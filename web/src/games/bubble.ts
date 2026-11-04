import { GAME_DURATION_MS } from '../../../shared/pip'
import { rng } from '../../../shared/rng'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const COLS = 10
const ROWS = 14 // rows that fit on the board
const LOSE_ROW = 11 // a bubble reaching this row ends the round
const PUSH_EVERY = 7 // shots between new rows
const COLORS = ['#1F78C4', '#D0432E', '#1F8A5B', '#F4B323', '#F29AAE']
const NAVY = '#1F2348'
type Cell = number | -1 // colour index or empty

export const bubble: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.bubble
  const seed = ctx.m.seed!
  const rBoard = rng('bubble:board:' + seed)
  const rRows = rng('bubble:rows:' + seed)
  const rQueue = rng('bubble:queue:' + seed)
  let done = false
  let score = 0
  let shots = 0
  let parity = 0
  let popped = 0
  const grid: Cell[][] = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(-1))
  const colsIn = (r: number) => (((r + parity) & 1) === 1 ? COLS - 1 : COLS)
  for (let r = 0; r < 6; r++) for (let c = 0; c < colsIn(r); c++) grid[r][c] = rBoard.int(COLORS.length)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Bubble Shooter</div><span class="tmr" id="tm">1:30</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div><div class="row" style="justify-content:space-between;font-size:13px;color:var(--ink2)"><span id="nx"></span><span class="mono" id="pp"></span></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g2 = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 358, 420)
  const R = W / (COLS * 2)
  const RH = R * Math.sqrt(3)
  const H = Math.round(RH * (LOSE_ROW + 1) + R * 2 + 74)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  g2.scale(dpr, dpr)
  const SX = W / 2
  const SY = H - 34

  const cx = (r: number, c: number) => R + c * 2 * R + (((r + parity) & 1) === 1 ? R : 0)
  const cy = (r: number) => R + r * RH
  const present = () => {
    const s = new Set<number>()
    for (const row of grid) for (const v of row) if (v >= 0) s.add(v)
    return [...s]
  }
  const nextColor = () => {
    const p = present()
    return p.length ? p[rQueue.int(1000) % p.length] : rQueue.int(COLORS.length)
  }
  let cur = nextColor()
  let nxt = nextColor()
  let aim = -Math.PI / 2
  let shot: { x: number; y: number; vx: number; vy: number; c: number } | null = null
  let aiming = false
  const flying: { x: number; y: number; vy: number; c: number; a: number }[] = []
  const bursts: { x: number; y: number; vx: number; vy: number; c: number; a: number }[] = []

  const nbrs = (r: number, c: number): [number, number][] => {
    const off = ((r + parity) & 1) === 1
    const d: [number, number][] = [[r, c - 1], [r, c + 1], ...(off ? ([[r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]] as [number, number][]) : ([[r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]] as [number, number][]))]
    return d.filter(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < colsIn(rr))
  }
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
    else circle(SX, SY, cur)
    circle(SX - R * 3.2, SY + R * 0.6, nxt, R * 0.7)
  }
  const hud = () => {
    $('#nx', ctx.root)!.textContent = `New row in ${PUSH_EVERY - (shots % PUSH_EVERY)} shot${PUSH_EVERY - (shots % PUSH_EVERY) === 1 ? '' : 's'}`
    $('#pp', ctx.root)!.textContent = `${popped} popped`
  }
  const award = (n: number) => {
    score += n
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: score })
    ctx.progress(score)
  }
  const land = () => {
    const s = shot!
    shot = null
    // closest empty cell that touches the ceiling or another bubble
    let best: [number, number] | null = null
    let bd = Infinity
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < colsIn(r); c++) {
        if (grid[r][c] >= 0) continue
        if (r !== 0 && !nbrs(r, c).some(([a, b]) => grid[a][b] >= 0)) continue
        const d = Math.hypot(cx(r, c) - s.x, cy(r) - s.y)
        if (d < bd) ((bd = d), (best = [r, c]))
      }
    if (!best) return
    const [r, c] = best
    grid[r][c] = s.c
    shots++
    // pop same-colour group
    const seen = new Set<string>([r + ',' + c])
    const q: [number, number][] = [[r, c]]
    for (let i = 0; i < q.length; i++) for (const [a, b] of nbrs(...q[i])) if (grid[a][b] === s.c && !seen.has(a + ',' + b)) (seen.add(a + ',' + b), q.push([a, b]))
    let gained = 0
    if (q.length >= 3) {
      for (const [a, b] of q) burst(a, b)
      popped += q.length
      gained += q.length * 10 + (q.length - 3) * 5
      sfx('game/bubble-pop')
      buzz(12)
      // drop anything not connected to the ceiling
      const keep = new Set<string>()
      const qq: [number, number][] = []
      for (let cc = 0; cc < colsIn(0); cc++) if (grid[0][cc] >= 0) (keep.add('0,' + cc), qq.push([0, cc]))
      for (let i = 0; i < qq.length; i++) for (const [a, b] of nbrs(...qq[i])) if (grid[a][b] >= 0 && !keep.has(a + ',' + b)) (keep.add(a + ',' + b), qq.push([a, b]))
      let dropped = 0
      for (let a = 0; a < ROWS; a++)
        for (let b = 0; b < colsIn(a); b++)
          if (grid[a][b] >= 0 && !keep.has(a + ',' + b)) {
            flying.push({ x: cx(a, b), y: cy(a), vy: 1 + Math.random() * 2, c: grid[a][b], a: 1 })
            grid[a][b] = -1
            dropped++
          }
      if (dropped) (gained += dropped * 20, popped += dropped, sfx('reward/coin', 0.6))
    } else {
      sfx('game/bubble-shoot', 0.4)
    }
    if (gained) award(gained)
    if (!present().length) {
      award(200)
      sfx('reward/bonus')
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < colsIn(rr); cc++) grid[rr][cc] = rBoard.int(COLORS.length)
    }
    if (shots % PUSH_EVERY === 0) pushRow()
    cur = nxt
    nxt = nextColor()
    hud()
    if (grid.slice(LOSE_ROW).some((row) => row.some((v) => v >= 0))) void end()
  }
  const burst = (r: number, c: number) => {
    for (let i = 0; i < 4; i++) bursts.push({ x: cx(r, c), y: cy(r), vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.8) * 5, c: grid[r][c], a: 1 })
    grid[r][c] = -1
  }
  const pushRow = () => {
    parity ^= 1
    for (let r = ROWS - 1; r > 0; r--) grid[r] = grid[r - 1]
    grid[0] = Array<Cell>(COLS).fill(-1)
    for (let c = 0; c < colsIn(0); c++) grid[0][c] = rRows.int(COLORS.length)
    sfx('game/card-slide', 0.5)
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
    const sp = R * 0.9 * 2.4
    shot = { x: SX, y: SY, vx: Math.cos(aim) * sp, vy: Math.sin(aim) * sp, c: cur }
    sfx('game/bubble-shoot')
  })
  cv.addEventListener('pointercancel', () => (aiming = false))

  let raf = 0
  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(2, (now - last) / 16.67)
    last = now
    if (shot) {
      const steps = Math.ceil(dt * 2)
      for (let i = 0; i < steps && shot; i++) {
        shot.x += (shot.vx * dt) / steps
        shot.y += (shot.vy * dt) / steps
        if (shot.x < R) ((shot.x = R), (shot.vx *= -1))
        if (shot.x > W - R) ((shot.x = W - R), (shot.vx *= -1))
        let hit = shot.y <= R
        if (!hit) outer: for (let r = 0; r < ROWS; r++) for (let c = 0; c < colsIn(r); c++) if (grid[r][c] >= 0 && Math.hypot(cx(r, c) - shot.x, cy(r) - shot.y) < R * 1.8) { hit = true; break outer }
        if (hit) land()
      }
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
    await ctx.finish({ score, time: total - clk.left(), detail: { popped, shots } })
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
