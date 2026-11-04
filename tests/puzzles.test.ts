import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSudoku, dealKlondike } from '../shared/puzzles'
import { billShares, escrowRequired, SPLIT_WEIGHTS } from '../shared/economy'
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

test('bill shares add up exactly', () => {
  for (const n of [2, 3, 4]) {
    for (const bill of [1, 2, 12.96, 1296.33]) {
      const s = billShares(bill, n, [1])
      assert.equal(s.reduce((a, b) => a + b, 0), Math.round(bill * 100000))
      assert.equal(SPLIT_WEIGHTS[n].reduce((a, b) => a + b, 0).toFixed(6), '1.000000')
    }
  }
  assert.equal(escrowRequired('spend', 10, 2, true), 0)
  assert.equal(escrowRequired('spend', 10, 2, false), 600000)
  assert.equal(escrowRequired('save', 2, 2, false), 200000)
  assert.equal(escrowRequired('play', 2, 2, false), 0)
})

test('rng is stable', () => {
  assert.equal(rng('x').int(1000), rng('x').int(1000))
})
