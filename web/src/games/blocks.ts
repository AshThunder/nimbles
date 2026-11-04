import { GAME_DURATION_MS } from '../../../shared/pip'
import { BK_MIN_GAP_MS, BK_N, BK_SHAPES, BlockGame, bkColor, type BkMove } from '../../../shared/blocks'
import { $, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

const COLORS = ['#1F78C4', '#D0432E', '#1F8A5B', '#F4B323', '#F29AAE']
const INK = '#1F2348'

export const blocks: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.blocks
  const game = new BlockGame(ctx.m.seed!)
  const log: BkMove[] = []
  let done = false
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  let lastAt = -Infinity

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Block Puzzle</div><span class="tmr" id="tm">2:00</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div class="bbox" id="bb"><canvas id="cv"></canvas></div>
  <div class="row" style="justify-content:space-between;font-size:13px;color:var(--ink2)"><span id="ln"></span><span class="mono" id="pp"></span></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const bb = $('#bb', ctx.root)!
  const cv = $('#cv', ctx.root) as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const W = Math.min(bb.clientWidth || 340, 360)
  const C = Math.floor((W - 8) / BK_N) // grid cell
  const GX = Math.floor((W - C * BK_N) / 2)
  const GY = 4
  const TY = GY + C * BK_N + 14 // tray top
  const TS = Math.floor(C * 0.55) // tray cell
  const H = TY + TS * 5 + 8
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  g.scale(dpr, dpr)

  const dims = (s: number) => {
    const sh = BK_SHAPES[s]
    return { h: Math.max(...sh.map((c) => c[0])) + 1, w: Math.max(...sh.map((c) => c[1])) + 1 }
  }
  const cell = (x: number, y: number, size: number, col: string, a = 1) => {
    g.globalAlpha = a
    g.fillStyle = col
    g.fillRect(x + 1, y + 1, size - 2, size - 2)
    g.lineWidth = 2
    g.strokeStyle = INK
    g.strokeRect(x + 1, y + 1, size - 2, size - 2)
    g.globalAlpha = 1
  }
  const slotX = (i: number) => (W / 3) * i + W / 6
  let drag: { slot: number; x: number; y: number } | null = null
  const target = () => {
    if (!drag) return null
    const s = game.slots[drag.slot]!
    const d = dims(s)
    const r = Math.round((drag.y - C * 1.7 - (d.h * C) / 2 - GY) / C)
    const c = Math.round((drag.x - (d.w * C) / 2 - GX) / C)
    return { r, c, ok: game.fits(s, r, c) }
  }
  const flashes: { x: number; y: number; a: number }[] = []
  const draw = () => {
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#ECE5D5'
    g.fillRect(GX, GY, C * BK_N, C * BK_N)
    for (let r = 0; r < BK_N; r++)
      for (let c = 0; c < BK_N; c++) {
        const v = game.grid[r][c]
        if (v >= 0) cell(GX + c * C, GY + r * C, C, COLORS[v])
        else {
          g.strokeStyle = 'rgba(31,35,72,.14)'
          g.lineWidth = 1
          g.strokeRect(GX + c * C + 0.5, GY + r * C + 0.5, C - 1, C - 1)
        }
      }
    g.strokeStyle = INK
    g.lineWidth = 2
    g.strokeRect(GX, GY, C * BK_N, C * BK_N)
    const t = target()
    if (drag && t?.ok) for (const [dr, dc] of BK_SHAPES[game.slots[drag.slot]!]) cell(GX + (t.c + dc) * C, GY + (t.r + dr) * C, C, COLORS[bkColor(game.slots[drag.slot]!)], 0.4)
    game.slots.forEach((s, i) => {
      if (s === null || (drag && drag.slot === i)) return
      const d = dims(s)
      const fits = game.canPlaceAny(s)
      for (const [dr, dc] of BK_SHAPES[s]) cell(slotX(i) - (d.w * TS) / 2 + dc * TS, TY + (5 * TS - d.h * TS) / 2 + dr * TS, TS, COLORS[bkColor(s)], fits ? 1 : 0.35)
    })
    if (drag) {
      const s = game.slots[drag.slot]!
      const d = dims(s)
      for (const [dr, dc] of BK_SHAPES[s]) cell(drag.x - (d.w * C) / 2 + dc * C, drag.y - C * 1.7 - (d.h * C) / 2 + dr * C, C, COLORS[bkColor(s)])
    }
    for (const f of flashes) {
      g.fillStyle = `rgba(255,252,245,${f.a})`
      g.fillRect(f.x, f.y, C, C)
    }
  }
  const hud = () => {
    $('#ln', ctx.root)!.textContent = `${game.lines} line${game.lines === 1 ? '' : 's'} cleared`
    $('#pp', ctx.root)!.textContent = `${game.placed} placed`
  }
  const pos = (e: PointerEvent): [number, number] => {
    const b = cv.getBoundingClientRect()
    return [((e.clientX - b.left) / b.width) * W, ((e.clientY - b.top) / b.height) * H]
  }
  cv.addEventListener('pointerdown', (e) => {
    if (done || drag) return
    const [x, y] = pos(e)
    if (y < TY - 6) return
    const slot = Math.min(2, Math.max(0, Math.floor(x / (W / 3))))
    if (game.slots[slot] === null) return
    cv.setPointerCapture(e.pointerId)
    drag = { slot, x, y }
    sfx('ui/select', 0.3)
  })
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return
    const [x, y] = pos(e)
    drag.x = x
    drag.y = y
  })
  const drop = (cancel: boolean) => {
    if (!drag) return
    const t = target()
    const slot = drag.slot
    drag = null
    if (cancel || !t || !t.ok) return
    const at = Math.max(now(), lastAt + BK_MIN_GAP_MS)
    const res = game.place(slot, t.r, t.c)
    if (!res) return
    lastAt = at
    log.push([slot, t.r, t.c, at])
    const n = res.rows.length + res.cols.length
    sfx(n ? 'game/bubble-pop' : 'game/card-slide', n ? 0.8 : 0.5)
    if (n) {
      buzz(18)
      if (n > 1) sfx('reward/bonus', 0.6)
    }
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: game.score })
    ctx.progress(game.score)
    hud()
    if (game.over) setTimeout(() => void end(), 700)
  }
  cv.addEventListener('pointerup', () => drop(false))
  cv.addEventListener('pointercancel', () => drop(true))

  let raf = 0
  const frame = () => {
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
    await ctx.finish({ score: game.score, time: Math.min(total, Math.max(now(), lastAt)), detail: { moves: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: game.score }),
    destroy: () => {
      done = true
      cancelAnimationFrame(raf)
      clk.stop()
    },
  }
}
