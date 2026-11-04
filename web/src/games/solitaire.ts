import { dealKlondike, canStack, canFound, cardId, type Card } from '../../../shared/puzzles'
import { GAME_DURATION_MS } from '../../../shared/pip'
import { sfx, buzz, $ } from '../lib'
import { clock, strip, setScores, type GameMod } from './common'

type Sel = { from: 'waste' } | { from: 'tab'; col: number; idx: number }

export const solitaire: GameMod = (ctx) => {
  const m0 = ctx.m
  const g = dealKlondike(m0.seed!)
  const total = GAME_DURATION_MS.solitaire
  let sel: Sel | null = null
  let done = false
  let moves = 0
  const score = () => g.found.reduce((s, p) => s + p.length, 0) * 10
  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Solitaire Duel</div><span class="tmr" id="tm">3:00</span></div>
  <div class="scroll" style="gap:10px">${strip(m0, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="sol" id="sol"></div></div>`
  const clk = clock(m0, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)

  const imgOf = (c: Card) => `<img src="/cards/faces/${cardId(c)}.svg" alt="${cardId(c).replace('-', ' of ')}" draggable="false">`
  const isSelTab = (col: number, i: number) => sel?.from === 'tab' && sel.col === col && i >= sel.idx
  const draw = () => {
    const wasteTop = g.waste[g.waste.length - 1]
    const top = `<div class="top2">
      <button class="slot" data-a="stock" aria-label="Draw card">${g.stock.length ? '<div class="pcard dn" style="position:relative;inset:0;width:100%;height:100%"></div>' : '<img src="/cards/slot-empty.svg" alt="Recycle">'}</button>
      <button class="slot ${sel?.from === 'waste' ? 'sel' : ''}" data-a="waste" aria-label="Waste">${wasteTop ? imgOf(wasteTop) : ''}</button>
      ${g.found.map((p, i) => `<button class="slot" data-a="found" data-i="${i}" aria-label="Foundation ${i + 1}">${p.length ? imgOf(p[p.length - 1]) : '<img src="/cards/slot-empty.svg" alt="" style="opacity:.5">'}</button>`).join('')}
    </div>`
    const tab = `<div class="tab7">${g.tab
      .map((col, ci) => {
        let y = 0
        const cards = col
          .map((t, i) => {
            const html = `<div class="pcard ${t.up ? '' : 'dn'} ${isSelTab(ci, i) ? 'sel' : ''}" style="top:${y}px" data-a="card" data-c="${ci}" data-i="${i}">${t.up ? imgOf(t.card) : ''}</div>`
            y += t.up ? 22 : 10
            return html
          })
          .join('')
        return `<div class="col" data-a="col" data-c="${ci}" style="min-height:${y + 70}px"><div class="slot" style="position:absolute;inset:0 0 auto 0"></div>${cards}</div>`
      })
      .join('')}</div>`
    $('#sol', ctx.root)!.innerHTML = top + tab
  }

  const cardsOf = (s: Sel): Card[] => (s.from === 'waste' ? [g.waste[g.waste.length - 1]] : g.tab[s.col].slice(s.idx).map((t) => t.card))
  const take = (s: Sel) => {
    if (s.from === 'waste') g.waste.pop()
    else {
      g.tab[s.col].splice(s.idx)
      const t = g.tab[s.col][g.tab[s.col].length - 1]
      if (t && !t.up) t.up = true
    }
  }
  const afterMove = () => {
    moves++
    sel = null
    const s = score()
    setScores(ctx.root, m0, ctx.me, { [ctx.me]: s })
    ctx.progress(s)
    draw()
    if (s >= 520) void end()
  }
  const toTab = (col: number): boolean => {
    if (!sel) return false
    const cs = cardsOf(sel)
    if (!cs[0]) return false
    const t = g.tab[col]
    const topc = t.length ? t[t.length - 1] : undefined
    if (topc && !topc.up) return false
    if (sel.from === 'tab' && sel.col === col) return false
    if (!canStack(topc?.card, cs[0])) return false
    const s = sel
    take(s)
    for (const c of cs) g.tab[col].push({ card: c, up: true })
    sfx('game/card-place', 0.5)
    afterMove()
    return true
  }
  const toFound = (p: number): boolean => {
    if (!sel) return false
    const cs = cardsOf(sel)
    if (cs.length !== 1 || !cs[0] || !canFound(g.found[p], cs[0])) return false
    take(sel)
    g.found[p].push(cs[0])
    sfx('reward/coin', 0.35)
    buzz(15)
    afterMove()
    return true
  }
  const autoFound = () => {
    if (!sel) return false
    const c = cardsOf(sel)
    if (c.length !== 1) return false
    const order = [...g.found.keys()].sort((a, b) => g.found[b].length - g.found[a].length)
    for (const p of order) if (canFound(g.found[p], c[0])) return toFound(p)
    return false
  }
  const bad = () => (sfx('ui/error', 0.3), buzz(25), (sel = null), draw())

  ctx.root.addEventListener('click', (e) => {
    if (done) return
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
    if (!t) return
    const a = t.dataset.a
    if (a === 'stock') {
      sel = null
      if (g.stock.length) g.waste.push(g.stock.pop()!)
      else if (g.waste.length) {
        g.stock = g.waste.reverse()
        g.waste = []
      }
      sfx('game/card-slide', 0.4)
      return draw()
    }
    if (a === 'waste') {
      if (!g.waste.length) return
      if (sel?.from === 'waste') return void (autoFound() || bad())
      sel = { from: 'waste' }
      sfx('ui/tap', 0.3)
      return draw()
    }
    if (a === 'found') {
      if (!sel) return
      return void (toFound(Number(t.dataset.i)) || bad())
    }
    if (a === 'card' || a === 'col') {
      const col = Number(t.dataset.c)
      const idx = a === 'card' ? Number(t.dataset.i) : -1
      const tile = idx >= 0 ? g.tab[col][idx] : undefined
      if (sel) {
        if (sel.from === 'tab' && sel.col === col && tile?.up) {
          if (sel.idx === idx && idx === g.tab[col].length - 1) return void (autoFound() || bad())
          sel = { from: 'tab', col, idx }
          return draw()
        }
        if (toTab(col)) return
        if (tile?.up) {
          sel = { from: 'tab', col, idx }
          sfx('ui/tap', 0.3)
          return draw()
        }
        return bad()
      }
      if (tile?.up) {
        sel = { from: 'tab', col, idx }
        sfx('ui/tap', 0.3)
        draw()
      }
    }
  })
  draw()

  const end = async () => {
    if (done) return
    done = true
    clk.stop()
    const s = score()
    sfx(s >= 520 ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: s, time: total - clk.left(), detail: { moves } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: score() }),
    destroy: () => ((done = true), clk.stop()),
  }
}
