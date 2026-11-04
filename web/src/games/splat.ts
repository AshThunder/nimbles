import { ARENA, CX, CY, MAX_AMMO, MAX_HP, DASH_CD, PR, SPEED, TICK_MS, walk, type Snap, type Wall } from '../../../shared/splat'
import { nickOf } from '../../../shared/nick'
import { $, buzz, esc, fmtTime, ic, sfx } from '../lib'
import { api } from '../api'
import type { GameMod } from './common'

/** Six flat seat colours. Each player keeps theirs from the lobby to the result. */
export const SEAT_COL = ['#1F78C4', '#D0432E', '#F4B323', '#1F8A5B', '#F29AAE', '#6C4AB6']
const INK = '#1F2348'
const PAPER = '#FFFCF5'
const ZONE_TINT = '#F6D8D1'
type Init = { n: number; seat: number; cap: number; startsAt: number; walls: Wall[]; spots: { x: number; y: number; kind: 'ammo' | 'shield' }[]; players: { seat: number; name: string; avatar: string; bot: boolean }[] }
type Stick = { x: number; y: number; on: boolean }

/** Splat Royale, 2 to 6 players. The server runs the match at 30 ticks a second; the phone sends sticks, moves its own blob right away (prediction) and draws the others a few frames behind, smoothly (interpolation). */
export const splat: GameMod = (ctx) => {
  const id = ctx.m.id
  const token = () => sessionStorage.getItem('nb:token') ?? ''
  let init: Init | null = null
  let cur: Snap | null = null
  const buf: { k: number; at: number; s: Snap }[] = []
  let clockOff: number | null = null
  let seq = 0
  const pending: { q: number; mx: number; my: number }[] = []
  let pred: { x: number; y: number } | null = null
  let predPrev = { x: 0, y: 0 }
  let predAt = 0
  let skew = 0
  let myAim: number | null = null
  let lastMsg = 0
  let dead = false
  let ws: WebSocket | null = null
  let retry = 0
  let raf = 0
  let hudSig = ''
  const feed: { text: string; at: number }[] = []
  const move: Stick = { x: 0, y: 0, on: false }
  const aim: Stick = { x: 0, y: 0, on: false }
  const keys = new Set<string>()
  let mouseFire = false
  let mouseAim: { x: number; y: number } | null = null
  let dashLatch = false

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Splat Royale</div><span class="tmr" id="tm" aria-label="Time left">--:--</span></div>
  <div class="spl">
    <div class="spl-hud" id="hud" role="status"></div>
    <div class="spl-wrap" id="wrap"><canvas id="cv" aria-label="Arena"></canvas><div class="spl-feed" id="feed" aria-live="polite"></div><div class="spl-msg" id="msg">Connecting…</div></div>
    <div class="spl-pad" id="pad">
      <div class="spl-st" id="stm" aria-label="Move stick"><i></i></div>
      <button class="spl-dash" id="dash" aria-label="Dash"><b id="dcd"></b><span>${ic('zap', 's20')}Dash</span></button>
      <div class="spl-st aim" id="sta" aria-label="Aim and fire stick"><i></i></div>
    </div>
    <div class="spl-help">Left stick moves, right stick aims and fires. Keyboard: WASD, mouse, Space</div>
  </div>`
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const wrap = $('#wrap', ctx.root) as HTMLElement
  const g = cv.getContext('2d')!
  const nameOf = (s: number) => (s === init?.seat ? 'You' : (init?.players[s]?.name ?? nickOf('seat' + s)))

  // ---------- network ----------
  const url = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/splat?m=${id}&t=${encodeURIComponent(token())}`
  const open = () => {
    if (dead) return
    const w = (ws = new WebSocket(url()))
    w.onopen = () => (retry = 0)
    w.onmessage = (ev) => {
      let j: any
      try { j = JSON.parse(String(ev.data)) } catch { return }
      lastMsg = performance.now()
      if (j.t === 'init') { init = j; skew = j.now - Date.now() }
      else if (j.t === 's' && init) take(j as Snap)
    }
    w.onclose = () => {
      if (dead || ws !== w) return
      retry = Math.min(retry + 1, 5)
      // a plain call renews an expired session token (re-signing in the wallet) before the socket reconnects
      setTimeout(() => void api.me().catch(() => {}).then(open), 250 * retry)
    }
    w.onerror = () => w.close()
  }
  const take = (s: Snap) => {
    if (cur && s.k <= cur.k) return
    cur = s
    const now = performance.now()
    buf.push({ k: s.k, at: now, s })
    if (buf.length > 10) buf.shift()
    // the server clock in our own time: follow the fastest arrivals closely, the slow ones gently
    const sample = now - s.k * TICK_MS
    clockOff = clockOff === null ? sample : clockOff + (sample - clockOff) * (sample < clockOff ? 0.3 : 0.02)
    for (const e of s.e) onEvent(e)
    reconcile(s)
  }
  const live = () => !!init && !!cur && !cur.over && Date.now() + skew >= init.startsAt
  /** Replay the inputs the server has not seen yet on top of where it says we are. */
  const reconcile = (s: Snap) => {
    if (!init) return
    const me = s.p[init.seat]
    if (!me) return
    while (pending.length && pending[0].q <= (s.q?.[init.seat] ?? 0)) pending.shift()
    const dashing = me[8] >= DASH_CD
    if (!me[6] || dashing || !pred) {
      predPrev = pred ?? { x: me[0], y: me[1] }
      pred = { x: me[0], y: me[1] }
      predAt = performance.now()
      if (!me[6]) pending.length = 0
      return
    }
    let t = { x: me[0], y: me[1] }
    for (const p of pending) t = walk(t.x, t.y, p.mx * SPEED, p.my * SPEED, init.walls)
    const err = Math.hypot(t.x - pred.x, t.y - pred.y)
    if (err > 60) { predPrev = t; pred = t; predAt = performance.now() }
    else if (err > 0.5) {
      predPrev = drawnPred()
      pred = { x: pred.x + (t.x - pred.x) * 0.3, y: pred.y + (t.y - pred.y) * 0.3 }
      predAt = performance.now()
    }
  }
  const drawnPred = () => {
    if (!pred) return { x: 0, y: 0 }
    const a = Math.min(1, (performance.now() - predAt) / TICK_MS)
    return { x: predPrev.x + (pred.x - predPrev.x) * a, y: predPrev.y + (pred.y - predPrev.y) * a }
  }
  let lastHitSfx = 0
  const onEvent = (e: Snap['e'][number]) => {
    if (!init) return
    const me = init.seat
    if (e.t === 'out') {
      const line = e.by === undefined ? `${nameOf(e.seat)} ${e.seat === me ? 'were' : 'was'} caught by the zone` : `${nameOf(e.by)} splatted ${nameOf(e.seat)}`
      feed.push({ text: line, at: performance.now() })
      if (e.seat === me) { buzz([80, 40, 80]); sfx('ui/wrong') }
    } else if (e.t === 'hit' && e.seat === me) {
      buzz(40)
      if (performance.now() - lastHitSfx > 250) { lastHitSfx = performance.now(); sfx('game/pool-hit', 0.4) }
    } else if (e.t === 'pick' && e.seat === me) sfx('reward/coin', 0.3)
    else if (e.t === 'fire' && e.seat === me) sfx('game/bubble-shoot', 0.15)
  }
  const sendInput = () => {
    if (!ws || ws.readyState !== 1 || !init) return
    let mx = move.x
    let my = move.y
    if (!move.on) {
      mx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
      my = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0)
    }
    let ax = aim.x
    let ay = aim.y
    let f = aim.on && Math.hypot(ax, ay) > 0.3
    if (!aim.on && mouseAim && cur) {
      const me = pred ?? { x: cur.p[init.seat][0], y: cur.p[init.seat][1] }
      ax = mouseAim.x - (Array.isArray(me) ? me[0] : me.x)
      ay = mouseAim.y - (Array.isArray(me) ? me[1] : me.y)
      f = mouseFire
    }
    const q = ++seq
    const px = +mx.toFixed(2)
    const py = +my.toFixed(2)
    ws.send(JSON.stringify({ t: 'i', q, mx: px, my: py, ax: +ax.toFixed(2), ay: +ay.toFixed(2), f, d: dashLatch }))
    myAim = Math.hypot(ax, ay) > 0.3 ? Math.atan2(ay, ax) : null
    if (live() && pred && cur?.p[init.seat]?.[6] && (cur.p[init.seat][8] ?? 0) < DASH_CD && !dashLatch) {
      // walk our own blob now, the same way the server will
      const ml = Math.hypot(px, py)
      const k = ml > 1 ? 1 / ml : 1
      pending.push({ q, mx: px * k, my: py * k })
      if (pending.length > 90) pending.shift()
      predPrev = drawnPred()
      pred = walk(pred.x, pred.y, px * k * SPEED, py * k * SPEED, init.walls)
      predAt = performance.now()
    } else pending.length = 0
    dashLatch = false
  }
  const sender = setInterval(sendInput, TICK_MS)

  // ---------- controls ----------
  const stick = (el: HTMLElement, st: Stick) => {
    const knob = el.querySelector('i') as HTMLElement
    const R = 32
    let pid = -1
    const set = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      let dx = ev.clientX - (r.left + r.width / 2)
      let dy = ev.clientY - (r.top + r.height / 2)
      const l = Math.hypot(dx, dy)
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R }
      st.x = dx / R
      st.y = dy / R
      knob.style.transform = `translate(${dx}px,${dy}px)`
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      pid = -1
      st.on = false
      st.x = 0
      st.y = 0
      knob.style.transform = ''
      el.classList.remove('hold')
    }
    el.addEventListener('pointerdown', (ev) => {
      if (pid !== -1) return
      pid = ev.pointerId
      el.setPointerCapture(pid)
      st.on = true
      el.classList.add('hold')
      set(ev)
      ev.preventDefault()
    })
    el.addEventListener('pointermove', (ev) => { if (ev.pointerId === pid) set(ev) })
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  stick($('#stm', ctx.root)!, move)
  stick($('#sta', ctx.root)!, aim)
  const dash = $('#dash', ctx.root) as HTMLButtonElement
  dash.addEventListener('pointerdown', (ev) => { dashLatch = true; ev.preventDefault() })
  const kd = (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase()
    if (k === ' ') { dashLatch = true; ev.preventDefault() } else if ('wasd'.includes(k) && k.length === 1 || k.startsWith('arrow')) { keys.add(k); ev.preventDefault() }
  }
  const ku = (ev: KeyboardEvent) => keys.delete(ev.key.toLowerCase())
  const toWorld = (ev: PointerEvent) => {
    const r = cv.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * ARENA, y: ((ev.clientY - r.top) / r.height) * ARENA }
  }
  cv.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') mouseAim = toWorld(ev) })
  cv.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse') { mouseAim = toWorld(ev); mouseFire = true } })
  const up = () => (mouseFire = false)
  addEventListener('keydown', kd)
  addEventListener('keyup', ku)
  addEventListener('pointerup', up)

  // ---------- drawing ----------
  const size = () => {
    const r = wrap.getBoundingClientRect()
    const d = Math.min(2, devicePixelRatio || 1)
    const px = Math.max(100, Math.round(r.width * d))
    if (cv.width !== px) { cv.width = px; cv.height = px }
  }
  const ro = new ResizeObserver(size)
  ro.observe(wrap)
  size()

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const draw = () => {
    raf = requestAnimationFrame(draw)
    const k = cv.width / ARENA
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, cv.width, cv.height)
    g.fillStyle = PAPER
    g.fillRect(0, 0, cv.width, cv.height)
    if (!init || !cur) return
    // others are drawn two and a half ticks behind the newest snapshot and blended between two snapshots
    const rk = clockOff === null ? cur.k : (performance.now() - clockOff) / TICK_MS - 2.5
    let lo = buf[0]
    let hi = buf[0]
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].k <= rk) lo = buf[i]
      if (buf[i].k >= rk) { hi = buf[i]; break }
      hi = buf[i]
    }
    const a = hi.k === lo.k ? 1 : Math.max(0, Math.min(1, (rk - lo.k) / (hi.k - lo.k)))
    const view = a < 0.5 ? lo.s : hi.s
    // zone: outside the circle is tinted
    g.fillStyle = ZONE_TINT
    g.beginPath()
    g.rect(0, 0, cv.width, cv.height)
    g.arc(CX * k, CY * k, cur.z * k, 0, Math.PI * 2, true)
    g.fill('evenodd')
    g.strokeStyle = '#D0432E'
    g.lineWidth = Math.max(2, 3 * k * 2)
    g.beginPath()
    g.arc(CX * k, CY * k, cur.z * k, 0, Math.PI * 2)
    g.stroke()
    // pickups
    init.spots.forEach((sp, i) => {
      const on = cur!.u[i] === 1
      const r = Math.max(8, 22 * k)
      g.beginPath()
      if (sp.kind === 'ammo') g.rect(sp.x * k - r, sp.y * k - r, r * 2, r * 2)
      else g.arc(sp.x * k, sp.y * k, r, 0, Math.PI * 2)
      g.fillStyle = on ? (sp.kind === 'ammo' ? '#F4B323' : '#1F78C4') : PAPER
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = on ? INK : '#B8BBD3'
      g.stroke()
      if (on) {
        g.fillStyle = INK
        g.font = `800 ${Math.round(r * 1.1)}px system-ui, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(sp.kind === 'ammo' ? 'A' : 'S', sp.x * k, sp.y * k + 1)
      }
    })
    // walls
    g.fillStyle = INK
    for (const w of init.walls) g.fillRect(w.x * k, w.y * k, w.w * k, w.h * k)
    // bullets
    for (const b0 of view.b) {
      // find the same bullet in the other snapshot (same owner, nearest) and blend
      const other = (view === hi.s ? lo.s : hi.s).b
      let near: number[] | null = null
      let nd = 28 * 28
      for (const o of other) if (o[2] === b0[2]) { const d = (o[0] - b0[0]) ** 2 + (o[1] - b0[1]) ** 2; if (d < nd) { nd = d; near = o } }
      const t = view === hi.s ? 1 - a : a // how far from `view` towards `near`
      const b = near ? [lerp(b0[0], near[0], t), lerp(b0[1], near[1], t), b0[2]] : b0
      g.beginPath()
      g.arc(b[0] * k, b[1] * k, Math.max(3.5, 7 * k * 1.2), 0, Math.PI * 2)
      g.fillStyle = SEAT_COL[b[2] % SEAT_COL.length]
      g.fill()
      g.lineWidth = 1.5
      g.strokeStyle = INK
      g.stroke()
    }
    // players
    const R = Math.max(10, PR * k)
    const meSeat = init.seat
    const tagRef: { v: { x: number; y: number } | null } = { v: null }
    cur.p.forEach((pc, i) => {
      if (!pc[6]) return
      const mine = i === meSeat
      const q = lo.s.p[i]
      const n = hi.s.p[i]
      const p = pc
      let wx = q && n && q[6] && n[6] ? lerp(q[0], n[0], a) : pc[0]
      let wy = q && n && q[6] && n[6] ? lerp(q[1], n[1], a) : pc[1]
      if (mine && pred) { const d = drawnPred(); wx = d.x; wy = d.y }
      const x = wx * k
      const y = wy * k
      const col = SEAT_COL[i % SEAT_COL.length]
      const aim = mine && myAim !== null ? myAim : (a < 0.5 ? (q ?? p)[2] : (n ?? p)[2])
      if (mine) {
        // a thick white ring inside a dark one so your blob stands out on any colour
        g.beginPath()
        g.arc(x, y, R + 7, 0, Math.PI * 2)
        g.fillStyle = INK
        g.fill()
        g.beginPath()
        g.arc(x, y, R + 4, 0, Math.PI * 2)
        g.fillStyle = '#fff'
        g.fill()
      }
      g.lineCap = 'round'
      g.strokeStyle = INK
      g.lineWidth = Math.max(4, R * 0.5)
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(aim) * (R + (mine ? 12 : 6)), y + Math.sin(aim) * (R + (mine ? 12 : 6)))
      g.stroke()
      g.beginPath()
      g.arc(x, y, R, 0, Math.PI * 2)
      g.fillStyle = col
      g.fill()
      g.lineWidth = 2.5
      g.strokeStyle = INK
      g.stroke()
      if (p[4] > 0) {
        g.beginPath()
        g.arc(x, y, R + (mine ? 10 : 4), 0, Math.PI * 2)
        g.lineWidth = 3
        g.strokeStyle = '#1F78C4'
        g.stroke()
      }
      g.fillStyle = col === '#F4B323' || col === '#F29AAE' ? INK : '#fff'
      g.font = `800 ${Math.round(R * 1.1)}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText((nameOf(i)[0] ?? '?').toUpperCase(), x, y + 1)
      // hit points as little squares above the player
      for (let h = 0; h < MAX_HP; h++) {
        g.fillStyle = h < p[3] ? '#D0432E' : PAPER
        g.strokeStyle = INK
        g.lineWidth = 1.5
        const hx = x + (h - 1) * 7 - 3
        g.fillRect(hx, y - R - 11 - (mine ? 7 : 0), 6, 6)
        g.strokeRect(hx, y - R - 11 - (mine ? 7 : 0), 6, 6)
      }
      const fs = Math.max(Math.round(11 * (cv.width / Math.max(1, wrap.clientWidth))), Math.round(R * 0.6))
      g.font = `800 ${fs}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      if (mine) {
        // YOU tag above the blob
        const tw = g.measureText('YOU').width + 12
        const ty = Math.max(fs / 2 + 4, y - R - 28 - (mine ? 7 : 0))
        const tx = Math.max(tw / 2 + 2, Math.min(cv.width - tw / 2 - 2, x))
        g.fillStyle = INK
        g.beginPath()
        g.roundRect(tx - tw / 2, ty - fs / 2 - 3, tw, fs + 6, 6)
        g.fill()
        g.fillStyle = '#fff'
        g.fillText('YOU', tx, ty + 1)
        tagRef.v = { x, y }
      } else {
        // nickname under the blob, with a paper halo so it reads on every background
        const nm = nameOf(i)
        const ny = Math.min(cv.height - fs / 2 - 2, y + R + fs * 0.9)
        const nx = Math.max(g.measureText(nm).width / 2 + 2, Math.min(cv.width - g.measureText(nm).width / 2 - 2, x))
        g.lineJoin = 'round'
        g.lineWidth = 4
        g.strokeStyle = PAPER
        g.strokeText(nm, nx, ny)
        g.fillStyle = col === '#F4B323' || col === '#F29AAE' ? INK : col
        g.fillText(nm, nx, ny)
      }
    })
    // off-screen arrow: if your blob is ever outside the view, point to it from the edge
    const tag = tagRef.v
    if (tag && (tag.x < 0 || tag.y < 0 || tag.x > cv.width || tag.y > cv.height)) {
      const ex = Math.max(16, Math.min(cv.width - 16, tag.x))
      const ey = Math.max(16, Math.min(cv.height - 16, tag.y))
      const ang = Math.atan2(tag.y - ey, tag.x - ex)
      g.save()
      g.translate(ex, ey)
      g.rotate(ang)
      g.fillStyle = INK
      g.strokeStyle = '#fff'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(12, 0)
      g.lineTo(-8, -9)
      g.lineTo(-8, 9)
      g.closePath()
      g.stroke()
      g.fill()
      g.restore()
    }
    hud()
  }

  // ---------- HUD ----------
  const hud = () => {
    if (!init || !cur) return
    const me = cur.p[init.seat]
    const alive = cur.p.filter((p) => p[6]).length
    const left = Math.max(0, init.cap - cur.k) * TICK_MS
    const sig = [me[3], me[4], me[5], me[6], me[7], alive, Math.floor(left / 1000), cur.over, Math.round((me[8] / DASH_CD) * 10), feed.length].join()
    const msg = $('#msg', ctx.root)!
    const quiet = performance.now() - lastMsg > 1500
    msg.style.display = quiet || cur.over || !me[6] ? 'block' : 'none'
    msg.textContent = cur.over ? 'Match over, adding it up…' : quiet ? 'Reconnecting…' : 'You are out. Watching the rest'
    for (let i = feed.length - 1; i >= 0; i--) if (performance.now() - feed[i].at > 4500) feed.splice(i, 1)
    if (sig === hudSig) return
    hudSig = sig
    $('#tm', ctx.root)!.textContent = fmtTime(left)
    $('#hud', ctx.root)!.innerHTML = `<span class="spl-hearts" aria-label="${me[3]} hit points">${Array.from({ length: MAX_HP }, (_, i) => `<i class="${i < me[3] ? 'on' : ''}">${ic('heart', 's20')}</i>`).join('')}${me[4] ? `<i class="sh on" aria-label="Shield">${ic('shield-check', 's20')}</i>` : ''}</span>
      <span class="spl-ammo" aria-label="${me[5]} shots">${Array.from({ length: MAX_AMMO }, (_, i) => `<i class="${i < me[5] ? 'on' : ''}"></i>`).join('')}</span>
      <span class="spl-alive"><b>${alive}</b> alive · <b>${me[7]}</b> ${me[7] === 1 ? 'splat' : 'splats'}</span>`
    ;($('#dcd', ctx.root) as HTMLElement).style.height = (me[8] / DASH_CD) * 100 + '%'
    dash.disabled = !me[6] || cur.over
    $('#feed', ctx.root)!.innerHTML = feed.map((f) => `<span>${esc(f.text)}</span>`).join('')
    ;($('#pad', ctx.root) as HTMLElement).classList.toggle('off', !me[6])
  }
  const feedTimer = setInterval(() => { hudSig = '' }, 1000)

  open()
  raf = requestAnimationFrame(draw)
  return {
    update() {},
    destroy() {
      dead = true
      cancelAnimationFrame(raf)
      clearInterval(sender)
      clearInterval(feedTimer)
      ro.disconnect()
      removeEventListener('keydown', kd)
      removeEventListener('keyup', ku)
      removeEventListener('pointerup', up)
      try { ws?.close() } catch { /* already closed */ }
    },
  }
}
