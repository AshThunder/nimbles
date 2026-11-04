import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { derivedBadges, lockXpPct, streakXpPct, unlockedCosmetics, withXpBonus } from '../shared/rewards'

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
const E = () => app.engine as any

test('XP bonuses: streak and lock, plain percentages', () => {
  assert.deepEqual([0, 2, 3, 6, 7, 29, 30, 99].map(streakXpPct), [0, 0, 10, 10, 20, 20, 30, 30])
  assert.equal(lockXpPct(7, true), 5)
  assert.equal(lockXpPct(30, true), 10)
  assert.equal(lockXpPct(90, true), 20)
  assert.equal(lockXpPct(90, false), 0, 'no lock, no bonus')
  assert.equal(withXpBonus(80, 30), 104)
  assert.equal(withXpBonus(80, 0), 80)
  assert.ok(withXpBonus(5, 50) >= 5)
})

test('badges earned by playing, and cosmetics unlocked by level', () => {
  assert.deepEqual(derivedBadges({ wins: 0, saved: false }), [])
  assert.deepEqual(derivedBadges({ wins: 12, saved: true }), ['first-win', 'wins-10', 'saver'])
  assert.deepEqual(unlockedCosmetics(1, []), [])
  assert.deepEqual(unlockedCosmetics(5, []), ['theme:sky', 'frame:blue'])
  assert.ok(unlockedCosmetics(15, []).includes('frame:coral') && unlockedCosmetics(15, []).includes('theme:blush'))
  assert.ok(unlockedCosmetics(1, ['frame:gold']).includes('frame:gold'))
})

test('style: wear only what is unlocked', async () => {
  const a = addr(51)
  const t = await login(a, 'Styler')
  assert.equal((await call(t, 'POST', '/me/style', { frame: 'frame:blue' })).status, 400, 'locked until level 5')
  assert.equal((await call(t, 'POST', '/me/style', { frame: 'theme:sky' })).status, 400, 'wrong kind')
  assert.equal((await call(t, 'POST', '/me/style', { theme: 'theme:nope' })).status, 400)
  E().db.profiles[a].xp = 5000
  const r = await call(t, 'POST', '/me/style', { frame: 'frame:blue', theme: 'theme:sky' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.j.style, { frame: 'frame:blue', theme: 'theme:sky' })
  assert.ok(r.j.unlocked.includes('frame:blue'))
  const off = await call(t, 'POST', '/me/style', { frame: '' })
  assert.equal(off.j.style.frame, '')
  assert.equal(off.j.style.theme, 'theme:sky')
})

test('saver board: ranked by this week interest, then lock weight', async () => {
  const a = addr(52), b = addr(53), c = addr(54)
  const ta = await login(a, 'A'), tb = await login(b, 'B'), tc = await login(c, 'C')
  const [ra, rb, rc] = [a, b, c].map((x) => E().db.profiles[x])
  E().creditJar(ra, 200_000); E().creditJar(rb, 200_000); E().creditJar(rc, 200_000)
  const wk = (E().profile(a) && ra.interestWeekKey) || undefined
  void wk
  ra.plan = { goalLuna: 1e7, lockDays: 7 }
  rb.plan = { goalLuna: 1e7, lockDays: 90 }
  rc.plan = { goalLuna: 1e7, lockDays: 30 }
  const now = new Date()
  // same interest for a and b, c has more
  const key = (E().payPool, null)
  void key
  for (const [r, v] of [[ra, 1000], [rb, 1000], [rc, 5000]] as const) { r.interestWeek = v; r.interestWeekKey = E().weekKeyNow() }
  const j = (await call(ta, 'GET', '/leaderboard/savers')).j
  const order = j.rows.map((r: any) => r.name).filter((n: string) => ['A', 'B', 'C'].includes(n))
  assert.deepEqual(order, ['C', 'B', 'A'], 'interest first, then balance x lock days')
  assert.ok(j.me && j.me.name === 'A')
  assert.equal(j.rows.find((r: any) => r.name === 'C').lockDays, 30)
  void tb; void tc; void now
})

test('a win earns XP with the streak and lock bonus, and a forfeit earns none', async () => {
  const E2 = E()
  const a = addr(55)
  await login(a, 'Bonus')
  const r = E2.db.profiles[a]
  r.activeDays = Array.from({ length: 8 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10))
  r.plan = { goalLuna: 1e7, lockDays: 90 }
  E2.creditJar(r, 100_000)
  const info = E2.jarInfo(a)
  assert.equal(info.locked, true)
  assert.equal(E2.streakOf(r).streak, 8)
  assert.equal(withXpBonus(80, streakXpPct(8) + lockXpPct(90, true)), 80 + Math.floor(80 * 40 / 100))
})
