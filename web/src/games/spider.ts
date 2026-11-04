import { GAME_DURATION_MS } from '../../../shared/pip'
import { SP_COLS, SP_MIN_GAP_MS, SP_RUNS, dealSpider, runFrom, spDeal, spMove, spScore, type SpLog } from '../../../shared/spider'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const spider: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.spider
  const g = dealSpider(ctx.m.seed!)
  const log: SpLog[] = []
  let sel: { col: number; idx: number } | null = null
  let done = false
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  const stamp = () => Math.max(now(), (log[log.length - 1]?.[4] ?? -SP_MIN_GAP_MS) + SP_MIN_GAP_MS)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Spider Solitaire</div><span class="tmr" id="tm">4:00</span></div>
  <div class="scroll" style="gap:8px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div>
  <div class="spt"><button class="btn gold sm" id="sd" style="min-height:40px;height:40px">Deal</button><span id="sr" style="font-size:14px;font-weight:700"></span></div>
  <div class="spd" id="spd"></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const board = $('#spd', ctx.root)!

  const draw = () => {
    const availH = Math.max(220, board.clientHeight || 300)
    const cardH = 46
    board.innerHTML = g.cols
      .map((col, ci) => {
        const gap = 7
        const upGap = Math.max(10, Math.min(20, (availH - cardH - col.filter((x) => !x.up).length * gap) / Math.max(1, col.filter((x) => x.up).length)))
        let y = 0
        const cards = col
          .map((c, i) => {
            const on = sel && sel.col === ci && i >= sel.idx
            const html = `<div class="sc ${c.up ? '' : 'dn'} ${on ? 'sel' : ''}" style="top:${y}px" data-c="${ci}" data-i="${i}">${c.up ? `<b>${RANK[c.r]}</b><i>♠</i>` : ''}</div>`
            y += c.up ? upGap : gap
            return html
          })
          .join('')
        return `<div class="scol" data-c="${ci}">${cards}</div>`
      })
      .join('')
    const left = Math.floor(g.stock.length / SP_COLS)
    ;($('#sd', ctx.root) as HTMLButtonElement).textContent = left ? `Deal (${left})` : 'No more deals'
    $('#sr', ctx.root)!.textContent = `${g.runs} of ${SP_RUNS} runs`
  }
  const after = () => {
    sel = null
    const s = spScore(g)
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: s })
    ctx.progress(s)
    draw()
    if (g.runs >= SP_RUNS) void end()
  }
  const doMove = (a: number, b: number, c: number) => {
    const runsBefore = g.runs
    const at = stamp()
    if (!spMove(g, a, b, c)) return false
    log.push([1, a, b, c, at])
    if (g.runs > runsBefore) {
      sfx('reward/bonus', 0.7)
      buzz(25)
    } else sfx('game/card-place', 0.5)
    after()
    return true
  }
  $('#sd', ctx.root)!.addEventListener('click', () => {
    if (done) return
    const at = stamp()
    if (!spDeal(g)) {
      sfx('ui/error', 0.3)
      buzz(25)
      return
    }
    log.push([0, 0, 0, 0, at])
    sfx('game/card-slide', 0.5)
    after()
  })
  board.addEventListener('click', (e) => {
    if (done) return
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')
    if (!t) return
    const col = Number(t.dataset.c)
    const idx = t.dataset.i === undefined ? -1 : Number(t.dataset.i)
    if (sel) {
      if (sel.col === col) {
        sel = idx >= 0 && idx !== sel.idx && runFrom(g.cols[col], idx) ? { col, idx } : null
        return draw()
      }
      if (doMove(sel.col, sel.idx, col)) return
      if (idx >= 0 && runFrom(g.cols[col], idx)) {
        sel = { col, idx }
        sfx('ui/tap', 0.3)
      } else {
        sel = null
        sfx('ui/error', 0.3)
        buzz(25)
      }
      return draw()
    }
    if (idx >= 0 && runFrom(g.cols[col], idx)) {
      sel = { col, idx }
      sfx('ui/tap', 0.3)
      draw()
    }
  })
  requestAnimationFrame(draw)
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    clk.stop()
    sfx(g.runs ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: spScore(g), time: Math.min(total, Math.max(now(), log[log.length - 1]?.[4] ?? 0)), detail: { moves: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: spScore(g) }),
    destroy: () => ((done = true), clk.stop()),
  }
}
