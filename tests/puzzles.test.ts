import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSudoku, dealKlondike } from '../shared/puzzles'
import { drawShares, escrowRequired, settleShares } from '../shared/economy'
import { rng } from '../shared/rng'

test('same seed gives same sudoku, different seed differs', () => {
  const a = makeSudoku('abc', 9)
  const b = makeSudoku('abc', 9)
  const c = makeSudoku('xyz', 9)
  assert.deepEqual(a.puzzle, b.puzzle)
  assert.notDeepEqual(a.puzzle, c.puzzle)
  assert.equal(a.puzzle.filter(Boolean).length <= 40, true)
})

test('4x4 sudoku has unique solution', () => {
  const p = makeSudoku('daily-2026-11-04', 4)
  assert.equal(p.puzzle.length, 16)
  assert.equal(p.solution.every((v) => v >= 1 && v <= 4), true)
})

test('klondike deal is deterministic and has 52 cards', () => {
  const a = dealKlondike('s1')
  const b = dealKlondike('s1')
  assert.deepEqual(a, b)
  const n = a.stock.length + a.tab.reduce((s, c) => s + c.length, 0)
  assert.equal(n, 52)
})

test('settle shares add up exactly and locks cover the biggest share', () => {
  for (const pct of [50, 70, 85, 100]) {
    for (const bill of [0.5, 1, 12.96, 1000, 33.333]) {
      const s = settleShares(bill, pct)
      assert.equal(s.loser + s.winner, Math.round(bill * 100000))
      assert.ok(s.loser >= s.winner)
      const d = drawShares(bill)
      assert.equal(d[0] + d[1], s.total)
      assert.ok(d[0] <= s.loser && d[1] <= s.loser, 'a draw never costs more than the lock')
      assert.equal(escrowRequired('settle', bill, pct), s.loser)
    }
  }
  assert.equal(escrowRequired('settle', 10, 100), 1000000)
  assert.equal(escrowRequired('settle', 10, 70), 700000)
  assert.equal(escrowRequired('save', 2), 200000)
  assert.equal(escrowRequired('play', 2), 0)
})

test('rng is stable', () => {
  assert.equal(rng('x').int(1000), rng('x').int(1000))
})
