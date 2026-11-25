// Blokade rules: a 9×9 Quoridor-style board. Walls never cut off every path to a goal.
export type Side = 's' | 'n'
export type Pos = { r: number; c: number }
export type WallDir = 'h' | 'v' // Flat (horizontal) or Standing (vertical)
export type Wall = { dir: WallDir; r: number; c: number; by?: Side } // r,c are 0..7; by is who placed it
export type PawnMove = { kind: 'pawn'; r: number; c: number }
export type WallMove = { kind: 'wall'; dir: WallDir; r: number; c: number }
export type Move = PawnMove | WallMove

export const SIZE = 9
export const WALL_MAX = 10

export type Board = {
  pawns: { s: Pos; n: Pos }
  walls: Wall[]
  left: { s: number; n: number }
  turn: Side
}

export const other = (s: Side): Side => (s === 's' ? 'n' : 's')
export const goalRow = (s: Side) => (s === 's' ? 0 : 8)
export const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c
export const inCell = (p: Pos) => p.r >= 0 && p.r < SIZE && p.c >= 0 && p.c < SIZE
export const inWall = (w: Wall) => w.r >= 0 && w.r <= 7 && w.c >= 0 && w.c <= 7

export const startBoard = (): Board => ({
  pawns: { s: { r: 8, c: 4 }, n: { r: 0, c: 4 } },
  walls: [],
  left: { s: WALL_MAX, n: WALL_MAX },
  turn: 's',
})

export function cloneBoard(b: Board): Board {
  return {
    pawns: { s: { ...b.pawns.s }, n: { ...b.pawns.n } },
    walls: b.walls.map((w) => ({ ...w })),
    left: { ...b.left },
    turn: b.turn,
  }
}

/** A wall between rows r and r+1 at column c. */
export function blockedVert(b: Board, r: number, c: number) {
  if (r < 0 || r > 7 || c < 0 || c > 8) return true
  return b.walls.some((w) => w.dir === 'h' && w.r === r && (w.c === c || w.c === c - 1))
}

/** A wall between cols c and c+1 at row r. */
export function blockedHorz(b: Board, r: number, c: number) {
  if (c < 0 || c > 7 || r < 0 || r > 8) return true
  return b.walls.some((w) => w.dir === 'v' && w.c === c && (w.r === r || w.r === r - 1))
}

export function canStep(b: Board, from: Pos, to: Pos) {
  if (!inCell(from) || !inCell(to)) return false
  const dr = to.r - from.r
  const dc = to.c - from.c
  if (Math.abs(dr) + Math.abs(dc) !== 1) return false
  if (dr === 1) return !blockedVert(b, from.r, from.c)
  if (dr === -1) return !blockedVert(b, to.r, from.c)
  if (dc === 1) return !blockedHorz(b, from.r, from.c)
  return !blockedHorz(b, from.r, to.c)
}

export function occupied(b: Board, p: Pos, ignore?: Side) {
  if (ignore !== 's' && samePos(b.pawns.s, p)) return 's' as Side
  if (ignore !== 'n' && samePos(b.pawns.n, p)) return 'n' as Side
  return null
}

const ORTH = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
]

/** Legal destinations for this side's pawn, including jumps. */
export function legalPawnMoves(b: Board, side: Side): Pos[] {
  const from = b.pawns[side]
  const out: Pos[] = []
  for (const d of ORTH) {
    const n = { r: from.r + d.r, c: from.c + d.c }
    if (!canStep(b, from, n)) continue
    const hit = occupied(b, n, side)
    if (!hit) {
      out.push(n)
      continue
    }
    const behind = { r: n.r + d.r, c: n.c + d.c }
    if (canStep(b, n, behind) && !occupied(b, behind)) {
      out.push(behind)
      continue
    }
    // straight jump blocked or off the board: side jumps from the opponent square
    for (const s of ORTH) {
      if (s.r === d.r && s.c === d.c) continue
      if (s.r === -d.r && s.c === -d.c) continue
      const sideSq = { r: n.r + s.r, c: n.c + s.c }
      if (canStep(b, n, sideSq) && !occupied(b, sideSq)) out.push(sideSq)
    }
  }
  return uniquePos(out)
}

function uniquePos(ps: Pos[]) {
  const seen = new Set<string>()
  return ps.filter((p) => {
    const k = p.r + ',' + p.c
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function wallOverlaps(a: Wall, b: Wall) {
  if (a.dir === 'h' && b.dir === 'h') return a.r === b.r && Math.abs(a.c - b.c) < 2
  if (a.dir === 'v' && b.dir === 'v') return a.c === b.c && Math.abs(a.r - b.r) < 2
  // a horizontal and a vertical wall cross at the same intersection
  const h = a.dir === 'h' ? a : b
  const v = a.dir === 'v' ? a : b
  return h.r === v.r && h.c === v.c
}

export function canPlaceWall(b: Board, w: Wall) {
  if (!inWall(w)) return false
  if (b.walls.some((x) => wallOverlaps(x, w))) return false
  const next = { ...b, walls: [...b.walls, w] }
  return pathExists(next, 's') && pathExists(next, 'n')
}

/** Shortest path length to the goal, ignoring pawns (only walls matter). Infinity if none. */
export function pathLength(b: Board, side: Side): number {
  const start = b.pawns[side]
  const goal = goalRow(side)
  if (start.r === goal) return 0
  const q: Pos[] = [start]
  const dist = new Int16Array(SIZE * SIZE)
  dist.fill(-1)
  dist[start.r * SIZE + start.c] = 0
  let qi = 0
  while (qi < q.length) {
    const p = q[qi++]
    const d = dist[p.r * SIZE + p.c]
    for (const o of ORTH) {
      const n = { r: p.r + o.r, c: p.c + o.c }
      if (!canStep(b, p, n)) continue
      const i = n.r * SIZE + n.c
      if (dist[i] >= 0) continue
      if (n.r === goal) return d + 1
      dist[i] = d + 1
      q.push(n)
    }
  }
  return Infinity
}

export const pathExists = (b: Board, side: Side) => pathLength(b, side) < Infinity

export function legalWalls(b: Board, side: Side): Wall[] {
  if (b.left[side] <= 0) return []
  const out: Wall[] = []
  for (const dir of ['h', 'v'] as WallDir[])
    for (let r = 0; r <= 7; r++)
      for (let c = 0; c <= 7; c++) {
        const w = { dir, r, c }
        if (canPlaceWall(b, w)) out.push(w)
      }
  return out
}

export function winnerOf(b: Board): Side | null {
  if (b.pawns.s.r === goalRow('s')) return 's'
  if (b.pawns.n.r === goalRow('n')) return 'n'
  return null
}

export function applyMove(b: Board, side: Side, mv: Move): Board {
  if (b.turn !== side) throw new Error('Not your turn')
  if (winnerOf(b)) throw new Error('The game is over')
  const next = cloneBoard(b)
  if (mv.kind === 'pawn') {
    const dest = { r: mv.r, c: mv.c }
    if (!legalPawnMoves(b, side).some((p) => samePos(p, dest))) throw new Error('Illegal move')
    next.pawns[side] = dest
  } else {
    const w = { dir: mv.dir, r: mv.r, c: mv.c }
    if (next.left[side] <= 0) throw new Error('No walls left')
    if (!canPlaceWall(next, w)) throw new Error('Illegal wall')
    next.walls.push({ ...w, by: side })
    next.left[side]--
  }
  next.turn = other(side)
  return next
}

export const isJump = (from: Pos, to: Pos) => Math.abs(to.r - from.r) + Math.abs(to.c - from.c) === 2
