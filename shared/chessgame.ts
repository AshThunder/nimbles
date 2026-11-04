// Live head-to-head chess. The server owns the game: it validates every move with chess.js,
// runs both clocks and decides the result. Clients only send moves and render what the server returns.
import { Chess } from 'chess.js'
import { hashSeed } from './rng'

export const CHESS_CLOCK_MS = 3 * 60 * 1000
export type Side = 'w' | 'b'
export type ChessOver = { winner: Side | null; reason: 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'resign' | 'time' }
export type ChessLive = {
  kind: 'chess'
  moves: string[] // "e2e4", "e7e8q"
  white: 0 | 1 // seat index that plays white
  left: { w: number; b: number } // ms on each clock at `lastAt`
  lastAt: number
  over?: ChessOver
}

export const initChess = (seed: string, startsAt: number): ChessLive => ({
  kind: 'chess', moves: [], white: (hashSeed('chess:' + seed) & 1) as 0 | 1, left: { w: CHESS_CLOCK_MS, b: CHESS_CLOCK_MS }, lastAt: startsAt,
})

export function replayChess(st: Pick<ChessLive, 'moves'>): Chess {
  const c = new Chess()
  for (const m of st.moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })
  return c
}

/** A side that cannot possibly mate (bare king, or king and one minor piece) */
function cannotMate(c: Chess, side: Side) {
  const pcs = c.board().flat().filter((p) => p && p.color === side && p.type !== 'k') as { type: string }[]
  return pcs.length === 0 || (pcs.length === 1 && (pcs[0].type === 'n' || pcs[0].type === 'b'))
}

/** Applies the clock: if the side to move has run out of time the game ends. Returns true if the state changed. */
export function chessTick(st: ChessLive, now: number): boolean {
  if (st.over) return false
  const c = replayChess(st)
  const side = c.turn() as Side
  if (now - st.lastAt < st.left[side]) return false
  st.left[side] = 0
  const opp: Side = side === 'w' ? 'b' : 'w'
  st.over = cannotMate(c, opp) ? { winner: null, reason: 'time' } : { winner: opp, reason: 'timeout' }
  return true
}

export function chessMove(st: ChessLive, seat: 0 | 1, mv: { from?: unknown; to?: unknown; promotion?: unknown }, now: number) {
  if (st.over) throw new Error('The game is over')
  if (chessTick(st, now)) return
  const c = replayChess(st)
  const side = c.turn() as Side
  if ((side === 'w') !== (st.white === seat)) throw new Error('Not your turn')
  const from = String(mv.from ?? '')
  const to = String(mv.to ?? '')
  const promo = mv.promotion ? String(mv.promotion).toLowerCase() : undefined
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || (promo && !/^[qrbn]$/.test(promo))) throw new Error('Bad move')
  let r
  try {
    r = c.move({ from, to, promotion: promo ?? 'q' })
  } catch {
    throw new Error('Illegal move')
  }
  st.left[side] = Math.max(1, st.left[side] - (now - st.lastAt))
  st.lastAt = now
  st.moves.push(from + to + (r.promotion ?? ''))
  if (c.isCheckmate()) st.over = { winner: side, reason: 'checkmate' }
  else if (c.isStalemate()) st.over = { winner: null, reason: 'stalemate' }
  else if (c.isDraw()) st.over = { winner: null, reason: 'draw' }
}

export function chessResign(st: ChessLive, seat: 0 | 1) {
  if (st.over) return
  const mine: Side = st.white === seat ? 'w' : 'b'
  st.over = { winner: mine === 'w' ? 'b' : 'w', reason: 'resign' }
}

/** Final whistle for the match clock: the side with more material on the board is not a result, so call it a draw. */
export function chessTimeUp(st: ChessLive) {
  if (!st.over) st.over = { winner: null, reason: 'time' }
}

/** 1 / 0.5 / 0 for a seat */
export const chessScore = (st: ChessLive, seat: 0 | 1) => (!st.over || st.over.winner === null ? 0.5 : (st.over.winner === 'w') === (st.white === seat) ? 1 : 0)
