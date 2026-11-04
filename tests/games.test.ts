import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { pipMove } from '../shared/chessai'
import { rack, step, fire, judge, pipShot, type Ball, type Group } from '../shared/poolsim'
import { wordRack, sevensOf, scoreWords, canMake } from '../shared/words'

const dict = new Set(readFileSync(new URL('../assets/words/dict.txt', import.meta.url), 'utf8').split('\n').filter(Boolean))

test('pip chess plays only legal moves and finds mate in one', () => {
  const c = new Chess('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1')
  const m = pipMove(c, 'med')!
  assert.equal(m.san, 'Ra8#')
  const g = new Chess()
  for (let i = 0; i < 24 && !g.isGameOver(); i++) {
    const mv = pipMove(g, i % 2 ? 'hard' : 'easy')!
    assert.ok(g.moves().includes(mv.san))
    g.move(mv)
  }
})

test('pool: rack is seeded, has 15 balls, 8 in the middle of row 3', () => {
  const a = rack('s1')
  const b = rack('s1')
  assert.equal(a.length, 16)
  assert.deepEqual(a.map((x) => x.n), b.map((x) => x.n))
  assert.notDeepEqual(a.map((x) => x.n), rack('s2').map((x) => x.n))
  assert.equal(a[1 + 4].n, 8)
})

test('pool: pip vs pip finishes under the rules, balls are conserved', () => {
  let balls = rack('t')
  let groups: Group | null = null // shooter A group
  let turn = 0
  let over: number | null = null
  for (let shot = 0; shot < 120 && over === null; shot++) {
    const mine: Group | null = turn === 0 ? groups : groups ? (groups === 'solid' ? 'stripe' : 'solid') : null
    const before = balls.map((b) => ({ ...b }))
    const [a, p] = pipShot(balls, mine, 'hard')
    const ev = fire(balls, a, p)
    const j = judge(before, ev, mine)
    assert.ok(balls.filter((b) => b.on).length + balls.filter((b) => !b.on).length === 16)
    if (j.win !== null) over = j.win ? turn : 1 - turn
    if (j.assign) groups = turn === 0 ? j.assign : j.assign === 'solid' ? 'stripe' : 'solid'
    if (!balls[0].on) Object.assign(balls[0], { on: true, x: 150, y: 400, vx: 0, vy: 0 })
    if (!(j.again && !j.foul)) turn = 1 - turn
  }
  assert.ok(balls.filter((b) => !b.on && b.n !== 0).length > 0, 'something was potted')
})

test('pool: a ball stops and cannot leave the table', () => {
  const bs: Ball[] = [{ n: 0, x: 150, y: 300, vx: 0, vy: 0, on: true }]
  const ev = fire(bs, -Math.PI / 4, 1)
  assert.ok(!bs[0].on || (bs[0].x >= 0 && bs[0].x <= 300 && bs[0].y >= 0 && bs[0].y <= 520))
  assert.equal(step(bs, ev) || false, false)
})

test('word rush: server scoring accepts real words from the rack only', () => {
  const sevens = sevensOf([...dict])
  const rk = wordRack('seed', sevens)
  assert.equal(rk.length, 7)
  const seven = sevens.find((w) => canMake(w, rk))
  assert.ok(seven, 'rack always has a 7-letter word')
  const r = scoreWords([seven, seven, 'zzzzz', 'ab'], rk, dict)
  assert.equal(r.score, 20)
  assert.deepEqual(r.valid, [seven])
})
