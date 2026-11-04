// Bubble Shooter rules and shot physics, in board units (bubble radius = 1). Pure and deterministic:
// the client animates the path this returns, the server replays the logged shots to recompute the score.
import { rng, type Rng } from './rng'

export const BS_COLS = 10
export const BS_ROWS = 14
export const BS_LOSE_ROW = 11
export const BS_PUSH_EVERY = 7
export const BS_COLORS = 5
export const BS_W = BS_COLS * 2
export const BS_RH = Math.sqrt(3)
export const BS_SX = BS_W / 2
export const BS_SY = BS_RH * (BS_LOSE_ROW + 1) + 3.5 // shooter position
export const BS_STEP = 0.5 // path step length
export const BS_MAX_STEPS = 500
export const BS_ANGLE_SCALE = 10000 // shot angles are logged as integers (1e-4 rad)
export const BS_MIN_ANGLE = 0.2
export const BS_MS_PER_STEP = 3 // a shot cannot land faster than this (real flight is ~3.9 ms/step)
export const BS_MIN_GAP_MS = 150

export type BsShot = [number, number] // [angle * 1e4 (rounded), at ms]
export type Cell = number // colour index, -1 = empty

export class BubbleGame {
  grid: Cell[][] = Array.from({ length: BS_ROWS }, () => Array<Cell>(BS_COLS).fill(-1))
  parity = 0
  shots = 0
  popped = 0
  score = 0
  over = false
  cur: number
  nxt: number
  private rBoard: Rng
  private rRows: Rng
  private rQueue: Rng

  constructor(seed: string) {
    this.rBoard = rng('bubble:board:' + seed)
    this.rRows = rng('bubble:rows:' + seed)
    this.rQueue = rng('bubble:queue:' + seed)
    for (let r = 0; r < 6; r++) for (let c = 0; c < this.colsIn(r); c++) this.grid[r][c] = this.rBoard.int(BS_COLORS)
    this.cur = this.nextColor()
    this.nxt = this.nextColor()
  }

  colsIn(r: number) {
    return ((r + this.parity) & 1) === 1 ? BS_COLS - 1 : BS_COLS
  }
  cx(r: number, c: number) {
    return 1 + c * 2 + (((r + this.parity) & 1) === 1 ? 1 : 0)
  }
  cy(r: number) {
    return 1 + r * BS_RH
  }
  present(): number[] {
    const s = new Set<number>()
    for (const row of this.grid) for (const v of row) if (v >= 0) s.add(v)
    return [...s]
  }
  private nextColor() {
    const p = this.present()
    return p.length ? p[this.rQueue.int(1000) % p.length] : this.rQueue.int(BS_COLORS)
  }
  nbrs(r: number, c: number): [number, number][] {
    const off = ((r + this.parity) & 1) === 1
    const d: [number, number][] = [[r, c - 1], [r, c + 1], ...(off ? ([[r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]] as [number, number][]) : ([[r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]] as [number, number][]))]
    return d.filter(([rr, cc]) => rr >= 0 && rr < BS_ROWS && cc >= 0 && cc < this.colsIn(rr))
  }

  /** Flies a bubble from the shooter along `angleQ` (integer, 1e-4 rad). Does not change the board. */
  trace(angleQ: number): { path: [number, number][]; cell: [number, number] | null } {
    const a = Math.min(-BS_MIN_ANGLE, Math.max(-Math.PI + BS_MIN_ANGLE, angleQ / BS_ANGLE_SCALE))
    let vx = Math.cos(a) * BS_STEP
    const vy = Math.sin(a) * BS_STEP
    let x = BS_SX
    let y = BS_SY
    const path: [number, number][] = [[x, y]]
    for (let i = 0; i < BS_MAX_STEPS; i++) {
      x += vx
      y += vy
      if (x < 1) ((x = 1), (vx = -vx))
      else if (x > BS_W - 1) ((x = BS_W - 1), (vx = -vx))
      path.push([x, y])
      if (y <= 1 || this.touches(x, y)) break
    }
    const [x1, y1] = path[path.length - 1]
    let best: [number, number] | null = null
    let bd = Infinity
    for (let r = 0; r < BS_ROWS; r++)
      for (let c = 0; c < this.colsIn(r); c++) {
        if (this.grid[r][c] >= 0) continue
        if (r !== 0 && !this.nbrs(r, c).some(([p, q]) => this.grid[p][q] >= 0)) continue
        const d = Math.hypot(this.cx(r, c) - x1, this.cy(r) - y1)
        if (d < bd) ((bd = d), (best = [r, c]))
      }
    return { path, cell: best }
  }
  private touches(x: number, y: number) {
    for (let r = 0; r < BS_ROWS; r++) for (let c = 0; c < this.colsIn(r); c++) if (this.grid[r][c] >= 0 && Math.hypot(this.cx(r, c) - x, this.cy(r) - y) < 1.8) return true
    return false
  }

  /** Lands the current bubble in `cell`, pops groups, drops orphans, pushes rows. */
  commit(cell: [number, number] | null): { popped: [number, number, number][]; dropped: [number, number, number][]; gained: number; cleared: boolean; pushed: boolean } {
    const ev = { popped: [] as [number, number, number][], dropped: [] as [number, number, number][], gained: 0, cleared: false, pushed: false }
    if (!cell) return ev
    const [r, c] = cell
    const col = this.cur
    this.grid[r][c] = col
    this.shots++
    const seen = new Set<string>([r + ',' + c])
    const q: [number, number][] = [[r, c]]
    for (let i = 0; i < q.length; i++) for (const [a, b] of this.nbrs(...q[i])) if (this.grid[a][b] === col && !seen.has(a + ',' + b)) (seen.add(a + ',' + b), q.push([a, b]))
    if (q.length >= 3) {
      for (const [a, b] of q) ev.popped.push([a, b, this.grid[a][b]]), (this.grid[a][b] = -1)
      this.popped += q.length
      ev.gained += q.length * 10 + (q.length - 3) * 5
      const keep = new Set<string>()
      const qq: [number, number][] = []
      for (let cc = 0; cc < this.colsIn(0); cc++) if (this.grid[0][cc] >= 0) (keep.add('0,' + cc), qq.push([0, cc]))
      for (let i = 0; i < qq.length; i++) for (const [a, b] of this.nbrs(...qq[i])) if (this.grid[a][b] >= 0 && !keep.has(a + ',' + b)) (keep.add(a + ',' + b), qq.push([a, b]))
      for (let a = 0; a < BS_ROWS; a++)
        for (let b = 0; b < this.colsIn(a); b++)
          if (this.grid[a][b] >= 0 && !keep.has(a + ',' + b)) {
            ev.dropped.push([a, b, this.grid[a][b]])
            this.grid[a][b] = -1
          }
      this.popped += ev.dropped.length
      ev.gained += ev.dropped.length * 20
    }
    if (!this.present().length) {
      ev.gained += 200
      ev.cleared = true
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < this.colsIn(rr); cc++) this.grid[rr][cc] = this.rBoard.int(BS_COLORS)
    }
    this.score += ev.gained
    if (this.shots % BS_PUSH_EVERY === 0) {
      this.pushRow()
      ev.pushed = true
    }
    this.cur = this.nxt
    this.nxt = this.nextColor()
    if (this.grid.slice(BS_LOSE_ROW).some((row) => row.some((v) => v >= 0))) this.over = true
    return ev
  }
  private pushRow() {
    this.parity ^= 1
    for (let r = BS_ROWS - 1; r > 0; r--) this.grid[r] = this.grid[r - 1]
    this.grid[0] = Array<Cell>(BS_COLS).fill(-1)
    for (let c = 0; c < this.colsIn(0); c++) this.grid[0][c] = this.rRows.int(BS_COLORS)
  }
}

export const quantizeAngle = (a: number) => Math.round(Math.min(-BS_MIN_ANGLE, Math.max(-Math.PI + BS_MIN_ANGLE, a)) * BS_ANGLE_SCALE)

export function replayBubble(seed: string, shots: unknown, limitMs: number): { ok: true; score: number; popped: number; shots: number } | { ok: false; reason: string } {
  if (!Array.isArray(shots)) return { ok: true, score: 0, popped: 0, shots: 0 }
  if (shots.length > 1200) return { ok: false, reason: 'Too many shots' }
  const g = new BubbleGame(seed)
  let last = -BS_MIN_GAP_MS
  let lastSteps = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (g.over) return { ok: false, reason: 'Shots after the round ended' }
    if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => typeof n === 'number' && isFinite(n))) return { ok: false, reason: `Shot ${i + 1} is malformed` }
    const [aq, at] = s as number[]
    if (!Number.isInteger(aq) || aq > -BS_MIN_ANGLE * BS_ANGLE_SCALE + 1 || aq < (-Math.PI + BS_MIN_ANGLE) * BS_ANGLE_SCALE - 1) return { ok: false, reason: `Shot ${i + 1} has a bad angle` }
    if (at < last + Math.max(BS_MIN_GAP_MS, lastSteps * BS_MS_PER_STEP) || at > limitMs) return { ok: false, reason: `Shot ${i + 1} is out of time` }
    const t = g.trace(aq)
    g.commit(t.cell)
    last = at
    lastSteps = t.path.length
  }
  return { ok: true, score: g.score, popped: g.popped, shots: g.shots }
}
