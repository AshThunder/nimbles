import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { SP_COLS, SP_MIN_GAP_MS, dealSpider, replaySpider, runFrom, spDeal, spMove, spScore, type SpLog } from '../shared/spider'

import { DM_DRAW, DM_TILES, dealDominoes, dmDraw, dmFits, dmOver, dmPlace, replayDominoes, type DmMove } from '../shared/dominoes'

import { BZ_CARDS, BZ_MIN_GAP_MS, bzDeal, bzScore, bzStackScore, bzTotal, replayBlitz, type BzMove } from '../shared/blitz'

import { BW_AIM_PERIOD, BW_HOOK_PERIOD, BW_PINS, bwApply, bwDrift, bwKnock, bwNew, bwScore, bwShot, bwWave, replayBowling, type BwThrow } from '../shared/bowling'
import { CR_MIN_GAP_MS, crFire, crNew, crValid, replayCarrom, type CrShot } from '../shared/carrom'
import { GH_MS, ghNew, ghRowAt, ghStep, ghTrack, replayGhost, type GhEvent } from '../shared/ghost'

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

/** A simple player: take any move that turns a card or builds, else deal. Returns its log. */
function greedySpider(seed: string, maxMoves = 300) {
  const g = dealSpider(seed)
  const log: SpLog[] = []
  let at = 500
  for (let n = 0; n < maxMoves; n++) {
    let done = false
    for (let a = 0; a < SP_COLS && !done; a++) {
      for (let b = 0; b < g.cols[a].length && !done; b++) {
        if (!runFrom(g.cols[a], b)) continue
        for (let c = 0; c < SP_COLS && !done; c++) {
          const top = g.cols[c][g.cols[c].length - 1]
          if (c === a || !top) continue
          const before = spScore(g)
          const snap = JSON.stringify(g)
          if (spMove(g, a, b, c)) {
            if (spScore(g) > before) {
              log.push([1, a, b, c, at])
              at += 200
              done = true
            } else Object.assign(g, JSON.parse(snap)) // a pointless shuffle, undo
          }
        }
      }
    }
    if (!done) {
      if (!spDeal(g)) break
      log.push([0, 0, 0, 0, at])
      at += 200
    }
  }
  return { g, log }
}

test('spider: same seed gives the same deal, 10 columns, 54 cards on the table and 5 deals in the stock', () => {
  const a = dealSpider('s-1'), b = dealSpider('s-1'), c = dealSpider('s-2')
  assert.deepEqual(a, b)
  assert.notDeepEqual(a.cols, c.cols)
  assert.equal(a.cols.length, 10)
  assert.equal(a.cols.reduce((n, x) => n + x.length, 0), 54)
  assert.equal(a.stock.length, 50)
  assert.ok(a.cols.every((col) => col[col.length - 1].up && col.slice(0, -1).every((x) => !x.up)))
})

test('spider: only same-suit descending runs move, onto the next rank up or an empty column; a K to A run is removed', () => {
  const g = dealSpider('s-3')
  g.cols[0] = [{ r: 5, up: false }, { r: 9, up: true }, { r: 8, up: true }]
  g.cols[1] = [{ r: 10, up: true }]
  g.cols[2] = [{ r: 3, up: true }]
  assert.equal(runFrom(g.cols[0], 1), 2)
  assert.equal(runFrom(g.cols[0], 0), 0, 'face down cards never move')
  assert.equal(spMove(g, 0, 1, 2), false, 'must land on a rank one higher')
  assert.equal(spMove(g, 0, 1, 1), true)
  assert.equal(g.cols[0].length, 1)
  assert.ok(g.cols[0][0].up, 'the card under it turns over')
  assert.equal(g.flipped, 1)
  // a full run K..A completes and leaves the column
  g.cols[3] = Array.from({ length: 13 }, (_, i) => ({ r: 13 - i, up: true }))
  const runs = g.runs
  g.cols[3] = Array.from({ length: 12 }, (_, i) => ({ r: 13 - i, up: true }))
  g.cols[6] = [{ r: 1, up: true }]
  g.cols[7] = [{ r: 2, up: true }]
  g.cols[3].pop() // K..3
  assert.ok(spMove(g, 7, 0, 3))
  assert.equal(g.cols[3].length, 12, 'K..2 sit in the column')
  assert.ok(spMove(g, 6, 0, 3))
  assert.equal(g.cols[3].length, 0, 'the finished K..A run is gone')
  assert.equal(g.runs, runs + 1)
  assert.ok(spScore(g) >= 100)
})

test('spider: dealing needs no empty column and a full stock row', () => {
  const g = dealSpider('s-4')
  assert.ok(spDeal(g))
  assert.equal(g.stock.length, 40)
  g.cols[2] = []
  assert.equal(spDeal(g), false)
  g.cols[2] = [{ r: 4, up: true }]
  g.stock = g.stock.slice(0, 5)
  assert.equal(spDeal(g), false)
})

test('spider: replay matches the player, and rejects illegal, too-fast, late or malformed logs', () => {
  const { g, log } = greedySpider('s-5')
  assert.ok(log.length > 10)
  const r = replaySpider('s-5', log, 250_000)
  assert.ok(r.ok && r.score === spScore(g) && r.score > 0, 'replay gives the same score')
  assert.equal(replaySpider('s-5', [[1, 0, 0, 0, 500]], 250_000).ok, false, 'same column move')
  assert.equal(replaySpider('s-5', [[0, 0, 0, 0, 500], [0, 0, 0, 0, 500 + SP_MIN_GAP_MS - 1]], 250_000).ok, false, 'faster than a finger')
  assert.equal(replaySpider('s-5', [[0, 0, 0, 0, 900_000]], 250_000).ok, false)
  assert.equal(replaySpider('s-5', 'junk', 250_000).ok, false)
  assert.equal(replaySpider('s-5', [[1.5, 0, 0, 0, 100]], 250_000).ok, false)
})

test('spider: a Play match vs Nimo is scored by the server from the move log, not the claimed score', async () => {
  const ta = await login(addr(81), 'Ada')
  const c = (await call(ta, 'POST', '/matches', { game: 'spider', mode: 'play', opp: 'pip' })).j
  assert.equal(c.status, 'ready')
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 100
  const { g, log } = greedySpider(m.seed)
  const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 99999, time: 1000, detail: { moves: log } })).j
  const mine = r.players.find((p: any) => p.player.address.startsWith('NQ12'))
  assert.equal(mine.result.score, spScore(g))
  assert.equal(mine.result.detail.verified, true)
  const t2 = await login(addr(82), 'Bisi')
  const c2 = (await call(t2, 'POST', '/matches', { game: 'spider', mode: 'play', opp: 'pip' })).j
  app.engine.db.matches[c2.id].startsAt = Date.now() - 100
  const r2 = (await call(t2, 'POST', `/matches/${c2.id}/result`, { score: 500, time: 1000, detail: { moves: 'junk' } })).j
  assert.equal(r2.players.find((p: any) => p.player.address.startsWith('NQ12')).result.score, 0)
})

/** Plays the highest-pip tile that fits, draws when stuck */
function greedyDominoes(seed: string) {
  const g = dealDominoes(seed)
  const log: DmMove[] = []
  let at = 400
  while (!dmOver(g)) {
    const fit = g.hand.filter((id) => dmFits(g, id)).sort((a, b) => DM_TILES[b][0] + DM_TILES[b][1] - DM_TILES[a][0] - DM_TILES[a][1])
    if (fit.length) {
      const side = dmFits(g, fit[0]) & 1 ? 0 : 1
      assert.ok(dmPlace(g, fit[0], side))
      log.push([fit[0], side, at])
    } else {
      assert.ok(dmDraw(g))
      log.push([DM_DRAW, 0, at])
    }
    at += 300
  }
  return { g, log }
}

test('dominoes: same deal for the same seed, 28 distinct tiles, tiles must match the chain end', () => {
  const a = dealDominoes('d-1')
  assert.deepEqual(a, dealDominoes('d-1'))
  assert.notDeepEqual(a.hand, dealDominoes('d-2').hand)
  assert.equal(new Set([...a.chain, ...a.hand, ...a.yard]).size, 28)
  assert.equal(a.hand.length, 7)
  const miss = a.hand.find((id) => !dmFits(a, id))
  if (miss !== undefined) assert.equal(dmPlace(a, miss, 0) || dmPlace(a, miss, 1), false)
  const ok = a.hand.find((id) => dmFits(a, id))
  if (ok !== undefined) {
    const [x, y] = DM_TILES[ok]
    assert.ok(dmPlace(a, ok, dmFits(a, ok) & 1 ? 0 : 1))
    assert.equal(a.score, x + y + (x === y ? 10 : 0) + ((a.hand.length as number) === 0 ? 40 : 0))
  }
})

test('dominoes: you can only draw when nothing fits', () => {
  const g = dealDominoes('d-3')
  g.hand = [g.hand.find((id) => dmFits(g, id)) ?? 0]
  if (dmFits(g, g.hand[0])) assert.equal(dmDraw(g), false)
  g.hand = [...Array(28).keys()].filter((id) => !dmFits(g, id) && !g.chain.includes(id)).slice(0, 3)
  assert.ok(dmDraw(g))
  assert.equal(g.hand.length, 4)
})

test('dominoes: replay matches the player, and rejects an illegal draw, a bad tile, a fast move, junk', () => {
  const { g, log } = greedyDominoes('d-4')
  const r = replayDominoes('d-4', log, 130_000)
  assert.ok(r.ok && r.score === g.score && r.score > 0)
  const first = dealDominoes('d-4')
  const playable = first.hand.find((id) => dmFits(first, id))
  assert.equal(replayDominoes('d-4', [[DM_DRAW, 0, 500]], 130_000).ok, playable === undefined, 'drawing with a playable tile is illegal')
  assert.equal(replayDominoes('d-4', [[99, 0, 500]], 130_000).ok, false)
  assert.equal(replayDominoes('d-4', [[log[0][0], log[0][1], 10], [log[1][0], log[1][1], 20]], 130_000).ok, false)
  assert.equal(replayDominoes('d-4', 'junk', 130_000).ok, false)
})

test('dominoes: a Play match vs Nimo is scored by the server from the move log', async () => {
  const ta = await login(addr(91), 'Ada')
  const c = (await call(ta, 'POST', '/matches', { game: 'dominoes', mode: 'play', opp: 'pip' })).j
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 100
  const { g, log } = greedyDominoes(m.seed)
  const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 99999, time: 1000, detail: { moves: log } })).j
  const mine = r.players.find((p: any) => p.player.address.startsWith('NQ12'))
  assert.equal(mine.result.score, g.score)
  assert.equal(mine.result.detail.verified, true)
})

// card ids: rank = id % 13 + 1, so ace = 0, 10 = 9, king = 12
test('blitz: same 20 cards for the same seed, hand values and scores', () => {
  assert.deepEqual(bzDeal('b-1'), bzDeal('b-1'))
  assert.notDeepEqual(bzDeal('b-1'), bzDeal('b-2'))
  assert.equal(new Set(bzDeal('b-1')).size, BZ_CARDS)
  assert.deepEqual(bzTotal([0, 12]), { total: 21, soft: true }, 'ace + king is a soft 21')
  assert.equal(bzStackScore([0, 12]), 100, 'a two card 21 is a blackjack')
  assert.equal(bzStackScore([4, 5, 9]), 70, '5 + 6 + 10 is 21')
  assert.equal(bzTotal([0, 0, 4]).total, 17, 'two aces, only one counts as 11')
  assert.equal(bzStackScore([12, 11, 4]), 0, 'bust')
  assert.equal(bzStackScore([9, 8]), 40)
  assert.equal(bzStackScore([1, 2]), 10)
  assert.equal(bzScore([[0, 12], [9, 8], [12, 11, 4], []]), 140)
})

test('blitz: replay scores what was placed, and rejects a full stack, a bad stack, fast taps, junk', () => {
  const deck = bzDeal('b-3')
  const moves: BzMove[] = deck.map((_, i) => [i % 4, 500 + i * 400])
  const stacks: number[][] = [[], [], [], []]
  deck.forEach((id, i) => stacks[i % 4].push(id))
  const r = replayBlitz('b-3', moves, 100_000)
  assert.ok(r.ok && r.score === bzScore(stacks))
  assert.equal(replayBlitz('b-3', [...moves.slice(0, 6).map((m, i) => [0, 500 + i * 400] as BzMove)], 100_000).ok, false, 'a sixth card in one stack')
  assert.equal(replayBlitz('b-3', [[4, 500]], 100_000).ok, false)
  assert.equal(replayBlitz('b-3', [[0, 500], [1, 500 + BZ_MIN_GAP_MS - 1]], 100_000).ok, false)
  assert.equal(replayBlitz('b-3', [[0, 500_000]], 100_000).ok, false)
  assert.equal(replayBlitz('b-3', 'junk', 100_000).ok, false)
  const half = replayBlitz('b-3', moves.slice(0, 8), 100_000)
  assert.ok(half.ok)
  assert.equal((half as any).score, bzScore(stacks.map((s) => s.slice(0, 2))), 'eight cards = two on each stack')
})

test('blitz: a Play match vs Nimo is scored by the server from the move log', async () => {
  const ta = await login(addr(95), 'Ada')
  const c = (await call(ta, 'POST', '/matches', { game: 'blitz', mode: 'play', opp: 'pip' })).j
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 100
  const deck = bzDeal(m.seed)
  const stacks: number[][] = [[], [], [], []]
  const log: BzMove[] = deck.map((id, i) => (stacks[i % 4].push(id), [i % 4, 400 + i * 300] as BzMove))
  const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 99999, time: 1000, detail: { moves: log } })).j
  const mine = r.players.find((p: any) => p.player.address.startsWith('NQ12'))
  assert.equal(mine.result.score, bzScore(stacks))
  assert.equal(mine.result.detail.verified, true)
})

test('bowling: triangle waves, standard scoring for strikes, spares, a perfect game and an open game', () => {
  assert.equal(bwWave(0, 3000), -1)
  assert.equal(bwWave(1500, 3000), 1)
  assert.equal(bwWave(3000, 3000), -1)
  assert.equal(bwWave(750, 3000), 0)
  assert.equal(bwScore(Array(12).fill(10)).total, 300)
  assert.equal(bwScore(Array(21).fill(5)).total, 150)
  assert.equal(bwScore([9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0]).total, 90)
  assert.equal(bwScore([10, 3, 4]).total, 17 + 7)
  assert.deepEqual(bwScore([10, 3, 4]).frames, [17, 24])
  assert.equal(bwScore([5, 5, 3]).total, 13 + 3, 'spare adds the next ball, an unfinished frame counts what was rolled')
})

test('bowling: drift is the same for the same seed, and a throw is a pure function of the two tap times', () => {
  assert.deepEqual(bwDrift('w-1'), bwDrift('w-1'))
  assert.notDeepEqual(bwDrift('w-1'), bwDrift('w-2'))
  assert.ok(bwDrift('w-1').every((d) => Math.abs(d) <= 0.075 + 1e-9))
  const st = BW_PINS.map(() => true)
  const a = bwKnock(st, bwShot(1234, 2345, 0.025))
  assert.deepEqual(a, bwKnock(st, bwShot(1234, 2345, 0.025)))
  assert.equal(bwKnock(st, { x: 0, slope: 0 }).length, 10, 'straight down the middle')
  assert.ok(bwKnock(st, { x: 1.4, slope: 0 }).length < 10)
  // frame logic: a strike moves on at once, an open frame needs two balls and resets the pins
  const g = bwNew()
  bwApply(g, [...Array(10).keys()])
  assert.equal(g.frame, 1)
  assert.equal(g.ball, 0)
  assert.equal(g.standing.filter(Boolean).length, 10)
  bwApply(g, [0, 1, 2])
  assert.equal(g.ball, 1)
  assert.equal(g.standing.filter(Boolean).length, 7)
  bwApply(g, [3])
  assert.equal(g.frame, 2)
})

/** Tries tap times on a grid and keeps the throw that knocks the most pins */
function bestBowler(seed: string, n = 20) {
  const drift = bwDrift(seed)
  const s = bwNew()
  const log: BwThrow[] = []
  for (let k = 0; k < n && !s.over; k++) {
    let best = -1
    let bt: BwThrow = [400, 800]
    for (let t1 = 300; t1 < BW_AIM_PERIOD; t1 += 25)
      for (let t2 = t1 + 300; t2 < t1 + 300 + BW_HOOK_PERIOD; t2 += 25) {
        const kn = bwKnock(s.standing, bwShot(t1, t2, drift[k])).length
        if (kn > best) ((best = kn), (bt = [t1, t2]))
      }
    log.push(bt)
    bwApply(s, bwKnock(s.standing, bwShot(bt[0], bt[1], drift[k])))
  }
  return { s, log }
}

test('bowling: replay rebuilds the score from tap times, and rejects too fast, too slow, too many, junk', () => {
  const { s, log } = bestBowler('w-3')
  const r = replayBowling('w-3', log, 190_000)
  assert.ok(r.ok && r.score === bwScore(s.rolls).total && r.score > 200, 'a perfect aimer scores high')
  assert.equal(replayBowling('w-3', [[10, 400]], 190_000).ok, false, 'aim tap in under 300 ms')
  assert.equal(replayBowling('w-3', [[400, 500]], 190_000).ok, false, 'hook tap right after the aim tap')
  assert.equal(replayBowling('w-3', [[400, 9000]], 190_000).ok, false, 'waited too long')
  assert.equal(replayBowling('w-3', log.concat([[400, 900]]), 190_000).ok, false, 'a throw after the game ended')
  assert.equal(replayBowling('w-3', log, 5_000).ok, false, 'more than the allowed time')
  assert.equal(replayBowling('w-3', 'junk', 190_000).ok, false)
  assert.equal(replayBowling('w-3', [[400.5, 900]], 190_000).ok, false)
})

test('bowling: a Play match vs Nimo is scored by the server from the tap times, not the claimed score', async () => {
  const ta = await login(addr(97), 'Ada')
  const c = (await call(ta, 'POST', '/matches', { game: 'bowling', mode: 'play', opp: 'pip' })).j
  const m = app.engine.db.matches[c.id]
  m.startsAt = Date.now() - 100
  const { s, log } = bestBowler(m.seed, 6)
  const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 99999, time: 1000, detail: { throws: log } })).j
  const mine = r.players.find((p: any) => p.player.address.startsWith('NQ12'))
  assert.equal(mine.result.score, bwScore(s.rolls).total)
  assert.equal(mine.result.detail.verified, true)
})

test('carrom: the same strikes on the same board always end the same, junk is refused, pockets score', () => {
  const shots: CrShot[] = [[500, 0, -1000, 100, 1000], [300, 300, -900, 80, 3000], [700, -400, -800, 90, 5000]]
  const a = replayCarrom('c-1', shots, 150_000)
  const b = replayCarrom('c-1', shots, 150_000)
  assert.ok(a.ok && b.ok)
  if (a.ok && b.ok) assert.deepEqual(a, b)
  const g1 = crNew('c-1')
  const g2 = crNew('c-1')
  for (const s of shots) (crFire(g1, s), crFire(g2, s))
  assert.deepEqual(g1, g2)
  assert.notDeepEqual(crNew('c-1').coins.map((c) => c.kind), crNew('c-2').coins.map((c) => c.kind))
  assert.equal(crValid([500, 0, -50, 50, 0]), false, 'aim must point up the board')
  assert.equal(crValid([100, 0, -1000, 50, 0]), false, 'striker must sit on the baseline segment')
  assert.equal(crValid([500, 0, -1000, 50.5, 0]), false)
  assert.equal(replayCarrom('c-1', [[500, 0, -1000, 100, 1000], [500, 0, -1000, 100, 1000 + CR_MIN_GAP_MS - 1]], 150_000).ok, false, 'strikes too close together')
  assert.equal(replayCarrom('c-1', Array(9).fill(0).map((_, i) => [500, 0, -1000, 50, i * 2000]), 150_000).ok, false, 'a ninth strike')
  assert.equal(replayCarrom('c-1', [[500, 0, -1000, 50, 160_000]], 150_000).ok, false, 'after the clock')
  assert.equal(replayCarrom('c-1', 'junk', 150_000).ok, false)
  // a straight strike up the middle breaks the pack and pockets something across some strikes of a search
  let best = 0
  const g = crNew('c-1')
  for (let k = 0; k < 8; k++) {
    let top = -1, shot: CrShot = [500, 0, -1000, 50, 0]
    for (let x = 250; x <= 750; x += 100) for (let ax = -600; ax <= 600; ax += 120) {
      const c = JSON.parse(JSON.stringify(g)); const t: CrShot = [x, ax, -600, 70, 0]; crFire(c, t)
      if (c.score > top) ((top = c.score), (shot = t))
    }
    crFire(g, shot)
    best = g.score
  }
  assert.ok(best >= 60, 'a patient player scores well')
})

test('ghost race: the track is the same per seed, hits stop you, a clean run covers the same ground', () => {
  assert.deepEqual(ghTrack('g-1'), ghTrack('g-1'))
  assert.notDeepEqual(ghTrack('g-1'), ghTrack('g-2'))
  assert.ok(ghTrack('g-1').every((m) => m >= 1 && m <= 6), 'one lane is always open')
  // standing still in a lane that is blocked costs time
  const rows = ghTrack('g-1')
  const clean = (() => {
    const g = ghNew()
    let i = 0
    while (g.t < GH_MS) {
      // dodge: step into an open lane when the next row blocks the current one
      const nx = rows[g.next]
      if (nx !== undefined && ghRowAt(g.next) - g.d < 16 && nx & (1 << g.lane)) g.lane = [0, 1, 2].find((l) => !(nx & (1 << l)))!
      ghStep(g, rows)
      i++
    }
    return g
  })()
  assert.equal(clean.hits, 0)
  const idle = ghNew()
  while (idle.t < GH_MS) ghStep(idle, rows)
  assert.ok(idle.hits > 0)
  assert.ok(Math.floor(idle.d) < Math.floor(clean.d))
  // replay of the lane changes rebuilds the same distance
  const ev: GhEvent[] = []
  {
    const g = ghNew()
    let lane = 1
    while (g.t < GH_MS) {
      const nx = rows[g.next]
      if (nx !== undefined && ghRowAt(g.next) - g.d < 16 && nx & (1 << g.lane)) {
        const nl = [0, 1, 2].find((l) => !(nx & (1 << l)))!
        if (nl !== lane && (!ev.length || g.t - ev[ev.length - 1][1] >= 100)) ((lane = nl), (g.lane = nl), ev.push([nl, g.t]))
      }
      ghStep(g, rows)
    }
  }
  const r = replayGhost('g-1', ev, 50_000)
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.score, Math.floor(clean.d))
  assert.equal(replayGhost('g-1', [], 50_000).ok && (replayGhost('g-1', [], 50_000) as any).score, Math.floor(idle.d))
  assert.equal(replayGhost('g-1', [[2, 50], [0, 100]], 50_000).ok, false, 'lane changes 50 ms apart')
  assert.equal(replayGhost('g-1', [[3, 100]], 50_000).ok, false)
  assert.equal(replayGhost('g-1', [[1, 105]], 50_000).ok, false)
  assert.equal(replayGhost('g-1', [[1, 46_000]], 50_000).ok, false)
  assert.equal(replayGhost('g-1', 'junk', 50_000).ok, false)
})

test('carrom and ghost race: a Play match vs Nimo takes the server score, not the claimed one', async () => {
  const ta = await login(addr(96), 'Ada')
  const c1 = (await call(ta, 'POST', '/matches', { game: 'carrom', mode: 'play', opp: 'pip' })).j
  app.engine.db.matches[c1.id].startsAt = Date.now() - 100
  const r1 = (await call(ta, 'POST', `/matches/${c1.id}/result`, { score: 99999, time: 1000, detail: { shots: [[500, 0, -1000, 100, 1000]] } })).j
  const m1 = r1.players.find((p: any) => p.player.address.startsWith('NQ12'))
  const exp = replayCarrom(app.engine.db.matches[c1.id].seed, [[500, 0, -1000, 100, 1000]], 150_000)
  assert.equal(m1.result.score, exp.ok ? exp.score : -1)
  assert.equal(m1.result.detail.verified, true)
  const c2 = (await call(ta, 'POST', '/matches', { game: 'ghost', mode: 'play', opp: 'pip' })).j
  app.engine.db.matches[c2.id].startsAt = Date.now() - 100
  const r2 = (await call(ta, 'POST', `/matches/${c2.id}/result`, { score: 99999, time: 45000, detail: { run: [] } })).j
  const m2 = r2.players.find((p: any) => p.player.address.startsWith('NQ12'))
  assert.ok(m2.result.score < 1000 && m2.result.score > 100)
  assert.equal(m2.result.detail.verified, true)
})
