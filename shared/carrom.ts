// Carrom, one player, eight strikes, the same board for everybody. The board is a unit square with pockets in the
// corners. Coins and the striker are discs that slide, rub to a stop and bounce off each other and the walls. The
// physics uses only + - * / and sqrt in a fixed step, so the server and every phone get the same shot.
// A strike is the striker's x on the baseline, an aim vector and a power. The seed shuffles which coins are white
// and which are black and nudges where the striker has to start.
import { rng } from './rng'

export const CR_STRIKES = 8
export const CR_MIN_GAP_MS = 1200
export const CR_R = 0.026 // coin radius
export const CR_SR = 0.032 // striker radius
export const CR_POCKET = 0.062 // a disc whose centre gets this close to a corner is pocketed
export const CR_BASE_Y = 0.86
export const CR_STEP = 100 // steps per second
export const CR_MAX_STEPS = 1100

export type Coin = { x: number; y: number; vx: number; vy: number; kind: 0 | 1 | 2; alive: boolean } // 0 white, 1 black, 2 queen
export type Carrom = { coins: Coin[]; sx: number; sy: number; svx: number; svy: number; sAlive: boolean; score: number; strikes: number; steps: number }
export const CR_POINTS = [10, 15, 50]

const LAYOUT: [number, number][] = [
  [0.5, 0.5], // queen
  [0.556, 0.5], [0.444, 0.5], [0.528, 0.4515], [0.472, 0.4515], [0.528, 0.5485], [0.472, 0.5485], // inner ring
  [0.5, 0.388], [0.5, 0.612], [0.597, 0.444], [0.403, 0.444], [0.597, 0.556], [0.403, 0.556], // outer ring
]

export function crNew(seed: string): Carrom {
  const r = rng('carrom:' + seed)
  const kinds = r.shuffle([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
  const coins: Coin[] = LAYOUT.map(([x, y], i) => ({ x, y, vx: 0, vy: 0, kind: (i === 0 ? 2 : kinds[i - 1]) as 0 | 1 | 2, alive: true }))
  return { coins, sx: 0.5, sy: CR_BASE_Y, svx: 0, svy: 0, sAlive: true, score: 0, strikes: 0, steps: 0 }
}

const POCKETS = [[0, 0], [1, 0], [0, 1], [1, 1]]
const inPocket = (x: number, y: number) => POCKETS.some(([px, py]) => (x - px) * (x - px) + (y - py) * (y - py) < CR_POCKET * CR_POCKET)

type Body = { x: number; y: number; vx: number; vy: number; r: number }

/** One physics step. Returns false when everything has stopped. */
export function crStep(g: Carrom): boolean {
  const bodies: (Body & { ref: Coin | null })[] = []
  if (g.sAlive) bodies.push({ x: g.sx, y: g.sy, vx: g.svx, vy: g.svy, r: CR_SR, ref: null })
  for (const c of g.coins) if (c.alive) bodies.push({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, r: CR_R, ref: c })
  let moving = false
  for (const b of bodies) {
    b.x += b.vx / CR_STEP
    b.y += b.vy / CR_STEP
    b.vx *= 0.985
    b.vy *= 0.985
    if (b.vx * b.vx + b.vy * b.vy < 0.0004) ((b.vx = 0), (b.vy = 0))
    else moving = true
    if (b.x < b.r) ((b.x = b.r), (b.vx = -b.vx * 0.8))
    if (b.x > 1 - b.r) ((b.x = 1 - b.r), (b.vx = -b.vx * 0.8))
    if (b.y < b.r) ((b.y = b.r), (b.vy = -b.vy * 0.8))
    if (b.y > 1 - b.r) ((b.y = 1 - b.r), (b.vy = -b.vy * 0.8))
  }
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const min = a.r + b.r
      const d2 = dx * dx + dy * dy
      if (d2 >= min * min || d2 === 0) continue
      const d = Math.sqrt(d2)
      const nx = dx / d, ny = dy / d
      const push = (min - d) / 2
      a.x -= nx * push; a.y -= ny * push
      b.x += nx * push; b.y += ny * push
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (rel < 0) {
        const wa = a.ref ? 1 : 2.2, wb = b.ref ? 1 : 2.2 // the striker is heavier
        const k = (1.9 * rel) / (1 / wa + 1 / wb)
        a.vx += (k * nx) / wa; a.vy += (k * ny) / wa
        b.vx -= (k * nx) / wb; b.vy -= (k * ny) / wb
        moving = true
      }
    }
  for (const b of bodies) {
    const pocketed = inPocket(b.x, b.y)
    if (b.ref) {
      const c = b.ref
      c.x = b.x; c.y = b.y; c.vx = b.vx; c.vy = b.vy
      if (pocketed) {
        c.alive = false
        g.score += CR_POINTS[c.kind]
      }
    } else {
      g.sx = b.x; g.sy = b.y; g.svx = b.vx; g.svy = b.vy
      if (pocketed) {
        g.sAlive = false
        g.score = Math.max(0, g.score - 10)
      }
    }
  }
  g.steps++
  return moving
}

/** [striker x in thousandths, aim x, aim y (both -1000..1000, pointing up the board), power 10..100, at ms] */
export type CrShot = [number, number, number, number, number]

export function crValid(s: unknown): s is CrShot {
  if (!Array.isArray(s) || s.length !== 5 || !s.every((n) => Number.isInteger(n))) return false
  const [x, ax, ay, p] = s as number[]
  return x >= 200 && x <= 800 && ax >= -1000 && ax <= 1000 && ay <= -100 && ay >= -1000 && p >= 10 && p <= 100
}

/** Puts the striker on the baseline and sets it moving. Step with crStep until it returns false or CR_MAX_STEPS, then crRest. */
export function crLaunch(g: Carrom, s: CrShot): void {
  const [x, ax, ay, p] = s
  g.sx = x / 1000
  g.sy = CR_BASE_Y
  g.sAlive = true
  const len = Math.sqrt(ax * ax + ay * ay)
  const v = (p / 100) * 3.2
  g.svx = (ax / len) * v
  g.svy = (ay / len) * v
  g.strikes++
}
export function crRest(g: Carrom): void {
  g.svx = g.svy = 0
}

/** The whole strike in one go (the server uses this; the phone steps it frame by frame) */
export function crFire(g: Carrom, s: CrShot): void {
  crLaunch(g, s)
  let n = 0
  while (crStep(g) && n++ < CR_MAX_STEPS);
  crRest(g)
}

export function replayCarrom(seed: string, shots: unknown, limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(shots)) return { ok: false, reason: 'Bad shot log' }
  if (shots.length > CR_STRIKES) return { ok: false, reason: 'Too many strikes' }
  const g = crNew(seed)
  let last = -CR_MIN_GAP_MS
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (!crValid(s)) return { ok: false, reason: `Strike ${i + 1} is malformed` }
    if (s[4] < last + CR_MIN_GAP_MS || s[4] > limitMs) return { ok: false, reason: `Strike ${i + 1} is out of time` }
    crFire(g, s)
    last = s[4]
  }
  return { ok: true, score: g.score, lastAt: Math.max(0, last), detail: { strikes: shots.length, left: g.coins.filter((c) => c.alive).length } }
}
