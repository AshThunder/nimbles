// Block Puzzle: an 8x8 grid and trays of three pieces. The trays depend only on the match seed.
// Fill a whole row or column and it clears. The client logs each placement; the server replays them.
import { rng } from './rng'

export const BK_N = 8
export const BK_MIN_GAP_MS = 250

/** Shapes as lists of [row, col] cells */
export const BK_SHAPES: [number, number][][] = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [1, 1]],
  [[0, 1], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 1], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
]
/** Colour index for each shape, for drawing */
export const bkColor = (shape: number) => shape % 5

const WEIGHT = BK_SHAPES.map((s) => (s.length >= 9 ? 1 : s.length >= 5 ? 2 : 3))
const bag = WEIGHT.flatMap((w, i) => Array<number>(w).fill(i))

/** The three shapes in tray number k, the same for everyone with this seed */
export function bkTray(seed: string, k: number): number[] {
  const r = rng(`blocks:${seed}:${k}`)
  return [r.pick(bag), r.pick(bag), r.pick(bag)]
}

export type BkMove = [number, number, number, number] // [slot 0..2, row, col, at ms]

export class BlockGame {
  grid: number[][] = Array.from({ length: BK_N }, () => Array<number>(BK_N).fill(-1))
  tray = 0
  slots: (number | null)[]
  score = 0
  placed = 0
  lines = 0
  over = false
  constructor(public seed: string) {
    this.slots = bkTray(seed, 0)
  }
  fits(shape: number, r: number, c: number) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false
    for (const [dr, dc] of BK_SHAPES[shape]) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || cc < 0 || rr >= BK_N || cc >= BK_N || this.grid[rr][cc] >= 0) return false
    }
    return true
  }
  canPlaceAny(shape: number) {
    for (let r = 0; r < BK_N; r++) for (let c = 0; c < BK_N; c++) if (this.fits(shape, r, c)) return true
    return false
  }
  /** Places a piece. Returns the cleared rows and columns, or null if the move is not legal. */
  place(slot: number, r: number, c: number): { rows: number[]; cols: number[]; gained: number } | null {
    if (this.over || !Number.isInteger(slot) || slot < 0 || slot > 2) return null
    const shape = this.slots[slot]
    if (shape === null || !this.fits(shape, r, c)) return null
    for (const [dr, dc] of BK_SHAPES[shape]) this.grid[r + dr][c + dc] = bkColor(shape)
    this.slots[slot] = null
    this.placed++
    const rows: number[] = []
    const cols: number[] = []
    for (let i = 0; i < BK_N; i++) {
      if (this.grid[i].every((v) => v >= 0)) rows.push(i)
      if (this.grid.every((row) => row[i] >= 0)) cols.push(i)
    }
    for (const i of rows) for (let j = 0; j < BK_N; j++) this.grid[i][j] = -1
    for (const j of cols) for (let i = 0; i < BK_N; i++) this.grid[i][j] = -1
    const n = rows.length + cols.length
    this.lines += n
    const gained = BK_SHAPES[shape].length + n * n * 10
    this.score += gained
    if (this.slots.every((s) => s === null)) {
      this.tray++
      this.slots = bkTray(this.seed, this.tray)
    }
    if (!this.slots.some((s) => s !== null && this.canPlaceAny(s))) this.over = true
    return { rows, cols, gained }
  }
}

export type ReplayResult = { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string }

export function replayBlocks(seed: string, moves: unknown, limitMs: number): ReplayResult {
  if (!Array.isArray(moves) || moves.length > 400) return { ok: false, reason: 'Bad move log' }
  const g = new BlockGame(seed)
  let last = -Infinity
  for (const m of moves) {
    if (!Array.isArray(m) || m.length !== 4 || !m.every((v) => Number.isInteger(v))) return { ok: false, reason: 'Bad move' }
    const [slot, r, c, at] = m as BkMove
    if (at < 0 || at > limitMs || at - last < BK_MIN_GAP_MS) return { ok: false, reason: 'Moves too fast' }
    last = at
    if (!g.place(slot, r, c)) return { ok: false, reason: 'Illegal placement' }
  }
  return { ok: true, score: g.score, lastAt: Math.max(0, last), detail: { placed: g.placed, lines: g.lines } }
}
