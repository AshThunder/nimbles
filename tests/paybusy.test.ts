// Nimiq Pay busy after NIM arrives (nimiq-pay-app#127): every wallet error maps to one friendly reading, a failed
// lock-in leaves the seat open and nothing locked, and an on-chain deposit is credited once and only once.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.CAMPAIGN_TICK_MS = '3600000'

const { createApp } = await import('../server/index')
const { MockChain } = await import('../server/chain')
const { classifyPayError, isPayBusy, isSendTimeout, isSendNotSent, payErrorCode, payErrorLog } = await import('../shared/pay-errors')

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 13 + (i * n) % 5) % chars.length]).join('')
  return 'NQ34 ' + s.match(/.{4}/g)!.join(' ')
}
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const login = async (a: string, name = 'P') => (await call(null, 'POST', '/session', { address: a, name })).j.token as string
const chain = () => app.chain as InstanceType<typeof MockChain>
const L = 1e5

async function duel(n: number, stake = 10) {
  const a = addr(n), b = addr(n + 1)
  const ta = await login(a, 'Host'), tb = await login(b, 'Guest')
  const code = (await call(ta, 'GET', '/friends')).j.code
  await call(tb, 'POST', '/friends/add', { code })
  const m = (await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake, opp: 'invite', challenge: b })).j
  await call(tb, 'POST', '/matches/join', { code: m.code })
  return { a, b, ta, tb, m }
}
const seat = (id: string, who: string) => app.engine.db.matches[id].players.find((p) => p.player.address === who)!

test('every Nimiq Pay busy error is read as busy (nothing sent), by message and by code', () => {
  const busy: unknown[] = [
    new Error('Nimiq network is not ready'),
    new Error('Error getting balance'),
    { code: -32000, message: 'Error getting balance' },
    { code: -32000, type: 'NETWORK_ERROR', message: 'x' },
    new Error('Something went wrong syncing your account'),
    new Error('Nimiq Pay is still updating your wallet'),
    { code: -32603, message: 'Failed to send payment transaction: A transaction is still pending. Wait for it to resolve before sending another.' },
    new Error('-32603 Failed to send payment transaction: A transaction is still pending.'),
    { data: { code: -32603 }, message: 'Internal error' },
    { type: 'INVALID_TRANSACTION', message: 'x' },
  ]
  for (const e of busy) {
    assert.equal(classifyPayError(e), 'busy', payErrorLog(e))
    assert.equal(isPayBusy(e), true)
    assert.equal(isSendNotSent(e), true)
    assert.equal(isSendTimeout(e), false, 'a busy error is not a "may have gone out" timeout: ' + payErrorLog(e))
  }
  assert.equal(payErrorCode({ code: '-32000' }), -32000)
  assert.equal(payErrorCode(new Error('code -32603: x')), -32603)
  assert.equal(payErrorCode(new Error('plain')), undefined)
})

test('the other readings stay distinct: cancel, real timeout, not enough NIM, unknown', () => {
  assert.equal(classifyPayError(new Error('User rejected the request')), 'denied')
  assert.equal(classifyPayError(new Error('Request cancelled by user')), 'denied')
  assert.equal(classifyPayError(new Error('Operation timed out after 30000 milliseconds')), 'timeout')
  assert.equal(classifyPayError(new Error('Payment timed out')), 'timeout')
  assert.equal(classifyPayError({ code: -32603, message: 'Failed to send payment transaction: Operation timed out after 30000 milliseconds' }), 'timeout', 'may have gone out, so it is looked for on chain')
  assert.equal(classifyPayError(new Error('Insufficient funds for this transaction')), 'funds')
  assert.equal(classifyPayError(new Error('Error getting balance')), 'busy', '"balance" alone is not "not enough NIM"')
  assert.equal(classifyPayError(new Error('Weird host failure')), 'other')
  assert.equal(classifyPayError(undefined), 'other')
  // the log line keeps the code and message for the console/server, trimmed
  assert.equal(payErrorLog({ code: -32000, type: 'NETWORK_ERROR', message: 'Error   getting\nbalance' }), '-32000 NETWORK_ERROR Error getting balance')
  assert.ok(payErrorLog(new Error('x'.repeat(500))).length <= 160)
})

test('a failed lock-in keeps the seat, locks nothing, stops "paying", gives time to retry, and never leaks the raw error', async () => {
  const { b, tb, m } = await duel(101)
  await call(tb, 'POST', `/matches/${m.id}/paying`)
  assert.ok(app.engine.db.matches[m.id].paying?.[b])
  app.engine.db.matches[m.id].fundBy = Date.now() + 10_000
  const v = (await call(tb, 'POST', `/matches/${m.id}/payfail`, { code: '-32603', error: 'Failed to send payment transaction: A transaction is still pending' })).j
  assert.equal(v.status, 'funding', 'the match is still collecting')
  assert.ok(v.players.some((p: any) => p.player.address === b && !p.funded), 'the seat is still there, unlocked')
  assert.equal(app.engine.db.matches[m.id].paying?.[b], undefined, 'no longer waiting on a payment that never left')
  assert.ok(app.engine.db.matches[m.id].fundBy! >= Date.now() + 170_000, 'the seat gets time to try again')
  assert.equal(v.payFails, undefined, 'server-only field')
  assert.ok(!JSON.stringify(v).includes('still pending'), 'the raw wallet error is never sent back')
  // the retry extension is capped, so a broken wallet cannot hold the other player forever
  for (let i = 0; i < 5; i++) { app.engine.db.matches[m.id].fundBy = Date.now() + 1000; await call(tb, 'POST', `/matches/${m.id}/payfail`, { code: 'sync' }) }
  assert.ok(app.engine.db.matches[m.id].fundBy! < Date.now() + 5000, 'no more extensions after the cap')
  // a timeout may have gone out: the seat stays "paying" for the last look on chain
  await call(tb, 'POST', `/matches/${m.id}/paying`)
  await call(tb, 'POST', `/matches/${m.id}/payfail`, { code: 'timeout', maybeSent: true })
  assert.ok(app.engine.db.matches[m.id].paying?.[b], 'still paying')
  // someone else's match: refused
  const outsider = await login(addr(150), 'Out')
  assert.equal((await call(outsider, 'POST', `/matches/${m.id}/payfail`, {})).status, 403)
})

test('a stake that lands on chain with no reply to the device is credited by the server, and only once', async () => {
  const { a, b, ta, tb, m } = await duel(111)
  const ha = chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: ha })
  // the guest's wallet broadcast, the app got nothing back
  const hb = chain().register({ from: b, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  // the device's "find", the background scan and a late hash report all race for the same deposit
  ;(app.engine as any).lastScan = 0
  const [f1, , f3] = await Promise.all([
    call(tb, 'POST', `/matches/${m.id}/find`),
    app.engine.scanAll(),
    call(tb, 'POST', `/matches/${m.id}/find`),
  ])
  assert.equal(f1.status, 200); assert.equal(f3.status, 200)
  const late = await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: hb })
  assert.equal(late.status, 200, 'the late report sees the seat already locked')
  assert.equal(seat(m.id, b).funded, true)
  assert.equal(seat(m.id, b).fundTx, hb)
  assert.equal(app.engine.db.usedTx[hb], m.id)
  assert.equal(app.engine.db.orphans?.[hb], undefined, 'the credited deposit is not also an orphan')
  assert.equal(app.engine.db.matches[m.id].status, 'ready')
  // the same transaction can never lock another seat
  const { tb: tb2, m: m2 } = await duel(121)
  const r = await call(tb2, 'POST', `/matches/${m2.id}/fund`, { txHash: hb })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /already used/)
  // nor be credited twice directly
  assert.throws(() => (app.engine as any).credit(app.engine.db.matches[m2.id], app.engine.db.matches[m2.id].players[1], hb, { ok: true, from: addr(122), related: [addr(122)], owner: addr(122) }), /already used/)
})

test('a deposit for the wrong amount or from a stranger is never credited', async () => {
  const { b, tb, m } = await duel(131)
  const small = chain().register({ from: b, to: chain().escrowAddress, luna: 1 * L, memo: m.escrow.memo })
  const stranger = chain().register({ from: addr(160), to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo })
  await call(tb, 'POST', `/matches/${m.id}/find`)
  assert.equal(seat(m.id, b).funded, false)
  assert.equal(app.engine.db.orphans?.[small]?.status, 'open', 'kept for a refund')
  assert.equal(app.engine.db.orphans?.[stranger]?.status, 'open', 'kept for a refund')
})

test('the profile says when Nimbles last paid the player, for the "Nimiq Pay is settling" banner', async () => {
  const { a, ta, m } = await duel(141)
  assert.equal((await call(ta, 'GET', '/me')).j.paidAt, undefined)
  await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: chain().register({ from: a, to: chain().escrowAddress, luna: 10 * L, memo: m.escrow.memo }) })
  await call(ta, 'POST', `/matches/${m.id}/cancel`)
  await new Promise((r) => setTimeout(r, 50))
  const at = (await call(ta, 'GET', '/me')).j.paidAt
  assert.ok(typeof at === 'number' && Date.now() - at < 5000, 'refund time reported')
})
