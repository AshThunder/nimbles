import { GAME_DURATION_MS } from '../../../shared/pip'
import { DM_DRAW, DM_MIN_GAP_MS, DM_TILES, dealDominoes, dmCanPlay, dmDraw, dmFits, dmOver, dmPlace, type DmMove } from '../../../shared/dominoes'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const tile = (id: number, cls = '', extra = '') => {
  const [a, b] = DM_TILES[id]
  return `<div class="dmt ${a === b ? 'dbl' : ''} ${cls}" ${extra}><b>${a}</b><s></s><b>${b}</b></div>`
}

export const dominoes: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.dominoes
  const g = dealDominoes(ctx.m.seed!)
  const log: DmMove[] = []
  let sel = -1
  let done = false
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  const stamp = () => Math.max(now(), (log[log.length - 1]?.[2] ?? -DM_MIN_GAP_MS) + DM_MIN_GAP_MS)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Domino Chain</div><span class="tmr" id="tm">2:00</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div>
  <div class="dmc" id="dc"></div>
  <div class="dme"><button class="btn sm" id="pl" style="height:44px;font-size:16px"></button><button class="btn sm" id="pr" style="height:44px;font-size:16px"></button></div>
  <div class="dmh" id="dh"></div>
  <button class="btn gold sm" id="dd" style="height:44px;font-size:16px"></button>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())

  const draw = () => {
    $('#dc', ctx.root)!.innerHTML = g.chain.map((id, i) => tile(id, i === 0 || i === g.chain.length - 1 ? 'end' : '')).join('')
    $('#dh', ctx.root)!.innerHTML = g.hand.map((id) => tile(id, `${dmFits(g, id) ? 'ok' : ''} ${sel === id ? 'sel' : ''}`, `data-t="${id}"`)).join('')
    const f = sel >= 0 ? dmFits(g, sel) : 0
    const L = $('#pl', ctx.root) as HTMLButtonElement
    const R = $('#pr', ctx.root) as HTMLButtonElement
    L.textContent = `◀ Left ${g.left}`
    R.textContent = `Right ${g.right} ▶`
    L.disabled = !(f & 1)
    R.disabled = !(f & 2)
    const D = $('#dd', ctx.root) as HTMLButtonElement
    D.textContent = g.yard.length ? `Draw (${g.yard.length} left)` : 'Nothing left to draw'
    D.disabled = dmCanPlay(g) || !g.yard.length
  }
  const after = () => {
    sel = -1
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: g.score })
    ctx.progress(g.score)
    draw()
    if (dmOver(g)) void end()
  }
  const place = (side: number) => {
    if (done || sel < 0) return
    const at = stamp()
    const id = sel
    if (!dmPlace(g, id, side)) return
    log.push([id, side, at])
    sfx('game/card-place', 0.5)
    after()
  }
  $('#pl', ctx.root)!.addEventListener('click', () => place(0))
  $('#pr', ctx.root)!.addEventListener('click', () => place(1))
  $('#dd', ctx.root)!.addEventListener('click', () => {
    if (done) return
    const at = stamp()
    if (!dmDraw(g)) return
    log.push([DM_DRAW, 0, at])
    sfx('game/card-slide', 0.5)
    sel = -1
    draw()
  })
  $('#dh', ctx.root)!.addEventListener('click', (e) => {
    if (done) return
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')
    if (!t) return
    const id = Number(t.dataset.t)
    const f = dmFits(g, id)
    if (!f) {
      sfx('ui/error', 0.3)
      buzz(25)
      sel = -1
      return draw()
    }
    sel = id
    sfx('ui/tap', 0.3)
    if (f === 1 || f === 2) return place(f === 1 ? 0 : 1) // only one end fits: play it
    draw()
  })
  draw()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    clk.stop()
    sfx(g.hand.length === 0 ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: g.score, time: Math.min(total, Math.max(now(), log[log.length - 1]?.[2] ?? 0)), detail: { moves: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: g.score }),
    destroy: () => ((done = true), clk.stop()),
  }
}
