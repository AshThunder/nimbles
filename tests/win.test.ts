import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
process.env.TRIVIA_PAUSE_MS = '0' // answer the next trivia question at once
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 11 + n * 3) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
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
const login = async (a: string, name: string) => (await call(null, 'POST', '/session', { address: a, name })).j.token as string
const deposit = (from: string, luna: number, memo: string) => (app.chain as any).register({ from, to: app.chain.escrowAddress, luna, memo })
const eng = () => app.engine as any

test('Win: needs a real stake, never against Nimo', async () => {
  const t = await login(addr(1), 'W')
  for (const bad of [0, 0.5, -5, 'abc', null]) assert.equal((await call(t, 'POST', '/matches', { game: 'trivia', mode: 'win', stake: bad, opp: 'invite', config: { topic: 'Science', count: 5 } })).status, 400, `stake ${bad} is refused`)
  assert.equal((await call(t, 'POST', '/matches', { game: 'trivia', mode: 'win', stake: 2, opp: 'pip' })).status, 400)
})

test('stakes are open: any amount from 1 NIM, no list and no fixed maximum, rounded to 0.01', async () => {
  const t = await login(addr(40), 'Open')
  for (const [stake, want] of [[1, 1], [3, 3], [37.5, 37.5], [12.345, 12.35], [500, 500], [2500, 2500]] as const) {
    const r = await call(t, 'POST', '/matches', { game: 'trivia', mode: 'win', stake, opp: 'invite', config: { topic: 'Science', count: 5 } })
    assert.equal(r.status, 200, `stake ${stake}: ${JSON.stringify(r.j)}`)
    assert.equal(r.j.stake, want)
    await call(t, 'POST', `/matches/${r.j.id}/cancel`)
  }
  const prev = process.env.MAX_STAKE_NIM
  process.env.MAX_STAKE_NIM = '100' // an operator can still set a cap on purpose
  assert.equal((await call(t, 'POST', '/matches', { game: 'trivia', mode: 'win', stake: 101, opp: 'invite', config: { topic: 'Science', count: 5 } })).status, 400)
  if (prev === undefined) delete process.env.MAX_STAKE_NIM
  else process.env.MAX_STAKE_NIM = prev
})

test('Win duel: the winner is paid to their wallet, pot minus 2%, nothing goes to the jar', async () => {
  const A = addr(2), B = addr(3)
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const c = (await call(ta, 'POST', '/matches', { game: 'trivia', mode: 'win', stake: 2, opp: 'invite', config: { topic: 'Science', count: 5 } })).j
  assert.equal(c.mode, 'win')
  await call(tb, 'POST', '/matches/join', { code: c.code })
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 200000, c.escrow.memo) })
  assert.equal((await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, 200000, c.escrow.memo) })).j.status, 'ready')
  const m = eng().db.matches[c.id]
  m.startsAt = Date.now() - 10
  await call(ta, 'GET', `/matches/${c.id}`)
  for (let i = 0; i < 5; i++) {
    const right = m.trivia.questions[i].answer
    await call(ta, 'POST', `/matches/${c.id}/answer`, { q: i, choice: right, ms: 4000 })
    await call(tb, 'POST', `/matches/${c.id}/answer`, { q: i, choice: (right + 1) % 4, ms: 2000 })
  }
  const end = (await call(ta, 'GET', `/matches/${c.id}`)).j
  assert.equal(end.status, 'settled')
  assert.equal(end.settlement.winner, A)
  assert.deepEqual(end.settlement.jarCredit, {})
  assert.equal(end.settlement.fee, 8000)
  const prize = end.settlement.payouts.filter((p: any) => p.kind === 'prize')
  assert.equal(prize.length, 1)
  assert.equal(prize[0].to, A)
  assert.equal(prize[0].luna, 392000)
  assert.equal((await call(ta, 'GET', '/me')).j.jarLuna, 0, 'a Win never touches the jar')
})

test('Win in Splat Royale: auto-match joins a waiting arena of the same size and stake', async () => {
  const [a, b] = [addr(10), addr(11)]
  const ta = await login(a, 'Host'), tb = await login(b, 'Guest')
  const first = (await call(ta, 'POST', '/matches', { game: 'splat', mode: 'win', stake: 1, opp: 'auto', config: { seats: 3 } })).j
  assert.equal(first.status, 'lobby')
  const other = (await call(tb, 'POST', '/matches', { game: 'splat', mode: 'win', stake: 1, opp: 'auto', config: { seats: 4 } })).j
  assert.notEqual(other.id, first.id, 'a different seat count is a different arena')
  const tc = await login(addr(12), 'Third')
  const joined = (await call(tc, 'POST', '/matches', { game: 'splat', mode: 'win', stake: 1, opp: 'auto', config: { seats: 3 } })).j
  assert.equal(joined.id, first.id)
  assert.equal(joined.players.length, 2)
  // after the wait, two players are enough
  eng().db.matches[first.id].createdAt = Date.now() - 50_000
  const v = (await call(ta, 'GET', `/matches/${first.id}`)).j
  assert.equal(v.status, 'funding')
  assert.equal(eng().db.matches[first.id].size, 2)
})

test('Win in Splat Royale with top 3: prizes are paid to wallets, 60/30/10 of the pot after the fee', async () => {
  const as = [20, 21, 22, 23].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'S' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'win', stake: 5, opp: 'invite', config: { seats: 4, payout: 'top3' } })).j
  for (let i = 1; i < 4; i++) await call(ts[i], 'POST', '/matches/join', { code: c.code })
  for (let i = 0; i < 4; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], 500000, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  m.startsAt = Date.now() - 50
  await call(ts[0], 'GET', `/matches/${c.id}`)
  as.forEach((a) => eng().splat.connect(c.id, a, { send() {}, close() {} }))
  for (let now = m.startsAt; now < m.startsAt + 200_000 && m.status === 'playing'; now += 200) eng().splat.step(now)
  const st = m.settlement
  assert.equal(m.status, 'settled')
  assert.deepEqual(st.jarCredit, {})
  const prizes = st.payouts.filter((p: any) => p.kind === 'prize')
  assert.equal(prizes.length, 3)
  const net = 2_000_000 - st.fee
  assert.equal(prizes.reduce((s: number, p: any) => s + p.luna, 0), net)
  assert.equal(prizes[1].luna, Math.floor(net * 0.3))
  assert.equal(prizes[0].to, st.ranks[0].address)
})
