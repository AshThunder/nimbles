// Nimbles Showdown, season 2: no instant rewards, a weekly ladder from staked games against real players, prizes held
// for review, weekend knockouts, invites at season end, and a migration that pauses payouts.
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
const S2 = await import('../shared/campaign')
const { isAdmin, ADMIN_DEFAULT, migrateV2 } = await import('../server/campaign')

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
const DAY = 864e5

let seq = 0
/** A finished match, the way settle() leaves it, fed straight to the campaign hook. */
function finished(players: string[], o: { mode?: string; stake?: number; winner?: string; opp?: string; bot?: boolean; at?: number; draw?: boolean } = {}) {
  const mode = o.mode ?? 'win'
  const m: any = {
    id: 'f' + ++seq, code: 'NMB-T' + seq, game: 'darts', mode, opp: o.opp ?? 'invite', stake: o.stake ?? 10, status: 'settled', host: players[0], size: 2,
    seed: 's', seedCommit: 'c', config: {}, escrow: { address: '', network: 'testnet', memo: '' }, createdAt: Date.now(),
    players: players.map((a) => ({ player: { address: a, name: 'x', avatar: 'ada' }, funded: mode !== 'play', escrowed: mode === 'play' ? 0 : (o.stake ?? 10) * L, result: { score: 10, time: 1, detail: { verified: true } } })),
  }
  if (o.bot) m.players.push({ player: { address: 'PIP-BOT', name: 'Nimo', avatar: 'pip' }, funded: true, escrowed: 0, isBot: true, result: { score: 5, time: 1 } })
  m.settlement = { winner: o.draw ? undefined : o.winner ?? players[0], draw: o.draw, ranks: [], payouts: [], xp: {}, jarCredit: {}, reason: 'x' }
  C().onSettled(m, false, o.at ?? Date.now())
  return m
}
const reset = () => {
  const st = C().st as any
  st.rewards = {}; st.holds = {}; st.weeksClosed = {}; st.tourneys = {}; st.chainLinks = {}; st.invitesClosed = false
  st.ladder = { games: [], ratings: {}, pairDay: {}, pairSeason: {} }
  st.paused = true; st.alerts = []; st.alerted = {}
  ;(app.engine.db as any).signals = { by: {}, newByIpDay: {} }
  for (const p of Object.values(app.engine.db.profiles)) { p.cjar = undefined; p.invitedBy = undefined }
  payer().ownBalance = 60_000 * L
  payer().paid.length = 0
  payer().failPays = false
}

test('budget and curves: season 2 pools add up, curves add up to their pools, 25 and 30 paid places', () => {
  assert.equal(S2.CAMPAIGN_NAME, 'Nimbles Showdown')
  assert.equal(S2.SEASON2_TOTAL_NIM, 43_876)
  assert.equal(S2.SEASON1_SPENT_NIM, 6_124)
  assert.equal(S2.LADDER_CURVES_NIM.ladder1.length, 25)
  assert.equal(S2.LADDER_CURVES_NIM.ladder2.length, 30)
  assert.equal(S2.LADDER_CURVES_NIM.ladder1.reduce((a, b) => a + b, 0), S2.SEASON2_CAPS_NIM.ladder1)
  assert.equal(S2.LADDER_CURVES_NIM.ladder2.reduce((a, b) => a + b, 0), S2.SEASON2_CAPS_NIM.ladder2)
  for (const c of Object.values(S2.LADDER_CURVES_NIM)) for (let i = 1; i < c.length; i++) assert.ok(c[i] <= c[i - 1])
  assert.equal(S2.TOURNEY.places.reduce((a, b) => a + b, 0), S2.TOURNEY.prizeNim)
  assert.equal(S2.TOURNEY.prizeNim * S2.TOURNEY.count, S2.SEASON2_CAPS_NIM.tourney)
  const w = S2.campaignWindow({})
  assert.equal(new Date(w.start).toISOString(), '2026-11-08T23:00:00.000Z', 'Nov 9 00:00 WAT')
  assert.equal(new Date(w.end).toISOString(), '2026-11-23T23:00:00.000Z', 'through the end of Nov 23 WAT')
  assert.equal(new Date(S2.weekRange(w, 0).end).toISOString(), '2026-11-15T23:00:00.000Z', 'week 1 ends Nov 16 00:00 WAT')
})

test('migration: closes season 1 at what it spent, reserve takes the rest of 50,000, holds unsent rewards, pauses, runs once', () => {
  const st: any = { paused: false, caps: Object.fromEntries(S2.POOL_IDS.map((p) => [p, S2.nimToLuna((S2.SEASON1_CAPS_NIM as any)[p] ?? 0)])), rewards: {}, dayReleased: {}, alerts: [], alerted: {}, feesBack: 0 }
  const spent: Record<string, number> = { welcome: 100, friend: 680, invite: 20, leaderboard: 0, nimo: 1024, beatnimo: 4300 } // 6,124 NIM
  let n = 0
  for (const [p, nim] of Object.entries(spent)) if (nim) st.rewards['r' + ++n] = { id: 'r' + n, pool: p, player: 'x', luna: nim * L, wallet: nim * L, jar: 0, note: '', at: 0, status: 'paid', attempts: 1, released: 'd' }
  st.rewards.q = { id: 'q', pool: 'nimo', player: 'y', luna: 0, wallet: 0, jar: 0, note: '', at: 0, status: 'queued', attempts: 0 }
  const alloc = (p: string) => Object.values(st.rewards).filter((r: any) => r.pool === p && r.status !== 'cancelled').reduce((s: number, r: any) => s + r.luna, 0)
  const rep = migrateV2(st, alloc as any)!
  assert.ok(rep)
  assert.equal(rep.legacyAllocated, 6_124 * L)
  assert.equal(st.caps.ladder1, 8_000 * L)
  assert.equal(st.caps.ladder2, 14_000 * L)
  assert.equal(st.caps.tourney, 8_000 * L)
  assert.equal(st.caps.invite2, 2_000 * L)
  assert.equal(st.caps.reserve, 11_876 * L)
  assert.equal(st.caps.nimo, 1024 * L, 'a closed pool is capped at what it paid')
  assert.equal(Object.values(st.caps).reduce((a: number, b: any) => a + b, 0), 50_000 * L, 'the total never grows')
  assert.equal(st.paused, true)
  assert.equal(st.rewards.q.status, 'review', 'an unsent season 1 reward is held for the owner')
  assert.equal(migrateV2(st, alloc as any), null, 'runs once')
})

test('no instant rewards: wins against Nimo, free play and unstaked games pay nothing and never count', async () => {
  reset()
  const [a, b] = [addr(1), addr(2)]
  await login(a); await login(b)
  finished([a], { mode: 'play', opp: 'pip', bot: true })
  finished([a, b], { mode: 'play' })
  finished([a, b], { stake: 5 })
  finished([a, b], { draw: true })
  assert.equal(Object.keys(C().st.rewards).length, 0)
  assert.equal(C().st.ladder.games.length, 0, 'under 10 NIM, free play, Nimo and draws never count')
  finished([a, b])
  assert.equal(C().st.ladder.games.length, 1)
})

test('pair caps: 2 counted games per pair per day, 6 per season, and repeats count less', async () => {
  reset()
  const [a, b] = [addr(11), addr(12)]
  const t0 = Date.now()
  for (let i = 0; i < 3; i++) finished([a, b], { at: t0 })
  assert.equal(C().st.ladder.games.length, 2)
  for (let d = 1; d < 6; d++) for (let i = 0; i < 2; i++) finished([a, b], { at: t0 + d * DAY + i })
  assert.equal(C().st.ladder.games.length, 6, 'the season cap is 6 for one pair')
  const base = C().st.ladder.games.map((g) => g.base)
  assert.ok(base[1] < base[0] && base[5] < base[1], 'each repeat against the same opponent is worth less')
})

test('weights: a new opponent and a much weaker one are worth little, an upset is worth more', () => {
  const even = S2.winWeight({ winnerRating: 1000, loserRating: 1000, repeat: 0, loserGames: 5 })
  assert.equal(Math.round(even * 100) / 100, 1)
  assert.ok(S2.winWeight({ winnerRating: 1000, loserRating: 1000, repeat: 0, loserGames: 0 }) <= 0.3)
  assert.ok(S2.winWeight({ winnerRating: 1300, loserRating: 1000, repeat: 0, loserGames: 5 }) < 0.5)
  assert.ok(S2.winWeight({ winnerRating: 1000, loserRating: 1300, repeat: 0, loserGames: 5 }) > 1.5)
  assert.ok(S2.trustOf(1) <= 0.05 && S2.trustOf(5) === 1)
  assert.ok(S2.componentFactor(2) < S2.componentFactor(8) && S2.componentFactor(8) === 1)
})

test('ranking needs 5 different eligible rivals and 3 active days; a closed farm ring of 2 earns almost nothing', async () => {
  reset()
  const w = C().window
  const ring = [21, 22, 23, 24, 25, 26, 27].map(addr)
  const dayStart = w.start + 60_000
  // the same 7 players over three different days
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) finished([ring[i], ring[j]], { winner: (i + j) % 2 ? ring[i] : ring[j], at: dayStart + ((i + j) % 3) * DAY })
  const farmA = addr(28), farmB = addr(29)
  for (let d = 0; d < 3; d++) for (let i = 0; i < 2; i++) finished([farmA, farmB], { at: dayStart + d * DAY + i })
  const st = C().standings(0, dayStart + 3 * DAY)
  const ranked = st.filter((r) => r.ranked).map((r) => r.address)
  assert.ok(ring.every((a) => ranked.includes(a)), 'everyone in the open group is ranked')
  assert.ok(!ranked.includes(farmA), 'two wallets farming each other are never ranked')
  const fa = st.find((r) => r.address === farmA)!
  assert.ok(fa.points < 1, 'and their points are tiny: ' + fa.points)
})

test('week close: prizes follow the curve, are held, linked wallets share one prize, nothing pays while paused or unapproved', async () => {
  reset()
  const w = C().window
  const ring = [31, 32, 33, 34, 35, 36, 37].map(addr)
  for (const a of ring) await login(a, 'R' + a.slice(-4))
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) finished([ring[i], ring[j]], { winner: (i + j) % 2 ? ring[i] : ring[j], at: w.start + 60_000 + ((i + j) % 3) * DAY })
  // two of them share a device: one prize for the pair
  const sig = (app.engine.db as any).signals.by
  sig[ring[0]] = { ips: [], devs: ['dX'], firstAt: 0, lastAt: 0 }
  sig[ring[1]] = { ips: [], devs: ['dX'], firstAt: 0, lastAt: 0 }
  const end = S2.weekRange(w, 0).end
  await C().closeWeeks(end + 1)
  await C().closeWeeks(end + 2)
  const holds = Object.values(C().st.holds).filter((h) => h.id.startsWith('lad:0:'))
  assert.equal(holds.length, ring.length, 'everyone ranked is listed once, even after two closes')
  const paid = holds.filter((h) => h.luna > 0).sort((a, b) => a.place! - b.place!)
  assert.equal(paid.length, ring.length - 1, 'the linked pair shares one prize')
  assert.deepEqual(paid.map((h) => h.luna / L), S2.LADDER_CURVES_NIM.ladder1.slice(0, paid.length))
  const dup = holds.find((h) => h.luna === 0)!
  assert.equal(dup.status, 'withheld')
  assert.ok(dup.flags.some((f) => /Same device/.test(f)))
  assert.ok(paid.every((h) => h.status === 'held'))
  // nothing is paid before review, and nothing while paused
  await C().tick(end + 3)
  assert.equal(payer().paid.length, 0)
  const ta = await login(ADMIN)
  assert.equal((await call(ta, 'POST', '/admin/campaign', { payApproved: true })).status, 400, 'nothing approved yet')
  assert.equal((await call(ta, 'POST', '/admin/campaign', { approve: paid[0].id })).status, 200)
  assert.equal((await call(ta, 'POST', '/admin/campaign', { approve: paid[1].id })).status, 200)
  assert.equal((await call(ta, 'POST', '/admin/campaign', { withhold: paid[1].id, reason: 'scripted' })).status, 200)
  const v = (await call(ta, 'POST', '/admin/campaign', { payApproved: true })).j
  assert.equal(v.counts.queued, 1)
  await C().tick(end + 4)
  assert.equal(payer().paid.length, 0, 'still paused')
  await call(ta, 'POST', '/admin/campaign', { paused: false })
  await C().tick(end + 5)
  assert.equal(payer().paid.length, 1)
  assert.equal(payer().paid[0].to, paid[0].player)
  assert.equal(payer().paid[0].luna, S2.LADDER_CURVES_NIM.ladder1[0] * L, 'paid in full, no jar half')
  assert.equal(C().st.holds[paid[0].id].status, 'paid')
  assert.equal(C().st.holds[paid[1].id].status, 'withheld')
  // the player sees their place and prize, never other people's flags
  const me = (await call(await login(paid[0].player), 'GET', '/showdown')).j
  assert.equal(me.prizes[0].status, 'paid')
  assert.ok(!/flag|Same device|budget|caps/i.test(JSON.stringify(me)))
  C().st.paused = true
})

test('robotic trivia timing is flagged for the reviewer', async () => {
  reset()
  const a = addr(41)
  app.engine.db.matches.tq = { id: 'tq', game: 'trivia', createdAt: Date.now(), trivia: { answers: { [a]: Array.from({ length: 12 }, () => ({ choice: 0, ms: 420, correct: true, points: 100 })) } } } as any
  const g = C().groups()
  const f = C().flagsOf(a, g.why, g.invite)
  assert.ok(f.some((x) => /Robotic trivia timing/.test(x)))
  assert.ok(f.some((x) => /Very fast trivia answers/.test(x)))
  delete app.engine.db.matches.tq
})

test('trivia is timed on the server, shows one question at a time, and hides the seed and Nimo answers', async () => {
  const a = addr(42)
  const t = await login(a)
  const c = (await call(t, 'POST', '/matches', { game: 'trivia', mode: 'play', opp: 'pip', pipLevel: 'hard', config: { topic: 'Science', count: 5 } })).j
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 10
  const v = (await call(t, 'GET', `/matches/${c.id}`)).j
  assert.equal(v.status, 'playing')
  assert.equal(v.seed, undefined)
  assert.equal(v.pipSalt, undefined)
  assert.equal(v.trivia.pip.length, 0, 'Nimo answers are not sent ahead')
  assert.equal(v.trivia.questions[1].q, '')
  // the device claims 1 ms; the server knows the question was shown 6 seconds ago
  m.trivia!.served![a][0] = Date.now() - 6000
  const r = (await call(t, 'POST', `/matches/${c.id}/answer`, { q: 0, choice: m.trivia!.questions[0].answer, ms: 1 })).j
  assert.ok(m.trivia!.answers[a][0].ms >= 5000, 'recorded ' + m.trivia!.answers[a][0].ms)
  assert.ok(r.next?.q, 'the next question comes with the answer')
  assert.equal(r.pip.choice >= 0 || r.pip.choice === -1, true)
  // answering before the next question is shown is refused
  assert.equal((await call(t, 'POST', `/matches/${c.id}/answer`, { q: 1, choice: 0, ms: 1 })).status, 400)
})

test('tournaments: free registration, one per device, random bracket with byes, places held for review', async () => {
  reset()
  const now = Date.now()
  const ta = await login(ADMIN)
  const bad = await call(ta, 'POST', '/admin/campaign', { createTourney: { game: 'trivia', startsAt: now + 60_000, stake: 10 } })
  assert.equal(bad.status, 400, 'at least 10 minutes ahead')
  const ok = await call(ta, 'POST', '/admin/campaign', { createTourney: { game: 'darts', startsAt: now + 11 * 60_000, stake: 10 } })
  assert.equal(ok.status, 400, 'only games with a server-checked result')
  const t = C().createTourney({ game: 'solitaire', startsAt: now + 11 * 60_000, stake: 10, maxPlayers: 8 }, now)
  const ps = [51, 52, 53, 54, 55].map(addr)
  for (const p of ps) await login(p, 'T' + p.slice(-2))
  await login(addr(56))
  ps.forEach((p, i) => C().registerTourney(p, t.id, { dev: 'dev' + i }))
  assert.throws(() => C().registerTourney(addr(56), t.id, { dev: 'dev0' }), /device/)
  await C().tickTourneys(t.startsAt + 1)
  assert.equal(t.status, 'running')
  const r0 = t.rounds![0]
  assert.equal(r0.matches.length, 4, '5 players make an 8 bracket')
  assert.equal(r0.matches.filter((x) => x.note === 'Bye').length, 3)
  const live = r0.matches.filter((x) => x.match)
  assert.equal(live.length, 1)
  const m = app.engine.db.matches[live[0].match!]
  assert.equal(m.status, 'funding')
  assert.equal(m.stake, 10)
  assert.equal(m.tourney?.id, t.id)
  // play each round out: the first seat wins
  const finishRound = async () => {
    for (const x of t.rounds![t.rounds!.length - 1].matches) {
      if (!x.match) continue
      const mm = app.engine.db.matches[x.match]
      if (mm.status === 'settled') continue
      mm.status = 'settled'
      mm.settlement = { winner: x.a!, ranks: [], payouts: [], xp: {}, jarCredit: {}, reason: 'x' }
      C().onTourneyMatchEnded(mm)
    }
    await C().tickTourneys(Date.now())
  }
  for (let i = 0; i < 3 && t.status === 'running'; i++) await finishRound()
  assert.equal(t.status, 'done')
  const holds = Object.values(C().st.holds).filter((h) => h.id.startsWith(`tour:${t.id}:`))
  const first = holds.find((h) => h.place === 1)!
  assert.equal(first.luna, 1600 * L)
  assert.equal(holds.find((h) => h.place === 2)!.luna, 900 * L)
  assert.ok(holds.every((h) => h.status === 'held'))
  assert.equal(holds.reduce((s, h) => s + h.luna, 0) <= 4000 * L, true)
})

test('a tournament match nobody locks is a walkover for whoever did', async () => {
  reset()
  const now = Date.now()
  const t = C().createTourney({ game: 'solitaire', startsAt: now + 11 * 60_000, stake: 10, maxPlayers: 4 }, now)
  const ps = [61, 62, 63, 64].map(addr)
  for (const p of ps) { await login(p); C().registerTourney(p, t.id) }
  await C().tickTourneys(t.startsAt + 1)
  const x = t.rounds![0].matches[0]
  const m = app.engine.db.matches[x.match!]
  m.players.find((p) => p.player.address === x.a)!.funded = true
  await C().tickTourneys(t.rounds![0].deadline + 1)
  assert.equal(m.status, 'cancelled')
  assert.equal(x.winner, x.a)
  assert.match(x.note!, /Walkover/)
})

test('invites pay at season end, only for invited players who played 5 different eligible rivals', async () => {
  reset()
  const inviter = addr(71)
  const invitee = addr(72), idle = addr(73)
  await login(inviter); await login(invitee); await login(idle)
  app.engine.db.profiles[invitee].invitedBy = inviter
  app.engine.db.profiles[idle].invitedBy = inviter
  const rivals = [74, 75, 76, 77, 78, 79].map(addr)
  // rivals play each other so they are eligible opponents
  for (let i = 0; i < rivals.length; i++) for (let j = i + 1; j < rivals.length; j++) finished([rivals[i], rivals[j]])
  for (const r of rivals.slice(0, 5)) finished([invitee, r])
  finished([idle, rivals[0]])
  assert.equal(C().inviteeEligible(invitee).ok, true)
  assert.equal(C().inviteeEligible(idle).ok, false)
  await C().closeInvites(C().window.start + DAY)
  assert.equal(Object.keys(C().st.holds).filter((k) => k.startsWith('inv2:')).length, 0, 'not before the season ends')
  await C().closeInvites(C().window.end + 1)
  const h = Object.values(C().st.holds).find((x) => x.pool === 'invite2')!
  assert.equal(h.player, inviter)
  assert.equal(h.luna, 50 * L)
  assert.equal(h.status, 'held')
})

test('admin: only the owner wallet, exact match, on every admin call', async () => {
  assert.equal(isAdmin(ADMIN_DEFAULT, {}), true)
  assert.equal(isAdmin('NQ20 0000 0000 0000 0000 0000 0000 0000 NHGR', {}), false, 'prefix and suffix are not enough')
  const tu = await login(addr(91))
  const ta = await login(ADMIN)
  assert.equal((await call(tu, 'GET', '/admin/me')).j.admin, false)
  for (const [m, p] of [['GET', '/admin/campaign'], ['POST', '/admin/campaign'], ['GET', '/admin/stats']]) assert.equal((await call(tu, m, p, m === 'POST' ? { paused: false } : undefined)).status, 403)
  assert.equal((await call(null, 'GET', '/admin/stats')).status, 401)
  const v = (await call(ta, 'GET', '/admin/campaign')).j
  assert.equal(v.season, 2)
  assert.equal(v.budget, 50_000 * L)
  assert.equal(v.paused, true, 'season 2 starts paused')
  assert.ok(v.pools.some((p: any) => p.id === 'ladder1' && p.cap === 8_000 * L))
  assert.equal((await call(ta, 'POST', '/admin/campaign', { moveFromReserve: { pool: 'nimo', nim: 1 } })).status, 400, 'closed pools stay closed')
})

test('player view: ladder progress only, no budget, pool sizes or flags', async () => {
  const a = addr(81)
  const t = await login(a)
  const v = (await call(t, 'GET', '/showdown')).j
  assert.equal(v.name, 'Nimbles Showdown')
  assert.equal(v.week.need.opponents, 5)
  assert.equal(v.week.need.days, 3)
  assert.ok(!/budget|caps|remaining|allocated|flags/i.test(JSON.stringify(v)))
  const b = (await call(t, 'GET', '/showdown/board')).j
  assert.ok(Array.isArray(b.rows))
})

test('match me lobby: open challenges are listed, the nearest stake within 50% is offered and confirmed by joining', async () => {
  const [a, b] = [addr(101), addr(102)]
  const ta = await login(a), tb = await login(b)
  const host = (await call(ta, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 50, opp: 'auto' })).j
  assert.equal(host.status, 'lobby')
  const list = (await call(tb, 'GET', '/lobby?game=darts&mode=win')).j.open
  assert.ok(list.some((x: any) => x.code === host.code && x.stake === 50))
  assert.equal((await call(ta, 'GET', '/lobby')).j.open.some((x: any) => x.code === host.code), false, 'never your own')
  const s = (await call(tb, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 40, opp: 'auto' })).j
  assert.equal(s.suggest.code, host.code)
  const far = (await call(tb, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 10, opp: 'auto' })).j
  assert.equal(far.suggest, undefined)
  await call(tb, 'POST', `/matches/${far.id}/cancel`)
  const j = (await call(tb, 'POST', '/matches/join', { code: s.suggest.code })).j
  assert.equal(j.status, 'funding')
})
