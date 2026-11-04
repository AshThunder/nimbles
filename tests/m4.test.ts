import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { PLACE_SPLIT, escrowRequired, evenShares, placeShares, toLuna } from '../shared/economy'

process.env.CHAIN = 'mock'
process.env.NIMBLES_UNLOCK_ALL = '1' // these games are held back in production, the tests open them
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 13 + n * 7) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())
const call = async (token: string | null, method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const login = async (a: string, name: string) => (await call(null, 'POST', '/session', { address: a, name })).j.token as string
const deposit = (from: string, luna: number, memo: string) => (app.chain as any).register({ from, to: app.chain.escrowAddress, luna, memo })
const eng = () => app.engine as any
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

test('placement split: every row adds to 100, the winner pays least, 3 players is 50/30/20 for last, middle, first', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const p = PLACE_SPLIT[n]
    assert.equal(p.length, n)
    assert.equal(sum(p), 100)
    for (let i = 1; i < n; i++) assert.ok(p[i] > p[i - 1], 'a worse place never pays less')
    for (const bill of [0.5, 3, 7.77, 10, 999.99]) {
      assert.equal(sum(placeShares(bill, n)), toLuna(bill), 'the shares add up to the bill, to the luna')
      assert.equal(sum(evenShares(bill, n)), toLuna(bill))
    }
  }
  assert.deepEqual(placeShares(10, 3), [200000, 300000, 500000].map((x) => x * 1))
  assert.deepEqual(PLACE_SPLIT[3], [20, 30, 50])
  assert.equal(escrowRequired('settle', 10, 100, 3), 500000, 'each locks the most they could owe')
})

async function lobby(n: number, payee: unknown, hostN: number, bill = 10) {
  const as = Array.from({ length: n }, (_, i) => addr(hostN + i))
  const ts = await Promise.all(as.map((a, i) => login(a, 'S' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'settle', opp: 'invite', terms: { bill, payee }, config: { seats: n } })).j
  return { as, ts, c }
}

test('3 players settle a bill: the host sets it, all agree, everyone locks the most they could owe, the bill goes to the payee, the rest comes back', async () => {
  const payee = addr(199)
  const { as, ts, c } = await lobby(3, payee, 100)
  assert.equal(c.terms.split, 'place')
  assert.equal(c.terms.lock, 500000)
  assert.equal(c.status, 'lobby')
  for (let i = 1; i < 3; i++) assert.equal((await call(ts[i], 'POST', '/matches/join', { code: c.code })).status, 200)
  const v = (await call(ts[0], 'GET', `/matches/${c.id}`)).j
  assert.equal(v.status, 'terms')
  // only the host can change the bill
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/terms`, { action: 'propose', bill: 1, payee: 'me' })).status, 400)
  // agreeing to an old revision is refused, and one agreement is not enough
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 99 })).status, 400)
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })).j.status, 'terms')
  const host = (await call(ts[0], 'POST', `/matches/${c.id}/terms`, { action: 'propose', bill: 9, payee })).j
  assert.equal(host.terms.rev, 2)
  assert.deepEqual(host.terms.agreed, [as[0]], 'a change clears the others')
  assert.equal(host.terms.lock, 450000)
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 2 })).j.status, 'terms')
  assert.equal((await call(ts[2], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 2 })).j.status, 'funding')
  for (let i = 0; i < 3; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], 450000, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  assert.equal(m.status, 'ready')
  m.startsAt = Date.now() - 50
  assert.equal((await call(ts[0], 'GET', `/matches/${c.id}`)).j.status, 'playing')
  const seen = { send() {}, close() {} }
  as.forEach((a) => assert.ok(eng().splat.connect(c.id, a, seen)))
  for (let now = m.startsAt; now < m.startsAt + 200_000 && m.status === 'playing'; now += 200) eng().splat.step(now)
  assert.equal(m.status, 'settled')
  const st = m.settlement
  assert.deepEqual(st.ranks.map((r: any) => r.rank), [1, 2, 3])
  const shares = placeShares(9, 3)
  const bill = st.payouts.filter((p: any) => p.kind === 'settle')
  assert.equal(bill.length, 1)
  assert.equal(bill[0].to, payee)
  assert.equal(bill[0].luna, 900000, 'the payee gets the whole bill')
  // each player gets their lock back minus what their place owes
  st.ranks.forEach((r: any, i: number) => {
    const back = st.payouts.filter((p: any) => p.kind === 'refund' && p.to === r.address).reduce((a: number, p: any) => a + p.luna, 0)
    assert.equal(back, 450000 - shares[i], `place ${i + 1} gets back lock minus share`)
  })
  assert.equal(sum(st.payouts.map((p: any) => p.luna)), 3 * 450000, 'every luna locked is paid out, nothing kept')
  assert.equal(st.fee, undefined, 'a settled bill has no saver fee')
})

test('payee is one of the players: they keep their own share, the others pay them', async () => {
  const { as, ts, c } = await lobby(3, 'me', 110, 6)
  for (let i = 1; i < 3; i++) await call(ts[i], 'POST', '/matches/join', { code: c.code })
  for (let i = 0; i < 3; i++) await call(ts[i], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })
  const lock = 300000
  for (let i = 0; i < 3; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], lock, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  m.startsAt = Date.now() - 50
  await call(ts[0], 'GET', `/matches/${c.id}`)
  as.forEach((a) => eng().splat.connect(c.id, a, { send() {}, close() {} }))
  for (let now = m.startsAt; now < m.startsAt + 200_000 && m.status === 'playing'; now += 200) eng().splat.step(now)
  assert.equal(m.status, 'settled')
  const st = m.settlement
  assert.equal(sum(st.payouts.map((p: any) => p.luna)), 3 * lock)
  const shares = placeShares(6, 3)
  const hostPlace = st.ranks.findIndex((r: any) => r.address === as[0])
  const others = sum(shares) - shares[hostPlace]
  const got = st.payouts.filter((p: any) => p.to === as[0]).reduce((a: number, p: any) => a + p.luna, 0)
  assert.equal(got, lock + others, 'the host gets their lock back and the other two shares')
})

test('a cancel after somebody locked refunds them, and nobody is charged for an unagreed bill', async () => {
  const { as, ts, c } = await lobby(3, 'me', 120)
  for (let i = 1; i < 3; i++) await call(ts[i], 'POST', '/matches/join', { code: c.code })
  for (let i = 0; i < 3; i++) await call(ts[i], 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })
  assert.equal((await call(ts[1], 'GET', `/matches/${c.id}`)).j.status, 'funding')
  await call(ts[1], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[1], 500000, c.escrow.memo) })
  const out = (await call(ts[0], 'POST', `/matches/${c.id}/cancel`)).j
  assert.equal(out.status, 'cancelled')
  const refunds = eng().db.matches[c.id].settlement?.payouts ?? []
  assert.equal(sum(refunds.filter((p: any) => p.to === as[1]).map((p: any) => p.luna)), 500000)
  assert.equal(sum(refunds.map((p: any) => p.luna)), 500000, 'only what was locked comes back')
})

test('the host starts with fewer players than seats: the split is worked out again and everybody agrees again', async () => {
  const { as, ts, c } = await lobby(4, 'me', 130, 8)
  await call(ts[1], 'POST', '/matches/join', { code: c.code })
  await call(ts[2], 'POST', '/matches/join', { code: c.code })
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/start`)).status, 403, 'only the host starts')
  const v = (await call(ts[0], 'POST', `/matches/${c.id}/start`)).j
  assert.equal(v.status, 'terms')
  assert.equal(v.size, 3)
  assert.equal(v.terms.rev, 2)
  assert.equal(v.terms.lock, escrowRequired('settle', 8, 100, 3))
  assert.deepEqual(v.terms.agreed, [as[0]])
})
