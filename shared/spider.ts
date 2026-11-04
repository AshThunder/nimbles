// Spider Solitaire, one suit. Pure rules: the client plays with `spMove`/`spDeal` and logs every move;
// the server deals the same layout from the match seed, replays the log and scores it itself.
import { rng } from './rng'

export type SpCard = { r: number; up: boolean } // rank 1 (ace) to 13 (king)
export type Spider = { cols: SpCard[][]; stock: number[]; runs: number; flipped: number }

export const SP_COLS = 10
export const SP_MIN_GAP_MS = 90
export const SP_RUNS = 8

export function dealSpider(seed: string): Spider {
  const deck = rng('spider:' + seed).shuffle(Array.from({ length: 8 * 13 }, (_, i) => (i % 13) + 1))
  const cols: SpCard[][] = Array.from({ length: SP_COLS }, () => [])
  let k = 0
  for (let c = 0; c < SP_COLS; c++) {
    const n = c < 4 ? 6 : 5
    for (let i = 0; i < n; i++) cols[c].push({ r: deck[k++], up: i === n - 1 })
  }
  return { cols, stock: deck.slice(k), runs: 0, flipped: 0 }
}

/** 100 per finished run, 4 per card turned face up, 2 per card sitting on the next rank up */
export function spScore(g: Spider) {
  let links = 0
  for (const col of g.cols) for (let i = 1; i < col.length; i++) if (col[i].up && col[i - 1].up && col[i - 1].r === col[i].r + 1) links++
  return g.runs * 100 + g.flipped * 4 + links * 2
}

/** Length of the movable run that ends a column and starts at idx, or 0 if idx is not the start of one */
export function runFrom(col: SpCard[], idx: number) {
  if (idx < 0 || idx >= col.length || !col[idx].up) return 0
  for (let i = idx + 1; i < col.length; i++) if (!col[i].up || col[i].r !== col[i - 1].r - 1) return 0
  return col.length - idx
}

function settleCol(g: Spider, c: number) {
  const col = g.cols[c]
  if (col.length >= 13) {
    const tail = col.slice(-13)
    if (tail.every((x, i) => x.up && x.r === 13 - i)) {
      col.splice(-13)
      g.runs++
    }
  }
  const t = col[col.length - 1]
  if (t && !t.up) {
    t.up = true
    g.flipped++
  }
}

/** Moves the run starting at column a, index b onto column c. False (and no change) when illegal. */
export function spMove(g: Spider, a: number, b: number, c: number): boolean {
  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < SP_COLS
  if (!ok(a) || !ok(c) || a === c || !Number.isInteger(b) || !runFrom(g.cols[a], b)) return false
  const dest = g.cols[c]
  const top = dest[dest.length - 1]
  const first = g.cols[a][b]
  if (top && top.r !== first.r + 1) return false
  const moved = g.cols[a].splice(b)
  dest.push(...moved)
  settleCol(g, a)
  settleCol(g, c)
  return true
}

/** Deals one card face up onto every column. Not allowed with an empty column or an empty stock. */
export function spDeal(g: Spider): boolean {
  if (g.stock.length < SP_COLS || g.cols.some((c) => c.length === 0)) return false
  for (let c = 0; c < SP_COLS; c++) g.cols[c].push({ r: g.stock.pop()!, up: true })
  for (let c = 0; c < SP_COLS; c++) settleCol(g, c)
  return true
}

/** [kind, a, b, c, at ms]: kind 0 = deal from the stock, kind 1 = move the run at column a index b to column c */
export type SpLog = [number, number, number, number, number]

export function replaySpider(seed: string, moves: unknown, limitMs: number): { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string } {
  if (!Array.isArray(moves)) return { ok: false, reason: 'Bad move log' }
  if (moves.length > 1500) return { ok: false, reason: 'Too many moves' }
  const g = dealSpider(seed)
  let last = -SP_MIN_GAP_MS
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]
    if (!Array.isArray(mv) || mv.length !== 5 || !mv.every((n) => Number.isInteger(n))) return { ok: false, reason: `Move ${i + 1} is malformed` }
    const [k, a, b, c, at] = mv as number[]
    if (at < last + SP_MIN_GAP_MS || at > limitMs) return { ok: false, reason: `Move ${i + 1} is out of time` }
    if (!(k === 0 ? spDeal(g) : k === 1 ? spMove(g, a, b, c) : false)) return { ok: false, reason: `Move ${i + 1} is not legal` }
    last = at
    if (g.runs >= SP_RUNS) break
  }
  return { ok: true, score: spScore(g), lastAt: Math.max(0, last), detail: { moves: moves.length, runs: g.runs } }
}
