// Klondike rules as pure functions. The client plays with `applyMove` and logs every move;
// the server replays that log from the match seed and recomputes the score itself.
import { canFound, canStack, dealKlondike, type Klondike } from './puzzles'

/** [kind, a, b, c, atMs]
 *  0 stock tap (draw, or recycle the waste)
 *  1 waste -> tableau column a
 *  2 waste -> foundation a
 *  3 tableau column a, from card index b -> tableau column c
 *  4 tableau column a (top card) -> foundation b */
export type SolMove = [number, number, number, number, number]

export const SOL_MAX_SCORE = 520
export const solScore = (g: Klondike) => g.found.reduce((s, p) => s + p.length, 0) * 10

function takeTab(g: Klondike, col: number, idx: number) {
  g.tab[col].splice(idx)
  const t = g.tab[col][g.tab[col].length - 1]
  if (t && !t.up) t.up = true
}

/** Applies one move if it is legal. Returns false (and changes nothing) when it is not. */
export function applyMove(g: Klondike, kind: number, a = 0, b = 0, c = 0): boolean {
  const col = (i: number) => Number.isInteger(i) && i >= 0 && i < 7
  const fnd = (i: number) => Number.isInteger(i) && i >= 0 && i < 4
  if (kind === 0) {
    if (g.stock.length) g.waste.push(g.stock.pop()!)
    else if (g.waste.length) {
      g.stock = g.waste.reverse()
      g.waste = []
    } else return false
    return true
  }
  if (kind === 1) {
    const card = g.waste[g.waste.length - 1]
    if (!card || !col(a)) return false
    const t = g.tab[a]
    const top = t[t.length - 1]
    if (top && !top.up) return false
    if (!canStack(top?.card, card)) return false
    g.waste.pop()
    t.push({ card, up: true })
    return true
  }
  if (kind === 2) {
    const card = g.waste[g.waste.length - 1]
    if (!card || !fnd(a) || !canFound(g.found[a], card)) return false
    g.waste.pop()
    g.found[a].push(card)
    return true
  }
  if (kind === 3) {
    if (!col(a) || !col(c) || a === c || !Number.isInteger(b) || b < 0) return false
    const from = g.tab[a]
    if (b >= from.length || !from[b].up) return false
    const t = g.tab[c]
    const top = t[t.length - 1]
    if (top && !top.up) return false
    const cards = from.slice(b).map((x) => x.card)
    if (!canStack(top?.card, cards[0])) return false
    takeTab(g, a, b)
    for (const k of cards) t.push({ card: k, up: true })
    return true
  }
  if (kind === 4) {
    if (!col(a) || !fnd(b)) return false
    const from = g.tab[a]
    const t = from[from.length - 1]
    if (!t || !t.up || !canFound(g.found[b], t.card)) return false
    takeTab(g, a, from.length - 1)
    g.found[b].push(t.card)
    return true
  }
  return false
}

export const SOL_MIN_GAP_MS = 90 // faster than a human can tap

/** Replays a move log against the seed. Returns the verified score, or an error. */
export function replaySolitaire(seed: string, moves: unknown, limitMs: number): { ok: true; score: number; moves: number; lastAt: number } | { ok: false; reason: string } {
  if (!Array.isArray(moves)) return { ok: true, score: 0, moves: 0, lastAt: 0 }
  if (moves.length > 2000) return { ok: false, reason: 'Too many moves' }
  const g = dealKlondike(seed)
  let last = -SOL_MIN_GAP_MS
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]
    if (!Array.isArray(mv) || mv.length !== 5 || !mv.every((n) => typeof n === 'number' && isFinite(n))) return { ok: false, reason: `Move ${i + 1} is malformed` }
    const [k, a, b, c, at] = mv as number[]
    if (at < last + SOL_MIN_GAP_MS || at > limitMs) return { ok: false, reason: `Move ${i + 1} is out of time` }
    if (!applyMove(g, k, a, b, c)) return { ok: false, reason: `Move ${i + 1} is not legal` }
    last = at
    if (solScore(g) >= SOL_MAX_SCORE) break
  }
  return { ok: true, score: solScore(g), moves: moves.length, lastAt: Math.max(0, last) }
}
