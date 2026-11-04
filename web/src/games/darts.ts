import { GAME_DURATION_MS } from '../../../shared/pip'
import { DT_DARTS, DT_MIN_GAP_MS, DT_ORDER, DT_R, dartAt, dartScore } from '../../../shared/darts'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const INK = '#1F2348'
const CREAM = '#FFFCF5'
const CORAL = '#D0432E'
const GREEN = '#1F8A5B'

export const darts: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.darts
  const seed = ctx.m.seed!
  let done = false
  let score = 0
  let k = 0
  let lastThrow = -Infinity
  const log: number[] = []
  const stuck: [number, number][] = []
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Darts</div><span class="tmr" id="tm">1:00</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div>
  <div class="row" style="justify-content:space-between;font-size:14px;color:var(--ink2)"><span id="dl"></span><b id="lt" style="color:var(--ink)">Tap to throw</b></div>
  <button class="btn gold block" id="th" style="min-height:52px">Throw</button>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 340, 340)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = W * dpr
  cv.style.width = W + 'px'
  cv.style.height = W + 'px'
  g.scale(dpr, dpr)
  const C = W / 2
  const R = W / 2 - 22 // board radius in px
  const px = (v: number) => C + v * R

  const ring = (r: number, col: string) => {
    g.beginPath()
    g.arc(C, C, r * R, 0, Math.PI * 2)
    g.fillStyle = col
    g.fill()
  }
  const wedge = (i: number, r0: number, r1: number, col: string) => {
    const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10)
    g.beginPath()
    g.arc(C, C, r1 * R, a0, a0 + Math.PI / 10)
    g.arc(C, C, r0 * R, a0 + Math.PI / 10, a0, true)
    g.closePath()
    g.fillStyle = col
    g.fill()
  }
  const board = () => {
    ring(1.16, INK)
    for (let i = 0; i < 20; i++) {
      const dark = i % 2 === 0
      wedge(i, DT_R.outerBull, DT_R.doubleIn, dark ? INK : CREAM)
      wedge(i, DT_R.doubleIn, DT_R.board, dark ? CORAL : GREEN)
      wedge(i, DT_R.trebleIn, DT_R.trebleOut, dark ? CORAL : GREEN)
    }
    ring(DT_R.outerBull, GREEN)
    ring(DT_R.bull, CORAL)
    g.fillStyle = CREAM
    g.font = `700 13px 'Bricolage Grotesque', sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + i * (Math.PI / 10)
      g.fillText(String(DT_ORDER[i]), C + Math.cos(a) * R * 1.09, C + Math.sin(a) * R * 1.09)
    }
  }
  const draw = (t: number) => {
    g.clearRect(0, 0, W, W)
    board()
    for (const [x, y] of stuck) {
      g.beginPath()
      g.arc(px(x), px(y), 5, 0, Math.PI * 2)
      g.fillStyle = '#F4B323'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = INK
      g.stroke()
    }
    if (k < DT_DARTS) {
      const [x, y] = dartAt(seed, k, t)
      const X = px(x)
      const Y = px(y)
      g.strokeStyle = INK
      g.lineWidth = 3
      g.beginPath()
      g.arc(X, Y, 13, 0, Math.PI * 2)
      g.moveTo(X - 21, Y)
      g.lineTo(X - 7, Y)
      g.moveTo(X + 7, Y)
      g.lineTo(X + 21, Y)
      g.moveTo(X, Y - 21)
      g.lineTo(X, Y - 7)
      g.moveTo(X, Y + 7)
      g.lineTo(X, Y + 21)
      g.stroke()
      g.strokeStyle = '#F4B323'
      g.lineWidth = 1.5
      g.stroke()
    }
  }
  const hud = () => {
    $('#dl', ctx.root)!.textContent = `${DT_DARTS - k} dart${DT_DARTS - k === 1 ? '' : 's'} left`
  }
  const throwDart = () => {
    if (done || k >= DT_DARTS) return
    const t = now()
    if (t - lastThrow < DT_MIN_GAP_MS) return
    lastThrow = t
    const [x, y] = dartAt(seed, k, t)
    const h = dartScore(x, y)
    log.push(t)
    stuck.push([x, y])
    k++
    score += h.score
    $('#lt', ctx.root)!.textContent = h.score ? `${h.label}  +${h.score}` : 'Miss'
    sfx(h.score >= 40 ? 'reward/bonus' : h.score ? 'game/bubble-pop' : 'ui/wrong', 0.6)
    buzz(h.score ? 14 : 28)
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: score })
    ctx.progress(score)
    hud()
    if (k >= DT_DARTS) setTimeout(() => void end(), 900)
  }
  cv.addEventListener('pointerdown', throwDart)
  $('#th', ctx.root)!.addEventListener('click', throwDart)

  let raf = 0
  const frame = () => {
    draw(now())
    if (!done) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  hud()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    clk.stop()
    sfx('reward/win-big')
    await ctx.finish({ score, time: Math.min(total, now()), detail: { throws: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: score }),
    destroy: () => {
      done = true
      cancelAnimationFrame(raf)
      clk.stop()
    },
  }
}
