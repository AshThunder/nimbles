// Live head-to-head 8-ball. The server owns the table: it runs the physics from the shot (angle, power, cue placement),
// applies the rules, and returns the recorded ball paths so both phones play the same animation.
import { BR, TH, TW, clone, grp, judge, rack, step, MAX_V, type Ball, type Ev, type Group } from './poolsim'
import { hashSeed } from './rng'

export const POOL_SHOT_CLOCK_MS = 60_000
export const POOL_MAX_IDLE = 3
export type PoolOver = { winner: 0 | 1 | null; reason: 'eight' | 'time' | 'resign' | 'idle' }
export type PoolFrame = number[] // x0,y0,x1,y1,… per ball index, -1,-1 when potted
export type PoolLive = {
  kind: 'pool'
  balls: Ball[]
  groups: [Group | null, Group | null]
  turn: 0 | 1
  placing: boolean // the player to move has ball in hand
  turnAt: number
  idle: [number, number]
  shotNo: number
  msg: string
  last?: { no: number; by: 0 | 1; frames: PoolFrame[]; potted: number[]; foul: boolean }
  over?: PoolOver
}

const other = (s: 0 | 1): 0 | 1 => (s === 0 ? 1 : 0)
const opposite = (g: Group): Group => (g === 'solid' ? 'stripe' : 'solid')

export function initPool(seed: string, startsAt: number): PoolLive {
  const turn = (hashSeed('pool:' + seed) & 1) as 0 | 1
  return { kind: 'pool', balls: rack(seed), groups: [null, null], turn, placing: false, turnAt: startsAt, idle: [0, 0], shotNo: 0, msg: 'Break' }
}

export const isFree = (bs: Ball[], x: number, y: number) =>
  x > BR && x < TW - BR && y > BR && y < TH - BR && bs.every((b) => !b.on || b.n === 0 || Math.hypot(b.x - x, b.y - y) > BR * 2 + 1)

export const headSpot = (bs: Ball[]): [number, number] => {
  for (const dy of [0, -30, 30, -60, 60]) for (const dx of [0, -40, 40, -80, 80]) if (isFree(bs, TW / 2 + dx, TH * 0.76 + dy)) return [TW / 2 + dx, TH * 0.76 + dy]
  return [TW / 2, TH * 0.9]
}

const snap = (bs: Ball[]): PoolFrame => bs.flatMap((b) => (b.on ? [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10] : [-1, -1]))
const potted = (st: PoolLive, g: Group | null) => (g ? st.balls.filter((b) => !b.on && grp(b.n) === g).length : 0)

export function poolShot(st: PoolLive, seat: 0 | 1, shot: { angle?: unknown; power?: unknown; place?: { x?: unknown; y?: unknown } | null }, now: number) {
  if (st.over) throw new Error('The game is over')
  if (st.turn !== seat) throw new Error('Not your turn')
  const angle = Number(shot.angle)
  const power = Math.min(1, Math.max(0.1, Number(shot.power)))
  if (!isFinite(angle) || !isFinite(power)) throw new Error('Bad shot')
  const cue = st.balls[0]
  if (st.placing && shot.place) {
    const x = Number(shot.place.x)
    const y = Number(shot.place.y)
    if (!isFinite(x) || !isFinite(y) || !isFree(st.balls, x, y)) throw new Error('The cue ball cannot go there')
    cue.x = x
    cue.y = y
  }
  cue.on = true
  const before = clone(st.balls)
  const ev: Ev = { first: null, potted: [], hits: 0, rail: 0 }
  cue.vx = Math.cos(angle) * MAX_V * power
  cue.vy = Math.sin(angle) * MAX_V * power
  const frames: PoolFrame[] = [snap(st.balls)]
  for (let i = 0; i < 1500; i++) {
    const moving = step(st.balls, ev)
    if (i % 3 === 2) frames.push(snap(st.balls))
    if (!moving) break
  }
  const lastF = snap(st.balls)
  if (frames[frames.length - 1].join() !== lastF.join()) frames.push(lastF)

  const mine = st.groups[seat]
  const j = judge(before, ev, mine)
  st.shotNo++
  st.idle[seat] = 0
  let msg = ''
  if (j.win !== null) {
    st.over = { winner: j.win ? seat : other(seat), reason: 'eight' }
    msg = j.win ? 'Sank the 8-ball' : 'Lost on the 8-ball'
  } else {
    if (j.assign) {
      st.groups[seat] = j.assign
      st.groups[other(seat)] = opposite(j.assign)
    }
    if (!st.balls[0].on) {
      const [x, y] = headSpot(st.balls)
      Object.assign(st.balls[0], { x, y, vx: 0, vy: 0, on: true })
    }
    if (j.foul) {
      msg = ev.potted.includes(0) ? 'Foul, cue ball potted' : ev.first === null ? 'Foul, no ball hit' : 'Foul, wrong ball first'
      st.turn = other(seat)
      st.placing = true
    } else {
      st.placing = false
      if (!j.again) st.turn = other(seat)
      msg = j.again ? 'Pots, shoots again' : 'Missed, turn passes'
    }
  }
  st.balls.forEach((b) => (b.vx = b.vy = 0))
  st.turnAt = now
  st.msg = msg
  st.last = { no: st.shotNo, by: seat, frames, potted: ev.potted, foul: j.foul }
}

/** Shot clock: a player who sits on their turn for 60 s fouls. Three in a row forfeits. */
export function poolTick(st: PoolLive, now: number): boolean {
  if (st.over || now - st.turnAt < POOL_SHOT_CLOCK_MS) return false
  const s = st.turn
  st.idle[s]++
  if (st.idle[s] >= POOL_MAX_IDLE) st.over = { winner: other(s), reason: 'idle' }
  else {
    st.turn = other(s)
    st.placing = true
    st.msg = 'Shot clock, foul'
  }
  st.turnAt = now
  return true
}

export function poolResign(st: PoolLive, seat: 0 | 1) {
  if (!st.over) st.over = { winner: other(seat), reason: 'resign' }
}

/** Match clock: whoever has potted more of their seven takes it; level or unassigned is a draw. */
export function poolTimeUp(st: PoolLive) {
  if (st.over) return
  const a = potted(st, st.groups[0])
  const b = potted(st, st.groups[1])
  st.over = { winner: a === b || !st.groups[0] ? null : a > b ? 0 : 1, reason: 'time' }
}

export const poolScore = (st: PoolLive, seat: 0 | 1) => (!st.over || st.over.winner === null ? 0.5 : st.over.winner === seat ? 1 : 0)
