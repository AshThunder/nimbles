// 21 Blitz: everybody gets the same 20 cards, one at a time. Put each on one of four stacks (five cards a stack).
// Each stack scores like a blackjack hand: a two card 21 is worth 100, any other 21 is 70, 20 is 50, 19 is 40,
// 18 is 30, 17 is 20, 16 or less is 10, and a bust is 0. Aces count 11 when that does not bust.
import { rng } from './rng'

export const BZ_STACKS = 4
export const BZ_CARDS = 20
export const BZ_PER = 5
export const BZ_MIN_GAP_MS = 250
export const BZ_MAX = 400

export const bzDeal = (seed: string): number[] => rng('blitz:' + seed).shuffle(Array.from({ length: 52 }, (_, i) => i)).slice(0, BZ_CARDS)
export const bzRank = (id: number) => (id % 13) + 1 // 1 = ace, 11 to 13 = face
export const bzPip = (id: number) => Math.min(10, bzRank(id))

export function bzTotal(stack: number[]): { total: number; soft: boolean } {
  let t = 0
  let ace = false
  for (const id of stack) {
    t += bzPip(id)
    if (bzRank(id) === 1) ace = true
  }
  return ace && t + 10 <= 21 ? { total: t + 10, soft: true } : { total: t, soft: false }
}

export function bzStackScore(stack: number[]): number {
  if (!stack.length) return 0
  const { total } = bzTotal(stack)
  if (total > 21) return 0
  if (total === 21) return stack.length === 2 ? 100 : 70
  if (total === 20) return 50
  if (total === 19) return 40
  if (total === 18) return 30
  if (total === 17) return 20
  return 10
}

export const bzScore = (stacks: number[][]) => stacks.reduce((n, s) => n + bzStackScore(s), 0)

/** Log: [stack, at ms] for each card in order. Cards not yet placed score nothing. */
export type BzMove = [number, number]

export function replayBlitz(seed: string, moves: unknown, limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(moves)) return { ok: false, reason: 'Bad move log' }
  if (moves.length > BZ_CARDS) return { ok: false, reason: 'Too many cards' }
  const deck = bzDeal(seed)
  const stacks: number[][] = Array.from({ length: BZ_STACKS }, () => [])
  let last = -BZ_MIN_GAP_MS
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]
    if (!Array.isArray(mv) || mv.length !== 2 || !mv.every((n) => Number.isInteger(n))) return { ok: false, reason: `Move ${i + 1} is malformed` }
    const [s, at] = mv as number[]
    if (at < last + BZ_MIN_GAP_MS || at > limitMs) return { ok: false, reason: `Move ${i + 1} is out of time` }
    if (s < 0 || s >= BZ_STACKS || stacks[s].length >= BZ_PER) return { ok: false, reason: `Move ${i + 1} is not legal` }
    stacks[s].push(deck[i])
    last = at
  }
  return { ok: true, score: bzScore(stacks), lastAt: Math.max(0, last), detail: { placed: moves.length } }
}
