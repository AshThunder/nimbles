import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const A = addr(11), B = addr(12)

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

/** Two funded players, staked, match started */
async function startMatch(game: 'chess' | 'pool', stake = 2) {
  const ta = await login(A, 'Ada')
  const tb = await login(B, 'Bisi')
  const c = (await call(ta, 'POST', '/matches', { game, mode: 'save', stake, opp: 'invite' })).j
  assert.equal(c.status, 'lobby')
  assert.equal((await call(tb, 'POST', '/matches/join', { code: c.code })).j.status, 'funding')
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, stake * 100000, c.escrow.memo) })
  const r = (await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, stake * 100000, c.escrow.memo) })).j
  assert.equal(r.status, 'ready')
  const rec = app.engine.db.matches[c.id]
  rec.startsAt = Date.now() - 10
  const g = (await call(ta, 'GET', `/matches/${c.id}`)).j
  assert.equal(g.status, 'playing')
  assert.ok(g.live, 'live state is created for a two-player chess/pool match')
  return { id: c.id as string, ta, tb, rec, live: g.live }
}

test('chess: server enforces turns, legality, and decides checkmate', async () => {
  const { id, ta, tb, live } = await startMatch('chess')
  const white = live.white === 0 ? ta : tb
  const black = live.white === 0 ? tb : ta
  assert.equal((await call(black, 'POST', `/matches/${id}/move`, { from: 'e7', to: 'e5' })).status, 400, 'black cannot open')
  assert.equal((await call(white, 'POST', `/matches/${id}/move`, { from: 'e2', to: 'e5' })).status, 400, 'illegal move')
  assert.equal((await call(white, 'POST', `/matches/${id}/move`, { from: 'e2', to: 'e4' })).status, 200)
  assert.equal((await call(white, 'POST', `/matches/${id}/move`, { from: 'd2', to: 'd4' })).status, 400, 'not your turn')
  // a client cannot report its own result for a live match
  assert.equal((await call(white, 'POST', `/matches/${id}/result`, { score: 1, time: 1000 })).status, 400)
  // fool's mate style: 1.e4 f6 2.d4 g5 3.Qh5#
  const seq: [typeof white, string, string][] = [[black, 'f7', 'f6'], [white, 'd2', 'd4'], [black, 'g7', 'g5'], [white, 'd1', 'h5']]
  let last: any
  for (const [t, from, to] of seq) last = (await call(t, 'POST', `/matches/${id}/move`, { from, to }))
  assert.equal(last.status, 200)
  assert.equal(last.j.status, 'settled')
  assert.equal(last.j.live.over.reason, 'checkmate')
  const winner = live.white === 0 ? A : B
  assert.equal(last.j.settlement.winner, winner)
  assert.equal(last.j.settlement.payouts.length + Object.keys(last.j.settlement.jarCredit).length >= 1, true)
  assert.equal((await call(black, 'POST', `/matches/${id}/move`, { from: 'a7', to: 'a6' })).status, 400, 'game over')
})

test('chess: running out of the clock loses, resigning loses', async () => {
  const { id, ta, tb, rec, live } = await startMatch('chess')
  const white = live.white === 0 ? ta : tb
  const black = live.white === 0 ? tb : ta
  await call(white, 'POST', `/matches/${id}/move`, { from: 'e2', to: 'e4' })
  const mv = rec.live as any
  mv.lastAt = Date.now() - 200_000 // black has sat on a 3 minute clock for 200 s
  const g = (await call(white, 'GET', `/matches/${id}`)).j
  assert.equal(g.status, 'settled')
  assert.equal(g.live.over.reason, 'timeout')
  assert.equal(g.settlement.winner, live.white === 0 ? A : B)
  void black
  const s2 = await startMatch('chess')
  const w2 = s2.live.white === 0 ? s2.ta : s2.tb
  const b2 = s2.live.white === 0 ? s2.tb : s2.ta
  const r = (await call(b2, 'POST', `/matches/${s2.id}/move`, { resign: true })).j
  assert.equal(r.status, 'settled')
  assert.equal(r.settlement.winner, s2.live.white === 0 ? A : B)
  void w2
})

test('pool: server runs the shot, returns the paths, enforces turn order', async () => {
  const { id, ta, tb, live } = await startMatch('pool')
  const first = live.turn === 0 ? ta : tb
  const second = live.turn === 0 ? tb : ta
  assert.equal((await call(second, 'POST', `/matches/${id}/move`, { angle: -1.57, power: 0.9 })).status, 400, 'not your turn')
  assert.equal((await call(first, 'POST', `/matches/${id}/move`, { angle: 'x', power: 1 })).status, 400)
  const r = await call(first, 'POST', `/matches/${id}/move`, { angle: -Math.PI / 2, power: 1 })
  assert.equal(r.status, 200)
  assert.ok(r.j.live.last.frames.length > 5, 'shooter gets the ball paths')
  assert.equal(r.j.live.last.no, 1)
  assert.equal(r.j.live.balls.length, 16)
  // a viewer who has already seen shot 1 does not get the paths again
  const quiet = (await call(second, 'GET', `/matches/${id}?shot=1`)).j
  assert.equal(quiet.live.last.frames.length, 0)
  const fresh = (await call(second, 'GET', `/matches/${id}?shot=0`)).j
  assert.ok(fresh.live.last.frames.length > 5)
  // after a break the turn either stays (potted) or passes (cue placement allowed after a foul)
  const next = r.j.live.turn === live.turn ? first : second
  const wrong = next === first ? second : first
  assert.equal((await call(wrong, 'POST', `/matches/${id}/move`, { angle: 0, power: 0.5 })).status, 400)
  assert.equal((await call(first, 'POST', `/matches/${id}/result`, { score: 1, time: 5 })).status, 400)
})

test('pool: idle shot clock fouls then forfeits; concede ends the match', async () => {
  const s = await startMatch('pool')
  const rec = s.rec.live as any
  const idler = rec.turn as 0 | 1
  for (let i = 0; i < 3; i++) {
    rec.turnAt = Date.now() - 61_000
    const g = (await call(s.ta, 'GET', `/matches/${s.id}`)).j
    if (i < 2) {
      assert.equal(g.status, 'playing')
      assert.equal(g.live.placing, true)
      // the other player now idles too, so flip back to the same idler for the test
      rec.turn = idler
    }
  }
  const done = (await call(s.ta, 'GET', `/matches/${s.id}`)).j
  assert.equal(done.status, 'settled')
  assert.equal(done.live.over.reason, 'idle')
  assert.equal(done.settlement.winner, idler === 0 ? B : A)

  const s2 = await startMatch('pool')
  const loser = (s2.rec.live as any).turn === 0 ? s2.ta : s2.tb
  const res = (await call(loser, 'POST', `/matches/${s2.id}/move`, { resign: true })).j
  assert.equal(res.status, 'settled')
})
