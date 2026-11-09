import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'
process.env.CAMPAIGN_START = new Date(Date.now() - 864e5).toISOString()
process.env.CAMPAIGN_END = new Date(Date.now() + 13 * 864e5).toISOString()
process.env.CAMPAIGN_TICK_MS = '3600000' // the tests drive the payout tick themselves

const { createApp } = await import('../server/index')
const { BUDGET_NIM, LEADERBOARD_TIERS_NIM, LEADERBOARD_WEEK_NIM, POOL_CAPS_NIM, splitReward, campaignWindow, rankBoard, CAMPAIGN_NAME } = await import('../shared/campaign')
const { isAdmin, ADMIN_DEFAULT } = await import('../server/campaign')

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 13 + (i * n) % 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const ADMIN = addr(900)
process.env.ADMIN_ADDRESSES = ADMIN

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
const C = () => app.campaign
const payer = () => app.campaign.payer as any
const L = 1e5

/** A finished match, the way settle() leaves it, fed straight to the campaign hook. */
let seq = 0
function finished(players: string[], o: { mode?: string; stake?: number; winner?: string; opp?: string; pipLevel?: string; game?: string; verified?: boolean; bot?: boolean } = {}) {
  const m: any = {
    id: 'f' + ++seq, code: 'NMB-T' + seq, game: o.game ?? 'darts', mode: o.mode ?? 'win', opp: o.opp ?? 'invite', pipLevel: o.pipLevel, stake: o.stake ?? 1, status: 'settled', host: players[0], size: 2,
    seed: 's', seedCommit: 'c', config: {}, escrow: { address: '', network: 'testnet', memo: '' }, createdAt: Date.now(),
    players: players.map((a) => ({ player: { address: a, name: 'x', avatar: 'ada' }, funded: (o.mode ?? 'win') !== 'play', escrowed: (o.mode ?? 'win') === 'play' ? 0 : (o.stake ?? 1) * L, result: { score: 10, time: 1, detail: { verified: o.verified ?? true } } })),
  }
  if (o.bot) m.players.push({ player: { address: 'PIP-BOT', name: 'Nimo', avatar: 'pip' }, funded: true, escrowed: 0, isBot: true, result: { score: 5, time: 1 } })
  m.settlement = { winner: o.winner ?? players[0], ranks: [], payouts: [], xp: {}, jarCredit: {}, reason: 'x' }
  C().onSettled(m, false)
  return m
}
const rewardsOf = (a: string) => Object.values(C().st.rewards).filter((r) => r.player === a)
const reset = () => {
  const st = C().st as any
  st.rewards = {}; st.players = {}; st.pairDay = {}; st.dayReleased = {}; st.paused = false; st.alerts = []; st.alerted = {}; st.weeksDone = {}
  st.amounts = { welcome: 50, friend: 20, invite: 100, nimo: 2 }
  st.caps = Object.fromEntries(Object.entries(POOL_CAPS_NIM).map(([k, v]) => [k, v * L]))
  for (const p of Object.values(app.engine.db.profiles)) p.cjar = undefined
  payer().ownBalance = 60_000 * L
  payer().paid.length = 0
  payer().failPays = false
}
async function befriend(a: string, b: string) {
  const ta = await login(a), tb = await login(b)
  const code = (await call(ta, 'GET', '/friends')).j.code
  const r = await call(tb, 'POST', '/friends/add', { code })
  assert.equal(r.status, 200, JSON.stringify(r.j))
}

test('budget: pools add to 50,000 NIM, leaderboard tiers add to 6,000 a week, every reward splits 50/50', () => {
  assert.equal(CAMPAIGN_NAME, 'Nimbles Showdown')
  assert.equal(BUDGET_NIM, 50_000)
  assert.equal(LEADERBOARD_TIERS_NIM.length, 20)
  assert.equal(LEADERBOARD_WEEK_NIM, 6_000)
  assert.equal(LEADERBOARD_TIERS_NIM[0], 1000)
  assert.equal(LEADERBOARD_TIERS_NIM[19], 100)
  for (let i = 1; i < 20; i++) assert.ok(LEADERBOARD_TIERS_NIM[i] <= LEADERBOARD_TIERS_NIM[i - 1])
  assert.equal(LEADERBOARD_WEEK_NIM * 2, POOL_CAPS_NIM.leaderboard)
  assert.deepEqual(splitReward(20 * L), { wallet: 10 * L, jar: 10 * L })
  assert.deepEqual(splitReward(3), { wallet: 1, jar: 2 })
  const w = campaignWindow({})
  assert.equal(new Date(w.start).toISOString(), '2026-11-08T23:00:00.000Z', 'Nov 9 00:00 WAT')
  assert.equal(new Date(w.end).toISOString(), '2026-11-23T23:00:00.000Z', 'through the end of Nov 23 WAT')
  assert.deepEqual(rankBoard([{ address: 'b', wins: 3, reachedAt: 5 }, { address: 'a', wins: 3, reachedAt: 2 }, { address: 'c', wins: 0, reachedAt: 1 }]).map((r) => r.address), ['a', 'b'])
})

test('welcome: 3 finished matches with one against a real player, paid half to wallet and half locked in the jar', async () => {
  reset()
  const [a, b] = [addr(1), addr(2)]
  await login(a); await login(b)
  finished([a], { mode: 'play', opp: 'pip', bot: true })
  finished([a], { mode: 'play', opp: 'pip', bot: true })
  finished([a], { mode: 'play', opp: 'pip', bot: true })
  assert.equal(rewardsOf(a).length, 0, 'three solo matches are not enough')
  finished([a, b], { mode: 'play' })
  const r = rewardsOf(a).find((x) => x.pool === 'welcome')!
  assert.equal(r.luna, 50 * L)
  await C().tick()
  assert.equal(r.status, 'paid')
  assert.deepEqual(payer().paid.map((p: any) => [p.to, p.luna]), [[a, 25 * L]])
  assert.equal(app.engine.db.profiles[a].cjar!.luna, 25 * L)
  assert.ok(app.engine.db.profiles[a].cjar!.unlockAt > Date.now() + 29 * 864e5, 'the jar lock rules apply')
  // idempotent: more matches and ticks never pay the welcome twice
  finished([a, b], { mode: 'play' })
  await C().tick(); await C().tick()
  assert.equal(payer().paid.filter((p: any) => p.to === a).length, 1)
  assert.equal(C().award('welcome', a, 50, `welcome:${a}`, 'again'), null)
})

test('friend duel: needs a friend, a staked finished match and 3 different opponents; 3 rewarded per pair per day', async () => {
  reset()
  const [a, b, c, d] = [addr(11), addr(12), addr(13), addr(14)]
  for (const x of [a, b, c, d]) await login(x)
  finished([a, b], { stake: 1 })
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'friend').length, 0, 'not friends yet')
  await befriend(a, b)
  finished([a, b], { stake: 1 })
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'friend').length, 0, 'only one opponent faced so far')
  finished([a, c], { stake: 1 }); finished([a, d], { stake: 1 }); finished([b, c], { stake: 1 }); finished([b, d], { stake: 1 })
  finished([a, b], { mode: 'play' })
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'friend').length, 0, 'free play does not count')
  for (let i = 0; i < 5; i++) finished([a, b], { stake: 1 })
  // 1 earlier pair match counted toward the daily limit, so two more were rewarded today
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'friend').length, 2)
  assert.equal(rewardsOf(b).filter((r) => r.pool === 'friend').length, 2)
  assert.equal(rewardsOf(a).find((r) => r.pool === 'friend')!.luna, 20 * L)
})

test('caps: a pool stops when empty, a player stops at 1,000 NIM, total can never pass the budget', async () => {
  reset()
  const a = addr(21)
  await login(a)
  C().st.caps.nimo = 5 * L
  assert.ok(C().award('nimo', a, 2, 'n1', 'x'))
  assert.ok(C().award('nimo', a, 2, 'n2', 'x'))
  assert.equal(C().award('nimo', a, 2, 'n3', 'x')!.luna, 1 * L, 'clamped to what is left')
  assert.equal(C().award('nimo', a, 2, 'n4', 'x'), null, 'empty pool pays nothing')
  reset()
  for (let i = 0; i < 20; i++) C().award('invite', a, 100, 'i' + i, 'x')
  assert.equal(C().earnedBy(a), 1000 * L)
  assert.equal(C().award('friend', a, 20, 'f1', 'x'), null)
  // reserve moves never grow the budget
  const before = Object.values(C().st.caps).reduce((s, x) => s + x, 0)
  C().adminSet({ moveFromReserve: { pool: 'friend', nim: 1000 } })
  assert.equal(Object.values(C().st.caps).reduce((s, x) => s + x, 0), before)
  assert.throws(() => C().adminSet({ moveFromReserve: { pool: 'friend', nim: 5000 } }))
  assert.throws(() => C().adminSet({ amounts: { friend: 5000 } }), 'amount bounds')
})

test('payout queue: daily pace, short wallet and the pause all queue instead of failing; a failed send retries', async () => {
  reset()
  const players = Array.from({ length: 4 }, (_, i) => addr(31 + i))
  for (const p of players) await login(p)
  for (const p of players) C().award('invite', p, 100, 'inv:' + p, 'x') // 400 NIM
  C().st.dayReleased[(await import('../shared/campaign')).campaignDay()] = 2_850 * L // 150 left in today's pace
  await C().tick()
  assert.equal(Object.values(C().st.rewards).filter((r) => r.status === 'paid').length, 1)
  assert.equal(Object.values(C().st.rewards).filter((r) => r.status === 'queued' && r.wait?.startsWith('Daily pace')).length, 3)
  reset()
  payer().ownBalance = 30 * L
  C().award('invite', players[0], 100, 'inv:x', 'x')
  await C().tick()
  const r = C().st.rewards['inv:x']
  assert.equal(r.status, 'queued')
  assert.match(r.wait!, /funds/)
  assert.equal(payer().paid.length, 0)
  assert.ok(C().st.alerts.some((x) => x.pool === 'wallet'))
  payer().ownBalance = 1000 * L
  C().adminSet({ paused: true })
  await C().tick()
  assert.equal(r.status, 'queued', 'paused: nothing goes out')
  C().adminSet({ paused: false })
  payer().failPays = true
  await C().tick()
  assert.equal(r.status, 'queued')
  assert.ok(r.error)
  assert.ok(r.jarCredited, 'the jar half is credited once on release')
  payer().failPays = false
  r.lastTryAt = 0
  await C().tick()
  assert.equal(r.status, 'paid')
  assert.equal(app.engine.db.profiles[players[0]].cjar!.luna, 50 * L, 'jar half credited exactly once')
})

test('alerts fire when a pool drops below 20%', () => {
  reset()
  const a = addr(41)
  C().st.caps.welcome = 100 * L
  C().award('welcome', a, 85, 'w', 'x')
  assert.ok(C().st.alerts.some((x) => x.pool === 'welcome'))
})

test('Nimo on Hard: verified wins pay, 10 a day, client-scored or easy wins do not', async () => {
  reset()
  const a = addr(51)
  await login(a)
  finished([a], { mode: 'play', opp: 'pip', pipLevel: 'hard', bot: true, verified: false })
  finished([a], { mode: 'play', opp: 'pip', pipLevel: 'med', bot: true })
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'nimo').length, 0)
  for (let i = 0; i < 12; i++) finished([a], { mode: 'play', opp: 'pip', pipLevel: 'hard', bot: true })
  assert.equal(rewardsOf(a).filter((r) => r.pool === 'nimo').length, 10)
  assert.equal(rewardsOf(a).find((r) => r.pool === 'nimo')!.luna, 2 * L)
})

test('Nimo on Hard over HTTP: a server-scored trivia win is rewarded', async () => {
  reset()
  const a = addr(52)
  const t = await login(a)
  const c = (await call(t, 'POST', '/matches', { game: 'trivia', mode: 'play', opp: 'pip', pipLevel: 'hard', config: { topic: 'Science', count: 5 } })).j
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 10
  await call(t, 'GET', `/matches/${c.id}`)
  m.trivia!.pip = m.trivia!.pip!.map((x) => ({ ...x, correct: false, points: 0 }))
  for (let i = 0; i < 5; i++) await call(t, 'POST', `/matches/${c.id}/answer`, { q: i, choice: m.trivia!.questions[i].answer, ms: 1500 })
  assert.equal(m.settlement?.winner, a)
  assert.ok(C().st.rewards[`nimo:${c.id}`])
})

test('invites: a new player who adds a friend code and plays 5 matches earns the inviter a reward, at most 5', async () => {
  reset()
  const host = addr(61), guest = addr(62), other = addr(63)
  const th = await login(host), tg = await login(guest)
  await login(other)
  const code = (await call(th, 'GET', '/friends')).j.code
  await call(tg, 'POST', '/friends/add', { code })
  assert.equal(app.engine.db.profiles[guest].invitedBy, host)
  for (let i = 0; i < 4; i++) finished([guest], { mode: 'play', opp: 'pip', bot: true })
  assert.equal(rewardsOf(host).filter((r) => r.pool === 'invite').length, 0)
  // the inviter sees each invited friend's own progress, and nothing earned yet (no amount shown before it is earned)
  let sd = (await call(th, 'GET', '/showdown')).j
  assert.deepEqual(sd.steps.invites.list.map((x: any) => [x.done, x.need, x.earned]), [[4, 5, 0]])
  assert.equal(sd.byStep.invite, undefined)
  finished([guest, other], { mode: 'play' })
  assert.equal(rewardsOf(host).filter((r) => r.pool === 'invite').length, 1)
  assert.equal(rewardsOf(host)[0].luna, 100 * L)
  sd = (await call(th, 'GET', '/showdown')).j
  assert.equal(sd.steps.invites.list[0].earned, 100 * L, 'once earned, the step shows what it paid')
  assert.equal(sd.byStep.invite, 100 * L)
  assert.ok(!JSON.stringify(sd).includes('budget') && !JSON.stringify(sd.steps).includes('amount'), 'no budget or prices in the player view')
})

test('weekly leaderboard: top wins at the end of the week get the fixed tiers, once', async () => {
  reset()
  const ps = [addr(71), addr(72), addr(73)]
  for (const p of ps) await login(p)
  finished([ps[0], ps[1]], { stake: 1, winner: ps[0] })
  finished([ps[0], ps[2]], { stake: 1, winner: ps[0] })
  finished([ps[1], ps[2]], { stake: 1, winner: ps[1] })
  const later = C().window.start + 7 * 864e5 + 1000
  C().closeWeeks(later)
  C().closeWeeks(later)
  const lb = Object.values(C().st.rewards).filter((r) => r.pool === 'leaderboard')
  assert.deepEqual(lb.map((r) => [r.player, r.luna / L]).sort(), [[ps[0], 1000], [ps[1], 800]].sort())
})

test('player view shows only their own progress and amounts', async () => {
  reset()
  const a = addr(81)
  const t = await login(a)
  C().award('invite', a, 100, 'x1', 'Invite')
  await C().tick()
  const v = (await call(t, 'GET', '/showdown')).j
  assert.equal(v.name, 'Nimbles Showdown')
  assert.equal(v.earned.total, 100 * L)
  assert.equal(v.jar.luna, 50 * L)
  const s = JSON.stringify(v)
  assert.ok(!/budget|caps|pool|remaining|allocated|amounts/i.test(s), 'no budget, pool sizes or reward prices leak to players')
  // locked half withdraws early with the sliding fee, paid from the campaign wallet
  const w = (await call(t, 'POST', '/showdown/jar/withdraw', { early: true })).j
  assert.ok(w.fee > 0 && w.luna + w.fee === 50 * L)
  assert.equal((await call(t, 'POST', '/showdown/jar/withdraw', { early: true })).status, 400)
})

test('admin: only the owner wallet, exact match, on every admin call', async () => {
  assert.equal(isAdmin(ADMIN_DEFAULT, {}), true)
  assert.equal(isAdmin('NQ20 0000 0000 0000 0000 0000 0000 0000 NHGR', {}), false, 'prefix and suffix are not enough')
  const tu = await login(addr(91))
  const ta = await login(ADMIN)
  assert.equal((await call(tu, 'GET', '/admin/me')).j.admin, false)
  for (const [m, p] of [['GET', '/admin/campaign'], ['POST', '/admin/campaign'], ['GET', '/admin/stats']]) assert.equal((await call(tu, m, p, m === 'POST' ? { paused: true } : undefined)).status, 403)
  assert.equal((await call(null, 'GET', '/admin/stats')).status, 401)
  assert.equal(C().st.paused, false)
  const v = (await call(ta, 'GET', '/admin/campaign')).j
  assert.equal(v.budget, 50_000 * L)
  assert.equal(v.pools.length, 6)
  const s = (await call(ta, 'GET', '/admin/stats')).j
  assert.ok(s.users.total > 0)
  assert.ok(s.top.every((r: any) => /^NQ..…....$/.test(r.addr)), 'players are shortened addresses')
  const set = (await call(ta, 'POST', '/admin/campaign', { paused: true, amounts: { friend: 25 } })).j
  assert.equal(set.paused, true)
  assert.equal(set.amounts.friend, 25)
  await call(ta, 'POST', '/admin/campaign', { paused: false, amounts: { friend: 20 } })
})

test('match me lobby: open challenges are listed, the nearest stake within 50% is offered and confirmed by joining', async () => {
  const [a, b] = [addr(101), addr(102)]
  const ta = await login(a), tb = await login(b)
  const host = (await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 50, opp: 'auto' })).j
  assert.equal(host.status, 'lobby')
  const list = (await call(tb, 'GET', '/lobby?game=darts&mode=win')).j.open
  assert.ok(list.some((x: any) => x.code === host.code && x.stake === 50))
  assert.equal((await call(ta, 'GET', '/lobby')).j.open.some((x: any) => x.code === host.code), false, 'never your own')
  // 40 NIM: 50 is within ±50% of 40, so it is offered, never joined automatically
  const s = (await call(tb, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 40, opp: 'auto' })).j
  assert.equal(s.suggest.code, host.code)
  assert.equal(s.suggest.stake, 50)
  // a custom 75 is also close enough (50 is 33% below)
  assert.equal((await call(tb, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 75, opp: 'auto' })).j.suggest?.code, host.code)
  // too far apart (10 vs 50) is not offered: a waiting match of its own is opened instead
  const far = (await call(tb, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 10, opp: 'auto' })).j
  assert.equal(far.suggest, undefined)
  assert.equal(far.status, 'lobby')
  await call(tb, 'POST', `/matches/${far.id}/cancel`)
  const j = (await call(tb, 'POST', '/matches/join', { code: s.suggest.code })).j
  assert.equal(j.status, 'funding')
  assert.equal(j.stake, 50)
})

test('friends: request a recent opponent, accept, online, and challenge directly', async () => {
  const [a, b] = [addr(111), addr(112)]
  const ta = await login(a), tb = await login(b)
  assert.equal((await call(ta, 'POST', '/friends/request', { address: b })).status, 400, 'only people you played')
  app.engine.db.profiles[a].friends.push(b)
  const r1 = (await call(ta, 'POST', '/friends/request', { address: b })).j
  assert.equal(r1.recent.find((x: any) => x.address === b).asked, true)
  const inc = (await call(tb, 'GET', '/friends')).j
  assert.equal(inc.incoming[0].address, a)
  const ok = (await call(tb, 'POST', '/friends/accept', { address: a })).j
  assert.equal(ok.friends[0].address, a)
  assert.equal(ok.friends[0].online, true)
  const ch = (await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 1, opp: 'invite', challenge: b })).j
  assert.equal((await call(tb, 'GET', '/friends')).j.challenges[0].code, ch.code)
  assert.equal((await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 1, opp: 'invite', challenge: addr(113) })).status, 400)
})
