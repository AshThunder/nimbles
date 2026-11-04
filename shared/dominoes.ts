// Domino Chain, a solo puzzle played on the same deal by everybody. Double-six set, 28 tiles.
// One tile starts the chain, you hold seven, the other 20 wait in the boneyard in a fixed order.
// Play a tile on either end of the chain. Only when nothing in your hand fits may you draw.
// Score: the pips of every tile you place, +10 for a double, +40 for emptying your hand.
import { rng } from './rng'

export const DM_TILES: [number, number][] = (() => {
  const t: [number, number][] = []
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b])
  return t
})()
export const DM_DRAW = 28 // tile id that means "draw from the boneyard"
export const DM_MIN_GAP_MS = 250
export const DM_HAND = 7
export const DM_EMPTY_BONUS = 40
export const DM_DOUBLE_BONUS = 10

export type Domino = { chain: number[]; left: number; right: number; hand: number[]; yard: number[]; score: number; placed: number }

export function dealDominoes(seed: string): Domino {
  const order = rng('dominoes:' + seed).shuffle(DM_TILES.map((_, i) => i))
  const start = DM_TILES[order[0]]
  return { chain: [order[0]], left: start[0], right: start[1], hand: order.slice(1, 1 + DM_HAND), yard: order.slice(1 + DM_HAND), score: 0, placed: 0 }
}

/** Which ends a tile fits: bit 1 = left, bit 2 = right */
export function dmFits(g: Domino, id: number): number {
  const t = DM_TILES[id]
  if (!t) return 0
  return (t[0] === g.left || t[1] === g.left ? 1 : 0) | (t[0] === g.right || t[1] === g.right ? 2 : 0)
}
export const dmCanPlay = (g: Domino) => g.hand.some((id) => dmFits(g, id) !== 0)
export const dmOver = (g: Domino) => g.hand.length === 0 || (!dmCanPlay(g) && g.yard.length === 0)

/** Places a tile on side 0 (left) or 1 (right). Returns false when it does not fit. */
export function dmPlace(g: Domino, id: number, side: number): boolean {
  const i = g.hand.indexOf(id)
  if (i < 0 || (side !== 0 && side !== 1) || !(dmFits(g, id) & (side === 0 ? 1 : 2))) return false
  const t = DM_TILES[id]
  const end = side === 0 ? g.left : g.right
  const other = t[0] === end ? t[1] : t[0]
  if (side === 0) {
    g.left = other
    g.chain.unshift(id)
  } else {
    g.right = other
    g.chain.push(id)
  }
  g.hand.splice(i, 1)
  g.placed++
  g.score += t[0] + t[1] + (t[0] === t[1] ? DM_DOUBLE_BONUS : 0) + (g.hand.length === 0 ? DM_EMPTY_BONUS : 0)
  return true
}

export function dmDraw(g: Domino): boolean {
  if (dmCanPlay(g) || g.yard.length === 0) return false
  g.hand.push(g.yard.shift()!)
  return true
}

/** [tile, side, at ms]; tile 28 = draw. */
export type DmMove = [number, number, number]

export function replayDominoes(seed: string, moves: unknown, limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(moves)) return { ok: false, reason: 'Bad move log' }
  if (moves.length > 80) return { ok: false, reason: 'Too many moves' }
  const g = dealDominoes(seed)
  let last = -DM_MIN_GAP_MS
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]
    if (!Array.isArray(mv) || mv.length !== 3 || !mv.every((n) => Number.isInteger(n))) return { ok: false, reason: `Move ${i + 1} is malformed` }
    const [id, side, at] = mv as number[]
    if (at < last + DM_MIN_GAP_MS || at > limitMs) return { ok: false, reason: `Move ${i + 1} is out of time` }
    if (dmOver(g)) return { ok: false, reason: 'The game was already over' }
    if (!(id === DM_DRAW ? dmDraw(g) : dmPlace(g, id, side))) return { ok: false, reason: `Move ${i + 1} is not legal` }
    last = at
  }
  return { ok: true, score: g.score, lastAt: Math.max(0, last), detail: { placed: g.placed } }
}
