import { api, serverNow } from '../api'
import { $, blokadePlace, buzz, esc, fmtTime, ic, isMuted, pipImg, setBlokadePlace, setMuted, sfx, toast } from '../lib'
import { finishBtn, others, wireFinish, type GameMod } from './common'
import { applyMove, canPlaceWall, cloneBoard, isJump, legalPawnMoves, legalWalls, samePos, startBoard, winnerOf, type Board, type Move, type Pos, type Side, type Wall, type WallDir } from '../../../shared/blokade'
import { blokadeScore, DEFAULT_CLOCK, initBlokade, sideOf, type BlokadeLive } from '../../../shared/blokadegame'
import { pipBlokade } from '../../../shared/blokadeai'
import type { PipLevel } from '../../../shared/types'

const HEX = (fill: string, dash = false) =>
  `<svg class="bk-token" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 1.6l8.6 5v10.8L12 22.4 3.4 17.4V6.6z" fill="${dash ? 'none' : fill}" stroke="${dash ? '#C98E0A' : '#1F2348'}" stroke-width="1.7" stroke-linejoin="round"${dash ? ' stroke-dasharray="2.6 2.2"' : ''}/></svg>`

const flipPos = (p: Pos, flip: boolean): Pos => (flip ? { r: 8 - p.r, c: 8 - p.c } : p)
const flipWall = (w: Wall, flip: boolean): Wall => (flip ? { ...w, r: 7 - w.r, c: 7 - w.c } : w)
const gPos = (r: number, c: number) => `grid-column:${2 * c + 1};grid-row:${2 * r + 1}`
const gH = (r: number, c: number) => `grid-column:${2 * c + 1}/${2 * c + 5};grid-row:${2 * (r + 1)}`
const gV = (r: number, c: number) => `grid-column:${2 * (c + 1)};grid-row:${2 * r + 1}/${2 * r + 5}`

function slotAt(boardEl: HTMLElement, clientX: number, clientY: number, dir: WallDir, flip: boolean): Wall | null {
  const rec = boardEl.getBoundingClientRect()
  const pad = 3
  const gap = 2
  const inner = rec.width - pad * 2
  const cell = (inner - 8 * gap) / 9
  const x = clientX - rec.left - pad
  const y = clientY - rec.top - pad
  if (dir === 'h') {
    let best: Wall | null = null
    let bd = Infinity
    for (let r = 0; r <= 7; r++)
      for (let c = 0; c <= 7; c++) {
        const gy = (r + 1) * cell + r * gap
        const gx = c * (cell + gap) + cell
        const d = Math.abs(y - gy) + Math.abs(x - gx) * 0.35
        if (d < bd) {
          bd = d
          best = { dir: 'h', r, c }
        }
      }
    if (!best || Math.abs(y - ((best.r + 1) * cell + best.r * gap)) > cell * 0.55) return null
    return flip ? flipWall(best, true) : best
  }
  let best: Wall | null = null
  let bd = Infinity
  for (let r = 0; r <= 7; r++)
    for (let c = 0; c <= 7; c++) {
      const gx = (c + 1) * cell + c * gap
      const gy = r * (cell + gap) + cell
      const d = Math.abs(x - gx) + Math.abs(y - gy) * 0.35
      if (d < bd) {
        bd = d
        best = { dir: 'v', r, c }
      }
    }
  if (!best || Math.abs(x - ((best.c + 1) * cell + best.c * gap)) > cell * 0.55) return null
  return flip ? flipWall(best, true) : best
}

export const playBlokade = (kind: 'pip' | 'live'): GameMod => (ctx) => {
  const level = (ctx.m.pipLevel ?? 'med') as PipLevel
  const seat = ctx.m.players.findIndex((p) => p.player.address === ctx.me)
  const opp = others(ctx.m, ctx.me)[0]
  const pip = kind === 'pip' || !!opp?.isBot
  let live = (ctx.m.live as BlokadeLive | undefined) ?? (pip ? initBlokade(ctx.m.seed || 'pip', Date.now(), DEFAULT_CLOCK) : null)
  if (!live) {
    ctx.root.innerHTML = `<div class="scroll center" style="justify-content:center;padding:24px">Waiting for the board…</div>`
    return { update: (m) => { if (m.live) { live = m.live as BlokadeLive; boot() } }, destroy: () => {} }
  }
  // vs Nimo the human is always south (like chess White)
  if (pip) live.south = 0

  let board: Board = cloneBoard(live.board)
  let mine: Side = pip ? 's' : sideOf(live, (seat >= 0 ? seat : 0) as 0 | 1)
  const flip = mine === 'n'
  let lastFrom: Pos | null = null
  let done = false
  let busy = false
  let thinking = false
  let status = ''
  let place: 'drag' | 'tap' = blokadePlace()
  let dir: WallDir = 'h'
  let ghost: Wall | null = null
  let drag: { dir: WallDir; x: number; y: number } | null = null
  let warned: Record<string, boolean> = {}
  const started = Date.now()
  const timers: ReturnType<typeof setTimeout>[] = []
  let tick: ReturnType<typeof setInterval> | undefined
  let dead = false

  const colorOf = (side: Side) => (side === mine ? 'blue' : 'gold')
  const wallsLeft = (side: Side) => board.left[side]

  const clocks = () => {
    if (pip) return { s: 0, n: 0 }
    const out = { ...live!.leftMs }
    if (!live!.over) {
      const side = board.turn
      out[side] = Math.max(0, out[side] - (serverNow() - live!.lastAt))
    }
    return out
  }

  const message = () => {
    if (done || live!.over) {
      const w = live!.over?.winner ?? winnerOf(board)
      return !w ? 'Draw' : w === mine ? 'You win' : pip ? 'Nimo wins' : 'You lose'
    }
    if (thinking) return 'Nimo is thinking…'
    if (drag) return 'Release on a glow to place. Anywhere else bounces back.'
    if (place === 'tap' && ghost) return 'Tap Confirm or the same groove to place. Tap elsewhere to cancel.'
    if (board.turn === mine) return place === 'tap' ? 'Your move · tap a lit square, or pick Flat or Standing' : 'Your move · tap a lit square, or drag a wall'
    return pip ? 'Nimo is thinking…' : `${esc((opp?.player.name || 'Rival').split(' ')[0])} is thinking…`
  }

  const renderBoard = () => {
    const legal = !done && board.turn === mine && !thinking ? legalPawnMoves(board, mine) : []
    const glows = drag && board.turn === mine && !done ? legalWalls(board, mine).filter((w) => w.dir === drag!.dir) : []
    const cells: string[] = []
    for (let vr = 0; vr < 9; vr++)
      for (let vc = 0; vc < 9; vc++) {
        const p = flipPos({ r: vr, c: vc }, flip)
        const cls = ['sqr', (vr + vc) % 2 ? 'dk' : 'lt']
        if (vr === 0) cls.push('goal-n')
        if (vr === 8) cls.push('goal-s')
        if (legal.some((x) => samePos(x, p))) cls.push('legal')
        let inner = ''
        if (samePos(board.pawns[mine], p)) inner = HEX('#1F78C4')
        else if (samePos(board.pawns[mine === 's' ? 'n' : 's'], p)) inner = HEX('#F4B323')
        else if (lastFrom && samePos(lastFrom, p)) inner = HEX('#C98E0A', true)
        cells.push(`<button class="${cls.join(' ')}" style="${gPos(vr, vc)}" data-cell="${p.r},${p.c}" aria-label="square">${inner}</button>`)
      }
    const wallHtml = board.walls
      .map((w) => {
        const v = flipWall(w, flip)
        const who = w.by === mine || (!w.by && false) ? 'blue' : w.by ? colorOf(w.by) : 'gold'
        // if by is missing, fall back: can't know — gold if not ours. applyMove always sets by.
        const col = w.by ? colorOf(w.by) : 'gold'
        return `<div class="bk-wall ${v.dir} ${col}" style="${v.dir === 'h' ? gH(v.r, v.c) : gV(v.r, v.c)}"></div>`
      })
      .join('')
    const glowHtml = glows
      .map((w) => {
        const v = flipWall(w, flip)
        return `<div class="bk-glow ${v.dir}" style="${v.dir === 'h' ? gH(v.r, v.c) : gV(v.r, v.c)}"></div>`
      })
      .join('')
    const ghostHtml = ghost
      ? (() => {
          const v = flipWall(ghost, flip)
          return `<div class="bk-wall ${v.dir} blue ghost" style="${v.dir === 'h' ? gH(v.r, v.c) : gV(v.r, v.c)}"></div>`
        })()
      : ''
    const hits = !drag && place === 'tap'
      ? legalWalls(board, mine)
          .filter((w) => w.dir === dir)
          .map((w) => {
            const v = flipWall(w, flip)
            return `<button class="bk-hit ${v.dir}" style="${v.dir === 'h' ? gH(v.r, v.c) : gV(v.r, v.c)}" data-wall="${w.dir},${w.r},${w.c}" aria-label="groove"></button>`
          })
          .join('')
      : ''
    return cells.join('') + wallHtml + glowHtml + ghostHtml + hits
  }

  const strip = (side: Side, top: boolean) => {
    const me = side === mine
    const clk = clocks()
    const showClk = !pip
    const name = me ? 'You' : pip ? `Nimo (${{ easy: 'Easy', med: 'Medium', hard: 'Hard' }[level]})` : esc(opp?.player.name || 'Rival')
    const av = me ? '<span class="you">You</span>' : pip ? pipImg(thinking ? 'think' : 'cool') : ''
    const avHtml = me || pip ? av : `<img src="/avatars/${esc(opp?.player.avatar || 'kai')}.svg" alt="">`
    // avatar() would be nicer but path is fine if we use the helper - keep img for non-pip
    return `<div class="cp ${board.turn === side && !done ? 'act' : ''}"><span class="cav">${me || pip ? av : `<img src="/avatars/${esc(opp!.player.avatar)}.svg" alt="">`}</span><b>${name}</b><span class="mono">${wallsLeft(side)} walls</span>${showClk ? `<span class="clk" data-side="${side}">${fmtTime(clk[side])}</span>` : ''}</div>`
  }

  const draw = () => {
    const boardEl = $('#bk-board', ctx.root)
    const st = $('#cst', ctx.root)
    const top = $('#cs-t', ctx.root)
    const bot = $('#cs-b', ctx.root)
    const tools = $('#bk-tools', ctx.root)
    if (boardEl) boardEl.innerHTML = renderBoard()
    if (st) st.textContent = message()
    if (top) top.innerHTML = strip(mine === 's' ? 'n' : 's', true)
    if (bot) bot.innerHTML = strip(mine, false)
    if (tools) {
      const canWall = !done && board.turn === mine && !thinking && board.left[mine] > 0
      tools.innerHTML = `<div class="wallbtns">
        <button class="wbtn ${dir === 'h' && (place === 'tap' || drag?.dir === 'h') ? 'on' : ''}" data-dir="h" ${canWall ? '' : 'disabled'}><span class="mini h"></span>Flat</button>
        <button class="wbtn ${dir === 'v' && (place === 'tap' || drag?.dir === 'v') ? 'on' : ''}" data-dir="v" ${canWall ? '' : 'disabled'}><span class="mini v"></span>Standing</button>
      </div>
      <div class="bk-modes"><div class="pick" role="radiogroup" aria-label="Wall placement">${(['drag', 'tap'] as const).map((m) => `<button class="pc ${place === m ? 'on' : ''}" data-place="${m}" role="radio" aria-checked="${place === m}">${place === m ? ic('check') : ''}${m === 'drag' ? 'Drag' : 'Tap'}</button>`).join('')}</div></div>
      <div class="hint">${place === 'tap' ? (ghost ? 'Tap Confirm or the same groove to place' : 'Tap Flat or Standing, then a groove') : 'Drag a wall from Flat or Standing, or tap a lit square to move'}</div>
      ${place === 'tap' && ghost && canWall ? `<button class="btn gold sm block" data-confirm>Place wall</button><button class="btn ghost sm block" data-cancel>Cancel</button>` : ''}`
    }
    const spk = $('#bk-spk', ctx.root)
    if (spk) spk.innerHTML = ic(isMuted() ? 'volume-x' : 'volume-2', 's20')
  }

  const paintClocks = () => {
    if (pip || done || live!.over) return
    const c = clocks()
    for (const side of ['s', 'n'] as Side[]) {
      const el = ctx.root.querySelector(`[data-side="${side}"]`)
      if (el) el.textContent = fmtTime(c[side])
      if (c[side] <= 10_000 && c[side] > 0 && !warned[side] && board.turn === side) {
        warned[side] = true
        sfx('ui/countdown-last')
        buzz(20)
      }
    }
  }

  const end = async (score: number, reason: string) => {
    if (done) return
    done = true
    thinking = false
    ghost = null
    drag = null
    sfx(score === 1 ? 'reward/win' : score === 0 ? 'reward/lose' : 'reward/draw')
    if (score === 1) buzz([60, 40, 60])
    draw()
    if (kind === 'pip') await ctx.finish({ score, time: Date.now() - started, detail: { reason, moves: live!.moves.length } })
  }

  const afterLocal = (mv: Move) => {
    const from = board.pawns[mine]
    const prevTurn = board.turn
    // board already updated by caller
    if (mv.kind === 'pawn') {
      lastFrom = from
      sfx(isJump(from, { r: mv.r, c: mv.c }) ? 'game/blokade-jump' : 'game/blokade-step')
      buzz(8)
    } else {
      sfx('game/blokade-wall')
      buzz(16)
    }
    const w = winnerOf(board)
    if (w) {
      live!.over = { winner: w, reason: 'goal' }
      void end(w === mine ? 1 : 0, 'goal')
      return
    }
    draw()
    if (pip && board.turn !== mine && !done) nimoTurn()
  }

  const applyLocal = (mv: Move) => {
    const next = applyMove(board, board.turn, mv)
    board = next
    live!.board = next
    live!.moves = [...live!.moves, mv]
    afterLocal(mv)
  }

  const sendLive = async (body: unknown) => {
    if (busy || dead || done) return
    busy = true
    try {
      const v = await api.move(ctx.m.id, body)
      ctx.sync(v)
      if (v.live) adopt(v.live as BlokadeLive, false)
    } catch (e: any) {
      toast(e.message || 'That move did not go through')
      sfx('game/blokade-invalid')
      board = cloneBoard(live!.board)
      draw()
    } finally {
      busy = false
    }
  }

  const playMove = (mv: Move) => {
    if (done || busy || thinking || board.turn !== mine) return
    ghost = null
    if (kind === 'live') {
      try {
        const prev = cloneBoard(board)
        const from = board.pawns[mine]
        board = applyMove(board, mine, mv)
        if (mv.kind === 'pawn') lastFrom = from
        sfx(mv.kind === 'wall' ? 'game/blokade-wall' : mv.kind === 'pawn' && isJump(from, { r: mv.r, c: mv.c }) ? 'game/blokade-jump' : 'game/blokade-step')
        draw()
        void sendLive(mv)
      } catch {
        sfx('game/blokade-invalid')
        buzz(12)
      }
      return
    }
    try {
      applyLocal(mv)
    } catch {
      sfx('game/blokade-invalid')
      buzz(12)
    }
  }

  const nimoTurn = () => {
    if (!pip || done || board.turn === mine) return
    thinking = true
    draw()
    const wait = level === 'hard' ? 420 + Math.random() * 280 : 280 + Math.random() * 420
    timers.push(
      setTimeout(() => {
        if (dead || done) return
        const mv = pipBlokade(board, level)
        thinking = false
        if (!mv) return void end(1, 'goal')
        const from = board.pawns[board.turn]
        try {
          applyLocal(mv)
        } catch {
          thinking = false
          draw()
        }
      }, wait),
    )
  }

  function adopt(next: BlokadeLive, sound: boolean) {
    const grew = next.moves.length > live!.moves.length
    const last = next.moves[next.moves.length - 1]
    if (sound && grew && last && next.board.turn === mine) {
      sfx(last.kind === 'wall' ? 'game/blokade-wall' : 'game/blokade-step')
    }
    live = next
    board = cloneBoard(next.board)
    mine = sideOf(next, (seat >= 0 ? seat : 0) as 0 | 1)
    if (next.over && !done) void end(blokadeScore(next, (seat >= 0 ? seat : 0) as 0 | 1), next.over.reason)
    else draw()
  }

  const bounce = (from: { x: number; y: number }, toBtn: HTMLElement) => {
    const layer = ctx.root
    const br = layer.getBoundingClientRect()
    const tr = toBtn.getBoundingClientRect()
    const el = document.createElement('div')
    el.className = `drag-wall ${dir === 'v' ? 'v' : ''}`
    el.style.left = from.x - br.left - 43 + 'px'
    el.style.top = from.y - br.top - 5 + 'px'
    layer.appendChild(el)
    requestAnimationFrame(() => {
      el.classList.add('back')
      el.style.left = tr.left - br.left + tr.width / 2 - 43 + 'px'
      el.style.top = tr.top - br.top + tr.height / 2 - 5 + 'px'
      el.style.opacity = '0'
    })
    setTimeout(() => el.remove(), 240)
    sfx('game/blokade-invalid')
    buzz(12)
  }

  const boot = () => {
    ctx.root.innerHTML = `<div class="top"><button class="spk" id="bk-spk" aria-label="Sound">${ic(isMuted() ? 'volume-x' : 'volume-2', 's20')}</button><div class="ttl">Blokade</div>${ctx.m.mode === 'play' ? '<span style="width:40px"></span>' : `<div class="coin nb">${ctx.m.mode === 'settle' ? 'Bill ' + ctx.m.stake : 'Pot ' + (ctx.m.stake * (ctx.m.players.length || 2))}</div>`}</div>
      <div class="scroll" style="gap:8px"><div class="cs" id="cs-t"></div><div class="bk-board" id="bk-board"></div><div class="cs" id="cs-b"></div><div class="cst" id="cst" role="status"></div><div id="bk-tools"></div>${finishBtn('Resign')}</div>`
    wireFinish(ctx.root, () => {
      if (kind === 'live') void sendLive({ resign: true })
      else void end(0, 'resign')
    }, 'Resign', 'Tap again to resign')
    draw()
    if (pip && board.turn !== mine) nimoTurn()
  }

  boot()
  tick = setInterval(() => {
    if (dead) return
    paintClocks()
    if (!pip && live && !live.over) {
      const c = clocks()
      const side = board.turn
      if (c[side] <= 0 && !done) {
        // the next poll/sync will settle; keep the strip at 0
      }
    }
  }, 250)

  const boardEl = () => $('#bk-board', ctx.root)

  ctx.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('#bk-spk')) {
      setMuted(!isMuted())
      sfx('ui/toggle')
      draw()
      return
    }
    const pl = t.closest<HTMLElement>('[data-place]')
    if (pl) {
      const m = pl.dataset.place as 'drag' | 'tap'
      place = m
      setBlokadePlace(m)
      ghost = null
      sfx('ui/select')
      draw()
      return
    }
    const cancel = t.closest('[data-cancel]')
    if (cancel) {
      ghost = null
      sfx('ui/back')
      draw()
      return
    }
    const conf = t.closest('[data-confirm]')
    if (conf && ghost && board.turn === mine) {
      playMove({ kind: 'wall', dir: ghost.dir, r: ghost.r, c: ghost.c })
      return
    }
    const wb = t.closest<HTMLElement>('.wbtn')
    if (wb && place === 'tap' && !wb.hasAttribute('disabled') && board.turn === mine) {
      dir = (wb.dataset.dir as WallDir) || 'h'
      ghost = null
      sfx('ui/select')
      draw()
      return
    }
    const cell = t.closest<HTMLElement>('[data-cell]')
    if (cell && board.turn === mine && !done) {
      const [r, c] = cell.dataset.cell!.split(',').map(Number)
      const dest = { r, c }
      if (legalPawnMoves(board, mine).some((p) => samePos(p, dest))) {
        playMove({ kind: 'pawn', r, c })
        return
      }
      if (place === 'tap' && ghost) {
        ghost = null
        sfx('ui/back')
        draw()
      }
      return
    }
    const hit = t.closest<HTMLElement>('[data-wall]')
    if (hit && place === 'tap' && board.turn === mine && !done) {
      const [d, r, c] = hit.dataset.wall!.split(',')
      const w: Wall = { dir: d as WallDir, r: Number(r), c: Number(c) }
      if (ghost && ghost.dir === w.dir && ghost.r === w.r && ghost.c === w.c) {
        playMove({ kind: 'wall', dir: w.dir, r: w.r, c: w.c })
        return
      }
      if (canPlaceWall(board, w) && board.left[mine] > 0) {
        dir = w.dir
        ghost = w
        sfx('ui/tile', 0.5)
        draw()
      } else {
        sfx('game/blokade-invalid')
        buzz(12)
      }
    }
  })

  const onDown = (e: PointerEvent) => {
    if (place !== 'drag' || done || board.turn !== mine || thinking || busy) return
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.wbtn')
    if (!btn || btn.hasAttribute('disabled') || board.left[mine] <= 0) return
    dir = (btn.dataset.dir as WallDir) || 'h'
    drag = { dir, x: e.clientX, y: e.clientY }
    ghost = null
    btn.setPointerCapture?.(e.pointerId)
    sfx('ui/tile', 0.4)
    draw()
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    drag = { ...drag, x: e.clientX, y: e.clientY }
    const el = boardEl()
    if (!el) return
    const slot = slotAt(el, e.clientX, e.clientY, drag.dir, flip)
    const legal = slot && canPlaceWall(board, slot) && board.left[mine] > 0
    ghost = legal ? slot : null
    // floating wall
    let floater = ctx.root.querySelector('.drag-wall.live') as HTMLElement | null
    if (!floater) {
      floater = document.createElement('div')
      floater.className = `drag-wall live ${drag.dir === 'v' ? 'v' : ''}`
      ctx.root.appendChild(floater)
    }
    const br = ctx.root.getBoundingClientRect()
    floater.style.left = e.clientX - br.left - (drag.dir === 'v' ? 5 : 43) + 'px'
    floater.style.top = e.clientY - br.top - (drag.dir === 'v' ? 43 : 5) + 'px'
    const boardHtml = el
    // only refresh glows/ghost if slot changed
    const prev = el.getAttribute('data-g')
    const key = ghost ? ghost.dir + ghost.r + ',' + ghost.c : ''
    if (prev !== key) {
      el.setAttribute('data-g', key)
      el.innerHTML = renderBoard()
    }
  }
  const onUp = (e: PointerEvent) => {
    if (!drag) return
    const startedDir = drag.dir
    const pos = { x: e.clientX, y: e.clientY }
    const el = boardEl()
    const slot = el ? slotAt(el, e.clientX, e.clientY, startedDir, flip) : null
    const ok = slot && canPlaceWall(board, slot) && board.left[mine] > 0
    ctx.root.querySelector('.drag-wall.live')?.remove()
    drag = null
    if (ok && slot) {
      ghost = null
      playMove({ kind: 'wall', dir: slot.dir, r: slot.r, c: slot.c })
    } else {
      ghost = null
      const btn = ctx.root.querySelector<HTMLElement>(`.wbtn[data-dir="${startedDir}"]`)
      if (btn) bounce(pos, btn)
      else sfx('game/blokade-invalid')
      draw()
    }
  }
  ctx.root.addEventListener('pointerdown', onDown)
  ctx.root.addEventListener('pointermove', onMove)
  ctx.root.addEventListener('pointerup', onUp)
  ctx.root.addEventListener('pointercancel', onUp)

  return {
    update: (m) => {
      if (kind !== 'live' || busy) return
      const next = m.live as BlokadeLive | undefined
      if (!next) return
      if (next.moves.length !== live!.moves.length || !!next.over !== !!live!.over) adopt(next, true)
      else live = { ...live!, leftMs: next.leftMs, lastAt: next.lastAt }
    },
    destroy: () => {
      dead = true
      timers.forEach(clearTimeout)
      if (tick) clearInterval(tick)
    },
  }
}
