// Friend challenges that were never seen, and payments that time out on the accepting device: the on-chain fallback,
// orphan deposits, the longer funding window, real client IPs, and the header balance guard.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.CAMPAIGN_TICK_MS = '3600000'
process.env.MAX_NEW_PROFILES_PER_IP = '3'

const { createApp } = await import('../server/index')
const { MockChain } = await import('../server/chain')
const { nextShownBalance, expectIncoming, BALANCE_ZERO_HOLD_MS } = await import('../shared/pay-balance')
const { clientIp } = await import('../server/signals')

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 5 + n * 11 + (i * n) % 7) % chars.length]).join('')
  return 'NQ34 ' + s.match(/.{4}/g)!.join(' ')
}
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())

async function call(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const login = async (a: string, name = 'P', headers: Record<string, string> = {}) => (await call(null, 'POST', '/session', { address: a, name }, headers)).j.token as string
const chain = () => app.chain as InstanceType<typeof MockChain>
const L = 1e5

/** Two friends; the first challenges the second to a staked match. */
async function challenge(n: number, stake = 10) {
  const a = addr(n), b = addr(n + 1)
  const ta = await login(a, 'Host'), tb = await login(b, 'Guest')
  const code = (await call(ta, 'GET', '/friends')).j.code
  await call(tb, 'POST', '/friends/add', { code })
  const m = (await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake, opp: 'invite', challenge: b })).j
  return { a, b, ta, tb, m }
}

test('a friend challenge reaches the friend on any screen, through the light /challenges poll', async () => {
  const { tb, ta, m } = await challenge(1)
  const r = (await call(tb, 'GET', '/challenges')).j
  assert.equal(r.challenges.length, 1)
  assert.equal(r.challenges[0].id, m.id)
  assert.equal(r.challenges[0].from.name, 'Host')
  assert.equal((await call(ta, 'GET', '/challenges')).j.challenges.length, 0, 'not to the challenger')
  const j = (await call(tb, 'POST', '/matches/join', { code: r.challenges[0].code })).j
  assert.equal(j.status, 'funding')
  assert.equal((await call(tb, 'GET', '/challenges')).j.challenges.length, 0, 'gone once accepted')
})

test('the accepter pays, Nimiq Pay times out, the hash never reaches the server: the deposit is found on chain', async () => {
  const { a, b, ta, tb, m } = await challenge(11)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  // the challenger locks the normal way
  const ha = chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  assert.equal((await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: ha })).j.status, 'funding')
  // the accepter's wallet broadcast the payment but the app got "Operation timed out after 30000 milliseconds"
  const before = app.engine.db.matches[m.id].fundBy!
  await call(tb, 'POST', `/matches/${m.id}/paying`)
  assert.ok(app.engine.db.matches[m.id].fundBy! >= before, 'the window waits for a paying seat')
  chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  const v = (await call(tb, 'POST', `/matches/${m.id}/find`)).j
  assert.equal(v.status, 'ready', 'both seats locked, the game starts')
  assert.ok(v.players.every((p: any) => p.funded))
  assert.equal(v.paying, undefined, 'server-only fields are not sent')
})

test('the background scan finds a deposit nobody reported, and a second payment becomes a refundable orphan', async () => {
  const { a, b, ta, tb, m } = await challenge(21)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  ;(app.engine as any).lastScan = 0
  await app.engine.scanAll()
  assert.equal(app.engine.db.matches[m.id].players.find((p) => p.player.address === b)!.funded, true)
  // the same device pays again (the screen was rebuilt): not lost, kept for a refund
  const dup = chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  ;(app.engine as any).lastScan = 0
  await app.engine.scanAll()
  const o = app.engine.db.orphans![dup]
  assert.ok(o, 'orphan recorded')
  assert.equal(o.status, 'open')
  assert.equal(o.luna, 10 * L)
  assert.match(o.why, /second payment/)
  assert.equal(app.engine.liabilities().orphans, 10 * L, 'counted as owed by the escrow')
  // nothing is sent until the owner clicks refund
  const sent = chain().paid.length
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(chain().paid.length, sent)
  const r = await app.engine.refundOrphan(dup)
  assert.equal(r.status, 'refunded')
  assert.equal(chain().paid.at(-1)!.to, b)
  assert.equal(chain().paid.at(-1)!.luna, 10 * L)
  await assert.rejects(app.engine.refundOrphan(dup), /Nothing to refund/)
  void a; void ta
})

test('a payment after the match was cancelled is kept as an orphan, never counted', async () => {
  const { b, tb, m } = await challenge(31)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  app.engine.db.matches[m.id].fundBy = Date.now() - 1
  assert.equal((await call(tb, 'GET', `/matches/${m.id}`)).j.status, 'cancelled')
  const late = chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  const r = await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: late })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /refunded/)
  assert.equal(app.engine.db.orphans![late].status, 'open')
})

test('a seat that said it was paying gets one last look on chain before the window closes', async () => {
  const { a, b, ta, tb, m } = await challenge(41)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo }) })
  await call(tb, 'POST', `/matches/${m.id}/paying`)
  chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  app.engine.db.matches[m.id].fundBy = Date.now() - 1
  await call(tb, 'GET', `/matches/${m.id}`)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(app.engine.db.matches[m.id].status, 'ready', 'found and counted instead of cancelled')
})

test('real client IP from the Fly proxy header, hashed on the server, and new profiles per IP are capped', async () => {
  assert.equal(clientIp({ headers: { 'fly-client-ip': '203.0.113.9' }, socket: { remoteAddress: '172.16.0.1' } } as any), '203.0.113.9')
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }, socket: {} } as any), '198.51.100.2')
  const h = { 'fly-client-ip': '203.0.113.77', 'x-nb-device': 'abc123' }
  for (let i = 0; i < 3; i++) assert.ok(await login(addr(60 + i), 'N', h))
  const r = await call(null, 'POST', '/session', { address: addr(63), name: 'N' }, h)
  assert.equal(r.status, 429, 'a 4th new profile from one IP today is refused')
  assert.ok(await login(addr(60), 'N', h), 'an existing player still signs in')
  assert.ok(await login(addr(63), 'N', { 'fly-client-ip': '203.0.113.78' }), 'another IP is fine')
  const dump = JSON.stringify((app.engine.db as any).signals)
  assert.ok(!dump.includes('203.0.113') && !dump.includes('abc123'), 'only keyed hashes are stored')
  assert.equal((app.engine.db as any).signals.by[addr(60)].devs.length, 1)
  const me = (await call(await login(addr(60), 'N', h), 'GET', '/me')).j
  assert.ok(!/signals|ips|devs/.test(JSON.stringify(me)), 'never shown to players')
})

test('header balance: a failed read or the brief 0 while Nimiq Pay moves funds never replaces the last balance', () => {
  const t = 1_000_000
  let s = nextShownBalance({ shown: undefined }, null, t).state
  assert.equal(s.shown, null, 'first read failed: unavailable, not 0')
  s = nextShownBalance(s, 50 * L, t).state
  assert.equal(s.shown, 50 * L)
  s = nextShownBalance(s, null, t + 1).state
  assert.equal(s.shown, 50 * L, 'an error keeps the last number')
  s = expectIncoming(s, 19.6 * L, t + 2)
  let r = nextShownBalance(s, 0, t + 3)
  assert.equal(r.state.shown, 50 * L, 'a sudden 0 right after a payout is not believed')
  assert.ok(r.retryMs, 'and is read again soon')
  r = nextShownBalance(r.state, 69.6 * L, t + 4000)
  assert.equal(r.state.shown, 69.6 * L)
  assert.equal(r.state.incoming, undefined, 'incoming clears once the balance includes it')
  // a real 0 (everything spent) is shown once it has held
  r = nextShownBalance(r.state, 0, t + 5000)
  assert.equal(r.state.shown, 69.6 * L)
  r = nextShownBalance(r.state, 0, t + 5000 + BALANCE_ZERO_HOLD_MS + 1)
  assert.equal(r.state.shown, 0)
})

test('right after the escrow paid a player, /paying tells their device to wait for Nimiq Pay to settle the wallet', async () => {
  const { a, b, ta, tb, m } = await challenge(71)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  const fresh = (await call(tb, 'POST', `/matches/${m.id}/paying`)).j
  assert.equal(fresh.waitMs, 0, 'nothing was paid to this wallet lately')
  // the challenger locked, then cancelled: the refund lands in the wallet, and Pay starts moving it into a new HTLC
  await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo }) })
  await call(ta, 'POST', `/matches/${m.id}/cancel`)
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(chain().paid.some((p) => p.to === a && /refund/.test(p.memo)), 'refunded')
  // a new challenge straight away: the refunded player is told to wait, the other one is not
  const tb2 = tb, tc = ta
  const m2 = (await call(tb2, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 10, opp: 'invite', challenge: a })).j
  await call(tc, 'POST', '/matches/join', { code: m2.code })
  const w = (await call(tc, 'POST', `/matches/${m2.id}/paying`)).j.waitMs
  assert.ok(w > 30_000 && w <= 50_000, `refunded wallet waits (${w} ms)`)
  assert.equal((await call(tb2, 'POST', `/matches/${m2.id}/paying`)).j.waitMs, 0)
  void b
})

test('an orphan paid from a Nimiq Pay HTLC that has since closed is refunded to the wallet that funded it', async () => {
  const { a, b, ta, tb, m } = await challenge(81)
  await call(tb, 'POST', '/matches/join', { code: m.code })
  const htlc = addr(85), htlc2 = addr(86)
  await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo }) })
  await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo }) })
  // a duplicate from an HTLC. Pay has closed it since, so it no longer looks like a contract (the old bug: owner = htlc)
  const dup = chain().register({ from: htlc, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: dup })
  const o = app.engine.db.orphans![dup]
  assert.ok(o)
  o.owner = htlc
  chain().funders.set(htlc, b)
  const r = await app.engine.refundOrphan(dup)
  assert.equal(r.status, 'refunded')
  assert.equal(chain().paid.at(-1)!.to, b, 'paid to the funding wallet, never the closed HTLC')
  assert.equal(r.owner, b)
  // a contract whose funder cannot be found is refused, nothing is sent
  const dup2 = chain().register({ from: htlc2, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: dup2 })
  assert.ok(app.engine.db.orphans![dup2])
  chain().contracts.add(htlc2)
  const n = chain().paid.length
  await assert.rejects(app.engine.refundOrphan(dup2), /by hand/)
  assert.equal(chain().paid.length, n)
  assert.equal(app.engine.db.orphans![dup2].status, 'open')
})

test('Nimiq Pay errors: a sync failure is "not sent, try again", a timeout may have gone out, a cancel is a cancel', async () => {
  const { isSendNotSent, isSendTimeout, isSendDenied } = await import('../shared/pay-errors')
  const sync = new Error('Something went wrong syncing your account')
  assert.equal(isSendNotSent(sync), true)
  assert.equal(isSendTimeout(sync), false)
  assert.equal(isSendDenied(sync), false)
  assert.equal(isSendNotSent({ type: 'INVALID_TRANSACTION', message: 'x' }), true)
  const to = new Error('Failed to send payment transaction: Operation timed out after 30000 milliseconds')
  assert.equal(isSendTimeout(to), true)
  assert.equal(isSendNotSent(to), false)
  assert.equal(isSendDenied(new Error('User rejected the request')), true)
})
