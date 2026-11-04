// Ten-pin bowling on a fixed lane, the same for everybody. A throw is two timed taps:
// the first locks where the ball starts (a marker sweeps across the lane), the second locks the hook
// (a second marker sweeps from left to right). Both sweeps are triangle waves of the time since the throw began,
// so the server rebuilds every throw from the two tap times. The seed sets how much the lane pulls the ball on
// each throw. That pull is shown on screen, so a good player aims against it.
// Pins are on a triangle one unit apart. A ball that passes within 0.6 of a pin knocks it down with a push
// (the closer to the middle of the pin, the harder; 1 to 3) and a pin that falls pushes every pin within 1.05 of it with one less.
import { rng } from './rng'

export const BW_AIM_PERIOD = 3000
export const BW_HOOK_PERIOD = 2200
export const BW_AIM_RANGE = 1.4
export const BW_HOOK_RANGE = 0.12
export const BW_MIN_GAP_MS = 300 // from the start of a throw to the aim tap, and between the two taps
export const BW_MAX_WAIT_MS = 8000

export const BW_PINS: { x: number; y: number }[] = (() => {
  const p: { x: number; y: number }[] = []
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) p.push({ x: i - r / 2, y: r * 0.866 })
  return p
})()

/** Triangle wave: -1 at 0, +1 at half a period, -1 again at a full period */
export function bwWave(t: number, period: number): number {
  const ph = (t % period) / period
  return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4
}

export const bwDrift = (seed: string): number[] => {
  const r = rng('bowl:' + seed)
  return Array.from({ length: 21 }, () => (Math.floor(r.next() * 7) - 3) * 0.025)
}

export type BwShot = { x: number; slope: number }
export function bwShot(t1: number, t2: number, drift: number): BwShot {
  return { x: bwWave(t1, BW_AIM_PERIOD) * BW_AIM_RANGE, slope: bwWave(t2, BW_HOOK_PERIOD) * BW_HOOK_RANGE + drift }
}

/** Which of the standing pins fall. */
export function bwKnock(standing: boolean[], shot: BwShot): number[] {
  const push: number[] = BW_PINS.map(() => 0)
  BW_PINS.forEach((p, i) => {
    if (!standing[i]) return
    const off = Math.abs(p.x - (shot.x + shot.slope * p.y))
    if (off < 0.6) push[i] = off < 0.08 ? 3 : off < 0.2 ? 2 : 1
  })
  // pins spread the push, strongest first
  for (let level = 3; level >= 2; level--) {
    for (let i = 0; i < push.length; i++) {
      if (push[i] !== level) continue
      for (let j = 0; j < push.length; j++) {
        if (!standing[j] || push[j] >= level - 1) continue
        const dx = BW_PINS[i].x - BW_PINS[j].x
        const dy = BW_PINS[i].y - BW_PINS[j].y
        if (dx * dx + dy * dy <= 1.02 * 1.02) push[j] = level - 1
      }
    }
  }
  const out: number[] = []
  push.forEach((v, i) => v >= 1 && standing[i] && out.push(i))
  return out
}

export type BwState = { rolls: number[]; standing: boolean[]; frame: number; ball: number; over: boolean }
export const bwNew = (): BwState => ({ rolls: [], standing: BW_PINS.map(() => true), frame: 0, ball: 0, over: false })

/** Applies a knock to the state and moves to the next throw, with the rules for a tenth frame with strike or spare */
export function bwApply(s: BwState, knocked: number[]): void {
  for (const i of knocked) s.standing[i] = false
  const n = knocked.length
  s.rolls.push(n)
  const left = s.standing.filter(Boolean).length
  const reset = () => (s.standing = BW_PINS.map(() => true))
  if (s.frame < 9) {
    if (s.ball === 0 && n === 10) (s.frame++, (s.ball = 0), reset())
    else if (s.ball === 0) s.ball = 1
    else (s.frame++, (s.ball = 0), reset())
    return
  }
  // tenth frame
  if (s.ball === 0) {
    s.ball = 1
    if (left === 0) reset()
  } else if (s.ball === 1) {
    const first = s.rolls[s.rolls.length - 2]
    if (first === 10 || first + n === 10) {
      s.ball = 2
      if (left === 0) reset()
    } else s.over = true
  } else s.over = true
}

/** Standard scoring. Frames not finished score what has been rolled. */
export function bwScore(rolls: number[]): { total: number; frames: number[] } {
  let i = 0
  let total = 0
  const frames: number[] = []
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    const a = rolls[i] ?? 0
    const b = rolls[i + 1] ?? 0
    const c = rolls[i + 2] ?? 0
    if (a === 10) {
      total += 10 + b + c
      i += 1
    } else if (i + 1 < rolls.length && a + b === 10) {
      total += 10 + c
      i += 2
    } else {
      total += a + (i + 1 < rolls.length ? b : 0)
      i += 2
    }
    frames.push(total)
  }
  return { total, frames }
}

/** [t1, t2]: ms since the throw began until the aim tap, and until the hook tap. */
export type BwThrow = [number, number]

export function replayBowling(seed: string, throws: unknown, limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(throws)) return { ok: false, reason: 'Bad throw log' }
  if (throws.length > 21) return { ok: false, reason: 'Too many throws' }
  const drift = bwDrift(seed)
  const s = bwNew()
  let clock = 0
  for (let k = 0; k < throws.length; k++) {
    const t = throws[k]
    if (!Array.isArray(t) || t.length !== 2 || !t.every((n) => Number.isInteger(n))) return { ok: false, reason: `Throw ${k + 1} is malformed` }
    const [t1, t2] = t as number[]
    if (s.over) return { ok: false, reason: 'The game was already over' }
    if (t1 < BW_MIN_GAP_MS || t2 < t1 + BW_MIN_GAP_MS || t2 - t1 > BW_MAX_WAIT_MS || t1 > BW_MAX_WAIT_MS) return { ok: false, reason: `Throw ${k + 1} is out of time` }
    clock += t2 + 600 // the ball takes about half a second to roll
    if (clock > limitMs) return { ok: false, reason: 'Out of time' }
    bwApply(s, bwKnock(s.standing, bwShot(t1, t2, drift[k])))
  }
  const sc = bwScore(s.rolls)
  return { ok: true, score: sc.total, lastAt: clock, detail: { rolls: s.rolls, frames: s.over || s.frame >= 10 ? 10 : s.frame } }
}
