import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'
process.env.CAMPAIGN_START = new Date(Date.now() - 864e5).toISOString()
process.env.CAMPAIGN_END = new Date(Date.now() + 13 * 864e5).toISOString()
process.env.CAMPAIGN_TICK_MS = '3600000'
const START = Date.now() - 3600_000
process.env.BEAT_NIMO_START = new Date(START).toISOString()

const { createApp } = await import('../server/index')
const { BEAT_NIMO, BUDGET_NIM, POOL_CAPS_NIM, campaignDay } = await import('../shared/campaign')
const { Campaign } = await import('../server/campaign')

let app: Awaited<ReturnType<typeof createApp>>
before(async () => { app = await createApp({ persist: false }) })
after(() => app.close())

const L = 1e5
const C = () => app.campaign
const payer = () => app.campaign.payer as any
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 13 + (i * n) % 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const reg = (a: string) => app.engine.session(a, 'P' + a.slice(-4))
const settle = () => new Promise((r) => setTimeout(r, 30))
let seq = 0
function nimoMatch(a: string, o: { level?: string; verified?: boolean; startedAgoMs?: number; startsAt?: number; win?: boolean; game?: string } = {}) {
  const startsAt = o.startsAt ?? Date.now() - (o.startedAgoMs ?? 60_000)
  const m: any = {
    id: 'bn' + ++seq, code: 'NMB-B' + seq, game: o.game ?? 'darts', mode: 'play', opp: 'pip', pipLevel: o.level ?? 'hard', stake: 0, status: 'settled', host: a, size: 2,
    seed: 's', seedCommit: 'c', config: {}, createdAt: startsAt - 4000, startsAt,
    players: [
      { player: { address: a, name: 'x', avatar: 'ada' }, funded: false, escrowed: 0, result: { score: 10, time: 30_000, detail: { verified: o.verified ?? true } } },
      { player: { address: 'PIP-BOT', name: 'Nimo', avatar: 'pip' }, funded: true, escrowed: 0, isBot: true, result: { score: 5, time: 1 } },
    ],
  }
  m.settlement = { winner: o.win === false ? 'PIP-BOT' : a, ranks: [], payouts: [], xp: {}, jarCredit: {}, reason: 'x' }
  app.engine.db.matches[m.id] = m
  C().onSettled(m, false)
  return m
}
const bn = () => Object.values(C().st.rewards).filter((r) => r.pool === 'beatnimo')
function reset() {
  const st = C().st as any
  for (const k of Object.keys(st.rewards)) delete st.rewards[k]
  st.paused = false; st.dayReleased = {}; st.players = {}
  payer().ownBalance = 60_000 * L
  payer().paid.length = 0
  payer().failPays = false
}

test('start time is stamped and a match that started before it never counts', async () => {
  reset()
  assert.equal(C().beatNimoStart, START)
  const a = addr(1); reg(a)
  nimoMatch(a, { startsAt: START - 1000 })
  assert.equal(bn().length, 0, 'started before the campaign')
  nimoMatch(a, { startsAt: START + 1000 })
  assert.equal(bn().length, 1)
})

test('only verified Hard wins with a real play time qualify', async () => {
  reset()
  const a = addr(2); reg(a)
  nimoMatch(a, { level: 'med' })
  nimoMatch(a, { verified: false })
  nimoMatch(a, { win: false })
  nimoMatch(a, { startedAgoMs: 5_000 })
  nimoMatch(a, { game: 'chess' }) // scored on the device, even if it claims verified
  nimoMatch(a, { game: 'sudoku' })
  const ghost = addr(3) // never signed in, no profile
  nimoMatch(ghost)
  assert.equal(bn().length, 0)
  nimoMatch(a, { game: 'trivia', verified: false }) // trivia is scored by the server itself
  assert.equal(bn().length, 1)
})

test('full 100 NIM paid straight to the wallet right away: no jar half, not held by the daily pace', async () => {
  reset()
  const a = addr(4); reg(a)
  C().st.dayReleased[campaignDay()] = 3_000 * L // the Showdown pace for today is used up
  nimoMatch(a)
  await settle()
  const r = bn()[0]
  assert.equal(r.luna, 100 * L)
  assert.equal(r.wallet, 100 * L)
  assert.equal(r.jar, 0)
  assert.equal(r.status, 'paid', 'paid without waiting for the batch tick')
  assert.deepEqual(payer().paid.filter((p: any) => p.memo.includes('beatnimo')).map((p: any) => [p.to, p.luna]), [[a, 100 * L]])
  assert.equal(app.engine.db.profiles[a].cjar?.luna ?? 0, 0, 'nothing locked in the jar')
  assert.equal(C().st.dayReleased[campaignDay()], 3_000 * L, 'does not use up the Showdown pace')
  assert.equal(C().earnedBy(a), 2 * L, 'only the usual 2 NIM Nimo step counts toward the Showdown 1,000 NIM player cap')
})

test('once per wallet, whatever the address formatting, and a cancelled reward is not re-earned', async () => {
  reset()
  const a = addr(5); reg(a)
  nimoMatch(a); nimoMatch(a)
  const m = nimoMatch(a)
  const twin = { ...m, id: 'twin', players: m.players.map((p: any) => (p.isBot ? p : { ...p, player: { ...p.player, address: a.replace(/ /g, '').toLowerCase() } })) }
  app.engine.db.profiles[twin.players[0].player.address] = app.engine.db.profiles[a]
  C().claimBeatNimo(twin as any)
  assert.equal(bn().length, 1)
  const b = addr(6); reg(b)
  payer().ownBalance = 0 // keep it queued so it can be cancelled
  nimoMatch(b)
  await settle()
  C().adminSet({ cancel: `beatnimo:${b.replace(/ /g, '')}` })
  payer().ownBalance = 60_000 * L
  nimoMatch(b)
  assert.equal(bn().filter((r) => r.player === b && r.status !== 'cancelled').length, 0)
})

test('exactly 50 slots, first come first served, even when many wins settle together', async () => {
  reset()
  const ps = Array.from({ length: 60 }, (_, i) => addr(100 + i))
  ps.forEach(reg)
  ps.forEach((a) => nimoMatch(a)) // all in one synchronous burst
  await Promise.all(ps.map(() => settle()))
  const live = bn().filter((r) => r.status !== 'cancelled')
  assert.equal(live.length, BEAT_NIMO.slots)
  assert.deepEqual(live.map((r) => r.player).sort(), ps.slice(0, 50).sort(), 'the first 50 wins get the slots')
  assert.equal(C().beatNimoView(ps[55]).left, 0)
  assert.equal(C().beatNimoView(ps[55]).mine, null)
  assert.equal(C().beatNimoView(ps[0]).mine!.luna, 100 * L)
  const v = (await C().adminView()).beatNimo
  assert.equal(v.used, 50); assert.equal(v.left, 0); assert.equal(v.remaining, 0); assert.equal(v.winners.length, 50)
  await C().tick(); await settle()
  assert.equal(payer().paid.filter((p: any) => p.memo.includes('beatnimo')).reduce((s: number, p: any) => s + p.luna, 0), 5_000 * L, 'never more than the 5,000 NIM line')
})

test('the pause switch stops these payouts too, and they go out on resume', async () => {
  reset()
  const a = addr(7); reg(a)
  C().adminSet({ paused: true })
  nimoMatch(a)
  await settle(); await C().tick()
  assert.equal(bn()[0].status, 'queued')
  assert.equal(payer().paid.length, 0)
  C().adminSet({ paused: false })
  await C().tick()
  assert.equal(bn()[0].status, 'paid')
})

test('a short campaign wallet queues the reward instead of dropping it', async () => {
  reset()
  const a = addr(8); reg(a)
  payer().ownBalance = 50 * L
  nimoMatch(a); await settle()
  assert.equal(bn()[0].status, 'queued')
  assert.match(bn()[0].wait!, /funds/)
  payer().ownBalance = 1_000 * L
  await C().tick()
  assert.equal(bn()[0].status, 'paid')
})

test('over HTTP: a real server-scored trivia win against Nimo on Hard claims a slot and shows on /showdown', async () => {
  reset()
  await new Promise<void>((r) => app.server.listen(0, r))
  const base = `http://127.0.0.1:${(app.server.address() as any).port}/api`
  const call = async (t: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return (await res.json()) as any
  }
  const a = addr(9)
  const t = (await call(null, 'POST', '/session', { address: a, name: 'T' })).token
  assert.equal((await call(t, 'GET', '/showdown')).beatNimo.left, 50)
  const c = await call(t, 'POST', '/matches', { game: 'trivia', mode: 'play', opp: 'pip', pipLevel: 'hard', config: { topic: 'Science', count: 5 } })
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 30_000
  await call(t, 'GET', `/matches/${c.id}`)
  m.trivia!.pip = m.trivia!.pip!.map((x) => ({ ...x, correct: false, points: 0 }))
  for (let i = 0; i < 5; i++) await call(t, 'POST', `/matches/${c.id}/answer`, { q: i, choice: m.trivia!.questions[i].answer, ms: 1500 })
  assert.equal(m.settlement?.winner, a)
  await settle()
  const sd = await call(t, 'GET', '/showdown')
  assert.equal(sd.beatNimo.left, 49)
  assert.equal(sd.beatNimo.mine.match, c.id)
  assert.equal(sd.beatNimo.mine.status, 'paid')
  // a client cannot claim a device-scored chess win as verified
  const ch = await call(t, 'POST', '/matches', { game: 'chess', mode: 'play', opp: 'pip', pipLevel: 'hard' })
  const cm = app.engine.db.matches[ch.id]
  if (cm) {
    cm.startsAt = Date.now() - 60_000
    await call(t, 'GET', `/matches/${ch.id}`)
    await call(t, 'POST', `/matches/${ch.id}/result`, { score: 1, time: 50_000, detail: { verified: true } })
    assert.notEqual((cm.players[0].result?.detail as any)?.verified, true)
  }
})

test('funded from the Showdown budget: total stays 50,000, an older database moves 3,000 reserve and 2,000 Nimo Hard wins once', async () => {
  assert.equal(BUDGET_NIM, 50_000)
  assert.deepEqual([POOL_CAPS_NIM.reserve, POOL_CAPS_NIM.nimo, POOL_CAPS_NIM.beatnimo], [0, 3_000, 5_000])
  const st = C().st as any
  const saved = { ...st.caps }
  st.caps = { welcome: 5_000 * L, friend: 20_000 * L, invite: 5_000 * L, leaderboard: 12_000 * L, nimo: 5_000 * L, reserve: 3_000 * L }
  new Campaign(app.engine, null, {})
  assert.deepEqual([st.caps.reserve, st.caps.nimo, st.caps.beatnimo].map((x: number) => x / L), [0, 3_000, 5_000])
  assert.equal(Object.values(st.caps as Record<string, number>).reduce((a, b) => a + b, 0), 50_000 * L)
  new Campaign(app.engine, null, {}) // a second boot changes nothing
  assert.equal(st.caps.beatnimo, 5_000 * L)
  const v = await C().adminView()
  assert.equal(v.budget, 50_000 * L)
  st.caps = saved
  reset()
  assert.equal(C().beatNimoView().claimed, 0)
})
