import { GAME_DURATION_MS } from '../../../shared/pip'
import { BW_AIM_PERIOD, BW_AIM_RANGE, BW_HOOK_PERIOD, BW_MAX_WAIT_MS, BW_MIN_GAP_MS, BW_PINS, bwApply, bwDrift, bwKnock, bwNew, bwScore, bwShot, bwWave, type BwThrow } from '../../../shared/bowling'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const INK = '#1F2348'
const CREAM = '#FFFCF5'
const SAND = '#ECE5D5'
const CORAL = '#D0432E'
const GOLD = '#F4B323'
const CAP = BW_MAX_WAIT_MS - 500

export const bowling: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.bowling
  const drift = bwDrift(ctx.m.seed!)
  const s = bwNew()
  const log: BwThrow[] = []
  let done = false
  let stage: 'aim' | 'hook' | 'roll' = 'aim'
  let start = performance.now()
  let t1 = 0
  let rollT = 0
  let rollShot = { x: 0, slope: 0 }
  let rollFell: number[] = []
  let fallen: boolean[] = BW_PINS.map(() => false)
  let msg = ''
  const t0 = performance.now()
  const nowTotal = () => Math.round(performance.now() - t0)

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Bowling</div><span class="tmr" id="tm">3:00</span></div>
  <div class="scroll" style="gap:8px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div>
  <div class="bwf" id="bf"></div>
  <div class="row" style="justify-content:space-between;font-size:14px;color:var(--ink2)"><span id="bi"></span><b id="lt" style="color:var(--ink)"></b></div>
  <button class="btn gold block" id="bt" style="min-height:52px">Lock aim</button>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 340, 340)
  const H = Math.round(W * 0.82)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  g.scale(dpr, dpr)
  const U = W / 5.2 // px per pin unit
  const cx = W / 2
  const headY = 18 + 3 * 0.866 * U // head pin, nearest the bowler
  const PX = (x: number) => cx + x * U
  const PY = (y: number) => headY - y * U // y grows towards the back row
  const L = (H - 22 - headY) / U // lane length in front of the head pin, in units

  const frameStrip = () => {
    const sc = bwScore(s.rolls)
    let i = 0
    const cells: string[] = []
    for (let f = 0; f < 10; f++) {
      const a = s.rolls[i]
      let t = ''
      if (a === undefined) t = ''
      else if (f < 9) {
        if (a === 10) {
          t = 'X'
          i += 1
        } else {
          const b = s.rolls[i + 1]
          t = b === undefined ? `${a || '-'}` : a + b === 10 ? `${a || '-'} /` : `${a || '-'} ${b || '-'}`
          i += 2
        }
      } else {
        const r = s.rolls.slice(i)
        const sym: string[] = []
        r.forEach((v, j) => sym.push(v === 10 ? 'X' : j > 0 && r[j - 1] !== 10 && r[j - 1] + v === 10 ? '/' : v === 0 ? '-' : String(v)))
        t = sym.join(' ')
      }
      cells.push(`<div class="${f === s.frame && !s.over ? 'on' : ''}"><small>${t}</small><b>${sc.frames[f] ?? ''}</b></div>`)
    }
    $('#bf', ctx.root)!.innerHTML = cells.join('')
  }

  const drawPin = (i: number, down: boolean) => {
    const p = BW_PINS[i]
    g.beginPath()
    g.arc(PX(p.x), PY(p.y), 0.27 * U, 0, Math.PI * 2)
    g.fillStyle = down ? SAND : CREAM
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = down ? '#C9C0AC' : INK
    g.stroke()
    if (!down) {
      g.beginPath()
      g.arc(PX(p.x), PY(p.y), 0.12 * U, 0, Math.PI * 2)
      g.fillStyle = CORAL
      g.fill()
    }
  }
  const draw = () => {
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#E8CE9A'
    g.fillRect(cx - 2.6 * U, 0, 5.2 * U, H)
    g.fillStyle = INK
    g.fillRect(0, 0, cx - 2.6 * U, H)
    g.fillRect(cx + 2.6 * U, 0, W - cx - 2.6 * U, H)
    for (let i = 0; i < 10; i++) drawPin(i, !s.standing[i] || fallen[i])
    const dr = drift[log.length] ?? 0
    const elapsed = performance.now() - start
    let x = 0
    let slope = dr
    if (stage === 'aim') {
      x = bwWave(Math.min(elapsed, CAP), BW_AIM_PERIOD) * BW_AIM_RANGE
    } else if (stage === 'hook') {
      x = bwWave(t1, BW_AIM_PERIOD) * BW_AIM_RANGE
      slope = bwShot(t1, Math.min(Math.round(elapsed), t1 + CAP), dr).slope
    } else {
      x = rollShot.x
      slope = rollShot.slope
    }
    // path
    const by = H - 14
    const bx = (y: number) => x + slope * y
    g.setLineDash([6, 6])
    g.strokeStyle = INK
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(PX(bx(-L)), by)
    g.lineTo(PX(bx(2.8)), PY(2.8))
    g.stroke()
    g.setLineDash([])
    // ball
    let ballY = by
    let ballX = PX(bx(-L))
    if (stage === 'roll') {
      const k = Math.min(1, (performance.now() - rollT) / 700)
      const y = -L + k * (L + 2.8)
      ballX = PX(bx(y))
      ballY = PY(y)
    }
    g.beginPath()
    g.arc(ballX, ballY, 0.34 * U, 0, Math.PI * 2)
    g.fillStyle = stage === 'aim' ? GOLD : INK
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = INK
    g.stroke()
    if (stage === 'roll' && performance.now() - rollT > 700) finishRoll()
    $('#lt', ctx.root)!.textContent = msg || (stage === 'aim' ? 'Tap to lock your aim' : stage === 'hook' ? 'Tap to lock the hook' : '')
    $('#bt', ctx.root)!.textContent = stage === 'hook' ? 'Lock hook' : 'Lock aim'
    const pull = dr === 0 ? 'Lane is straight' : dr < 0 ? `Lane pulls left ${Math.round(Math.abs(dr) * 100)}` : `Lane pulls right ${Math.round(Math.abs(dr) * 100)}`
    $('#bi', ctx.root)!.textContent = done ? '' : `Frame ${Math.min(10, s.frame + 1)} · ball ${s.ball + 1} · ${pull}`
  }

  const finishRoll = () => {
    if (stage !== 'roll') return
    const n = rollFell.length
    bwApply(s, rollFell)
    fallen = BW_PINS.map(() => false)
    const strike = n === 10 && s.rolls.length > 0 && (s.ball === 0 || s.frame === 9 || s.over)
    msg = n === 0 ? 'Gutter' : strike ? 'Strike!' : `${n} down`
    if (n === 10) (sfx('reward/win-big', 0.5), buzz(30))
    else sfx(n ? 'reward/coin' : 'ui/error', 0.35)
    const sc = bwScore(s.rolls).total
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: sc })
    ctx.progress(sc)
    frameStrip()
    if (s.over) {
      stage = 'aim'
      setTimeout(() => void end(), 900)
      return
    }
    stage = 'aim'
    start = performance.now()
    setTimeout(() => (msg = ''), 900)
  }

  const tap = () => {
    if (done) return
    const el = Math.min(Math.round(performance.now() - start), 10 ** 6)
    if (stage === 'aim') {
      if (el < BW_MIN_GAP_MS) return
      t1 = Math.min(el, CAP)
      stage = 'hook'
      start = performance.now() - t1
      sfx('ui/tap', 0.3)
    } else if (stage === 'hook') {
      if (el < t1 + BW_MIN_GAP_MS) return
      const t2 = Math.min(el, t1 + CAP)
      const dr = drift[log.length] ?? 0
      rollShot = bwShot(t1, t2, dr)
      rollFell = bwKnock(s.standing, rollShot)
      log.push([t1, t2])
      stage = 'roll'
      rollT = performance.now()
      msg = ''
      sfx('game/card-slide', 0.5)
      setTimeout(() => (fallen = BW_PINS.map((_, i) => rollFell.includes(i))), 450)
    }
  }
  $('#bt', ctx.root)!.addEventListener('click', tap)
  cv.addEventListener('pointerdown', tap)

  let raf = 0
  const loop = () => {
    if (done && stage !== 'roll') return
    // a player who walks away still gets a clean log
    const el = performance.now() - start
    if (!done && stage === 'aim' && el > CAP) tap()
    else if (!done && stage === 'hook' && el > t1 + CAP) tap()
    draw()
    raf = requestAnimationFrame(loop)
  }
  frameStrip()
  loop()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    clk.stop()
    const sc = bwScore(s.rolls).total
    sfx(sc >= 150 ? 'reward/win-big' : 'reward/lose')
    const used = log.reduce((n, t) => n + t[1] + 600, 0)
    await ctx.finish({ score: sc, time: Math.min(total, Math.max(nowTotal(), used)), detail: { throws: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: bwScore(s.rolls).total }),
    destroy: () => ((done = true), cancelAnimationFrame(raf), clk.stop()),
  }
}
