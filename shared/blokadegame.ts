// Live head-to-head Blokade. The server owns the board, clocks and result.
import { hashSeed } from './rng'
import { applyMove, startBoard, winnerOf, type Board, type Move, type Side } from './blokade'

export type ClockId = '3+5' | '5+5' | '1+0'
export const CLOCKS: Record<ClockId, { base: number; inc: number }> = {
  '3+5': { base: 3 * 60_000, inc: 5_000 },
  '5+5': { base: 5 * 60_000, inc: 5_000 },
  '1+0': { base: 60_000, inc: 0 },
}
export const DEFAULT_CLOCK: ClockId = '3+5'
export const isClockId = (v: unknown): v is ClockId => v === '3+5' || v === '5+5' || v === '1+0'

export type BlokadeOver = { winner: Side; reason: 'goal' | 'timeout' | 'resign' }
export type BlokadeLive = {
  kind: 'blokade'
  south: 0 | 1 // seat that plays south
  board: Board
  clock: ClockId
  leftMs: { s: number; n: number }
  lastAt: number
  moves: Move[]
  over?: BlokadeOver
}

export const initBlokade = (seed: string, startsAt: number, clock: ClockId = DEFAULT_CLOCK): BlokadeLive => {
  const id = isClockId(clock) ? clock : DEFAULT_CLOCK
  const { base } = CLOCKS[id]
  return {
    kind: 'blokade',
    south: (hashSeed('blokade:' + seed) & 1) as 0 | 1,
    board: startBoard(),
    clock: id,
    leftMs: { s: base, n: base },
    lastAt: startsAt,
    moves: [],
  }
}

export const sideOf = (st: BlokadeLive, seat: 0 | 1): Side => (st.south === seat ? 's' : 'n')

/** If the side to move has run out of time they lose. Returns true if the state changed. */
export function blokadeTick(st: BlokadeLive, now: number): boolean {
  if (st.over) return false
  const side = st.board.turn
  if (now - st.lastAt < st.leftMs[side]) return false
  st.leftMs[side] = 0
  st.over = { winner: side === 's' ? 'n' : 's', reason: 'timeout' }
  return true
}

export function blokadeMove(st: BlokadeLive, seat: 0 | 1, mv: unknown, now: number) {
  if (st.over) throw new Error('The game is over')
  if (blokadeTick(st, now)) return
  const side = sideOf(st, seat)
  if (st.board.turn !== side) throw new Error('Not your turn')
  const move = parseMove(mv)
  const next = applyMove(st.board, side, move)
  const used = Math.max(0, now - st.lastAt)
  const inc = CLOCKS[st.clock].inc
  st.leftMs[side] = Math.max(1, st.leftMs[side] - used) + inc
  st.lastAt = now
  st.board = next
  st.moves.push(move)
  const w = winnerOf(next)
  if (w) st.over = { winner: w, reason: 'goal' }
}

export function blokadeResign(st: BlokadeLive, seat: 0 | 1) {
  if (st.over) return
  const mine = sideOf(st, seat)
  st.over = { winner: mine === 's' ? 'n' : 's', reason: 'resign' }
}

export const blokadeScore = (st: BlokadeLive, seat: 0 | 1) => {
  if (!st.over) return 0.5
  return st.over.winner === sideOf(st, seat) ? 1 : 0
}

function parseMove(mv: any): Move {
  const kind = String(mv?.kind ?? '')
  const r = Number(mv?.r)
  const c = Number(mv?.c)
  if (!Number.isInteger(r) || !Number.isInteger(c)) throw new Error('Bad move')
  if (kind === 'pawn') return { kind: 'pawn', r, c }
  const dir = mv?.dir === 'v' ? 'v' : mv?.dir === 'h' ? 'h' : null
  if (kind === 'wall' && dir) return { kind: 'wall', dir, r, c }
  throw new Error('Bad move')
}
