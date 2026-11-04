import { esc, ic, sfx, buzz, $, $$ } from '../lib'
import { makeSudoku } from '../../../shared/puzzles'
import { GAME_DURATION_MS } from '../../../shared/pip'
import { clock, strip, setScores, type GameMod } from './common'

export type Board = {
  grid: number[]
  conflicts(): Set<number>
  filledCorrect(): number
  solved(): boolean
  destroy(): void
}

/** Renders a sudoku into `host`. `solution` (optional) lets the caller count correct entries. */
export function board(host: HTMLElement, size: 4 | 9, puzzle: number[], solution: number[] | undefined, onChange: (b: Board, cell: number) => void): Board {
  const grid = puzzle.slice()
  const fixed = puzzle.map((v) => v !== 0)
  const box = size === 9 ? 3 : 2
  let sel = grid.findIndex((_, i) => !fixed[i])
  const conflicts = () => {
    const bad = new Set<number>()
    const groups: number[][] = []
    for (let i = 0; i < size; i++) {
      groups.push(Array.from({ length: size }, (_, k) => i * size + k))
      groups.push(Array.from({ length: size }, (_, k) => k * size + i))
    }
    for (let br = 0; br < size; br += box) for (let bc = 0; bc < size; bc += box) {
      const g: number[] = []
      for (let r = 0; r < box; r++) for (let c = 0; c < box; c++) g.push((br + r) * size + bc + c)
      groups.push(g)
    }
    for (const g of groups) {
      const seen = new Map<number, number>()
      for (const i of g) {
        const v = grid[i]
        if (!v) continue
        if (seen.has(v)) {
          bad.add(i)
          bad.add(seen.get(v)!)
        } else seen.set(v, i)
      }
    }
    if (solution) grid.forEach((v, i) => v && !fixed[i] && v !== solution[i] && bad.add(i))
    return bad
  }
  const api: Board = {
    grid,
    conflicts,
    filledCorrect: () => grid.reduce((s, v, i) => s + (!fixed[i] && v !== 0 && (!solution || v === solution[i]) ? 1 : 0), 0),
    solved: () => grid.every((v) => v) && conflicts().size === 0,
    destroy: () => (host.innerHTML = ''),
  }
  const draw = () => {
    const bad = conflicts()
    const sv = sel >= 0 ? grid[sel] : 0
    host.innerHTML = `<div class="sdk n${size}" style="grid-template-columns:repeat(${size},1fr)" role="grid">${grid
      .map((v, i) => {
        const r = Math.floor(i / size), c = i % size
        const cls = ['cell', fixed[i] ? 'fix' : v ? 'mine' : '', i === sel ? 'sel' : sv && v === sv ? 'same' : '', bad.has(i) ? 'bad' : '', (c + 1) % box === 0 && c < size - 1 ? 'bR' : '', (r + 1) % box === 0 && r < size - 1 ? 'bB' : '']
        return `<div class="${cls.filter(Boolean).join(' ')}" data-i="${i}" role="gridcell" aria-label="row ${r + 1} column ${c + 1}${v ? ' ' + v : ' empty'}">${v || ''}</div>`
      })
      .join('')}</div>
      <div class="pad n${size}">${Array.from({ length: size }, (_, k) => `<button class="key" data-n="${k + 1}">${k + 1}</button>`).join('')}<button class="key" data-n="0" aria-label="Erase">${ic('delete', 's20')}</button></div>`
  }
  draw()
  host.onclick = (e) => {
    const t = e.target as HTMLElement
    const cell = t.closest<HTMLElement>('.cell')
    if (cell) {
      sel = Number(cell.dataset.i)
      sfx('ui/tap', 0.3)
      return draw()
    }
    const key = t.closest<HTMLElement>('.key')
    if (key && sel >= 0 && !fixed[sel]) {
      const n = Number(key.dataset.n)
      grid[sel] = n
      if (n) {
        const wrong = conflicts().has(sel)
        sfx(wrong ? 'ui/wrong' : 'ui/tap', wrong ? 0.4 : 0.5)
        if (wrong) buzz(30)
      }
      draw()
      onChange(api, sel)
    }
  }
  return api
}

/** Duel version: 9x9 Sudoku or the Last Bite 4x4 sprint. Same puzzle from the shared seed. */
export const sudokuGame = (size: 4 | 9): GameMod => (ctx) => {
  const m0 = ctx.m
  const pz = makeSudoku(m0.seed!, size)
  const total = GAME_DURATION_MS[m0.game]
  const per = size === 9 ? 1 : 10
  const bonus = size === 9 ? 50 : 50
  let done = false
  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">${size === 9 ? 'Sudoku' : 'Last Bite sprint'}</div><span class="tmr" id="tm">0:00</span></div>
  <div class="scroll" style="gap:12px">${strip(m0, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div id="bd" style="display:flex;flex-direction:column;gap:14px"></div></div>`
  const clk = clock(m0, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(false), total)
  const score = (b: Board, solved: boolean) => b.filledCorrect() * per + (solved ? bonus + Math.floor(clk.left() / 1000) : 0)
  let last = 0
  const bd = board($('#bd', ctx.root)!, size, pz.puzzle, pz.solution, (b) => {
    const s = score(b, false)
    setScores(ctx.root, m0, ctx.me, { [ctx.me]: s })
    if (Date.now() - last > 1500) ((last = Date.now()), ctx.progress(s))
    if (b.solved()) void end(true)
  })
  const end = async (solved: boolean) => {
    if (done) return
    done = true
    clk.stop()
    const s = score(bd, solved)
    sfx(solved ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: s, time: total - clk.left(), detail: { solved, grid: bd.grid, correct: bd.filledCorrect() } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: score(bd, false) }),
    destroy: () => {
      done = true
      clk.stop()
    },
  }
}
export { esc, $$ }
