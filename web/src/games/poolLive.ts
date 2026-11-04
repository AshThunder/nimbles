import { GAME_DURATION_MS } from '../../../shared/pip'
import { COL, grp, type Ball, type Group } from '../../../shared/poolsim'
import { isFree, POOL_SHOT_CLOCK_MS, type PoolFrame, type PoolLive } from '../../../shared/poolgame'
import { api, liveSeen, serverNow } from '../api'
import { $, avatar, esc, ic, sfx, buzz, toast } from '../lib'
import { clock, finishBtn, others, wireFinish, type GameMod } from './common'
import { createTable } from './poolDraw'

const MS_PER_FRAME = 50 // the server records one frame every 3 physics steps (60 steps a second)

/** Live 8-ball against another person. The server runs the physics and the rules, this draws the paths it sends back. */
export const poolLive: GameMod = (ctx) => {
  const id = ctx.m.id
  const seat = ctx.m.players.findIndex((p) => p.player.address === ctx.me) === 0 ? 0 : 1
  const opp = others(ctx.m, ctx.me)[0]
  let live = ctx.m.live as PoolLive
  let balls: Ball[] = live.balls.map((b) => ({ ...b }))
  let animatedNo = live.last?.no ?? 0 // a shot we joined late is shown as the table state, not replayed
  liveSeen[id] = animatedNo
  let anim: { frames: PoolFrame[]; t0: number; next: PoolLive } | null = null
  let queued: PoolLive | null = null
  let aim = -Math.PI / 2
  let power = 0.6
  let aimShow = false
  let place: { x: number; y: number } | null = null
  let busy = false
  let dead = false
  let raf = 0

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">8-Ball Pool</div><span class="tmr" id="tm">6:00</span></div>
  <div class="scroll" style="gap:8px"><div class="pls" id="pls"></div><div class="plw"><canvas id="cv"></canvas></div>
  <div class="cst" id="cst" role="status"></div>
  <div class="pwr"><span class="mono">Power</span><input type="range" id="pw" min="10" max="100" value="60" aria-label="Shot power"><button class="btn gold" id="sh" style="min-height:48px;padding:0 20px">${ic('target', 's20')}Shoot</button></div>
  ${finishBtn('Concede')}</div>`
  wireFinish(ctx.root, () => void send({ resign: true }), 'Concede', 'Tap again to concede')
  const table = createTable($('#cv', ctx.root) as HTMLCanvasElement, ctx.root.querySelector('.plw') as HTMLElement)
  const clk = clock(ctx.m, $('#tm', ctx.root), null, () => {}, GAME_DURATION_MS.pool) // the server calls time

  const myTurn = () => live.turn === seat && !live.over
  const canShoot = () => myTurn() && !anim && !busy
  const chips = (s: 0 | 1) => {
    const gr: Group | null = live.groups[s]
    if (!gr) return '<span class="mono">Open table</span>'
    const ns = gr === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]
    return ns.map((n) => `<i class="pch ${balls.find((b) => b.n === n)?.on ? '' : 'gone'}" style="background:${COL[n <= 8 ? n : n - 8]}"></i>`).join('')
  }
  const statusText = () => {
    if (anim) return 'Rolling…'
    const left = Math.max(0, Math.ceil((live.turnAt + POOL_SHOT_CLOCK_MS - serverNow()) / 1000))
    const t = left <= 20 ? ` · ${left}s` : ''
    const lead = live.last ? `${live.msg}. ` : ''
    if (myTurn()) return `${lead}${live.placing ? 'Tap the table to move the cue ball, then shoot' : live.last ? 'Your shot' : 'Your break. Aim, set power, shoot'}${t}`
    return `${lead}${esc(opp.player.name.split(' ')[0])} is lining up…${t}`.replace(/&amp;/g, '&')
  }
  const hud = () => {
    $('#pls', ctx.root)!.innerHTML = `<div class="pl ${myTurn() ? 'act' : ''}"><span class="you">You</span><span class="pc2">${chips(seat)}</span></div><div class="pl ${live.turn !== seat && !live.over ? 'act' : ''}"><span class="pcv">${avatar(opp.player.avatar)}</span><span class="pc2">${chips(seat === 0 ? 1 : 0)}</span></div>`
    $('#cst', ctx.root)!.textContent = statusText()
    ;($('#sh', ctx.root) as HTMLButtonElement).disabled = !canShoot()
    ;($('#pw', ctx.root) as HTMLInputElement).disabled = !canShoot()
  }
  const draw = () => table.draw(balls, { guide: canShoot() && aimShow ? { aim, power } : null, place: canShoot() && live.placing })

  const snapTo = (next: PoolLive) => {
    live = next
    balls = next.balls.map((b) => ({ ...b }))
    place = null
    ctx.progress(balls.filter((b) => !b.on && b.n !== 0 && grp(b.n) === live.groups[seat]).length)
    hud()
  }
  const finishAnim = (next: PoolLive) => {
    anim = null
    snapTo(next)
    const q = queued
    queued = null
    if (q) receive(q)
  }
  /** Take server state. A shot we have not shown yet is animated first. */
  const receive = (next: PoolLive) => {
    if (dead) return
    const shot = next.last
    if (shot && shot.no > animatedNo) {
      if (anim) return void (queued = next)
      animatedNo = shot.no
      liveSeen[id] = shot.no
      if (shot.frames.length > 1) {
        anim = { frames: shot.frames, t0: performance.now(), next }
        sfx('game/pool-hit', 0.7)
        buzz(10)
        hud()
        return
      }
    }
    if (anim) return void (queued = next)
    // same turn and shot as what is on screen: keep the local cue placement and aim, just take the clock
    if (next.shotNo === live.shotNo && next.turn === live.turn && next.placing === live.placing && !next.over === !live.over) {
      live = { ...live, turnAt: next.turnAt, msg: next.msg }
      return
    }
    snapTo(next)
  }
  const frame = () => {
    if (dead) return
    if (anim) {
      const t = (performance.now() - anim.t0) / MS_PER_FRAME
      const i = Math.floor(t)
      const fr = anim.frames
      if (i >= fr.length - 1) finishAnim(anim.next)
      else {
        const a = fr[i]
        const b = fr[i + 1]
        const f = t - i
        balls.forEach((ball, k) => {
          const on = b[k * 2] >= 0
          if (ball.on && !on) {
            sfx('game/pool-pocket', 0.5)
            buzz(15)
          }
          ball.on = a[k * 2] >= 0
          if (ball.on && on) {
            ball.x = a[k * 2] + (b[k * 2] - a[k * 2]) * f
            ball.y = a[k * 2 + 1] + (b[k * 2 + 1] - a[k * 2 + 1]) * f
          } else if (ball.on) {
            ball.x = a[k * 2]
            ball.y = a[k * 2 + 1]
          }
        })
      }
    }
    draw()
    raf = requestAnimationFrame(frame)
  }

  async function send(b: unknown) {
    if (busy || dead) return
    busy = true
    hud()
    try {
      const v = await api.move(id, b)
      if (v.live) receive(v.live as PoolLive)
      ctx.sync(v)
    } catch (e: any) {
      toast(e.message || 'That shot did not go through')
    } finally {
      busy = false
      hud()
    }
  }

  const cv = table.cv
  const setAim = (e: PointerEvent) => {
    const p = table.toWorld(e)
    const c = balls[0]
    if (Math.hypot(p.x - c.x, p.y - c.y) > 4) aim = Math.atan2(p.y - c.y, p.x - c.x)
    aimShow = true
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!canShoot()) return
    const p = table.toWorld(e)
    // with ball in hand a tap away from the cue ball places it, a touch on it starts aiming
    if (live.placing && Math.hypot(p.x - balls[0].x, p.y - balls[0].y) > 30) {
      if (isFree(balls, p.x, p.y)) {
        place = { x: p.x, y: p.y }
        Object.assign(balls[0], { x: p.x, y: p.y, on: true })
        sfx('ui/tile', 0.5)
      }
      return
    }
    cv.setPointerCapture(e.pointerId)
    setAim(e)
  })
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons && canShoot()) setAim(e)
  })
  $('#pw', ctx.root)!.addEventListener('input', (e) => (power = Number((e.target as HTMLInputElement).value) / 100))
  $('#sh', ctx.root)!.addEventListener('click', () => {
    if (!canShoot()) return
    aimShow = false
    void send({ angle: aim, power, place })
  })
  const statusTick = setInterval(() => !dead && !anim && ($('#cst', ctx.root)!.textContent = statusText()), 1000)

  hud()
  raf = requestAnimationFrame(frame)
  return {
    update: (m) => {
      if (m.live) receive(m.live as PoolLive)
    },
    destroy: () => {
      dead = true
      cancelAnimationFrame(raf)
      clk.stop()
      clearInterval(statusTick)
    },
  }
}
