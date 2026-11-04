import { GAME_DURATION_MS } from '../../../shared/pip'
import { BubbleGame, BS_COLS, BS_ROWS, BS_LOSE_ROW, BS_PUSH_EVERY, BS_SY, BS_SX, quantizeAngle, type BsShot } from '../../../shared/bubblesim'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const COLS = BS_COLS
const ROWS = BS_ROWS
const LOSE_ROW = BS_LOSE_ROW
const PUSH_EVERY = BS_PUSH_EVERY
const COLORS = ['#1F78C4', '#D0432E', '#1F8A5B', '#F4B323', '#F29AAE']
const NAVY = '#1F2348'

export const bubble: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.bubble
  const game = new BubbleGame(ctx.m.seed!)
  const grid = game.grid
  let done = false
  let score = 0
  const log: BsShot[] = []
  const t0 = Date.now()
  const colsIn = (r: number) => game.colsIn(r)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Bubble Shooter</div><span class="tmr" id="tm">1:30</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div><div class="row" style="justify-content:space-between;font-size:13px;color:var(--ink2)"><span id="nx"></span><span class="mono" id="pp"></span></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g2 = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 358, 420)
  const R = W / (COLS * 2)
  const U = R // px per board unit
  const H = Math.round(R * (BS_SY + 2.2))
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  g2.scale(dpr, dpr)
  const SX = BS_SX * U
  const SY = BS_SY * U

  const cx = (r: number, c: number) => game.cx(r, c) * U
  const cy = (r: number) => game.cy(r) * U
  const present = () => game.present()
  let aim = -Math.PI / 2
  let shot: { path: [number, number][]; i: number; cell: [number, number] | null; x: number; y: number; c: number } | null = null
  let aiming = false
  const flying: { x: number; y: number; vy: number; c: number; a: number }[] = []
  const bursts: { x: number; y: number; vx: number; vy: number; c: number; a: number }[] = []

  const circle = (x: number, y: number, c: number, r = R) => {
    g2.beginPath()
    g2.arc(x, y, r - 1.5, 0, Math.PI * 2)
    g2.fillStyle = COLORS[c]
    g2.fill()
    g2.lineWidth = 2
    g2.strokeStyle = NAVY
    g2.stroke()
    g2.beginPath()
    g2.arc(x - r * 0.3, y - r * 0.3, r * 0.2, 0, Math.PI * 2)
    g2.fillStyle = 'rgba(255,252,245,.55)'
    g2.fill()
  }
  const draw = () => {
    g2.clearRect(0, 0, W, H)
    // danger line
    g2.strokeStyle = 'rgba(208,67,46,.5)'
    g2.setLineDash([6, 6])
    g2.lineWidth = 2
    g2.beginPath()
    g2.moveTo(0, cy(LOSE_ROW) - R)
    g2.lineTo(W, cy(LOSE_ROW) - R)
    g2.stroke()
    g2.setLineDash([])
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < colsIn(r); c++) if (grid[r][c] >= 0) circle(cx(r, c), cy(r), grid[r][c])
    for (const f of flying) circle(f.x, f.y, f.c)
    for (const b of bursts) {
      g2.globalAlpha = Math.max(0, b.a)
      g2.beginPath()
      g2.arc(b.x, b.y, 4, 0, 7)
      g2.fillStyle = COLORS[b.c]
      g2.fill()
      g2.globalAlpha = 1
    }
    if (aiming && !shot) {
      g2.fillStyle = NAVY
      for (let i = 1; i < 14; i++) {
        let x = SX + Math.cos(aim) * i * R * 1.6
        const y = SY + Math.sin(aim) * i * R * 1.6
        if (x < 0 || x > W) x = x < 0 ? -x : 2 * W - x
        g2.globalAlpha = 1 - i / 15
        g2.beginPath()
        g2.arc(x, y, 2.5, 0, 7)
        g2.fill()
      }
      g2.globalAlpha = 1
    }
    if (shot) circle(shot.x, shot.y, shot.c)
    else circle(SX, SY, game.cur)
    circle(SX - R * 3.2, SY + R * 0.6, game.nxt, R * 0.7)
  }
  const hud = () => {
    $('#nx', ctx.root)!.textContent = `New row in ${PUSH_EVERY - (game.shots % PUSH_EVERY)} shot${PUSH_EVERY - (game.shots % PUSH_EVERY) === 1 ? '' : 's'}`
    $('#pp', ctx.root)!.textContent = `${game.popped} popped`
  }
  const award = () => {
    score = game.score
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: score })
    ctx.progress(score)
  }
  const land = () => {
    const s = shot!
    shot = null
    const ev = game.commit(s.cell)
    for (const [a, b, c] of ev.popped) burst(a, b, c)
    if (ev.popped.length) {
      sfx('game/bubble-pop')
      buzz(12)
    } else sfx('game/bubble-shoot', 0.4)
    for (const [a, b, c] of ev.dropped) flying.push({ x: cx(a, b), y: cy(a), vy: 1 + Math.random() * 2, c, a: 1 })
    if (ev.dropped.length) sfx('reward/coin', 0.6)
    if (ev.cleared) sfx('reward/bonus')
    if (ev.pushed) sfx('game/card-slide', 0.5)
    if (ev.gained) award()
    hud()
    if (game.over) void end()
  }
  const burst = (r: number, c: number, col: number) => {
    for (let i = 0; i < 4; i++) bursts.push({ x: cx(r, c), y: cy(r), vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.8) * 5, c: col, a: 1 })
  }
  const aimAt = (e: PointerEvent) => {
    const b = cv.getBoundingClientRect()
    const dx = ((e.clientX - b.left) / b.width) * W - SX
    const dy = ((e.clientY - b.top) / b.height) * H - SY
    let a = Math.atan2(dy, dx)
    const lim = 0.2
    if (a > 0) a = dx >= 0 ? -lim : -Math.PI + lim
    a = Math.min(-lim, Math.max(-Math.PI + lim, a))
    aim = a
  }
  cv.addEventListener('pointerdown', (e) => {
    if (done || shot) return
    cv.setPointerCapture(e.pointerId)
    aiming = true
    aimAt(e)
  })
  cv.addEventListener('pointermove', (e) => aiming && aimAt(e))
  cv.addEventListener('pointerup', () => {
    if (!aiming || done || shot) return
    aiming = false
    const aq = quantizeAngle(aim)
    const t = game.trace(aq)
    log.push([aq, Math.max(Date.now() - t0, 0)])
    shot = { path: t.path, i: 0, cell: t.cell, x: SX, y: SY, c: game.cur }
    sfx('game/bubble-shoot')
  })
  cv.addEventListener('pointercancel', () => (aiming = false))

  let raf = 0
  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(2, (now - last) / 16.67)
    last = now
    if (shot) {
      shot.i = Math.min(shot.path.length - 1, shot.i + dt * 4.3) // same pace as ~2.16 radii per frame
      const k = Math.floor(shot.i)
      const [ax, ay] = shot.path[k]
      const [bx, by] = shot.path[Math.min(k + 1, shot.path.length - 1)]
      const f = shot.i - k
      shot.x = (ax + (bx - ax) * f) * U
      shot.y = (ay + (by - ay) * f) * U
      if (shot.i >= shot.path.length - 1) land()
    }
    for (const f of flying) ((f.y += f.vy * dt), (f.vy += 0.5 * dt), (f.a -= 0.01 * dt))
    for (let i = flying.length - 1; i >= 0; i--) if (flying[i].y > H) flying.splice(i, 1)
    for (const b of bursts) ((b.x += b.vx * dt), (b.y += b.vy * dt), (b.vy += 0.3 * dt), (b.a -= 0.04 * dt))
    for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].a <= 0) bursts.splice(i, 1)
    draw()
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
    await ctx.finish({ score, time: total - clk.left(), detail: { popped: game.popped, shots: log } })
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
