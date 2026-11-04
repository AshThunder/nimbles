// Speed Math: the same run of sums for everyone with this seed, easy at first, harder as you go.
// The client logs each answer and its time; the server checks every answer itself.
import { rng } from './rng'

export const SM_MIN_GAP_MS = 350
export const SM_MAX = 120

export type Sum = { text: string; answer: number }

/** Sum number i of the run */
export function smQuestion(seed: string, i: number): Sum {
  const r = rng(`speedmath:${seed}:${i}`)
  const lvl = Math.min(4, Math.floor(i / 6))
  const pick = r.int(lvl === 0 ? 2 : lvl === 1 ? 3 : 4)
  let a: number, b: number
  if (pick === 0) {
    a = 4 + r.int(lvl < 2 ? 20 : 70)
    b = 3 + r.int(lvl < 2 ? 20 : 60)
    return { text: `${a} + ${b}`, answer: a + b }
  }
  if (pick === 1) {
    a = 20 + r.int(lvl < 2 ? 60 : 160)
    b = 3 + r.int(Math.min(a - 3, lvl < 2 ? 40 : 90))
    return { text: `${a} − ${b}`, answer: a - b }
  }
  if (pick === 2) {
    a = 2 + r.int(lvl < 3 ? 8 : 11)
    b = 2 + r.int(lvl < 3 ? 8 : 11)
    return { text: `${a} × ${b}`, answer: a * b }
  }
  b = 2 + r.int(lvl < 4 ? 8 : 11)
  const q = 2 + r.int(lvl < 4 ? 9 : 12)
  return { text: `${b * q} ÷ ${b}`, answer: q }
}

export type SmAnswer = [number, number] // [answer, at ms]
export type ReplayResult = { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string }

export function replaySpeedMath(seed: string, answers: unknown, limitMs: number): ReplayResult {
  if (!Array.isArray(answers) || answers.length > SM_MAX) return { ok: false, reason: 'Bad answer log' }
  let score = 0
  let streak = 0
  let right = 0
  let last = -Infinity
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i]
    if (!Array.isArray(a) || a.length !== 2 || !Number.isInteger(a[0]) || !Number.isInteger(a[1])) return { ok: false, reason: 'Bad answer' }
    const [ans, at] = a as SmAnswer
    if (at < 0 || at > limitMs || at - last < SM_MIN_GAP_MS) return { ok: false, reason: 'Answers too fast' }
    last = at
    if (ans === smQuestion(seed, i).answer) {
      score += 10 + Math.min(streak, 10)
      streak++
      right++
    } else {
      score = Math.max(0, score - 5)
      streak = 0
    }
  }
  return { ok: true, score, lastAt: Math.max(0, last), detail: { answered: answers.length, right } }
}
