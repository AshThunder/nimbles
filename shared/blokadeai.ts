// Nimo's Blokade play. Easy is leaky, Hard is strong but not perfect.
import type { PipLevel } from './types'
import { applyMove, legalPawnMoves, legalWalls, pathLength, winnerOf, type Board, type Move, type Side, type Wall } from './blokade'

const SCORE_WIN = 10_000

function score(b: Board, me: Side) {
  const w = winnerOf(b)
  if (w === me) return SCORE_WIN
  if (w) return -SCORE_WIN
  const mine = pathLength(b, me)
  const theirs = pathLength(b, me === 's' ? 'n' : 's')
  if (!Number.isFinite(mine)) return -SCORE_WIN
  if (!Number.isFinite(theirs)) return SCORE_WIN
  return (theirs - mine) * 12 + (b.left[me] - b.left[me === 's' ? 'n' : 's'])
}

function pawnMoves(b: Board, me: Side): Move[] {
  return legalPawnMoves(b, me).map((p) => ({ kind: 'pawn' as const, r: p.r, c: p.c }))
}

function usefulWalls(b: Board, me: Side): Wall[] {
  const base = score(b, me)
  const out: Wall[] = []
  for (const w of legalWalls(b, me)) {
    const n = applyMove(b, me, { kind: 'wall', ...w })
    if (score(n, me) > base + 0.5) out.push(w)
  }
  return out
}

function pick<T>(xs: T[]): T {
  return xs[(Math.random() * xs.length) | 0]
}

function shortestPawn(b: Board, me: Side): Move | null {
  const here = pathLength(b, me)
  let best: Move[] = []
  let bv = Infinity
  for (const mv of pawnMoves(b, me)) {
    const n = applyMove(b, me, mv)
    const d = pathLength(n, me)
    if (d < bv) ((bv = d), (best = [mv]))
    else if (d === bv) best.push(mv)
  }
  if (!best.length) return null
  // prefer a move that actually shortens, else any
  return bv <= here ? pick(best) : pick(best)
}

function minimax(b: Board, me: Side, toMove: Side, depth: number, alpha: number, beta: number): number {
  const w = winnerOf(b)
  if (w === me) return SCORE_WIN + depth
  if (w) return -SCORE_WIN - depth
  if (depth === 0) return score(b, me) + (Math.random() - 0.5) * 1.2
  const maxing = toMove === me
  let best = maxing ? -Infinity : Infinity
  const moves: Move[] = [...pawnMoves(b, toMove), ...usefulWalls(b, toMove).map((w) => ({ kind: 'wall' as const, ...w }))]
  if (!moves.length) return score(b, me)
  // look at shorter lists first: pawn moves, then a cap on walls
  const list = moves.slice(0, 28)
  for (const mv of list) {
    const n = applyMove(b, toMove, mv)
    const v = minimax(n, me, n.turn, depth - 1, alpha, beta)
    if (maxing) {
      best = Math.max(best, v)
      alpha = Math.max(alpha, v)
    } else {
      best = Math.min(best, v)
      beta = Math.min(beta, v)
    }
    if (beta <= alpha) break
  }
  return best
}

export function pipBlokade(b: Board, level: PipLevel): Move | null {
  const me = b.turn
  const pawns = pawnMoves(b, me)
  const walls = legalWalls(b, me)
  if (!pawns.length && !walls.length) return null

  if (level === 'easy') {
    if (Math.random() < 0.3 && (pawns.length || walls.length)) return pick([...pawns, ...walls.map((w) => ({ kind: 'wall' as const, ...w }))])
    if (walls.length && Math.random() < 0.12) return { kind: 'wall', ...pick(walls) }
    return shortestPawn(b, me) ?? pick(pawns)
  }

  if (level === 'med') {
    const useful = usefulWalls(b, me)
    // place a wall when it clearly lengthens their path more than ours
    if (useful.length && Math.random() < 0.7) {
      let best = useful[0]
      let bv = -Infinity
      for (const w of useful) {
        const v = score(applyMove(b, me, { kind: 'wall', ...w }), me) + Math.random() * 2
        if (v > bv) ((bv = v), (best = w))
      }
      if (bv >= score(b, me) + 8) return { kind: 'wall', ...best }
    }
    return shortestPawn(b, me) ?? (pawns[0] ?? { kind: 'wall', ...walls[0] })
  }

  // Hard: depth-2 minimax on useful walls + pawn moves, with a little noise so it is beatable
  const cands: Move[] = [...pawns, ...usefulWalls(b, me).map((w) => ({ kind: 'wall' as const, ...w }))]
  if (!cands.length) return shortestPawn(b, me)
  let best: Move[] = []
  let bv = -Infinity
  for (const mv of cands) {
    const n = applyMove(b, me, mv)
    const v = minimax(n, me, n.turn, 1, -Infinity, Infinity) + (Math.random() - 0.5) * 3
    if (v > bv + 0.4) ((bv = v), (best = [mv]))
    else if (Math.abs(v - bv) <= 0.4) best.push(mv)
  }
  return pick(best.length ? best : cands)
}
