import { GAME_DURATION_MS } from '../../../shared/pip'
import { BZ_CARDS, BZ_MIN_GAP_MS, BZ_PER, BZ_STACKS, bzDeal, bzRank, bzScore, bzStackScore, bzTotal, type BzMove } from '../../../shared/blitz'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const RK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUIT = ['♠', '♥', '♦', '♣']
const card = (id: number, cls = '') => `<div class="bzc ${Math.floor(id / 13) === 1 || Math.floor(id / 13) === 2 ? 'red' : ''} ${cls}"><b>${RK[bzRank(id)]}</b><i>${SUIT[Math.floor(id / 13)]}</i></div>`

export const blitz: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.blitz
  const deck = bzDeal(ctx.m.seed!)
  const stacks: number[][] = Array.from({ length: BZ_STACKS }, () => [])
  const log: BzMove[] = []
  let done = false
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">21 Blitz</div><span class="tmr" id="tm">1:30</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div>
  <div class="bzn"><div><small>Place this card</small><div id="bn"></div></div><div><small>Next</small><div id="bx"></div></div><div class="bzl"><b id="bl"></b><small>cards left</small></div></div>
  <div class="bzs" id="bs"></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())

  const draw = () => {
    const i = log.length
    $('#bn', ctx.root)!.innerHTML = i < BZ_CARDS ? card(deck[i], 'big') : ''
    $('#bx', ctx.root)!.innerHTML = i + 1 < BZ_CARDS ? card(deck[i + 1]) : ''
    $('#bl', ctx.root)!.textContent = String(BZ_CARDS - i)
    $('#bs', ctx.root)!.innerHTML = stacks
      .map((s, k) => {
        const t = bzTotal(s)
        const pts = bzStackScore(s)
        const full = s.length >= BZ_PER
        return `<button class="bzk ${t.total > 21 ? 'bust' : ''} ${full ? 'full' : ''}" data-s="${k}" ${full || i >= BZ_CARDS ? 'disabled' : ''}>
          <div class="bzh">${s.length ? (t.total > 21 ? 'Bust' : t.total) : '·'}<small>${s.length ? `${pts} pts` : ''}</small></div>
          <div class="bzcol">${s.map((id) => card(id, 'sm')).join('')}</div></button>`
      })
      .join('')
  }
  const end = async () => {
    if (done) return
    done = true
    clk.stop()
    const sc = bzScore(stacks)
    sfx(sc >= 200 ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: sc, time: Math.min(total, Math.max(now(), log[log.length - 1]?.[1] ?? 0)), detail: { moves: log } })
  }
  $('#bs', ctx.root)!.addEventListener('click', (e) => {
    if (done) return
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-s]')
    if (!t) return
    const k = Number(t.dataset.s)
    const i = log.length
    if (i >= BZ_CARDS || stacks[k].length >= BZ_PER) return
    const at = Math.max(now(), (log[i - 1]?.[1] ?? -BZ_MIN_GAP_MS) + BZ_MIN_GAP_MS)
    stacks[k].push(deck[i])
    log.push([k, at])
    sfx('game/card-place', 0.5)
    if (bzTotal(stacks[k]).total > 21) buzz(25)
    const sc = bzScore(stacks)
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: sc })
    ctx.progress(sc)
    draw()
    if (log.length >= BZ_CARDS) setTimeout(() => void end(), 700)
  })
  draw()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: bzScore(stacks) }),
    destroy: () => ((done = true), clk.stop()),
  }
}
