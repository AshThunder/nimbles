// Friend challenges and tournament matches, seen from any screen. Before this, a challenge only showed up on the
// Friends tab (and only while it was open), so most challenges ran out with the friend never knowing.
import { api, type Challenge } from './api'
import { esc, sfx } from './lib'
import { go } from './state'
import { setChallengeCount } from './ui'
import { GAMES, type GameId } from '../../shared/types'

const POLL_MS = 15_000
const dismissed = new Set<string>(JSON.parse(sessionStorage.getItem('nb:dismissed') ?? '[]'))
let timer: ReturnType<typeof setTimeout> | undefined
let bar: HTMLDivElement | null = null
let last: { challenges: Challenge[]; tourney: { id: string; tourney: string } | null } = { challenges: [], tourney: null }
let seen = new Set<string>()

const onMatchScreen = () => /^#\/m\//.test(location.hash)

function paint() {
  bar ??= Object.assign(document.createElement('div'), { className: 'cbar', role: 'status' })
  if (!bar.isConnected) document.body.appendChild(bar)
  const c = last.challenges.find((x) => !dismissed.has(x.id))
  const t = last.tourney && !dismissed.has('t:' + last.tourney.id) ? last.tourney : null
  // the Friends tab shows a count too
  setChallengeCount(last.challenges.length)
  document.querySelectorAll<HTMLElement>('[data-badge="friends"]').forEach((el) => { el.textContent = last.challenges.length ? String(last.challenges.length) : '' })
  if (onMatchScreen() || (!c && !t)) { bar.hidden = true; return }
  bar.hidden = false
  if (t) {
    bar.innerHTML = `<span class="t"><b>${esc(t.tourney)}</b><span>Your knockout match is ready. Lock in before the round ends</span></span><button class="btn gold sm" data-cb="open" data-id="${esc(t.id)}">Open</button><button class="btn ghost sm" data-cb="hide" data-id="t:${esc(t.id)}">Later</button>`
  } else if (c) {
    const game = GAMES[c.game as GameId]?.name ?? c.game
    const stake = c.mode === 'play' ? 'Free' : `${c.stake} NIM`
    bar.innerHTML = `<span class="t"><b>${esc(c.from.name)} challenged you</b><span>${esc(game)} · ${stake}</span></span><button class="btn gold sm" data-cb="accept" data-code="${esc(c.code)}">Accept</button><button class="btn ghost sm" data-cb="hide" data-id="${esc(c.id)}">Not now</button>`
  }
}

async function poll() {
  clearTimeout(timer)
  if (document.visibilityState !== 'hidden') {
    try {
      const r = await api.challenges()
      last = { challenges: r.challenges, tourney: r.tourney }
      const fresh = r.challenges.filter((x) => !seen.has(x.id))
      if (fresh.length) sfx('ui/open')
      seen = new Set(r.challenges.map((x) => x.id))
      paint()
    } catch { /* offline or signed out: try again later */ }
  }
  timer = setTimeout(() => void poll(), POLL_MS)
}

export function startChallengePoll() {
  if (timer) return
  document.addEventListener('click', async (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest?.('[data-cb]') as HTMLElement | null
    if (!el) return
    ev.preventDefault()
    const act = el.dataset.cb
    if (act === 'hide') {
      dismissed.add(el.dataset.id!)
      sessionStorage.setItem('nb:dismissed', JSON.stringify([...dismissed]))
      return paint()
    }
    if (act === 'open') { bar!.hidden = true; return go('/m/' + el.dataset.id) }
    if (act === 'accept') {
      el.setAttribute('disabled', '')
      try {
        const v = await api.join(el.dataset.code!)
        bar!.hidden = true
        sfx('ui/confirm')
        go('/m/' + v.id)
      } catch (e: any) {
        el.removeAttribute('disabled')
        bar!.innerHTML = `<span class="t"><b>Could not join</b><span>${esc(e?.message ?? 'Try again')}</span></span><button class="btn ghost sm" data-cb="hide" data-id="err">OK</button>`
      }
      void poll()
    }
  })
  window.addEventListener('hashchange', paint)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll() })
  void poll()
}
