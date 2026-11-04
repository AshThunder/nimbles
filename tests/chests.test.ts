import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { chestContents, chestsDue } from '../shared/rewards'

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
const today = new Date().toISOString().slice(0, 10)

test('chests are due for a daily win, a 3-win day, streak milestones and level-ups, once each', () => {
  const base = { today: '2026-11-04', wins: 0, streak: 0, streakStart: '2026-11-04', level: 3, lvlSeen: 3 }
  assert.deepEqual(chestsDue(base), [])
  assert.deepEqual(chestsDue({ ...base, wins: 1 }).map((c) => c.id), ['win:2026-11-04'])
  assert.deepEqual(chestsDue({ ...base, wins: 3 }).map((c) => c.kind), ['win', 'triple'])
  assert.deepEqual(chestsDue({ ...base, streak: 7, streakStart: '2026-10-29' }).map((c) => c.id), ['streak3:2026-10-29', 'streak7:2026-10-29'])
  assert.deepEqual(chestsDue({ ...base, streak: 30 }).map((c) => c.kind), ['streak3', 'streak7', 'streak30'])
  assert.deepEqual(chestsDue({ ...base, level: 5 }).map((c) => c.id), ['lvl:4', 'lvl:5'])
})

test('contents are fixed per kind and never include NIM', () => {
  for (const k of ['win', 'triple', 'streak3', 'streak7', 'streak30', 'level'] as const) {
    const a = chestContents(k, 10), b = chestContents(k, 10)
    assert.deepEqual(a, b)
    assert.ok(a.xp > 0)
    assert.ok(!('luna' in a) && !('nim' in a))
  }
  assert.equal(chestContents('level', 10).badge, 'level-10')
  assert.equal(chestContents('level', 7).badge, undefined)
})

test('engine gives each chest once, opens it for its fixed contents, and boosts the saver share', async () => {
  const a = addr(41)
  const t = await login(a, 'Chesty')
  const r = E().db.profiles[a]
  r.questDay = today
  r.questWins = 3
  r.activeDays = [today]
  const list = (await call(t, 'GET', '/chests')).j
  const ids = list.chests.map((c: any) => c.id)
  assert.ok(ids.includes('win:' + today) && ids.includes('triple:' + today))
  assert.equal((await call(t, 'GET', '/chests')).j.chests.length, list.chests.length, 'a second look adds nothing')
  const xp0 = r.xp
  const o = (await call(t, 'POST', '/chests/open', { id: 'triple:' + today })).j
  assert.equal(o.opened.contents.xp, 100)
  assert.equal(r.xp, xp0 + 100)
  assert.ok(r.badges.includes('hot-hand') && r.cosmetics.includes('theme:butter'))
  assert.equal(E().boostPct(r), 10, 'chest boost counts toward the saver share')
  assert.equal((await call(t, 'POST', '/chests/open', { id: 'triple:' + today })).status, 400, 'no second opening')
  assert.equal((await call(t, 'POST', '/chests/open', { id: 'nope' })).status, 400)
  // boosts end on time and the level boost plus chest boost is capped
  r.boosts = [{ pct: 10, until: Date.now() - 1 }]
  assert.equal(E().boostPct(r), 0)
  r.boosts = [{ pct: 90, until: Date.now() + 1000 }]
  assert.ok(E().boostPct(r) <= 40)
})

test('a level-up earns a chest, and old players are not flooded', async () => {
  const a = addr(42)
  const t = await login(a, 'Levels')
  const r = E().db.profiles[a]
  await call(t, 'GET', '/chests') // sets the marker at level 1
  r.xp = 400 // level 2
  const l = (await call(t, 'GET', '/chests')).j
  assert.ok(l.chests.some((c: any) => c.id === 'lvl:2'))
  const b = addr(43)
  await login(b, 'Vet')
  E().db.profiles[b].xp = 100000
  const l2 = (await call(await login(b, 'Vet'), 'GET', '/chests')).j
  assert.equal(l2.chests.filter((c: any) => c.kind === 'level').length, 0)
})
