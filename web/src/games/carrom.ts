import { GAME_DURATION_MS } from '../../../shared/pip'
import { CR_BASE_Y, CR_MAX_STEPS, CR_MIN_GAP_MS, CR_POCKET, CR_R, CR_SR, CR_STEP, CR_STRIKES, crLaunch, crNew, crRest, crStep, type CrShot } from '../../../shared/carrom'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const INK = '#1F2348'
const CREAM = '#FFFCF5'
const WOOD = '#E8CE9A'
const CORAL = '#D0432E'
const GOLD = '#F4B323'

export const carrom: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.carrom
  const g0 = crNew(ctx.m.seed!)
  const log: CrShot[] = []
  let done = false
  let moving = false
  let acc = 0
  let steps = 0
  let last = 0
  let before = 0
  let aimX = 0.5
  let aimY = 0.35
  let sxm = 500
  let power = 60
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Carrom</div><span class="tmr" id="tm">2:30</span></div>
  <div class="scroll" style="gap:8px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div>
  <div class="row" style="justify-content:space-between;font-size:14px;color:var(--ink2)"><span id="cl"></span><b id="lt" style="color:var(--ink)">Tap the board to aim</b></div>
  <label class="crs"><span>Place</span><input type="range" id="sx" min="200" max="800" value="500"></label>
  <label class="crs"><span>Power</span><input type="range" id="pw" min="10" max="100" value="60"></label>
  <button class="btn gold block" id="sh" style="min-height:52px">Strike</button>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const c = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 340, 328)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = W * dpr
  cv.style.width = W + 'px'
  cv.style.height = W + 'px'
  c.scale(dpr, dpr)
  const P = (v: number) => v * W

  const disc = (x: number, y: number, r: number, fill: string, ring = INK) => {
    c.beginPath()
    c.arc(P(x), P(y), P(r), 0, Math.PI * 2)
    c.fillStyle = fill
    c.fill()
    c.lineWidth = 2
    c.strokeStyle = ring
    c.stroke()
  }
  const draw = () => {
    c.clearRect(0, 0, W, W)
    c.fillStyle = WOOD
    c.fillRect(0, 0, W, W)
    c.lineWidth = 4
    c.strokeStyle = INK
    c.strokeRect(2, 2, W - 4, W - 4)
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      c.beginPath()
      c.arc(P(x), P(y), P(CR_POCKET * 0.8), 0, Math.PI * 2)
      c.fillStyle = INK
      c.fill()
    }
    c.beginPath()
    c.arc(P(0.5), P(0.5), P(0.1), 0, Math.PI * 2)
    c.lineWidth = 1.5
    c.stroke()
    c.beginPath()
    c.moveTo(P(0.2), P(CR_BASE_Y))
    c.lineTo(P(0.8), P(CR_BASE_Y))
    c.stroke()
    for (const k of g0.coins) if (k.alive) disc(k.x, k.y, CR_R, k.kind === 2 ? CORAL : k.kind === 0 ? CREAM : INK, k.kind === 1 ? CREAM : INK)
    const sx = moving ? g0.sx : sxm / 1000
    const sy = moving ? g0.sy : CR_BASE_Y
    if (!moving && !done && log.length < CR_STRIKES) {
      c.setLineDash([6, 6])
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(P(sx), P(sy))
      const dx = aimX - sx
      const dy = aimY - sy
      const l = Math.sqrt(dx * dx + dy * dy) || 1
      c.lineTo(P(sx + (dx / l) * 0.7), P(sy + (dy / l) * 0.7))
      c.stroke()
      c.setLineDash([])
    }
    if (g0.sAlive || !moving) disc(sx, sy, CR_SR, GOLD)
    if (!moving && !done && log.length < CR_STRIKES) disc(aimX, aimY, 0.012, CORAL)
  }
  const hud = () => {
    $('#cl', ctx.root)!.textContent = `${CR_STRIKES - log.length} strike${CR_STRIKES - log.length === 1 ? '' : 's'} left`
    ;($('#sh', ctx.root) as HTMLButtonElement).disabled = moving || done || log.length >= CR_STRIKES
  }

  const aimAt = (clientX: number, clientY: number) => {
    const r = cv.getBoundingClientRect()
    aimX = Math.min(0.98, Math.max(0.02, (clientX - r.left) / r.width))
    aimY = Math.min(0.98, Math.max(0.02, (clientY - r.top) / r.height))
    draw()
  }
  cv.addEventListener('pointerdown', (e) => !moving && aimAt(e.clientX, e.clientY))
  cv.addEventListener('pointermove', (e) => e.buttons && !moving && aimAt(e.clientX, e.clientY))
  $('#sx', ctx.root)!.addEventListener('input', (e) => ((sxm = Number((e.target as HTMLInputElement).value)), draw()))
  $('#pw', ctx.root)!.addEventListener('input', (e) => (power = Number((e.target as HTMLInputElement).value)))

  const shoot = () => {
    if (moving || done || log.length >= CR_STRIKES) return
    const at = now()
    if (log.length && at < log[log.length - 1][4] + CR_MIN_GAP_MS) return
    let ax = aimX - sxm / 1000
    let ay = aimY - CR_BASE_Y
    const l = Math.sqrt(ax * ax + ay * ay) || 1
    let nx = Math.round((ax / l) * 1000)
    let ny = Math.round((ay / l) * 1000)
    if (ny > -100) {
      ny = -100
      nx = nx < 0 ? -995 : 995
    }
    const shot: CrShot = [sxm, nx, ny, power, at]
    log.push(shot)
    before = g0.score
    crLaunch(g0, shot)
    steps = 0
    acc = 0
    last = performance.now()
    moving = true
    sfx('ui/tap', 0.4)
    $('#lt', ctx.root)!.textContent = ''
    hud()
  }
  $('#sh', ctx.root)!.addEventListener('click', shoot)

  let raf = 0
  const loop = () => {
    if (done) return
    if (moving) {
      const t = performance.now()
      acc += Math.min(0.1, (t - last) / 1000) * CR_STEP
      last = t
      while (acc >= 1 && moving) {
        acc--
        const was = g0.score
        const more = crStep(g0)
        steps++
        if (g0.score > was) (sfx('reward/coin', 0.4), buzz(20))
        if (!more || steps >= CR_MAX_STEPS) {
          crRest(g0)
          moving = false
        }
      }
      if (!moving) settle()
    }
    draw()
    raf = requestAnimationFrame(loop)
  }
  const settle = () => {
    const gain = g0.score - before
    $('#lt', ctx.root)!.textContent = gain > 0 ? `+${gain}` : gain < 0 ? 'Foul' : 'Tap the board to aim'
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: g0.score })
    ctx.progress(g0.score)
    hud()
    if (log.length >= CR_STRIKES || g0.coins.every((k) => !k.alive)) setTimeout(() => void end(), 700)
  }
  hud()
  loop()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    clk.stop()
    sfx(g0.score >= 90 ? 'reward/win-big' : 'reward/lose')
    // a strike still rolling when time ran out does not count
    const sent = moving ? log.slice(0, -1) : log
    let score = g0.score
    if (moving) {
      const g1 = crNew(ctx.m.seed!)
      for (const s of sent) {
        crLaunch(g1, s)
        let n = 0
        while (crStep(g1) && n++ < CR_MAX_STEPS);
        crRest(g1)
      }
      score = g1.score
    }
    await ctx.finish({ score, time: Math.min(total, sent.length ? Math.max(now(), sent[sent.length - 1][4]) : now()), detail: { shots: sent } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: g0.score }),
    destroy: () => ((done = true), cancelAnimationFrame(raf), clk.stop()),
  }
}
