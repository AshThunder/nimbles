import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { DT_DARTS, DT_MIN_GAP_MS, dartAt, dartScore, replayDarts } from '../shared/darts'
import { BK_N, BK_SHAPES, BlockGame, bkTray, replayBlocks, type BkMove } from '../shared/blocks'
import { smQuestion, replaySpeedMath, type SmAnswer } from '../shared/speedmath'

process.env.CHAIN = 'mock'
process.env.NIMBLES_UNLOCK_ALL = '1' // these games are held back in production, the tests open them
process.env.GEMINI_API_KEY = ''

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5 + 11) % chars.length]).join('')
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

/** Best dart: scans the next 3 seconds of the reticle path and throws at the highest-scoring moment */
function bestThrows(seed: string, n = DT_DARTS) {
  const out: number[] = []
  let t = 0
  for (let k = 0; k < n; k++) {
    let best = -1, bt = t
    for (let x = t; x < t + 4000; x += 5) {
      const [px, py] = dartAt(seed, k, x)
      const s = dartScore(px, py).score
      if (s > best) ((best = s), (bt = x))
    }
    out.push(bt)
    t = bt + DT_MIN_GAP_MS
  }
  return out
}
function greedyBlocks(seed: string) {
  const g = new BlockGame(seed)
  const log: BkMove[] = []
  let at = 0
  while (!g.over && log.length < 300) {
    let done = false
    for (let s = 0; s < 3 && !done; s++) {
      if (g.slots[s] === null) continue
      for (let r = 0; r < BK_N && !done; r++)
        for (let c = 0; c < BK_N && !done; c++)
          if (g.fits(g.slots[s]!, r, c)) {
            at += 300
            g.place(s, r, c)
            log.push([s, r, c, at])
            done = true
          }
    }
    if (!done) break
  }
  return { g, log }
}

test('darts: board scoring, the same path for the same seed, a different path for another', () => {
  assert.equal(dartScore(0, 0).score, 50)
  assert.equal(dartScore(0, -0.08).score, 25)
  assert.equal(dartScore(0, -0.61).score, 60) // treble 20
  assert.equal(dartScore(0, -0.97).score, 40) // double 20
  assert.equal(dartScore(0, -0.8).score, 20)
  assert.equal(dartScore(0.8, 0).score, 6) // right of centre is the 6
  assert.equal(dartScore(0, 0.8).score, 3) // straight down is the 3
  assert.equal(dartScore(1.2, 0).score, 0)
  assert.deepEqual(dartAt('s1', 3, 1234), dartAt('s1', 3, 1234))
  assert.notDeepEqual(dartAt('s1', 3, 1234), dartAt('s2', 3, 1234))
})

test('darts: replay scores the thrown times, and rejects bad logs', () => {
  const th = bestThrows('d-1')
  const r = replayDarts('d-1', th, 70_000)
  assert.ok(r.ok && r.score > 250, 'a patient player scores well: ' + (r.ok && r.score))
  const sum = th.reduce((s, t, k) => s + dartScore(...dartAt('d-1', k, t)).score, 0)
  assert.equal(r.ok && r.score, sum)
  assert.equal(replayDarts('d-1', [...th, 99999], 70_000).ok, false) // an 11th dart
  assert.equal(replayDarts('d-1', [1000, 1200], 70_000).ok, false) // too fast
  assert.equal(replayDarts('d-1', [1000.5], 70_000).ok, false)
  assert.equal(replayDarts('d-1', [90_000], 70_000).ok, false)
  assert.equal(replayDarts('d-1', undefined, 70_000).ok, false)
  const other = replayDarts('d-2', th, 70_000)
  assert.ok(other.ok && other.score < (r as any).score, 'the same times do not score the same on another deal')
})

test('blocks: same trays for the same seed, rows and columns clear, replay matches', () => {
  assert.deepEqual(bkTray('b-1', 0), bkTray('b-1', 0))
  assert.ok(BK_SHAPES.length > 15)
  const g = new BlockGame('b-line')
  // fill row 7 with singles: place a 1x1 repeatedly via direct grid edits, then clear by placing the last cell
  for (let c = 0; c < BK_N - 1; c++) g.grid[7][c] = 0
  g.slots = [0, 0, 0]
  const res = g.place(0, 7, 7)!
  assert.deepEqual(res.rows, [7])
  assert.equal(res.gained, 1 + 10)
  assert.ok(g.grid[7].every((v) => v === -1))
  const { g: played, log } = greedyBlocks('b-2')
  const rp = replayBlocks('b-2', log, 200_000)
  assert.ok(rp.ok && rp.score === played.score && played.score > 20)
  const bad = log.map((m) => [...m] as BkMove)
  bad[2][1] = (bad[2][1] + 3) % 8
  bad[2][2] = (bad[2][2] + 3) % 8
  assert.equal(replayBlocks('b-2', bad, 200_000).ok, false, 'an illegal or changed placement is refused')
  assert.equal(replayBlocks('b-2', log.map((m, i) => [m[0], m[1], m[2], i * 20] as BkMove), 200_000).ok, false)
  assert.equal(replayBlocks('b-2', [[0, 0, 0, 100], [0, 0, 0, 500]], 200_000).ok, false, 'a spent slot cannot be used twice')
})

test('speed math: the same sums for the same seed, scoring and streaks, and the server checks every answer', () => {
  assert.deepEqual(smQuestion('m-1', 4), smQuestion('m-1', 4))
  for (let i = 0; i < 80; i++) {
    const q = smQuestion('m-9', i)
    assert.ok(Number.isInteger(q.answer) && q.answer > 0, q.text)
  }
  const ans = (n: number, wrongAt: number[] = []) => Array.from({ length: n }, (_, i) => [smQuestion('m-2', i).answer + (wrongAt.includes(i) ? 1 : 0), 500 + i * 1000] as SmAnswer)
  const clean = replaySpeedMath('m-2', ans(5), 70_000)
  assert.ok(clean.ok && clean.score === 10 + 11 + 12 + 13 + 14)
  const one = replaySpeedMath('m-2', ans(5, [2]), 70_000)
  assert.ok(one.ok && one.score === 10 + 11 - 5 + 10 + 11)
  assert.equal(replaySpeedMath('m-2', [[1, 100], [1, 200]], 70_000).ok, false)
  assert.equal(replaySpeedMath('m-2', ans(5).map((a) => [a[0], 2_000_000] as SmAnswer), 70_000).ok, false)
  assert.equal(replaySpeedMath('m-2', 'no', 70_000).ok, false)
})

for (const game of ['darts', 'blocks', 'speedmath'] as const) {
  test(`${game}: a Play match vs Nimo is scored by the server from the move log, not the claimed score`, async () => {
    const ta = await login(addr(30 + game.length), 'Ada')
    const c = (await call(ta, 'POST', '/matches', { game, mode: 'play', opp: 'pip' })).j
    assert.equal(c.status, 'ready')
    const m = app.engine.db.matches[c.id]
    m.startsAt = Date.now() - 100
    const seed = m.seed
    const key = game === 'darts' ? 'throws' : game === 'blocks' ? 'moves' : 'answers'
    const log: unknown = game === 'darts' ? bestThrows(seed) : game === 'blocks' ? greedyBlocks(seed).log : Array.from({ length: 6 }, (_, i) => [smQuestion(seed, i).answer, 400 + i * 600])
    const expected = game === 'darts' ? (replayDarts(seed, log, 70_000) as any).score : game === 'blocks' ? (replayBlocks(seed, log, 200_000) as any).score : 10 + 11 + 12 + 13 + 14 + 15
    const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 99999, time: 1000, detail: { [key]: log } })).j
    const mine = r.players.find((p: any) => p.player.address.startsWith('NQ12'))
    assert.equal(mine.result.score, expected, 'the claimed 99999 is ignored')
    assert.equal(mine.result.detail.verified, true)
    // a tampered log scores nothing
    const t2 = await login(addr(60 + game.length), 'Bisi')
    const c2 = (await call(t2, 'POST', '/matches', { game, mode: 'play', opp: 'pip' })).j
    app.engine.db.matches[c2.id].startsAt = Date.now() - 100
    const r2 = (await call(t2, 'POST', `/matches/${c2.id}/result`, { score: 500, time: 1000, detail: { [key]: 'junk' } })).j
    assert.equal(r2.players.find((p: any) => p.player.address.startsWith('NQ12')).result.score, 0)
  })
}
