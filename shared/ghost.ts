// Ghost Race: a three-lane dash, the same track for everybody. You run on your own at a pace that creeps up; rows of
// blocks come at you and a hit stops you for a moment. You only choose the lane. A "ghost" runs the whole track at a
// fixed pace so you can see whether you are ahead of it. Score is the distance covered in 45 seconds.
// The sim is a fixed 10 ms step, so the server can replay a run from the lane changes alone.
import { rng } from './rng'

export const GH_MS = 45000
export const GH_STEP = 10
export const GH_GAP_MS = 100
export const GH_STUN_MS = 900
export const GH_ROW_GAP = 8
export const GH_FIRST = 24
export const GH_MAX_EVENTS = 450
export const GH_GHOST_PACE = 0.7 // share of the clean-run distance the ghost covers

export const ghSpeed = (t: number) => 9 + 0.15 * (t / 1000) // units per second
/** Each row is a mask over three lanes, never all three (so there is always a way through) */
export function ghTrack(seed: string): number[] {
  const r = rng('ghost:' + seed)
  const rows: number[] = []
  for (let i = 0; i < 75; i++) rows.push(r.pick([1, 2, 4, 3, 5, 6, 3, 5, 6, 1, 2, 4]))
  return rows
}
export const ghRowAt = (i: number) => GH_FIRST + i * GH_ROW_GAP

export type Ghost = { t: number; d: number; lane: number; stun: number; next: number; hits: number }
export const ghNew = (): Ghost => ({ t: 0, d: 0, lane: 1, stun: 0, next: 0, hits: 0 })

/** Advance 10 ms. The lane the runner is in at this moment is g.lane. */
export function ghStep(g: Ghost, rows: number[]): void {
  if (g.t >= g.stun) {
    const nd = g.d + ghSpeed(g.t) * (GH_STEP / 1000)
    const pr = ghRowAt(g.next)
    if (g.next < rows.length && nd >= pr) {
      if (rows[g.next] & (1 << g.lane)) {
        g.d = pr
        g.stun = g.t + GH_STUN_MS
        g.hits++
      } else g.d = nd
      g.next++
    } else g.d = nd
  }
  g.t += GH_STEP
}

/** [lane 0..2, at ms (a multiple of 10)] */
export type GhEvent = [number, number]

export function replayGhost(seed: string, ev: unknown, _limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(ev)) return { ok: false, reason: 'Bad run log' }
  if (ev.length > GH_MAX_EVENTS) return { ok: false, reason: 'Too many lane changes' }
  let prev = -GH_GAP_MS
  for (const e of ev) {
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0]) || !Number.isInteger(e[1])) return { ok: false, reason: 'Bad lane change' }
    if (e[0] < 0 || e[0] > 2 || e[1] % GH_STEP !== 0 || e[1] < prev + GH_GAP_MS || e[1] > GH_MS) return { ok: false, reason: 'Lane change out of order or too fast' }
    prev = e[1]
  }
  const rows = ghTrack(seed)
  const g = ghNew()
  let i = 0
  while (g.t < GH_MS) {
    while (i < ev.length && (ev[i] as GhEvent)[1] <= g.t) g.lane = (ev[i++] as GhEvent)[0]
    ghStep(g, rows)
  }
  return { ok: true, score: Math.floor(g.d), lastAt: Math.max(0, prev), detail: { hits: g.hits } }
}
