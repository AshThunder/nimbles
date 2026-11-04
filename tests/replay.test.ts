import test from 'node:test'
import assert from 'node:assert/strict'
import { dealKlondike } from '../shared/puzzles'
import { applyMove, replaySolitaire, solScore, type SolMove } from '../shared/solitaire'
import { BubbleGame, replayBubble, quantizeAngle, type BsShot } from '../shared/bubblesim'
import { resolveChainConfig } from '../server/chain'

/** Greedy legal player: foundation moves first, then draws. Logs every move with a timestamp. */
function playSolitaire(seed: string, maxMoves = 400) {
  const g = dealKlondike(seed)
  const log: SolMove[] = []
  let t = 0
  const mv = (k: number, a = 0, b = 0, c = 0) => {
    if (!applyMove(g, k, a, b, c)) return false
    t += 120
    log.push([k, a, b, c, t])
    return true
  }
  for (let i = 0; i < maxMoves; i++) {
    let moved = false
    for (let p = 0; p < 4 && !moved; p++) moved = mv(2, p)
    for (let c = 0; c < 7 && !moved; c++) for (let p = 0; p < 4 && !moved; p++) moved = mv(4, c, p)
    for (let c = 0; c < 7 && !moved; c++) moved = mv(1, c)
    for (let a = 0; a < 7 && !moved; a++) for (let c = 0; c < 7 && !moved; c++) {
      const first = g.tab[a].findIndex((x) => x.up)
      if (first >= 0 && (first > 0 || g.tab[a][0].card.rank !== 12)) moved = mv(3, a, first, c)
    }
    if (!moved) moved = mv(0)
    if (!moved) break
  }
  return { g, log }
}

test('solitaire: replay of a legal game reproduces the client score exactly', () => {
  const { g, log } = playSolitaire('seed-a')
  assert.ok(log.length > 20)
  const r = replaySolitaire('seed-a', log, 200_000)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.score, solScore(g))
})

test('solitaire: tampered, illegal, too-fast and out-of-time logs are rejected', () => {
  const { log } = playSolitaire('seed-b')
  const bad = log.map((m) => [...m] as SolMove)
  bad[3] = [3, 0, 0, 0, bad[3][4]] // same column to itself
  assert.equal(replaySolitaire('seed-b', bad, 200_000).ok, false)
  assert.equal(replaySolitaire('seed-OTHER', log, 200_000).ok && (replaySolitaire('seed-OTHER', log, 200_000) as any).score === (replaySolitaire('seed-b', log, 200_000) as any).score, false) // another seed does not replay the same
  const fast = log.map((m, i) => [m[0], m[1], m[2], m[3], i * 10] as SolMove)
  assert.equal(replaySolitaire('seed-b', fast, 200_000).ok, false)
  assert.equal(replaySolitaire('seed-b', log, 1000).ok, false)
  assert.equal(replaySolitaire('seed-b', [[2, 0, 0, 0, 500]], 200_000).ok, false) // nothing on the waste to play
  assert.equal(replaySolitaire('seed-b', 'x' as any, 1000).ok, true) // no log = score 0
})

/** Plays shots that start a same-colour pop when possible, otherwise random angles. */
function playBubble(seed: string, n = 60) {
  const g = new BubbleGame(seed)
  const log: BsShot[] = []
  let t = 0
  for (let i = 0; i < n && !g.over; i++) {
    let best = { aq: quantizeAngle(-Math.PI / 2), pops: -1 }
    for (let k = 0; k < 40; k++) {
      const aq = quantizeAngle(-0.25 - (k / 39) * (Math.PI - 0.5))
      const tr = g.trace(aq)
      if (!tr.cell) continue
      const [r, c] = tr.cell
      let same = 0
      for (const [a, b] of g.nbrs(r, c)) if (g.grid[a][b] === g.cur) same++
      if (same > best.pops) best = { aq, pops: same }
    }
    const tr = g.trace(best.aq)
    t += Math.max(150, tr.path.length * 4) + 20
    log.push([best.aq, t - Math.max(150, tr.path.length * 4)])
    t = log[log.length - 1][1] + Math.max(150, tr.path.length * 4) + 5
    g.commit(tr.cell)
  }
  return { g, log }
}

test('bubble: replay reproduces the score, and a changed shot changes it', () => {
  const { g, log } = playBubble('bs-1')
  assert.ok(g.score > 0, 'the bot scored')
  const r = replayBubble('bs-1', log, 200_000)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.score, g.score)
  const other = replayBubble('bs-2', log, 200_000)
  assert.ok(!other.ok || other.score !== g.score)
})

test('bubble: bad angles, rapid fire and shots after game over are rejected', () => {
  const { log } = playBubble('bs-3', 10)
  assert.equal(replayBubble('bs-3', [[5000, 100]], 1e6).ok, false) // aiming downwards
  assert.equal(replayBubble('bs-3', [[-15000.5, 100]], 1e6).ok, false) // not an integer
  assert.equal(replayBubble('bs-3', log.map((s, i) => [s[0], i * 20] as BsShot), 1e6).ok, false) // faster than a bubble can fly
  assert.equal(replayBubble('bs-3', log, 1).ok, false)
})

test('chain config: NETWORK flag, aliases, and conflicts', () => {
  assert.deepEqual(resolveChainConfig({}), { kind: 'mock', network: 'testnet' })
  assert.deepEqual(resolveChainConfig({ CHAIN: 'nimiq' }), { kind: 'nimiq', network: 'testnet' })
  assert.deepEqual(resolveChainConfig({ CHAIN: 'nimiq', NETWORK: 'mainnet' }), { kind: 'nimiq', network: 'mainnet' })
  assert.deepEqual(resolveChainConfig({ CHAIN: 'testnet' }), { kind: 'nimiq', network: 'testnet' })
  assert.throws(() => resolveChainConfig({ CHAIN: 'testnet', NETWORK: 'mainnet' }))
  assert.throws(() => resolveChainConfig({ CHAIN: 'nimiq', NETWORK: 'ropsten' }))
})
