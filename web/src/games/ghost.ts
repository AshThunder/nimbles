import { GH_GAP_MS, GH_GHOST_PACE, GH_MS, GH_STEP, ghNew, ghRowAt, ghSpeed, ghStep, ghTrack, type GhEvent } from '../../../shared/ghost'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const INK = '#1F2348'
const CREAM = '#FFFCF5'
const SAND = '#ECE5D5'
const CORAL = '#D0432E'
const GOLD = '#F4B323'

export const ghost: GameMod = (ctx) => {
  const rows = ghTrack(ctx.m.seed!)
  const g = ghNew()
  const log: GhEvent[] = []
  let done = false
  let lastMove = -1000
  let acc = 0
  let prevHits = 0
  let flash = 0
  let lastTs = performance.now()

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Ghost Race</div><span class="tmr" id="tm">0:45</span></div>
  <div class="scroll" style="gap:8px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div>
  <div class="row" style="justify-content:space-between;font-size:14px;color:var(--ink2)"><span id="gd"></span><b id="lt" style="color:var(--ink)"></b></div>
  <div class="row" style="gap:10px"><button class="btn gold" id="gl" style="flex:1;min-height:56px">◀ Left</button><button class="btn gold" id="gr" style="flex:1;min-height:56px">Right ▶</button></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const c = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 340, 340)
  const H = Math.round(W * 0.9)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  c.scale(dpr, dpr)
  const LW = W / 3
  const PY = H * 0.8
  const PPU = PY / 22 // pixels per track unit
  // the ghost covers a fixed share of what a clean run covers
  const ghostAt = (t: number) => GH_GHOST_PACE * (9 * (t / 1000) + 0.075 * (t / 1000) ** 2)
  const sq = (x: number, y: number, w: number, h: number, fill: string) => {
    c.fillStyle = fill
    c.beginPath()
    c.roundRect(x, y, w, h, 8)
    c.fill()
    c.lineWidth = 2.5
    c.strokeStyle = INK
    c.stroke()
  }
  const draw = () => {
    c.clearRect(0, 0, W, H)
    c.fillStyle = CREAM
    c.fillRect(0, 0, W, H)
    c.strokeStyle = SAND
    c.lineWidth = 2
    c.setLineDash([10, 10])
    for (let i = 1; i < 3; i++) {
      c.beginPath()
      c.moveTo(i * LW, 0)
      c.lineTo(i * LW, H)
      c.stroke()
    }
    c.setLineDash([])
    for (let i = g.next - 1; i < rows.length; i++) {
      if (i < 0) continue
      const y = PY - (ghRowAt(i) - g.d) * PPU
      if (y < -30) break
      if (y > H + 30) continue
      for (let l = 0; l < 3; l++) if (rows[i] & (1 << l)) sq(l * LW + 10, y - 14, LW - 20, 28, CORAL)
    }
    const gd = ghostAt(g.t)
    const gy = PY - (gd - g.d) * PPU
    if (gy > -20 && gy < H + 20) {
      c.globalAlpha = 0.45
      sq(1 * LW + LW / 2 - 18, gy - 18, 36, 36, '#8A87A8')
      c.globalAlpha = 1
    }
    const stunned = g.t < g.stun
    const px = g.lane * LW + LW / 2
    sq(px - 20, PY - 20 + (stunned ? 3 : 0), 40, 40, stunned ? '#FFFFFF' : GOLD)
    const gap = Math.round(g.d - gd)
    $('#gd', ctx.root)!.textContent = `${Math.floor(g.d)} m · ghost ${gap >= 0 ? 'behind ' + gap : 'ahead ' + -gap} m`
    $('#lt', ctx.root)!.textContent = flash > performance.now() ? 'Bump!' : `${(ghSpeed(g.t) * 3.6).toFixed(0)} km/h`
  }

  const move = (dir: -1 | 1) => {
    if (done || g.t - lastMove < GH_GAP_MS) return
    const lane = Math.min(2, Math.max(0, g.lane + dir))
    if (lane === g.lane) return
    g.lane = lane
    lastMove = g.t
    log.push([lane, g.t])
    sfx('ui/tap', 0.25)
  }
  $('#gl', ctx.root)!.addEventListener('click', () => move(-1))
  $('#gr', ctx.root)!.addEventListener('click', () => move(1))
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect()
    move(e.clientX - r.left < r.width / 2 ? -1 : 1)
  })

  let raf = 0
  const loop = () => {
    if (done) return
    const t = performance.now()
    acc += Math.min(250, t - lastTs)
    lastTs = t
    while (acc >= GH_STEP && g.t < GH_MS) {
      acc -= GH_STEP
      ghStep(g, rows)
      if (g.hits > prevHits) {
        prevHits = g.hits
        flash = performance.now() + 500
        sfx('ui/error', 0.35)
        buzz(40)
      }
    }
    const sc = Math.floor(g.d)
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: sc })
    ctx.progress(sc)
    draw()
    if (g.t >= GH_MS) return void end()
    raf = requestAnimationFrame(loop)
  }
  loop()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), GH_MS)
  const end = async () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    clk.stop()
    while (g.t < GH_MS) ghStep(g, rows) // a runner who stopped tapping keeps their lane to the end
    const sc = Math.floor(g.d)
    sfx(g.hits <= 4 ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: sc, time: GH_MS, detail: { run: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: Math.floor(g.d) }),
    destroy: () => ((done = true), cancelAnimationFrame(raf), clk.stop()),
  }
}
