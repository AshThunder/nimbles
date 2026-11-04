import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { createApp } from '../server/index'
import { splatShares } from '../shared/economy'
import { TICK_MS } from '../shared/splat'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''
process.env.JAR_LOCK_DAYS = '30'

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
let port = 0
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  port = (app.server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}/api`
})
after(() => app.close())
const call = async (token: string | null, method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const login = async (a: string, name: string) => (await call(null, 'POST', '/session', { address: a, name })).j.token as string
const deposit = (from: string, luna: number, memo: string) => (app.chain as any).register({ from, to: app.chain.escrowAddress, luna, memo })
const eng = () => app.engine as any

test('top-3 split is 60/30/10 with the rounding on first place, and two players always winner-takes-all', () => {
  assert.deepEqual(splatShares(1_000_000, 'top3', 6), [600000, 300000, 100000])
  const odd = splatShares(1_234_567, 'top3', 4)
  assert.equal(odd.reduce((a, b) => a + b, 0), 1_234_567)
  assert.equal(odd[1], 370370)
  assert.equal(odd[2], 123456)
  assert.deepEqual(splatShares(500, 'top3', 2), [500])
  assert.deepEqual(splatShares(500, 'wta', 6), [500])
})

test('Splat Royale rules: Play or Save only, friends or Nimo, 2 to 6 seats, no Nimo with money', async () => {
  const t = await login(addr(60), 'Host')
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'settle', opp: 'invite', terms: { bill: 4 } })).status, 400)
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'save', stake: 2, opp: 'auto', config: { seats: 4 } })).status, 200, 'auto-match is allowed now')
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'save', stake: 2, opp: 'pip', config: { seats: 4 } })).status, 400)
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'save', stake: 2, opp: 'invite', config: { seats: 7 } })).status, 400)
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'save', stake: 2, opp: 'invite', config: { seats: 1 } })).status, 400)
  const ok = await call(t, 'POST', '/matches', { game: 'splat', mode: 'play', opp: 'pip', pipLevel: 'easy', config: { seats: 5 } })
  assert.equal(ok.status, 200)
  assert.equal(ok.j.players.length, 5)
  assert.equal(ok.j.players.filter((p: any) => p.isBot).length, 4)
  assert.equal(new Set(ok.j.players.map((p: any) => p.player.address)).size, 5, 'every Nimo has its own seat id')
  assert.equal(ok.j.status, 'ready')
  assert.equal((await call(t, 'POST', `/matches/${ok.j.id}/result`, { score: 99, time: 1 })).status, 400, 'the client cannot report a Splat score')
})

test('save, top 3 split: four lock in, the sim decides, 60/30/10 of the pot after the saver fee go to the jars', async () => {
  const as = [70, 71, 72, 73].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'P' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'save', stake: 5, opp: 'invite', config: { seats: 4, payout: 'top3' } })).j
  assert.equal(c.config.payout, 'top3')
  for (let i = 1; i < 4; i++) assert.equal((await call(ts[i], 'POST', '/matches/join', { code: c.code })).status, 200)
  for (let i = 0; i < 4; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], 500000, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  assert.equal(m.status, 'ready')
  m.startsAt = Date.now() - 50
  assert.equal((await call(ts[0], 'GET', `/matches/${c.id}`)).j.status, 'playing')
  const seen = { send() {}, close() {} }
  as.forEach((a) => assert.ok(eng().splat.connect(c.id, a, seen)))
  // run the clock a whole match forward; everyone idles in the shrinking zone
  const t0 = m.startsAt
  for (let now = t0; now < t0 + 200_000 && m.status === 'playing'; now += 200) eng().splat.step(now)
  assert.equal(m.status, 'settled')
  const st = m.settlement
  assert.equal(st.ranks.length, 4)
  assert.deepEqual(st.ranks.map((r: any) => r.rank), [1, 2, 3, 4], 'a strict order, no ties')
  const pot = 2_000_000
  const fee = 40_000 // 2% of the pot, capped at 1 NIM
  assert.equal(st.fee, 40_000)
  const net = pot - fee
  const [a1, a2, a3] = splatShares(net, 'top3', 4)
  assert.equal(st.jarCredit[st.ranks[0].address], a1)
  assert.equal(st.jarCredit[st.ranks[1].address], a2)
  assert.equal(st.jarCredit[st.ranks[2].address], a3)
  assert.equal(st.jarCredit[st.ranks[3].address], undefined)
  assert.equal(Object.values(st.jarCredit as Record<string, number>).reduce((a, b) => a + b, 0) + st.fee, pot, 'every luna is accounted for')
  assert.ok(st.xp[st.ranks[0].address] > st.xp[st.ranks[3].address])
  assert.equal(st.reason, 'Last one standing')
})

test('save, winner takes all, and the host can start early with whoever is in', async () => {
  const as = [80, 81, 82].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'Q' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'save', stake: 1, opp: 'invite', config: { seats: 6 } })).j
  assert.equal(c.config.payout, 'wta')
  await call(ts[1], 'POST', '/matches/join', { code: c.code })
  await call(ts[2], 'POST', '/matches/join', { code: c.code })
  assert.equal((await call(ts[1], 'POST', `/matches/${c.id}/start`)).status, 403, 'only the host starts')
  const s = (await call(ts[0], 'POST', `/matches/${c.id}/start`)).j
  assert.equal(s.status, 'funding')
  assert.equal(s.size, 3)
  for (let i = 0; i < 3; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], 100000, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  m.startsAt = Date.now() - 50
  await call(ts[0], 'GET', `/matches/${c.id}`)
  as.forEach((a) => eng().splat.connect(c.id, a, { send() {}, close() {} }))
  for (let now = m.startsAt; now < m.startsAt + 200_000 && m.status === 'playing'; now += 200) eng().splat.step(now)
  const st = m.settlement
  assert.equal(st.winner, st.ranks[0].address)
  assert.equal(Object.keys(st.jarCredit).length, 1)
  assert.equal(st.jarCredit[st.winner], 300000 - 6000)
})

test('a player who is gone for more than 10 seconds is out, and everyone else keeps playing', async () => {
  const as = [90, 91].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'R' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'play', opp: 'invite', config: { seats: 2 } })).j
  await call(ts[1], 'POST', '/matches/join', { code: c.code })
  const m = eng().db.matches[c.id]
  assert.equal(m.status, 'ready')
  m.startsAt = Date.now() - 50
  await call(ts[0], 'GET', `/matches/${c.id}`)
  const run = eng().splat.runs.get(c.id)
  const cn = { send() {}, close() {} }
  eng().splat.connect(c.id, as[0], cn)
  eng().splat.connect(c.id, as[1], cn)
  const t0 = m.startsAt
  eng().splat.step(t0 + 1000)
  eng().splat.disconnect(c.id, run.seatOf.get(as[1]), cn, t0 + 1000)
  eng().splat.step(t0 + 5000)
  assert.equal(run.sim.players[run.seatOf.get(as[1])].alive, true, 'still inside the grace')
  eng().splat.step(t0 + 12_500)
  assert.equal(run.sim.players[run.seatOf.get(as[1])].alive, false)
  assert.equal(m.status, 'settled', 'the other player was last standing')
  assert.equal(m.settlement.winner, as[0])
})

test('a restart in the middle of a match refunds everyone instead of guessing', async () => {
  const as = [100, 101].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'S' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'save', stake: 2, opp: 'invite', config: { seats: 2 } })).j
  await call(ts[1], 'POST', '/matches/join', { code: c.code })
  for (let i = 0; i < 2; i++) await call(ts[i], 'POST', `/matches/${c.id}/fund`, { txHash: deposit(as[i], 200000, c.escrow.memo) })
  const m = eng().db.matches[c.id]
  m.startsAt = Date.now() - 50
  await call(ts[0], 'GET', `/matches/${c.id}`)
  assert.equal(m.status, 'playing')
  eng().splat.runs.delete(c.id) // as if the process restarted
  const v = (await call(ts[0], 'GET', `/matches/${c.id}`)).j
  assert.equal(v.status, 'settled')
  assert.equal(v.settlement.payouts.filter((p: any) => p.kind === 'refund').length, 2)
  assert.equal(Object.keys(v.settlement.jarCredit).length, 0)
})

test('the websocket: bad token refused, inputs move your player, snapshots stream at 30 Hz', async () => {
  const as = [110, 111].map(addr)
  const ts = await Promise.all(as.map((a, i) => login(a, 'W' + i)))
  const c = (await call(ts[0], 'POST', '/matches', { game: 'splat', mode: 'play', opp: 'invite', config: { seats: 2 } })).j
  await call(ts[1], 'POST', '/matches/join', { code: c.code })
  const url = (t: string) => `ws://127.0.0.1:${port}/ws/splat?m=${c.id}&t=${encodeURIComponent(t)}`
  const refused = await new Promise<number>((res) => {
    const w = new WebSocket(url('nope'))
    w.on('unexpected-response', (_q, r) => res(r.statusCode ?? 0))
    w.on('error', () => {})
  })
  assert.equal(refused, 401)
  const w = new WebSocket(url(ts[0]))
  const got: any[] = []
  w.on('message', (d) => got.push(JSON.parse(String(d))))
  await new Promise((r) => w.on('open', r))
  const w2 = new WebSocket(url(ts[1]))
  await new Promise((r) => w2.on('open', r))
  const init = await new Promise<any>((res) => {
    const iv = setInterval(() => { const i = got.find((g) => g.t === 'init'); if (i) { clearInterval(iv); res(i) } }, 20)
  })
  assert.equal(init.n, 2)
  assert.equal(init.tickMs, TICK_MS)
  assert.ok(init.walls.length >= 6)
  // wait out the countdown, then hold "move right" and fire
  await new Promise((r) => setTimeout(r, Math.max(0, init.startsAt - Date.now()) + 300))
  w.send('not json')
  w.send(JSON.stringify({ t: 'i', mx: 'x' }))
  w.send(JSON.stringify({ t: 'i', mx: 1, my: 0, ax: 0, ay: 1, f: false, d: false }))
  await new Promise((r) => setTimeout(r, 1200))
  const snaps = got.filter((g) => g.t === 's')
  assert.ok(snaps.length > 12, 'about 20 snapshots a second, got ' + snaps.length)
  const first = snaps.find((s) => s.k >= 1)
  const last = snaps[snaps.length - 1]
  const seat = init.seat
  assert.ok(last.k > first.k)
  assert.ok(last.p[seat][0] !== first.p[seat][0] || last.p[seat][1] !== first.p[seat][1], 'my player moved')
  w.close()
  w2.close()
})
