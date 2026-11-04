import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { earlyFee } from '../shared/rewards'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const S1 = addr(21), S2 = addr(22)

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
const E = () => app.engine as any
const DAY = 864e5

test('early unlock fee starts at 10% and shrinks to zero, never negative', () => {
  const t0 = 1_000_000, end = t0 + 30 * DAY
  assert.equal(earlyFee(1_000_000, t0, end, t0).fee, 100_000)
  assert.equal(earlyFee(1_000_000, t0, end, t0 + 15 * DAY).fee, 50_000)
  assert.equal(earlyFee(1_000_000, t0, end, end - DAY).fee, Math.floor(1_000_000 * 0.1 / 30))
  assert.equal(earlyFee(1_000_000, t0, end, end).fee, 0)
  assert.equal(earlyFee(1_000_000, t0, end, end + 5 * DAY).fee, 0)
  assert.equal(earlyFee(0, t0, end, t0).fee, 0)
  let last = Infinity
  for (let d = 0; d <= 30; d++) {
    const f = earlyFee(777_777, t0, end, t0 + d * DAY).fee
    assert.ok(f >= 0 && f <= last, 'fee only goes down')
    last = f
  }
})

test('plan: goal and lock length are the saver\'s choice, 7/30/90 only', async () => {
  const t = await login(S1, 'Sav')
  const j0 = (await call(t, 'GET', '/jar')).j
  assert.equal(j0.plan.lockDays, 30)
  assert.equal(j0.plan.goalLuna, 100 * 1e5)
  assert.equal((await call(t, 'POST', '/jar/plan', { lockDays: 14 })).status, 400)
  assert.equal((await call(t, 'POST', '/jar/plan', { goalNim: 0 })).status, 400)
  const j1 = (await call(t, 'POST', '/jar/plan', { goalNim: 250, lockDays: 90 })).j
  assert.equal(j1.plan.goalLuna, 250 * 1e5)
  assert.equal(j1.plan.lockDays, 90)
  assert.equal((await call(t, 'GET', '/me')).j.plan.lockDays, 90)
})

test('a new deposit never resets the lock, and the lock length is frozen while locked', async () => {
  const t = await login(S1, 'Sav')
  const p = E().db.profiles[S1]
  const day = new Date().toISOString().slice(0, 10)
  p.vaultDay = day // pretend the vault was solved
  const dep = (luna: number) => (app.chain as any).register({ from: S1, to: app.chain.escrowAddress, luna, memo: 'nb:vault:' + day.replace(/-/g, '') })
  const r1 = await call(t, 'POST', '/vault/deposit', { txHash: dep(100000), amount: 1 })
  assert.equal(r1.status, 200)
  const start = p.lockStartAt, until = p.jarUnlockAt
  assert.ok(until - start === 90 * DAY, 'lock follows the 90 day plan')
  assert.equal(p.jarLuna, 100000)
  // time passes, a second deposit arrives
  p.lockStartAt -= 10 * DAY
  p.jarUnlockAt -= 10 * DAY
  const kept = p.jarUnlockAt
  const r2 = await call(t, 'POST', '/vault/deposit', { txHash: dep(50000), amount: 0.5 })
  assert.equal(r2.status, 200)
  assert.equal(p.jarLuna, 150000)
  assert.equal(p.jarUnlockAt, kept, 'the second deposit leaves the unlock time alone')
  assert.equal((await call(t, 'POST', '/jar/plan', { lockDays: 7 })).status, 400)
  assert.equal((await call(t, 'POST', '/jar/plan', { goalNim: 500 })).status, 200, 'goal is always editable')
})

test('early unlock: refused without consent, then costs the shrinking fee and feeds the pool', async () => {
  const t = await login(S1, 'Sav')
  const p = E().db.profiles[S1]
  assert.equal((await call(t, 'POST', '/jar/withdraw', {})).status, 400)
  const q = (await call(t, 'GET', '/jar')).j
  assert.equal(q.locked, true)
  assert.ok(q.early.fee > 0 && q.early.fee < 15000, 'under 10% of 1.5 NIM')
  const poolBefore = E().pool.luna
  const paidBefore = (app.chain as any).paid.length
  const r = await call(t, 'POST', '/jar/withdraw', { early: true })
  assert.equal(r.status, 200)
  assert.equal(r.j.fee + r.j.luna, 150000)
  assert.equal(p.jarLuna, 0)
  assert.equal(p.jarUnlockAt, 0)
  assert.equal(E().pool.luna, poolBefore + r.j.fee)
  const paid = (app.chain as any).paid.slice(paidBefore)
  assert.equal(paid.length, 1)
  assert.equal(paid[0].luna, r.j.luna)
  assert.equal((await call(t, 'POST', '/jar/withdraw', { early: true })).status, 400, 'empty jar')
})

test('after the lock ends the jar withdraws free, and an empty jar lets the tier change', async () => {
  const t = await login(S2, 'Sav2')
  const p = E().db.profiles[S2]
  E().creditJar(p, 200000)
  assert.equal(p.jarUnlockAt - p.lockStartAt, 30 * DAY)
  p.jarUnlockAt = Date.now() - 1
  const q = (await call(t, 'GET', '/jar')).j
  assert.equal(q.locked, false)
  assert.equal(q.early.fee, 0)
  assert.equal((await call(t, 'POST', '/jar/plan', { lockDays: 7 })).status, 200)
  const r = await call(t, 'POST', '/jar/withdraw', {})
  assert.equal(r.status, 200)
  assert.equal(r.j.fee, 0)
  assert.equal(r.j.luna, 200000)
  E().creditJar(p, 100000)
  assert.equal(p.jarUnlockAt - p.lockStartAt, 7 * DAY, 'the new deposit starts a 7 day lock')
})

// ---------------- saver pool ----------------
import { levelBoostPct, poolDay, poolWeight, saveFee } from '../shared/rewards'

test('save fee is 2% of the pot, capped at 1 NIM', () => {
  assert.equal(saveFee(400000), 8000)
  assert.equal(saveFee(100 * 1e5), 1e5)
  assert.equal(saveFee(10_000 * 1e5), 1e5)
  assert.equal(saveFee(0), 0)
  assert.equal(saveFee(1), 0)
})

test('saver boost: +5% per 5 levels, capped at +25%', () => {
  assert.deepEqual([1, 4, 5, 9, 10, 24, 25, 40].map(levelBoostPct), [0, 0, 5, 5, 10, 20, 25, 25])
})

test('daily pool payout is proportional, capped, floored and never negative', () => {
  const w = { a: poolWeight(1_000_000, 90, 0), b: poolWeight(1_000_000, 30, 0), c: poolWeight(500_000, 30, 25) }
  const d = poolDay(1_000_000, w, 200_000, 0.05)
  assert.equal(d.day, 50_000)
  assert.ok(d.paid <= d.day && d.paid > d.day - 3)
  assert.ok(d.shares.a > d.shares.b * 2.9 && d.shares.a < d.shares.b * 3.1, '90 days earns 3x the 30 days at the same balance')
  assert.ok(d.shares.c > 0)
  // a boosted saver earns more than an unboosted one with the same balance and lock
  const e = poolDay(1_000_000, { x: poolWeight(1_000_000, 30, 25), y: poolWeight(1_000_000, 30, 0) }, 200_000, 0.05)
  assert.ok(e.shares.x > e.shares.y)
  // the daily cap holds on a huge pool
  assert.equal(poolDay(10_000 * 1e5, w, 200_000, 0.05).day, 200_000)
  // an empty pool or no savers pays nothing, and nothing is negative
  assert.equal(poolDay(0, w).paid, 0)
  assert.equal(poolDay(1_000_000, {}).paid, 0)
  assert.equal(poolDay(-5, w).day, 0)
  for (const s of Object.values(d.shares)) assert.ok(s > 0)
  assert.equal(poolWeight(0, 90, 10), 0n)
})

test('engine pays the pool once a day to locked jars only, without touching their lock', async () => {
  const E2 = E()
  const p1 = addr(31), p2 = addr(32), p3 = addr(33)
  for (const [a, n] of [[p1, 'P1'], [p2, 'P2'], [p3, 'P3']]) await login(a, n)
  const r1 = E2.db.profiles[p1], r2 = E2.db.profiles[p2], r3 = E2.db.profiles[p3]
  r1.plan = { goalLuna: 1e7, lockDays: 90 }; r2.plan = { goalLuna: 1e7, lockDays: 30 }
  E2.creditJar(r1, 1_000_000); E2.creditJar(r2, 1_000_000)
  E2.creditJar(r3, 1_000_000); r3.jarUnlockAt = Date.now() - 1 // unlocked, earns nothing
  const unlock1 = r1.jarUnlockAt
  E2.pool.luna = 1_000_000
  E2.pool.lastPayDay = '2000-01-01'
  const before = [r1.jarLuna, r2.jarLuna, r3.jarLuna]
  const sumAll = () => (Object.values(E2.db.profiles) as any[]).reduce((s, x) => s + x.jarLuna, 0)
  const all0 = sumAll()
  const { paid } = E2.payPool()
  assert.ok(paid > 0 && paid <= 50_000)
  assert.equal(sumAll() - all0, paid, 'every luna paid lands in a jar')
  assert.equal(r3.jarLuna, before[2], 'unlocked jar earns nothing')
  assert.ok(r1.jarLuna - before[0] > r2.jarLuna - before[1])
  assert.equal(r1.jarUnlockAt, unlock1, 'the lock is untouched')
  assert.equal(E2.pool.luna, 1_000_000 - paid)
  assert.equal(E2.payPool().paid, 0, 'a second run on the same day pays nothing')
  const info = (await call(await login(p1, 'P1'), 'GET', '/jar')).j
  assert.equal(info.interest.last, r1.jarLuna - before[0])
  assert.equal(info.interest.total, info.interest.last)
  assert.ok(info.pool.nextPayoutAt > Date.now())
})
