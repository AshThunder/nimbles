import { GAME_DURATION_MS } from '../../../shared/pip'
import { TW, TH, RAIL, BR, POCKETS, MAX_V, COL, NAVY, grp, rack, step, clone, judge, pipShot, type Ball, type Ev, type Group } from '../../../shared/poolsim'
import { $, ic, sfx, buzz, pipImg } from '../lib'
import { clock, finishBtn, wireFinish, type GameMod } from './common'

export const pool: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.pool
  const level = ctx.m.pipLevel ?? 'med'
  let balls = rack(ctx.m.seed ?? 'x')
  let groups: { me: Group | null } = { me: null }
  let turn: 'me' | 'pip' = 'me'
  let phase: 'aim' | 'roll' | 'place' | 'over' = 'aim'
  let aim = -Math.PI / 2
  let power = 0.6
  let status = 'Your break. Aim, set power, shoot'
  let aimShow = false
  let ev: Ev = { first: null, potted: [], hits: 0, rail: 0 }
  let snapshot = clone(balls)
  let done = false
  let raf = 0
  const timers: ReturnType<typeof setTimeout>[] = []
  const started = Date.now()
  const pipGroup = (): Group | null => (groups.me ? (groups.me === 'solid' ? 'stripe' : 'solid') : null)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">8-Ball Pool</div><span class="tmr" id="tm">6:00</span></div>
  <div class="scroll" style="gap:8px"><div class="pls" id="pls"></div><div class="plw"><canvas id="cv"></canvas></div>
  <div class="cst" id="cst" role="status"></div>
  <div class="pwr"><span class="mono">Power</span><input type="range" id="pw" min="10" max="100" value="60" aria-label="Shot power"><button class="btn gold" id="sh" style="height:48px;padding:0 20px">${ic('target', 's20')}Shoot</button></div>
  ${finishBtn('Concede')}</div>`
  wireFinish(ctx.root, () => void end(0, 'concede'), 'Concede', 'Tap again to concede')
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const wrap = ctx.root.querySelector('.plw') as HTMLElement
  const availW = Math.min(wrap.clientWidth || 358, 360)
  const S = availW / (TW + RAIL * 2)
  const CW = TW + RAIL * 2
  const CH = TH + RAIL * 2
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = CW * S * dpr
  cv.height = CH * S * dpr
  cv.style.width = CW * S + 'px'
  cv.style.height = CH * S + 'px'
  g.scale(S * dpr, S * dpr)

  const ball = (b: Ball, x = b.x, y = b.y, r = BR) => {
    const c = b.n === 0 ? COL[0] : COL[b.n <= 8 ? b.n : b.n - 8]
    g.save()
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.clip()
    g.fillStyle = b.n >= 9 ? '#FFFCF5' : c
    g.fillRect(x - r, y - r, r * 2, r * 2)
    if (b.n >= 9) {
      g.fillStyle = c
      g.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1)
    }
    g.restore()
    g.beginPath()
    g.arc(x, y, r - 0.8, 0, Math.PI * 2)
    g.lineWidth = 1.8
    g.strokeStyle = NAVY
    g.stroke()
    if (b.n > 0) {
      g.beginPath()
      g.arc(x, y, r * 0.5, 0, Math.PI * 2)
      g.fillStyle = '#FFFCF5'
      g.fill()
      g.fillStyle = NAVY
      g.font = '800 7px DM Mono, monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(b.n), x, y + 0.4)
    }
  }
  const castGuide = () => {
    const cue = balls[0]
    const dx = Math.cos(aim)
    const dy = Math.sin(aim)
    let t = Infinity
    let hitBall: Ball | null = null
    for (const b of balls) {
      if (!b.on || b.n === 0) continue
      const fx = b.x - cue.x
      const fy = b.y - cue.y
      const proj = fx * dx + fy * dy
      if (proj <= 0) continue
      const perp2 = fx * fx + fy * fy - proj * proj
      if (perp2 > 4 * BR * BR) continue
      const tt = proj - Math.sqrt(4 * BR * BR - perp2)
      if (tt < t) ((t = tt), (hitBall = b))
    }
    const wall = Math.min(dx > 0 ? (TW - BR - cue.x) / dx : dx < 0 ? (BR - cue.x) / dx : Infinity, dy > 0 ? (TH - BR - cue.y) / dy : dy < 0 ? (BR - cue.y) / dy : Infinity)
    if (wall < t) ((t = wall), (hitBall = null))
    return { x: cue.x + dx * t, y: cue.y + dy * t, hit: hitBall }
  }
  const draw = () => {
    g.clearRect(0, 0, CW, CH)
    g.fillStyle = NAVY
    g.beginPath()
    g.roundRect(0, 0, CW, CH, 20)
    g.fill()
    g.save()
    g.translate(RAIL, RAIL)
    g.fillStyle = '#1F8A5B'
    g.fillRect(0, 0, TW, TH)
    g.strokeStyle = 'rgba(255,252,245,.28)'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(0, TH * 0.76)
    g.lineTo(TW, TH * 0.76)
    g.stroke()
    for (const p of POCKETS) {
      g.beginPath()
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      g.fillStyle = '#12142B'
      g.fill()
    }
    for (const b of balls) if (b.on) ball(b)
    const cue = balls[0]
    if (phase === 'aim' && turn === 'me' && cue.on && aimShow) {
      const e = castGuide()
      g.setLineDash([5, 6])
      g.strokeStyle = '#FFFCF5'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cue.x, cue.y)
      g.lineTo(e.x, e.y)
      g.stroke()
      g.setLineDash([])
      g.beginPath()
      g.arc(e.x, e.y, BR, 0, Math.PI * 2)
      g.strokeStyle = '#F4B323'
      g.stroke()
      // cue stick
      const back = 14 + (1 - power) * 0 + power * 26
      g.strokeStyle = '#F4B323'
      g.lineWidth = 4
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(cue.x - Math.cos(aim) * (BR + 4 + back * 0.4), cue.y - Math.sin(aim) * (BR + 4 + back * 0.4))
      g.lineTo(cue.x - Math.cos(aim) * (BR + 4 + back * 0.4 + 90), cue.y - Math.sin(aim) * (BR + 4 + back * 0.4 + 90))
      g.stroke()
    }
    if (phase === 'place' && turn === 'me') {
      g.fillStyle = 'rgba(244,179,35,.35)'
      g.fillRect(0, 0, TW, TH)
    }
    g.restore()
  }
  const chips = (side: 'me' | 'pip') => {
    const gr = side === 'me' ? groups.me : pipGroup()
    if (!gr) return '<span class="mono">Open table</span>'
    const ns = gr === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]
    return ns.map((n) => `<i class="pch ${balls.find((b) => b.n === n)?.on ? '' : 'gone'}" style="background:${COL[n <= 8 ? n : n - 8]}"></i>`).join('')
  }
  const hud = () => {
    $('#pls', ctx.root)!.innerHTML = `<div class="pl ${turn === 'me' ? 'act' : ''}"><span class="you">You</span><span class="pc2">${chips('me')}</span></div><div class="pl ${turn === 'pip' ? 'act' : ''}"><span class="pcv">${pipImg('cool')}</span><span class="pc2">${chips('pip')}</span></div>`
    $('#cst', ctx.root)!.textContent = status
    ;($('#sh', ctx.root) as HTMLButtonElement).disabled = !(phase === 'aim' && turn === 'me')
    ;($('#pw', ctx.root) as HTMLInputElement).disabled = !(phase === 'aim' && turn === 'me')
  }

  const shoot = (ang: number, pw: number) => {
    snapshot = clone(balls)
    ev = { first: null, potted: [], hits: 0, rail: 0 }
    balls[0].vx = Math.cos(ang) * MAX_V * pw
    balls[0].vy = Math.sin(ang) * MAX_V * pw
    phase = 'roll'
    status = turn === 'me' ? 'Rolling…' : 'Pip shoots…'
    sfx('game/pool-hit', 0.4 + pw * 0.5)
    buzz(10)
    hud()
  }
  const placeCue = (x: number, y: number) => {
    const c = balls[0]
    c.x = x
    c.y = y
    c.on = true
    c.vx = c.vy = 0
  }
  const free = (x: number, y: number) => x > BR && x < TW - BR && y > BR && y < TH - BR && balls.every((b) => !b.on || b.n === 0 || Math.hypot(b.x - x, b.y - y) > BR * 2 + 1)
  const headSpot = () => {
    for (const dy of [0, -30, 30, -60, 60]) for (const dx of [0, -40, 40, -80, 80]) if (free(TW / 2 + dx, TH * 0.76 + dy)) return [TW / 2 + dx, TH * 0.76 + dy] as const
    return [TW / 2, TH * 0.9] as const
  }
  const settle = () => {
    const shooter = turn
    const mineGroup = shooter === 'me' ? groups.me : pipGroup()
    const j = judge(snapshot, ev, mineGroup)
    if (ev.potted.length) sfx('game/pool-pocket')
    if (j.win !== null) {
      const meWins = shooter === 'me' ? j.win : !j.win
      status = meWins ? 'You sank the 8-ball. You win' : shooter === 'me' ? 'Lost on the 8-ball' : 'Pip sank the 8-ball'
      hud()
      return void end(meWins ? 1 : 0, 'eight')
    }
    if (j.assign) {
      groups.me = shooter === 'me' ? j.assign : j.assign === 'solid' ? 'stripe' : 'solid'
    }
    if (!balls[0].on) placeCue(...headSpot())
    let msg = ''
    if (j.foul) {
      msg = `${shooter === 'me' ? 'Foul' : 'Pip fouled'}${ev.potted.includes(0) ? ', cue ball potted' : ev.first === null ? ', no ball hit' : ', wrong ball first'}.`
      turn = shooter === 'me' ? 'pip' : 'me'
      if (turn === 'me') msg += ' Tap the table to place the cue ball'
    } else if (j.again) msg = shooter === 'me' ? 'Nice. Shoot again' : 'Pip shoots again'
    else turn = shooter === 'me' ? 'pip' : 'me'
    if (!msg) msg = turn === 'me' ? 'Your shot' : 'Pip is lining up…'
    status = msg
    ctx.progress(balls.filter((b) => !b.on && b.n !== 0 && grp(b.n) === groups.me).length)
    phase = j.foul && turn === 'me' ? 'place' : 'aim'
    hud()
    if (turn === 'pip') pipPlay()
  }
  const pipPlay = () => {
    timers.push(
      setTimeout(() => {
        if (done) return
        const [a, p] = pipShot(balls, pipGroup(), level)
        aim = a
        aimShow = false
        timers.push(setTimeout(() => !done && shoot(a, p), 500))
      }, 600),
    )
  }
  const frame = () => {
    if (done) return
    if (phase === 'roll') {
      const before = ev.potted.length
      const moving = step(balls, ev)
      if (ev.potted.length > before) {
        sfx('game/pool-pocket', 0.5)
        buzz(15)
      }
      if (!moving) settle()
    }
    draw()
    raf = requestAnimationFrame(frame)
  }
  const toWorld = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * CW - RAIL, y: ((e.clientY - r.top) / r.height) * CH - RAIL }
  }
  const setAim = (e: PointerEvent) => {
    const p = toWorld(e)
    const c = balls[0]
    if (Math.hypot(p.x - c.x, p.y - c.y) > 4) aim = Math.atan2(p.y - c.y, p.x - c.x)
    aimShow = true
  }
  cv.addEventListener('pointerdown', (e) => {
    if (done || turn !== 'me') return
    if (phase === 'place') {
      const p = toWorld(e)
      if (free(p.x, p.y)) {
        placeCue(p.x, p.y)
        phase = 'aim'
        status = 'Cue ball placed. Aim and shoot'
        hud()
      }
      return
    }
    if (phase !== 'aim') return
    cv.setPointerCapture(e.pointerId)
    setAim(e)
  })
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons && phase === 'aim' && turn === 'me') setAim(e)
  })
  $('#pw', ctx.root)!.addEventListener('input', (e) => (power = Number((e.target as HTMLInputElement).value) / 100))
  $('#sh', ctx.root)!.addEventListener('click', () => {
    if (phase !== 'aim' || turn !== 'me' || done) return
    aimShow = false
    shoot(aim, power)
  })
  const clk = clock(ctx.m, $('#tm', ctx.root), null, () => {
    // out of time: whoever has potted more of the 14 balls takes it
    const potted = (gr: Group | null) => (gr ? balls.filter((b) => !b.on && grp(b.n) === gr).length : 0)
    const me = potted(groups.me)
    const pip = potted(pipGroup())
    void end(me > pip ? 1 : me === pip ? 0.5 : 0, 'time')
  }, total)
  const end = async (score: number, reason: string) => {
    if (done) return
    done = true
    phase = 'over'
    cancelAnimationFrame(raf)
    clk.stop()
    timers.forEach(clearTimeout)
    draw()
    sfx(score === 1 ? 'reward/win-big' : score === 0.5 ? 'reward/draw' : 'reward/lose')
    await new Promise((r) => setTimeout(r, reason === 'concede' ? 0 : 1200))
    await ctx.finish({ score, time: Date.now() - started, detail: { reason, potted: balls.filter((b) => !b.on).length } })
  }
  hud()
  raf = requestAnimationFrame(frame)
  void level
  return {
    update: () => {},
    destroy: () => {
      done = true
      cancelAnimationFrame(raf)
      clk.stop()
      timers.forEach(clearTimeout)
    },
  }
}
