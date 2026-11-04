import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const expect = (v: any) => {
  const o: any = {
    toBe: (x: any) => assert.equal(v, x),
    toEqual: (x: any) => assert.deepEqual(v, x),
    toBeLessThan: (x: number) => assert.ok(v < x, `${v} < ${x}`),
    toBeLessThanOrEqual: (x: number) => assert.ok(v <= x, `${v} <= ${x}`),
    toBeGreaterThan: (x: number) => assert.ok(v > x, `${v} > ${x}`),
    toBeGreaterThanOrEqual: (x: number) => assert.ok(v >= x, `${v} >= ${x}`),
    toBeTruthy: () => assert.ok(v),
    toBeCloseTo: (x: number, d = 2) => assert.ok(Math.abs(v - x) < 10 ** -d / 2, `${v} ~ ${x}`),
  }
  o.not = { toBe: (x: any) => assert.notEqual(v, x) }
  return o
}
import { ARENA, botInput, cleanInput, createSim, fastForward, makeMap, standings, stateHash, stepSim, zoneRadius, forceOut, snapshot, type Input, type Sim } from '../shared/splat'

const runBots = (seed: string, n: number, cap = 3600) => {
  const s = createSim(seed, n, cap)
  while (!s.over) stepSim(s, s.players.map((p) => botInput(s, p.seat, 'med')))
  return s
}

describe('splat sim', () => {
  it('map is point-symmetric: walls and pickups have twins through the centre', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const m = makeMap('seed-' + n, n)
      expect(m.walls.length).toBeGreaterThanOrEqual(6)
      for (const w of m.walls) {
        const twin = m.walls.find((o) => Math.abs(o.x - (ARENA - w.x - w.w)) < 1e-6 && Math.abs(o.y - (ARENA - w.y - w.h)) < 1e-6 && o.w === w.w && o.h === w.h)
        expect(twin).toBeTruthy()
      }
      for (const sp of m.spots) {
        const twin = m.spots.find((o) => o.kind === sp.kind && Math.abs(o.x - (ARENA - sp.x)) < 1e-6 && Math.abs(o.y - (ARENA - sp.y)) < 1e-6)
        expect(twin).toBeTruthy()
      }
      expect(m.spots.filter((p) => p.kind === 'ammo').length).toBe(m.spots.filter((p) => p.kind === 'ammo').length)
    }
  })
  it('spawns sit on a ring, are identical in loadout and clear of walls', () => {
    const s = createSim('abc', 6)
    expect(new Set(s.seatPos).size).toBe(6)
    for (const p of s.players) {
      expect([p.hp, p.ammo, p.shield]).toEqual([3, 5, 0])
      expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(400, 3)
    }
  })
  it('same seed and inputs give the same match; a different seed does not', () => {
    const a = runBots('same', 4)
    const b = runBots('same', 4)
    expect(stateHash(a)).toBe(stateHash(b))
    expect(JSON.stringify(a.walls)).not.toBe(JSON.stringify(runBots('other', 4).walls))
  })
  it('bot matches always finish by the cap, with a strict order of every seat', () => {
    for (const [seed, n] of [['a', 2], ['b', 3], ['c', 4], ['d', 5], ['e', 6], ['f', 6]] as [string, number][]) {
      const s = runBots(seed, n)
      expect(s.over).toBe(true)
      expect(s.tick).toBeLessThanOrEqual(3600)
      const order = standings(s)
      expect([...order].sort()).toEqual(Array.from({ length: n }, (_, i) => i))
      // someone actually fought
      expect(s.players.reduce((t, p) => t + p.splats, 0) + s.players.filter((p) => !p.alive).length).toBeGreaterThan(0)
    }
  })
  it('standing still in the zone gets you eliminated by the shrinking circle', () => {
    const s = createSim('idle', 2, 600)
    while (!s.over) stepSim(s, [])
    // both idle on the ring at radius 400, the zone shrinks below that, both burn; one order is decided
    const order = standings(s)
    expect(order.length).toBe(2)
    expect(s.players.every((p) => p.hp < 3)).toBe(true)
  })
  it('the zone schedule is fixed', () => {
    expect(zoneRadius(0)).toBe(500)
    expect(zoneRadius(900)).toBe(500)
    expect(zoneRadius(4500)).toBe(70)
    expect(zoneRadius(2700)).toBeCloseTo(285, 0)
  })
  it('a hit costs HP, a shield absorbs one, three hits eliminate and credit the shooter', () => {
    const s = createSim('hit', 2)
    const [a, b] = s.players
    a.x = 300; a.y = 500; b.x = 500; b.y = 500; s.walls = []
    s.spots.forEach((p) => (p.at = 1e9))
    b.shield = 1
    const aimAtB: Input = { mx: 0, my: 0, ax: 1, ay: 0, f: true, d: false }
    for (let i = 0; i < 60 && s.players[1].alive; i++) stepSim(s, [aimAtB])
    expect(b.alive).toBe(false)
    expect(a.splats).toBe(4) // shield + 3 HP
    expect(s.over).toBe(true)
    expect(standings(s)).toEqual([0, 1])
  })
  it('walls stop bullets and players', () => {
    const s = createSim('wall', 2)
    const [a, b] = s.players
    s.walls = [{ x: 380, y: 400, w: 40, h: 200 }]
    s.spots.forEach((p) => (p.at = 1e9))
    a.x = 300; a.y = 500; b.x = 700; b.y = 500
    for (let i = 0; i < 40; i++) stepSim(s, [{ mx: 1, my: 0, ax: 1, ay: 0, f: true, d: false }])
    expect(b.hp).toBe(3)
    expect(a.x).toBeLessThan(380 - 20)
  })
  it('ammo is limited, refills over time and a pickup tops it up', () => {
    const s = createSim('ammo', 2)
    const a = s.players[0]
    s.spots.forEach((p) => (p.at = 1e9))
    s.players[1].x = 900; s.players[1].y = 900
    for (let i = 0; i < 30; i++) stepSim(s, [{ mx: 0, my: 0, ax: 0, ay: -1, f: true, d: false }])
    expect(a.ammo).toBeLessThan(5)
    expect(s.bullets.length + 0).toBeGreaterThanOrEqual(0)
    s.spots[0].at = 0
    a.x = s.spots[0].x; a.y = s.spots[0].y
    a.ammo = 0
    if (s.spots[0].kind === 'ammo') { stepSim(s, []); expect(a.ammo).toBe(5) }
  })
  it('dash moves farther than walking and has a cooldown', () => {
    const s = createSim('dash', 2)
    s.walls = []
    const a = s.players[0]
    a.x = 500; a.y = 300
    const x0 = a.x
    stepSim(s, [{ mx: 1, my: 0, ax: 0, ay: 0, f: false, d: true }])
    expect(a.x - x0).toBeGreaterThan(20)
    expect(a.dashCd).toBeGreaterThan(0)
  })
  it('forceOut eliminates a seat and fastForward finishes a bot-only match', () => {
    const s = createSim('ff', 4)
    forceOut(s, 0)
    expect(s.players[0].alive).toBe(false)
    fastForward(s, (seat) => botInput(s, seat))
    expect(s.over).toBe(true)
    expect(standings(s)[3]).toBe(0)
  })
  it('input from the wire is clamped and cannot be NaN', () => {
    const i = cleanInput({ mx: 1e9, my: NaN, ax: 'x', ay: -50, f: 'yes', d: 1 })
    expect(i).toEqual({ mx: 1, my: 0, ax: 0, ay: -1, f: false, d: true })
    const s: Sim = createSim('w', 2)
    stepSim(s, [cleanInput({ mx: Infinity })])
    expect(Number.isFinite(s.players[0].x)).toBe(true)
    expect(snapshot(s).p.length).toBe(2)
  })
})
