import { rng } from './rng'

// ---------- Sudoku (n = 9 or 4) ----------

export type SudokuPuzzle = { size: number; puzzle: number[]; solution: number[] }

function boxDims(n: number) {
  return n === 9 ? [3, 3] : [2, 2]
}

function canPlace(g: number[], n: number, idx: number, v: number): boolean {
  const r = Math.floor(idx / n)
  const c = idx % n
  const [br, bc] = boxDims(n)
  for (let i = 0; i < n; i++) {
    if (g[r * n + i] === v || g[i * n + c] === v) return false
  }
  const r0 = r - (r % br)
  const c0 = c - (c % bc)
  for (let i = 0; i < br; i++) for (let j = 0; j < bc; j++) if (g[(r0 + i) * n + c0 + j] === v) return false
  return true
}

function fill(g: number[], n: number, r: ReturnType<typeof rng>): boolean {
  const idx = g.indexOf(0)
  if (idx < 0) return true
  for (const v of r.shuffle(Array.from({ length: n }, (_, i) => i + 1))) {
    if (canPlace(g, n, idx, v)) {
      g[idx] = v
      if (fill(g, n, r)) return true
      g[idx] = 0
    }
  }
  return false
}

/** Counts solutions up to `limit` using the most-constrained-cell heuristic. */
function countSolutions(g: number[], n: number, limit: number): number {
  let best = -1
  let bestOpts: number[] = []
  for (let i = 0; i < g.length; i++) {
    if (g[i] !== 0) continue
    const opts: number[] = []
    for (let v = 1; v <= n; v++) if (canPlace(g, n, i, v)) opts.push(v)
    if (opts.length === 0) return 0
    if (best < 0 || opts.length < bestOpts.length) {
      best = i
      bestOpts = opts
      if (opts.length === 1) break
    }
  }
  if (best < 0) return 1
  let count = 0
  for (const v of bestOpts) {
    g[best] = v
    count += countSolutions(g, n, limit - count)
    g[best] = 0
    if (count >= limit) break
  }
  return count
}

export function makeSudoku(seed: string, size: 9 | 4 = 9, clues = size === 9 ? 38 : 8): SudokuPuzzle {
  const r = rng('sudoku:' + size + ':' + seed)
  const sol = new Array(size * size).fill(0)
  fill(sol, size, r)
  const puzzle = [...sol]
  const order = r.shuffle(Array.from({ length: size * size }, (_, i) => i))
  let remaining = size * size
  for (const i of order) {
    if (remaining <= clues) break
    const keep = puzzle[i]
    puzzle[i] = 0
    if (countSolutions([...puzzle], size, 2) !== 1) puzzle[i] = keep
    else remaining--
  }
  return { size, puzzle, solution: sol }
}

// ---------- Klondike solitaire ----------

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
export const RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'] as const
export type Card = { suit: Suit; rank: number } // rank 0..12 (a..k)

export const cardId = (c: Card) => `${c.suit}-${RANKS[c.rank]}`
export const isRed = (c: Card) => c.suit === 'hearts' || c.suit === 'diamonds'

export type Klondike = {
  stock: Card[] // top of stock is the end of the array
  waste: Card[]
  found: Card[][] // 4 piles, any suit, built a..k same suit
  tab: { card: Card; up: boolean }[][] // 7 columns
}

export function dealKlondike(seed: string): Klondike {
  const r = rng('klondike:' + seed)
  const deck: Card[] = []
  for (const suit of SUITS) for (let rank = 0; rank < 13; rank++) deck.push({ suit, rank })
  const d = r.shuffle(deck)
  const tab: Klondike['tab'] = []
  let k = 0
  for (let c = 0; c < 7; c++) {
    const col: Klondike['tab'][number] = []
    for (let i = 0; i <= c; i++) col.push({ card: d[k++], up: i === c })
    tab.push(col)
  }
  return { stock: d.slice(k), waste: [], found: [[], [], [], []], tab }
}

export function canStack(onto: Card | undefined, c: Card): boolean {
  if (!onto) return c.rank === 12
  return onto.rank === c.rank + 1 && isRed(onto) !== isRed(c)
}

export function canFound(pile: Card[], c: Card): boolean {
  if (pile.length === 0) return c.rank === 0
  const top = pile[pile.length - 1]
  return top.suit === c.suit && top.rank + 1 === c.rank
}
