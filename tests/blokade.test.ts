import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMove, canPlaceWall, legalPawnMoves, pathExists, pathLength, startBoard, winnerOf, type Board, type Wall } from '../shared/blokade'
import { blokadeMove, blokadeResign, blokadeScore, blokadeTick, CLOCKS, initBlokade } from '../shared/blokadegame'
import { pipBlokade } from '../shared/blokadeai'

const place = (b: Board, side: 's' | 'n', w: Wall) => applyMove(b, side, { kind: 'wall', ...w })

test('opening pawn moves: three steps, no jump', () => {
  const b = startBoard()
  const ms = legalPawnMoves(b, 's')
  assert.deepEqual(new Set(ms.map((p) => p.r + ',' + p.c)), new Set(['7,4', '8,3', '8,5']))
  assert.equal(winnerOf(b), null)
})

test('a wall blocks a step and cannot overlap or cross', () => {
  let b = startBoard()
  b = place(b, 's', { dir: 'h', r: 7, c: 3 })
  const ms = legalPawnMoves(b, 's')
  assert.ok(!ms.some((p) => p.r === 7 && p.c === 4), 'wall above south blocks the forward step')
  assert.equal(canPlaceWall(b, { dir: 'h', r: 7, c: 4 }), false, 'overlapping flat wall')
  assert.equal(canPlaceWall(b, { dir: 'v', r: 7, c: 3 }), false, 'crossing standing wall')
  assert.equal(canPlaceWall(b, { dir: 'h', r: 5, c: 3 }), true)
})

test('a wall may not cut off every path to a goal', () => {
  const b = startBoard()
  // zigzag fence: close cols 0-7 on groove 3, cols 7-8 on groove 4; the standing wall at (3,7) would seal the last way around
  b.walls = [
    { dir: 'h', r: 3, c: 0 },
    { dir: 'h', r: 3, c: 2 },
    { dir: 'h', r: 3, c: 4 },
    { dir: 'h', r: 3, c: 6 },
    { dir: 'h', r: 4, c: 7 },
  ]
  assert.equal(pathExists(b, 's') && pathExists(b, 'n'), true)
  assert.equal(canPlaceWall(b, { dir: 'v', r: 3, c: 7 }), false)
  assert.ok(Number.isFinite(pathLength(b, 's')))
})

test('straight jump over an adjacent pawn', () => {
  const b = startBoard()
  b.pawns = { s: { r: 4, c: 4 }, n: { r: 3, c: 4 } }
  const jumps = legalPawnMoves(b, 'n')
  assert.ok(jumps.some((p) => p.r === 5 && p.c === 4), 'straight jump')
})

test('side jump when the square behind is blocked', () => {
  const b = startBoard()
  b.pawns = { s: { r: 4, c: 4 }, n: { r: 3, c: 4 } }
  b.walls = [{ dir: 'h', r: 4, c: 3, by: 's' }]
  const ms = legalPawnMoves(b, 'n')
  assert.ok(!ms.some((p) => p.r === 5 && p.c === 4), 'straight jump is walled off')
  assert.ok(ms.some((p) => p.r === 4 && p.c === 3))
  assert.ok(ms.some((p) => p.r === 4 && p.c === 5))
})

test('reaching the far side wins', () => {
  const b = startBoard()
  b.pawns.s = { r: 0, c: 4 }
  assert.equal(winnerOf(b), 's')
})

test('clock increment and timeout', () => {
  const st = initBlokade('clk', 0, '3+5')
  const southSeat = st.south
  const dest = { kind: 'pawn' as const, r: 7, c: 4 } // south's opening forward
  blokadeMove(st, southSeat, dest, 4_000)
  assert.equal(st.leftMs.s, CLOCKS['3+5'].base - 4_000 + 5_000)
  assert.equal(st.board.turn, 'n')
  // north flags
  const ticked = blokadeTick(st, 4_000 + CLOCKS['3+5'].base + 1)
  assert.equal(ticked, true)
  assert.equal(st.over?.reason, 'timeout')
  assert.equal(st.over?.winner, 's')
  assert.equal(blokadeScore(st, southSeat), 1)
})

test('resign awards the other seat', () => {
  const st = initBlokade('r', 0, '3+5')
  blokadeResign(st, st.south)
  assert.equal(st.over?.reason, 'resign')
  assert.equal(blokadeScore(st, st.south), 0)
  assert.equal(blokadeScore(st, (1 - st.south) as 0 | 1), 1)
})

test('Nimo at every level returns a legal move', () => {
  const b = startBoard()
  for (const level of ['easy', 'med', 'hard'] as const) {
    const mv = pipBlokade(b, level)
    assert.ok(mv, level)
    const next = applyMove(b, 's', mv!)
    assert.equal(next.turn, 'n')
  }
})
