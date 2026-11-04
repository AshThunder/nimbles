import { Chess, type Move } from 'chess.js'

const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/** Material plus a small centre and advancement bonus. Positive favours white. */
export function evaluate(ch: Chess): number {
  let s = 0
  const b = ch.board()
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = b[r][c]
      if (!p) continue
      const centre = 6 - (Math.abs(3.5 - c) + Math.abs(3.5 - r)) * 1.5
      const adv = p.type === 'p' ? (p.color === 'w' ? 6 - r : r - 1) * 4 : 0
      const v = VAL[p.type] + (p.type === 'k' ? 0 : centre) + adv
      s += p.color === 'w' ? v : -v
    }
  return s
}
function order(ms: Move[]) {
  return ms.sort((a, b) => (b.captured ? VAL[b.captured] * 10 - VAL[b.piece] : 0) - (a.captured ? VAL[a.captured] * 10 - VAL[a.piece] : 0) + (b.promotion ? 800 : 0) - (a.promotion ? 800 : 0))
}
function search(ch: Chess, depth: number, alpha: number, beta: number): number {
  if (ch.isCheckmate()) return ch.turn() === 'w' ? -99999 - depth : 99999 + depth
  if (ch.isDraw()) return 0
  if (depth === 0) return evaluate(ch)
  const white = ch.turn() === 'w'
  let best = white ? -Infinity : Infinity
  for (const m of order(ch.moves({ verbose: true }))) {
    ch.move(m)
    const v = search(ch, depth - 1, alpha, beta)
    ch.undo()
    if (white) {
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
export function pipMove(ch: Chess, level: 'easy' | 'med' | 'hard'): Move | null {
  const ms = ch.moves({ verbose: true })
  if (!ms.length) return null
  const depth = { easy: 1, med: 2, hard: 3 }[level]
  if (level === 'easy' && Math.random() < 0.3) return ms[(Math.random() * ms.length) | 0]
  const black = ch.turn() === 'b'
  let best: Move[] = []
  let bv = black ? Infinity : -Infinity
  for (const m of order(ms)) {
    ch.move(m)
    const v = search(ch, depth - 1, -Infinity, Infinity) + (level === 'easy' ? (Math.random() - 0.5) * 80 : Math.random() * 3)
    ch.undo()
    if (black ? v < bv - 1e-9 : v > bv + 1e-9) ((bv = v), (best = [m]))
    else if (Math.abs(v - bv) < 1e-9) best.push(m)
  }
  return best[(Math.random() * best.length) | 0]
}

