import { rng } from './rng'

// Table in px at scale 1. Portrait, so it fits a phone.
export const TW = 300
export const TH = 520
export const RAIL = 16
export const BR = 9 // ball radius
export const POCKETS: { x: number; y: number; r: number }[] = [
  { x: -3, y: -3, r: 19 },
  { x: TW + 3, y: -3, r: 19 },
  { x: -6, y: TH / 2, r: 17 },
  { x: TW + 6, y: TH / 2, r: 17 },
  { x: -3, y: TH + 3, r: 19 },
  { x: TW + 3, y: TH + 3, r: 19 },
]
export const MAX_V = 21
export const FRICTION = 0.987
export const NAVY = '#1F2348'
export const COL = ['#FFFCF5', '#F4B323', '#1F78C4', '#D0432E', '#7A4FB5', '#E8833A', '#1F8A5B', '#8C2F39', '#1F2348']
export type Ball = { n: number; x: number; y: number; vx: number; vy: number; on: boolean }
export type Ev = { first: number | null; potted: number[]; hits: number; rail: number }
export type Group = 'solid' | 'stripe'
export const grp = (n: number): Group | null => (n >= 1 && n <= 7 ? 'solid' : n >= 9 ? 'stripe' : null)

export function rack(seed: string): Ball[] {
  const r = rng('pool:' + seed)
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]
  for (let i = rest.length - 1; i > 0; i--) {
    const j = r.int(i + 1)
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  // 8 in the middle of row 3, one solid and one stripe in the back corners
  const order: number[] = []
  const pool = [...rest]
  const pick = (cond: (n: number) => boolean) => pool.splice(pool.findIndex(cond), 1)[0]
  const c1 = pick((n) => n < 8)
  const c2 = pick((n) => n > 8)
  const slots = 15
  for (let i = 0; i < slots; i++) order.push(0)
  const idx = (row: number, k: number) => (row * (row + 1)) / 2 + k
  order[idx(2, 1)] = 8
  order[idx(4, 0)] = c1
  order[idx(4, 4)] = c2
  for (let i = 0; i < slots; i++) if (!order[i]) order[i] = pool.shift()!
  const balls: Ball[] = [{ n: 0, x: TW / 2, y: TH * 0.76, vx: 0, vy: 0, on: true }]
  const x0 = TW / 2
  const y0 = TH * 0.27
  let i = 0
  for (let row = 0; row < 5; row++)
    for (let k = 0; k <= row; k++) {
      balls.push({ n: order[i++], x: x0 + (k - row / 2) * (BR * 2 + 0.4), y: y0 - row * BR * 1.74, vx: 0, vy: 0, on: true })
    }
  return balls
}

export function step(bs: Ball[], ev: Ev) {
  for (let sub = 0; sub < 4; sub++) {
    for (const b of bs) {
      if (!b.on) continue
      b.x += b.vx / 4
      b.y += b.vy / 4
      for (const p of POCKETS)
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
          b.on = false
          b.vx = b.vy = 0
          ev.potted.push(b.n)
          break
        }
      if (!b.on) continue
      if (b.x < BR) ((b.x = BR), (b.vx = -b.vx * 0.8), ev.rail++)
      else if (b.x > TW - BR) ((b.x = TW - BR), (b.vx = -b.vx * 0.8), ev.rail++)
      if (b.y < BR) ((b.y = BR), (b.vy = -b.vy * 0.8), ev.rail++)
      else if (b.y > TH - BR) ((b.y = TH - BR), (b.vy = -b.vy * 0.8), ev.rail++)
    }
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]
      if (!a.on) continue
      for (let j = i + 1; j < bs.length; j++) {
        const c = bs[j]
        if (!c.on) continue
        const dx = c.x - a.x
        const dy = c.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= 4 * BR * BR || d2 === 0) continue
        const d = Math.sqrt(d2)
        const nx = dx / d
        const ny = dy / d
        const ov = (2 * BR - d) / 2
        a.x -= nx * ov
        a.y -= ny * ov
        c.x += nx * ov
        c.y += ny * ov
        const p = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny
        if (p > 0) {
          a.vx -= p * nx
          a.vy -= p * ny
          c.vx += p * nx
          c.vy += p * ny
          ev.hits++
          if (ev.first === null && (a.n === 0 || c.n === 0)) ev.first = a.n === 0 ? c.n : a.n
        }
      }
    }
  }
  let moving = false
  for (const b of bs) {
    if (!b.on) continue
    b.vx *= FRICTION
    b.vy *= FRICTION
    if (Math.hypot(b.vx, b.vy) < 0.05) b.vx = b.vy = 0
    else moving = true
  }
  return moving
}
export const clone = (bs: Ball[]) => bs.map((b) => ({ ...b }))
export const fire = (bs: Ball[], ang: number, power: number): Ev => {
  const cue = bs[0]
  cue.vx = Math.cos(ang) * MAX_V * power
  cue.vy = Math.sin(ang) * MAX_V * power
  const ev: Ev = { first: null, potted: [], hits: 0, rail: 0 }
  for (let i = 0; i < 900 && step(bs, ev); i++);
  return ev
}

export type Judge = { foul: boolean; again: boolean; win: boolean | null; assign: Group | null; pottedOwn: number }
/** Apply the shot rules for `shooter`, whose group may be unassigned. */
export function judge(before: Ball[], ev: Ev, mine: Group | null): Judge {
  const own = (n: number) => (mine ? grp(n) === mine : n !== 8 && n !== 0)
  const ownLeft = mine ? before.filter((b) => b.on && grp(b.n) === mine).length : 99
  const scratch = ev.potted.includes(0)
  let foul = scratch || ev.first === null
  if (!foul && ev.first !== null) {
    if (mine) foul = ownLeft === 0 ? ev.first !== 8 : grp(ev.first) !== mine
  }
  if (ev.potted.includes(8)) return { foul, again: false, win: !foul && ownLeft === 0, assign: null, pottedOwn: 0 }
  const pottedOwn = ev.potted.filter((n) => n !== 0 && own(n)).length
  let assign: Group | null = null
  if (!mine && !foul) {
    const f = ev.potted.find((n) => grp(n))
    if (f) assign = grp(f)
  }
  const again = !foul && (pottedOwn > 0 || !!assign)
  return { foul, again, win: null, assign, pottedOwn }
}

export function pipShot(bs: Ball[], mine: Group | null, level: 'easy' | 'med' | 'hard') {
  const cue = bs[0]
  const left = mine ? bs.filter((b) => b.on && grp(b.n) === mine) : []
  const targets = mine ? (left.length ? left : bs.filter((b) => b.on && b.n === 8)) : bs.filter((b) => b.on && b.n !== 0 && b.n !== 8)
  const noise = { easy: 0.09, med: 0.035, hard: 0.01 }[level]
  const tries = { easy: 14, med: 40, hard: 90 }[level]
  const cands: [number, number][] = []
  for (const t of targets)
    for (const p of POCKETS) {
      const px = Math.max(8, Math.min(TW - 8, p.x))
      const py = Math.max(8, Math.min(TH - 8, p.y))
      const d = Math.hypot(px - t.x, py - t.y) || 1
      const gx = t.x - ((px - t.x) / d) * BR * 2
      const gy = t.y - ((py - t.y) / d) * BR * 2
      const ang = Math.atan2(gy - cue.y, gx - cue.x)
      const dist = Math.hypot(gx - cue.x, gy - cue.y) + d
      cands.push([ang, Math.min(1, 0.32 + dist / 760)])
    }
  while (cands.length < tries) cands.push([Math.random() * Math.PI * 2, 0.4 + Math.random() * 0.5])
  cands.sort(() => Math.random() - 0.5)
  let best: [number, number] = [0, 0.5]
  let bv = -Infinity
  for (const [a0, p0] of cands.slice(0, tries)) {
    const a = a0 + (Math.random() - 0.5) * 2 * noise
    const p = Math.min(1, Math.max(0.2, p0 + (Math.random() - 0.5) * 0.1))
    const sim = clone(bs)
    const ev = fire(sim, a, p)
    const j = judge(bs, ev, mine)
    let v = j.pottedOwn * 10 + (j.again ? 3 : 0) - (j.foul ? 40 : 0) + ev.hits * 0.1
    if (j.win === true) v += 200
    if (j.win === false) v -= 300
    if (v > bv) ((bv = v), (best = [a, p]))
  }
  return best
}

