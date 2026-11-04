import { TW, TH, RAIL, BR, POCKETS, COL, NAVY, type Ball } from '../../../shared/poolsim'

export type TableOpts = { guide: { aim: number; power: number } | null; place: boolean }

/** Canvas table renderer shared by the practice game (vs Pip) and the live duel. */
export function createTable(cv: HTMLCanvasElement, wrap: HTMLElement) {
  const g = cv.getContext('2d')!
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
  const castGuide = (balls: Ball[], aim: number) => {
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
  const draw = (balls: Ball[], o: TableOpts) => {
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
    if (o.guide && cue.on) {
      const { aim, power } = o.guide
      const e = castGuide(balls, aim)
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
      const back = 14 + power * 26
      g.strokeStyle = '#F4B323'
      g.lineWidth = 4
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(cue.x - Math.cos(aim) * (BR + 4 + back * 0.4), cue.y - Math.sin(aim) * (BR + 4 + back * 0.4))
      g.lineTo(cue.x - Math.cos(aim) * (BR + 4 + back * 0.4 + 90), cue.y - Math.sin(aim) * (BR + 4 + back * 0.4 + 90))
      g.stroke()
    }
    if (o.place) {
      g.fillStyle = 'rgba(244,179,35,.35)'
      g.fillRect(0, 0, TW, TH)
    }
    g.restore()
  }
  const toWorld = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * CW - RAIL, y: ((e.clientY - r.top) / r.height) * CH - RAIL }
  }
  return { cv, CW, CH, draw, toWorld }
}
