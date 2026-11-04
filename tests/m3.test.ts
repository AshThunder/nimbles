import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLegacyName, nickOf } from '../shared/nick'
import { SPEED, createSim, stepSim, walk, snapshot, TICK_MS, HZ } from '../shared/splat'

test('nicknames: friendly, stable per address, short, never the old Player 0002 style', () => {
  const addr = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0001'
  const a = nickOf(addr)
  assert.equal(a, nickOf(addr.toLowerCase().replace(/ /g, '')))
  assert.match(a, /^[A-Z][a-z]+ [A-Z][a-z]+$/)
  assert.ok(a.length <= 16)
  const names = new Set(Array.from({ length: 200 }, (_, i) => nickOf('NQ07 ' + i)))
  assert.ok(names.size > 100, 'spread over many names')
  assert.ok(isLegacyName('Player 0002') && !isLegacyName(a))
})

test('splat runs at 30 Hz and a walking player moves at the same real speed as before (200 units a second)', () => {
  assert.equal(HZ, 30)
  assert.ok(Math.abs(SPEED * (1000 / TICK_MS) - 200) < 1e-9)
})

test('prediction: walk() is exactly what stepSim does for a walking player', () => {
  const s = createSim('predict', 2)
  s.spots.forEach((p) => (p.at = 1e9))
  const p = s.players[0]
  let t = { x: p.x, y: p.y }
  for (let i = 0; i < 90; i++) {
    stepSim(s, [{ mx: 0.7, my: -0.7, ax: 0, ay: 0, f: false, d: false }, undefined])
    t = walk(t.x, t.y, 0.7 * SPEED, -0.7 * SPEED, s.walls)
  }
  assert.ok(Math.abs(p.x - t.x) < 1e-9 && Math.abs(p.y - t.y) < 1e-9)
  assert.equal(snapshot(s).k, 90)
})
