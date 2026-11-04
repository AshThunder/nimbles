import type { MatchView } from '../api'
import { serverNow } from '../api'
import { avatar, esc, fmtTime } from '../lib'
import { GAME_DURATION_MS } from '../../../shared/pip'

export type FinishArg = { score: number; time: number; detail?: unknown }
export type GameCtx = { root: HTMLElement; m: MatchView; me: string; finish: (r: FinishArg) => Promise<void>; progress: (score: number) => void }
export type GameInst = { update(m: MatchView): void; destroy(): void }
export type GameMod = (ctx: GameCtx) => GameInst

export const meOf = (m: MatchView, me: string) => m.players.find((p) => p.player.address === me)!
export const others = (m: MatchView, me: string) => m.players.filter((p) => p.player.address !== me)
export const firstName = (n: string) => esc(n.split(' ')[0])

/** Scoreboard strip for any number of players. IDs let games update the numbers without redrawing. */
export function strip(m: MatchView, me: string, scores: Record<string, number> = {}) {
  return `<div class="pstrip">${m.players
    .map((p) => {
      const mine = p.player.address === me
      const s = scores[p.player.address] ?? p.progress ?? 0
      return `<div class="scorepill" style="${mine ? 'background:var(--gold-tint)' : ''}">${avatar(p.player.avatar)}<span style="flex:1;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mine ? 'You' : firstName(p.player.name)}</span><b data-score="${esc(p.player.address)}">${s}</b></div>`
    })
    .join('')}</div>`
}
export function setScores(root: HTMLElement, m: MatchView, me: string, override: Record<string, number> = {}) {
  for (const p of m.players) {
    const el = root.querySelector(`[data-score="${CSS.escape(p.player.address)}"]`)
    if (el) el.textContent = String(override[p.player.address] ?? p.progress ?? 0)
  }
}

/** Counts down to the end of the round (gameplay duration, not the forfeit grace). Calls onEnd at zero. */
export function clock(m: MatchView, el: HTMLElement | null, bar: HTMLElement | null, onEnd: () => void, totalMs = GAME_DURATION_MS[m.game]) {
  const end = (m.startsAt ?? serverNow()) + totalMs
  let done = false
  const t = setInterval(() => {
    const left = Math.max(0, end - serverNow())
    if (el) el.textContent = fmtTime(left)
    if (bar) bar.style.width = (left / totalMs) * 100 + '%'
    if (left <= 0 && !done) {
      done = true
      clearInterval(t)
      onEnd()
    }
  }, 250)
  return { stop: () => clearInterval(t), left: () => Math.max(0, end - serverNow()), end }
}

/** "Finish round" with a two-tap confirm, so a stray tap never ends your run. */
export const finishBtn = () => `<button class="btn ghost sm block" data-fin style="height:40px;font-size:14px">Finish round</button>`
export function wireFinish(root: HTMLElement, onConfirm: () => void) {
  const b = root.querySelector<HTMLButtonElement>('[data-fin]')
  if (!b) return
  let armed: ReturnType<typeof setTimeout> | undefined
  b.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed)
      return onConfirm()
    }
    b.textContent = 'Tap again to finish'
    armed = setTimeout(() => {
      armed = undefined
      b.textContent = 'Finish round'
    }, 2500)
  })
}
