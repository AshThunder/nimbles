import { Chess, type Move, type Square } from 'chess.js'
import { pipMove } from '../../../shared/chessai'
import { $, esc, ic, pipImg, sfx, buzz } from '../lib'
import { finishBtn, wireFinish, type GameMod } from './common'
import { fmtTime } from '../lib'

const FILES = 'abcdefgh'
const BLITZ_MS = 3 * 60 * 1000

export const chess: GameMod = (ctx) => {
  const level = ctx.m.pipLevel ?? 'med'
  const ch = new Chess()
  let sel: Square | null = null
  let legal: Move[] = []
  let last: { from: string; to: string } | null = null
  let done = false
  let thinking = false
  let status = 'Your move. You play white'
  const left = { w: BLITZ_MS, b: BLITZ_MS }
  let tickAt = Date.now()
  const started = Date.now()
  const timers: ReturnType<typeof setTimeout>[] = []

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Chess Blitz</div><span style="width:40px"></span></div>
  <div class="scroll" style="gap:10px"><div class="cs" id="cs-b"></div><div class="cb" id="cb"></div><div class="cs" id="cs-w"></div><div class="cst" id="cst" role="status"></div>${finishBtn('Resign')}</div>`
  wireFinish(ctx.root, () => void end(0, 'resign'), 'Resign', 'Tap again to resign')

  const sq = (r: number, c: number) => (FILES[c] + (8 - r)) as Square
  const strips = () => {
    const mk = (side: 'w' | 'b') => {
      const mine = side === 'w'
      return `<div class="cp ${ch.turn() === side && !done ? 'act' : ''}"><span class="cav">${mine ? '<span class="you">You</span>' : pipImg('cool')}</span><b>${mine ? 'You' : 'Pip (' + { easy: 'Easy', med: 'Medium', hard: 'Hard' }[level] + ')'}</b><span class="mono">${mine ? 'White' : 'Black'}</span><span class="clk">${fmtTime(left[side])}</span></div>`
    }
    $('#cs-b', ctx.root)!.innerHTML = mk('b')
    $('#cs-w', ctx.root)!.innerHTML = mk('w')
  }
  const draw = () => {
    const bd = ch.board()
    const king = ch.inCheck() ? ch.turn() : null
    let h = ''
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const s = sq(r, c)
        const p = bd[r][c]
        const dark = (r + c) % 2 === 1
        const tgt = legal.find((m) => m.to === s)
        const cls = ['sqr', dark ? 'dk' : 'lt', sel === s ? 'sel' : '', last && (last.from === s || last.to === s) ? 'lm' : '', p && king && p.type === 'k' && p.color === king ? 'chk' : '', tgt ? (tgt.captured ? 'cap' : 'mv') : ''].join(' ')
        h += `<button class="${cls}" data-s="${s}" aria-label="${s}${p ? ' ' + p.color + p.type : ''}">${p ? `<img src="/chess/pieces/${p.color}-${{ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[p.type]}.svg" alt="" draggable="false">` : ''}</button>`
      }
    $('#cb', ctx.root)!.innerHTML = h
    $('#cst', ctx.root)!.textContent = status
    strips()
  }
  const finishGame = (reason: string) => {
    if (ch.isCheckmate()) return end(ch.turn() === 'b' ? 1 : 0, 'checkmate')
    return end(0.5, reason)
  }
  const afterMove = () => {
    sel = null
    legal = []
    if (ch.isGameOver()) {
      status = ch.isCheckmate() ? (ch.turn() === 'b' ? 'Checkmate, you win' : 'Checkmate, Pip wins') : ch.isStalemate() ? 'Stalemate, a draw' : 'Draw'
      draw()
      return void finishGame(status)
    }
    status = ch.inCheck() ? (ch.turn() === 'w' ? 'You are in check' : 'Pip is in check') : ch.turn() === 'w' ? 'Your move' : 'Pip is thinking…'
    draw()
  }
  const doMove = (m: { from: string; to: string; promotion?: string }) => {
    const r = ch.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' })
    last = { from: r.from, to: r.to }
    sfx(r.captured ? 'game/chess-capture' : 'game/chess-move')
    buzz(r.captured ? 20 : 8)
    afterMove()
    return r
  }
  const pipTurn = () => {
    if (done || ch.turn() !== 'b' || ch.isGameOver()) return
    thinking = true
    timers.push(
      setTimeout(() => {
        if (done) return
        const t0 = performance.now()
        const mv = pipMove(ch, level)
        const spent = performance.now() - t0
        const wait = Math.max(0, 500 + Math.random() * 1200 - spent)
        timers.push(
          setTimeout(() => {
            thinking = false
            if (!done && mv) doMove(mv)
          }, wait),
        )
      }, 50),
    )
  }
  ctx.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.sqr')
    if (!b || done || thinking || ch.turn() !== 'w') return
    const s = b.dataset.s as Square
    const mv = legal.find((m) => m.to === s)
    if (mv) {
      doMove(mv)
      pipTurn()
      return
    }
    const p = ch.get(s)
    if (p && p.color === 'w') {
      sel = s
      legal = ch.moves({ square: s, verbose: true })
      sfx('ui/tile', 0.5)
    } else {
      sel = null
      legal = []
    }
    draw()
  })
  const clk = setInterval(() => {
    if (done) return
    const now = Date.now()
    const side = ch.turn()
    left[side] = Math.max(0, left[side] - (now - tickAt))
    tickAt = now
    strips()
    if (left[side] <= 0) {
      status = side === 'w' ? 'Out of time, Pip wins' : 'Pip ran out of time, you win'
      $('#cst', ctx.root)!.textContent = status
      void end(side === 'w' ? 0 : 1, 'timeout')
    }
  }, 250)
  const end = async (score: number, reason: string) => {
    if (done) return
    done = true
    clearInterval(clk)
    timers.forEach(clearTimeout)
    sfx(score === 1 ? 'reward/win-big' : 'reward/lose')
    await new Promise((r) => setTimeout(r, score === 0 && reason === 'resign' ? 0 : 1200))
    await ctx.finish({ score, time: Date.now() - started, detail: { reason, moves: ch.history().length, pgn: ch.pgn() } })
  }
  draw()
  return {
    update: () => {},
    destroy: () => {
      done = true
      clearInterval(clk)
      timers.forEach(clearTimeout)
    },
  }
}
export { esc, ic }
