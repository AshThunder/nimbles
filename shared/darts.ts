// Darts: a reticle sweeps the board on a path that depends only on the match seed and the clock.
// Tap to throw; the dart lands where the reticle is at that moment. Skill is timing, nothing random.
// The client logs the throw times, the server replays them on the same path and scores them itself.
import { rng } from './rng'

export const DT_DARTS = 10
export const DT_MIN_GAP_MS = 700 // a dart takes this long to fly and be picked up
export const DT_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 9, 14, 12, 5]
export const DT_R = { bull: 0.05, outerBull: 0.11, trebleIn: 0.57, trebleOut: 0.65, doubleIn: 0.93, board: 1 }

type Path = { ax: number; ay: number; wx: number; wy: number; px: number; py: number; cx: number; cy: number }
const paths = new Map<string, Path[]>()

/** Ten reticle paths, one per dart. Later darts sweep faster and wider. */
export function dartPaths(seed: string): Path[] {
  const hit = paths.get(seed)
  if (hit) return hit
  const r = rng('darts:' + seed)
  const out: Path[] = []
  for (let k = 0; k < DT_DARTS; k++) {
    const hard = k / (DT_DARTS - 1)
    out.push({
      ax: 0.6 + 0.2 * r.next() + 0.12 * hard,
      ay: 0.55 + 0.2 * r.next() + 0.12 * hard,
      wx: 1.5 + r.next() * 0.9 + hard * 0.8,
      wy: 1.9 + r.next() * 0.9 + hard * 0.8,
      px: r.next() * 6.28,
      py: r.next() * 6.28,
      cx: (r.next() - 0.5) * 0.12,
      cy: (r.next() - 0.5) * 0.12,
    })
  }
  if (paths.size > 50) paths.clear()
  paths.set(seed, out)
  return out
}

/** Where dart k lands if thrown t ms after the round starts, in board units (board radius 1, y down) */
export function dartAt(seed: string, k: number, tMs: number): [number, number] {
  const p = dartPaths(seed)[k]
  const t = tMs / 1000
  const q = (v: number) => Math.round(v * 1000) / 1000
  return [q(p.cx + p.ax * Math.sin(p.wx * t + p.px)), q(p.cy + p.ay * Math.sin(p.wy * t + p.py))]
}

export type DartHit = { score: number; label: string }
/** Score for a dart landing at (x, y) */
export function dartScore(x: number, y: number): DartHit {
  const r = Math.hypot(x, y)
  if (r <= DT_R.bull) return { score: 50, label: 'Bullseye' }
  if (r <= DT_R.outerBull) return { score: 25, label: 'Outer bull' }
  if (r > DT_R.board) return { score: 0, label: 'Miss' }
  // angle measured clockwise from straight up; segment 20 is centred there
  let a = Math.atan2(x, -y)
  if (a < 0) a += Math.PI * 2
  const seg = DT_ORDER[Math.floor(((a + Math.PI / 20) % (Math.PI * 2)) / (Math.PI / 10))]
  if (r >= DT_R.doubleIn) return { score: seg * 2, label: `Double ${seg}` }
  if (r >= DT_R.trebleIn && r <= DT_R.trebleOut) return { score: seg * 3, label: `Treble ${seg}` }
  return { score: seg, label: String(seg) }
}

export type ReplayResult = { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string }

export function replayDarts(seed: string, throws: unknown, limitMs: number): ReplayResult {
  if (!Array.isArray(throws) || throws.length > DT_DARTS) return { ok: false, reason: 'Bad throw log' }
  let score = 0
  let last = -Infinity
  const hits: number[] = []
  for (let k = 0; k < throws.length; k++) {
    const t = throws[k]
    if (!Number.isInteger(t) || t < 0 || t > limitMs) return { ok: false, reason: 'Bad throw time' }
    if (t - last < DT_MIN_GAP_MS) return { ok: false, reason: 'Throws too fast' }
    last = t
    const [x, y] = dartAt(seed, k, t)
    const h = dartScore(x, y)
    score += h.score
    hits.push(h.score)
  }
  return { ok: true, score, lastAt: Math.max(0, last), detail: { darts: throws.length, hits } }
}
