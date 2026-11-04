// Splat Royale: a deterministic top-down arena sim. The server runs it at 20 Hz and clients only send inputs.
// Same seed, same map, same loadouts for everyone. Nothing in here is random once the seed is fixed.
import { rng } from './rng'
import type { PipLevel } from './types'

export const TICK_MS = 50
export const ARENA = 1000
export const CX = 500
export const CY = 500
export const ZONE_R0 = 500
export const ZONE_R1 = 70
export const PR = 24 // player radius
export const BR = 7 // bullet radius
export const SPEED = 10 // units per tick (200/s)
export const DASH_SPEED = 32
export const DASH_TICKS = 6
export const DASH_CD = 60
export const BULLET_SPEED = 20
export const BULLET_LIFE = 40
export const FIRE_CD = 8
export const MAX_HP = 3
export const MAX_AMMO = 5
export const AMMO_EVERY = 20
export const PICK_R = 20
export const PICK_RESPAWN = 300
export const SPAWN_R = 400
export const DEFAULT_CAP_TICKS = 3600 // 3 minutes

export type Input = { mx: number; my: number; ax: number; ay: number; f: boolean; d: boolean }
export const NO_INPUT: Input = { mx: 0, my: 0, ax: 0, ay: 0, f: false, d: false }
export type Wall = { x: number; y: number; w: number; h: number }
export type Spot = { x: number; y: number; kind: 'ammo' | 'shield'; at: number } // at = tick when it is next available
export type SPlayer = {
  seat: number; x: number; y: number; vx: number; vy: number; aim: number
  hp: number; shield: number; ammo: number; fireCd: number; dashT: number; dashCd: number; dx: number; dy: number
  ammoT: number; zoneT: number; splats: number; alive: boolean; out: number // out = tick of elimination, -1 while alive
}
export type Bullet = { id: number; x: number; y: number; vx: number; vy: number; owner: number; life: number }
export type SEvent = { t: 'hit' | 'out' | 'pick' | 'fire' | 'dash'; seat: number; by?: number; kind?: string }
export type Sim = {
  n: number; seed: string; cap: number; tick: number; over: boolean
  walls: Wall[]; spots: Spot[]; players: SPlayer[]; bullets: Bullet[]; nextBullet: number
  events: SEvent[]; seatPos: number[] // seatPos[seat] = ring slot, from the seed
}

export const zoneStart = (cap: number) => Math.round(cap / 6)
export const zoneEnd = (cap: number) => Math.round((cap * 5) / 6)
export function zoneRadius(tick: number, cap = DEFAULT_CAP_TICKS): number {
  const a = zoneStart(cap)
  const b = zoneEnd(cap)
  if (tick <= a) return ZONE_R0
  if (tick >= b) return ZONE_R1
  return ZONE_R0 + ((ZONE_R1 - ZONE_R0) * (tick - a)) / (b - a)
}

const hitsWallCircle = (w: Wall, x: number, y: number, r: number) => {
  const px = Math.max(w.x, Math.min(x, w.x + w.w))
  const py = Math.max(w.y, Math.min(y, w.y + w.h))
  return (x - px) ** 2 + (y - py) ** 2 < r * r
}
const spawnOf = (slot: number, n: number) => {
  const a = -Math.PI / 2 + (slot * 2 * Math.PI) / n
  return { x: CX + Math.cos(a) * SPAWN_R, y: CY + Math.sin(a) * SPAWN_R }
}

/** Point-symmetric map: every wall and pickup has a twin through the centre, so no seat has a better corner. */
export function makeMap(seed: string, n: number): { walls: Wall[]; spots: Spot[]; seatPos: number[] } {
  const r = rng('splat-map:' + seed)
  const spawns = Array.from({ length: n }, (_, i) => spawnOf(i, n))
  const walls: Wall[] = []
  let guard = 0
  while (walls.length < 12 && guard++ < 400) {
    const horiz = r.next() < 0.5
    const w = horiz ? 90 + r.int(90) : 34 + r.int(14)
    const h = horiz ? 34 + r.int(14) : 90 + r.int(90)
    const x = 170 + r.int(300)
    const y = 170 + r.int(300)
    const a: Wall = { x, y, w, h }
    const b: Wall = { x: ARENA - x - w, y: ARENA - y - h, w, h }
    const nearCenter = hitsWallCircle(a, CX, CY, 70) || hitsWallCircle(b, CX, CY, 70)
    if (nearCenter) continue
    if (spawns.some((s) => hitsWallCircle(a, s.x, s.y, 90) || hitsWallCircle(b, s.x, s.y, 90))) continue
    // keep walls from stacking into a fortress: no overlap with each other
    const clash = walls.some((o) => [a, b].some((q) => q.x < o.x + o.w + 40 && q.x + q.w + 40 > o.x && q.y < o.y + o.h + 40 && q.y + q.h + 40 > o.y))
    if (clash || (a.x < b.x + b.w + 40 && a.x + a.w + 40 > b.x && a.y < b.y + b.h + 40 && a.y + a.h + 40 > b.y)) continue
    walls.push(a, b)
  }
  const spots: Spot[] = []
  const kinds: ('ammo' | 'shield')[] = ['ammo', 'ammo', 'shield']
  for (const kind of kinds) {
    for (let tries = 0; tries < 200; tries++) {
      const ang = r.next() * Math.PI
      const rad = 120 + r.next() * 230
      const x = CX + Math.cos(ang) * rad
      const y = CY + Math.sin(ang) * rad
      const clearWalls = !walls.some((w) => hitsWallCircle(w, x, y, PICK_R + 14))
      const apart = spots.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 > 110 * 110 && (ARENA - s.x - x) ** 2 + (ARENA - s.y - y) ** 2 > 110 * 110)
      if (clearWalls && apart) {
        spots.push({ x, y, kind, at: 0 }, { x: ARENA - x, y: ARENA - y, kind, at: 0 })
        break
      }
    }
  }
  const seatPos = r.shuffle(Array.from({ length: n }, (_, i) => i))
  return { walls, spots, seatPos }
}

export function createSim(seed: string, n: number, cap = DEFAULT_CAP_TICKS): Sim {
  const { walls, spots, seatPos } = makeMap(seed, n)
  const players: SPlayer[] = Array.from({ length: n }, (_, seat) => {
    const s = spawnOf(seatPos[seat], n)
    const aim = Math.atan2(CY - s.y, CX - s.x)
    return { seat, x: s.x, y: s.y, vx: 0, vy: 0, aim, hp: MAX_HP, shield: 0, ammo: MAX_AMMO, fireCd: 0, dashT: 0, dashCd: 0, dx: 0, dy: 0, ammoT: 0, zoneT: 0, splats: 0, alive: true, out: -1 }
  })
  return { n, seed, cap, tick: 0, over: false, walls, spots, players, bullets: [], nextBullet: 1, events: [], seatPos }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : 0)
/** Anything off the wire becomes a safe input: finite numbers, bounded, booleans. */
export function cleanInput(raw: any): Input {
  return { mx: num(raw?.mx, -1, 1), my: num(raw?.my, -1, 1), ax: num(raw?.ax, -1, 1), ay: num(raw?.ay, -1, 1), f: raw?.f === true || raw?.f === 1, d: raw?.d === true || raw?.d === 1 }
}

function pushOut(p: SPlayer, w: Wall) {
  const px = clamp(p.x, w.x, w.x + w.w)
  const py = clamp(p.y, w.y, w.y + w.h)
  let dx = p.x - px
  let dy = p.y - py
  const d2 = dx * dx + dy * dy
  if (d2 >= PR * PR) return
  if (d2 < 1e-9) {
    // centre is inside the wall: leave by the shortest side
    const l = p.x - w.x
    const r = w.x + w.w - p.x
    const t = p.y - w.y
    const b = w.y + w.h - p.y
    const m = Math.min(l, r, t, b)
    if (m === l) p.x = w.x - PR
    else if (m === r) p.x = w.x + w.w + PR
    else if (m === t) p.y = w.y - PR
    else p.y = w.y + w.h + PR
    return
  }
  const d = Math.sqrt(d2)
  dx /= d
  dy /= d
  p.x = px + dx * PR
  p.y = py + dy * PR
}

/** Segment (a to b) against an axis box grown by r. Returns the entry fraction or -1. */
export function segBox(ax: number, ay: number, bx: number, by: number, w: Wall, r: number): number {
  let t0 = 0
  let t1 = 1
  const d = [bx - ax, by - ay]
  const lo = [w.x - r, w.y - r]
  const hi = [w.x + w.w + r, w.y + w.h + r]
  const o = [ax, ay]
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1
    } else {
      let a = (lo[i] - o[i]) / d[i]
      let b = (hi[i] - o[i]) / d[i]
      if (a > b) [a, b] = [b, a]
      t0 = Math.max(t0, a)
      t1 = Math.min(t1, b)
      if (t0 > t1) return -1
    }
  }
  return t0
}
/** Segment against a circle. Returns the entry fraction or -1. */
export function segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - cx
  const fy = ay - cy
  const a = dx * dx + dy * dy
  const c = fx * fx + fy * fy - r * r
  if (c <= 0) return 0
  if (a < 1e-12) return -1
  const b = 2 * (fx * dx + fy * dy)
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  return t >= 0 && t <= 1 ? t : -1
}
export const clearLine = (s: Sim, ax: number, ay: number, bx: number, by: number) => !s.walls.some((w) => segBox(ax, ay, bx, by, w, 0) >= 0)

function eliminate(s: Sim, p: SPlayer, by?: number) {
  if (!p.alive) return
  p.alive = false
  p.hp = 0
  p.out = s.tick
  p.vx = p.vy = 0
  s.events.push({ t: 'out', seat: p.seat, by })
}
/** Used by the server when a player has been gone too long. */
export function forceOut(s: Sim, seat: number) {
  const p = s.players[seat]
  if (p && p.alive) eliminate(s, p)
}
function damage(s: Sim, p: SPlayer, by: number | undefined) {
  if (p.shield > 0) p.shield = 0
  else p.hp -= 1
  s.events.push({ t: 'hit', seat: p.seat, by })
  if (p.hp <= 0) eliminate(s, p, by)
}

export function aliveCount(s: Sim) {
  return s.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0)
}

/** Advance one tick. inputs[seat] may be missing, which means standing still. */
export function stepSim(s: Sim, inputs: (Input | undefined)[]): void {
  if (s.over) return
  s.events = []
  const zr = zoneRadius(s.tick, s.cap)
  for (const p of s.players) {
    if (!p.alive) continue
    const inp = inputs[p.seat] ?? NO_INPUT
    let mx = inp.mx
    let my = inp.my
    const ml = Math.hypot(mx, my)
    if (ml > 1) { mx /= ml; my /= ml }
    const al = Math.hypot(inp.ax, inp.ay)
    if (al > 0.15) p.aim = Math.atan2(inp.ay, inp.ax)
    if (inp.d && p.dashCd <= 0 && p.dashT <= 0) {
      const dl = Math.hypot(mx, my)
      p.dx = dl > 0.1 ? mx / dl : Math.cos(p.aim)
      p.dy = dl > 0.1 ? my / dl : Math.sin(p.aim)
      p.dashT = DASH_TICKS
      p.dashCd = DASH_CD
      s.events.push({ t: 'dash', seat: p.seat })
    }
    if (p.dashT > 0) { p.vx = p.dx * DASH_SPEED; p.vy = p.dy * DASH_SPEED; p.dashT-- }
    else { p.vx = mx * SPEED; p.vy = my * SPEED }
    if (p.dashCd > 0 && p.dashT <= 0) p.dashCd--
    p.x = clamp(p.x + p.vx, PR, ARENA - PR)
    p.y = clamp(p.y + p.vy, PR, ARENA - PR)
    for (let k = 0; k < 2; k++) for (const w of s.walls) pushOut(p, w)
    p.x = clamp(p.x, PR, ARENA - PR)
    p.y = clamp(p.y, PR, ARENA - PR)
    // ammo refills one every second
    if (p.ammo < MAX_AMMO) { if (++p.ammoT >= AMMO_EVERY) { p.ammo++; p.ammoT = 0 } } else p.ammoT = 0
    if (p.fireCd > 0) p.fireCd--
    if (inp.f && p.fireCd <= 0 && p.ammo > 0) {
      p.ammo--
      p.fireCd = FIRE_CD
      const c = Math.cos(p.aim)
      const sn = Math.sin(p.aim)
      s.bullets.push({ id: s.nextBullet++, x: p.x + c * (PR + 2), y: p.y + sn * (PR + 2), vx: c * BULLET_SPEED, vy: sn * BULLET_SPEED, owner: p.seat, life: BULLET_LIFE })
      s.events.push({ t: 'fire', seat: p.seat })
    }
    // pickups
    for (const sp of s.spots) {
      if (sp.at > s.tick) continue
      if ((p.x - sp.x) ** 2 + (p.y - sp.y) ** 2 > (PR + PICK_R) ** 2) continue
      if (sp.kind === 'ammo' && p.ammo < MAX_AMMO) p.ammo = MAX_AMMO
      else if (sp.kind === 'shield' && p.shield < 1) p.shield = 1
      else continue
      sp.at = s.tick + PICK_RESPAWN
      s.events.push({ t: 'pick', seat: p.seat, kind: sp.kind })
    }
  }
  // bullets move in id order; each takes the earliest hit along its step
  const keep: Bullet[] = []
  for (const b of s.bullets) {
    const nx = b.x + b.vx
    const ny = b.y + b.vy
    let best = 2
    let victim = -1
    for (const w of s.walls) {
      const t = segBox(b.x, b.y, nx, ny, w, BR)
      if (t >= 0 && t < best) { best = t; victim = -2 }
    }
    for (const p of s.players) {
      if (!p.alive || p.seat === b.owner) continue
      const t = segCircle(b.x, b.y, nx, ny, p.x, p.y, PR + BR)
      if (t >= 0 && t < best) { best = t; victim = p.seat }
    }
    const out = nx < 0 || ny < 0 || nx > ARENA || ny > ARENA
    if (victim >= 0) {
      const owner = s.players[b.owner]
      if (owner) owner.splats++
      damage(s, s.players[victim], b.owner)
      continue
    }
    if (victim === -2 || out || --b.life <= 0) continue
    b.x = nx
    b.y = ny
    keep.push(b)
  }
  s.bullets = keep
  // the zone burns one HP a second, nobody gets credit
  for (const p of s.players) {
    if (!p.alive) continue
    if (Math.hypot(p.x - CX, p.y - CY) > zr) {
      if (++p.zoneT >= 20) { p.zoneT = 0; p.hp -= 1; s.events.push({ t: 'hit', seat: p.seat }); if (p.hp <= 0) eliminate(s, p) }
    } else p.zoneT = 0
  }
  s.tick++
  if (aliveCount(s) <= 1 || s.tick >= s.cap) s.over = true
}

/** Seats from best to worst. Survivors first (HP, splats, lower seat), then the later you went out the better. */
export function standings(s: Sim): number[] {
  const key = (p: SPlayer) => [p.alive ? 1 : 0, p.alive ? 0 : p.out, p.alive ? p.hp + p.shield * 0.5 : 0, p.splats, -p.seat]
  return [...s.players].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]
    return 0
  }).map((p) => p.seat)
}

/** Run the rest of a match with only the given inputs (bots), no waiting. Used when every human is out. */
export function fastForward(s: Sim, inputFor: (seat: number) => Input | undefined) {
  let guard = 0
  while (!s.over && guard++ < s.cap + 5) stepSim(s, s.players.map((p) => (p.alive ? inputFor(p.seat) : undefined)))
}

// ---------- Nimo bots: scripted from the sim state, no randomness beyond a seeded hash ----------
const h32 = (a: number, b: number, c: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}
const SEEDN = (s: Sim) => s.seed.length * 131 + s.seed.charCodeAt(0) + s.seed.charCodeAt(s.seed.length - 1)
const ERR: Record<PipLevel, number> = { easy: 0.6, med: 0.34, hard: 0.16 }
const FIRE_P: Record<PipLevel, number> = { easy: 0.15, med: 0.3, hard: 0.5 }
const FIRE_RANGE: Record<PipLevel, number> = { easy: 330, med: 400, hard: 460 }

export function botInput(s: Sim, seat: number, level: PipLevel = 'med'): Input {
  const me = s.players[seat]
  if (!me || !me.alive) return NO_INPUT
  const sd = SEEDN(s)
  const zr = zoneRadius(s.tick + 40, s.cap)
  let foe: SPlayer | undefined
  let fd = Infinity
  for (const p of s.players) {
    if (!p.alive || p.seat === seat) continue
    const d = Math.hypot(p.x - me.x, p.y - me.y)
    if (d < fd - 1e-9) { fd = d; foe = p }
  }
  let mx = 0
  let my = 0
  const toCx = CX - me.x
  const toCy = CY - me.y
  const cd = Math.hypot(toCx, toCy)
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l] }
  let aimX = Math.cos(me.aim)
  let aimY = Math.sin(me.aim)
  let fire = false
  if (foe) {
    const lead = fd / BULLET_SPEED
    const tx = foe.x + foe.vx * lead * (level === 'easy' ? 0 : 1)
    const ty = foe.y + foe.vy * lead * (level === 'easy' ? 0 : 1)
    const base = Math.atan2(ty - me.y, tx - me.x)
    const err = (h32(sd, seat * 977 + Math.floor(s.tick / 6), 1) - 0.5) * 2 * ERR[level]
    aimX = Math.cos(base + err)
    aimY = Math.sin(base + err)
    const [ux, uy] = unit(foe.x - me.x, foe.y - me.y)
    const side = (Math.floor(s.tick / (24 + Math.floor(h32(sd, seat, 2) * 30))) + seat) % 2 ? 1 : -1
    if (fd > 330) { mx = ux; my = uy } else if (fd < 130) { mx = -ux; my = -uy }
    mx += -uy * side * 0.9
    my += ux * side * 0.9
    fire = s.tick > 60 && fd < FIRE_RANGE[level] && clearLine(s, me.x, me.y, foe.x, foe.y) && h32(sd, seat * 31 + s.tick, 3) < FIRE_P[level]
  }
  // low on ammo: go to the nearest live ammo spot
  if (me.ammo < 2) {
    let best: Spot | undefined
    let bd = 320
    for (const sp of s.spots) {
      if (sp.kind !== 'ammo' || sp.at > s.tick) continue
      const d = Math.hypot(sp.x - me.x, sp.y - me.y)
      if (d < bd) { bd = d; best = sp }
    }
    if (best) { const [ux, uy] = unit(best.x - me.x, best.y - me.y); mx = ux; my = uy }
  }
  // the zone wins every argument
  if (cd > zr - 70) { const [ux, uy] = unit(toCx, toCy); mx = ux * 1.4 + mx * 0.2; my = uy * 1.4 + my * 0.2 }
  const dash = me.hp <= 1 && fd < 220 && me.dashCd <= 0 && h32(sd, seat, s.tick) < 0.15
  return { mx, my, ax: aimX, ay: aimY, f: fire, d: dash }
}

// ---------- wire format ----------
const r1 = (v: number) => Math.round(v * 10) / 10
export type Snap = {
  k: number; z: number; over: boolean
  p: [number, number, number, number, number, number, number, number, number][] // x y aim hp shield ammo alive splats dashCd
  b: [number, number, number][] // x y owner
  u: number[] // pickup available flags
  e: SEvent[]
}
export function snapshot(s: Sim): Snap {
  return {
    k: s.tick, z: r1(zoneRadius(s.tick, s.cap)), over: s.over,
    p: s.players.map((p) => [r1(p.x), r1(p.y), Math.round(p.aim * 100) / 100, p.hp, p.shield, p.ammo, p.alive ? 1 : 0, p.splats, p.dashCd] as Snap['p'][number]),
    b: s.bullets.map((b) => [r1(b.x), r1(b.y), b.owner] as [number, number, number]),
    u: s.spots.map((sp) => (sp.at <= s.tick ? 1 : 0)),
    e: s.events,
  }
}
export const stateHash = (s: Sim) => JSON.stringify([s.tick, s.players.map((p) => [p.x, p.y, p.hp, p.ammo, p.splats, p.out]), s.bullets.map((b) => [b.x, b.y])])
