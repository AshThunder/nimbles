import { Chess, type Move, type Square } from 'chess.js'
import { replayChess, type ChessLive, type Side } from '../../../shared/chessgame'
import { api, serverNow } from '../api'
import { $, avatar, esc, fmtTime, sfx, buzz, toast } from '../lib'
import { finishBtn, others, wireFinish, type GameMod } from './common'

const FILES = 'abcdefgh'
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const

/** Live chess against another person. The server validates moves and runs the clocks. */
export const chessLive: GameMod = (ctx) => {
  const id = ctx.m.id
  let live = ctx.m.live as ChessLive
  const seat = ctx.m.players.findIndex((p) => p.player.address === ctx.me)
  const opp = others(ctx.m, ctx.me)[0]
  const mine: Side = live.white === seat ? 'w' : 'b'
  let ch = replayChess(live)
  let sel: Square | null = null
  let legal: Move[] = []
  let busy = false
  let dead = false

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Chess Blitz</div><span style="width:40px"></span></div>
  <div class="scroll" style="gap:10px"><div class="cs" id="cs-t"></div><div class="cb" id="cb"></div><div class="cs" id="cs-b"></div><div class="cst" id="cst" role="status"></div>${finishBtn('Resign')}</div>`
  wireFinish(ctx.root, () => void send({ resign: true }), 'Resign', 'Tap again to resign')

  const lastMove = () => ch.history({ verbose: true }).pop() ?? null
  const clocks = () => {
    const side: Side = live.moves.length % 2 === 0 ? 'w' : 'b' // the confirmed side to move, which the server's clock is running for
    const out = { ...live.left }
    if (!live.over) out[side] = Math.max(0, out[side] - (serverNow() - live.lastAt))
    return out
  }
  const strips = () => {
    const c = clocks()
    const mk = (side: Side) => {
      const me = side === mine
      return `<div class="cp ${ch.turn() === side && !live.over ? 'act' : ''}"><span class="cav">${me ? '<span class="you">You</span>' : avatar(opp.player.avatar)}</span><b>${me ? 'You' : esc(opp.player.name)}</b><span class="mono">${side === 'w' ? 'White' : 'Black'}</span><span class="clk" data-side="${side}">${fmtTime(c[side])}</span></div>`
    }
    $('#cs-t', ctx.root)!.innerHTML = mk(mine === 'w' ? 'b' : 'w')
    $('#cs-b', ctx.root)!.innerHTML = mk(mine)
  }
  const message = () => {
    if (live.over) return live.over.winner === null ? 'Draw' : live.over.winner === mine ? 'You win' : 'You lose'
    if (ch.inCheck()) return ch.turn() === mine ? 'You are in check' : 'Check'
    return ch.turn() === mine ? 'Your move' : `${esc(opp.player.name.split(' ')[0])} is thinking…`
  }
  const draw = () => {
    const bd = ch.board()
    const king = ch.inCheck() ? ch.turn() : null
    const lm = lastMove()
    const white = mine === 'w'
    let h = ''
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const rr = white ? r : 7 - r
        const cc = white ? c : 7 - c
        const s = (FILES[cc] + (8 - rr)) as Square
        const p = bd[rr][cc]
        const dark = (rr + cc) % 2 === 1
        const tgt = legal.find((m) => m.to === s)
        const cls = ['sqr', dark ? 'dk' : 'lt', sel === s ? 'sel' : '', lm && (lm.from === s || lm.to === s) ? 'lm' : '', p && king && p.type === 'k' && p.color === king ? 'chk' : '', tgt ? (tgt.captured ? 'cap' : 'mv') : ''].join(' ')
        h += `<button class="${cls}" data-s="${s}" aria-label="${s}${p ? ' ' + p.color + p.type : ''}">${p ? `<img src="/chess/pieces/${p.color}-${PIECE[p.type]}.svg" alt="" draggable="false">` : ''}</button>`
      }
    $('#cb', ctx.root)!.innerHTML = h
    $('#cst', ctx.root)!.textContent = message().replace(/&amp;/g, '&')
    strips()
  }

  const apply = (next: ChessLive, sound: boolean) => {
    const grew = next.moves.length > live.moves.length
    const mineMove = ch.history().length > live.moves.length // we already played it locally
    live = next
    ch = replayChess(live)
    sel = null
    legal = []
    if (sound && grew && !mineMove) {
      const san = ch.history({ verbose: true }).pop()
      sfx(san?.captured ? 'game/chess-capture' : 'game/chess-move')
      buzz(san?.captured ? 20 : 8)
    }
    draw()
  }

  const send = async (b: unknown) => {
    if (busy || dead) return
    busy = true
    try {
      const v = await api.move(id, b)
      ctx.sync(v)
      if (v.live) apply(v.live as ChessLive, false)
    } catch (e: any) {
      toast(e.message || 'That move did not go through')
      apply(live, false) // back to the server's board
    } finally {
      busy = false
    }
  }

  ctx.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.sqr')
    if (!b || dead || live.over || busy || ch.turn() !== mine) return
    const s = b.dataset.s as Square
    const mv = legal.find((m) => m.to === s)
    if (mv) {
      const r = ch.move({ from: mv.from, to: mv.to, promotion: 'q' }) // optimistic, the server confirms
      sfx(r.captured ? 'game/chess-capture' : 'game/chess-move')
      sel = null
      legal = []
      draw()
      void send({ from: r.from, to: r.to, promotion: r.promotion })
      return
    }
    const p = ch.get(s)
    if (p && p.color === mine) {
      sel = s
      legal = ch.moves({ square: s, verbose: true })
      sfx('ui/tile', 0.5)
    } else {
      sel = null
      legal = []
    }
    draw()
  })

  const tick = setInterval(() => {
    if (dead) return
    const c = clocks()
    for (const side of ['w', 'b'] as Side[]) {
      const el = ctx.root.querySelector(`[data-side="${side}"]`)
      if (el) el.textContent = fmtTime(c[side])
    }
  }, 250)
  draw()
  return {
    update: (m) => {
      const next = m.live as ChessLive | undefined
      if (!next) return
      // ignore a stale poll that arrives after our own optimistic move
      if (busy) return
      if (next.moves.length !== live.moves.length || !!next.over !== !!live.over) apply(next, true)
      else live = { ...live, left: next.left, lastAt: next.lastAt }
    },
    destroy: () => {
      dead = true
      clearInterval(tick)
    },
  }
}
