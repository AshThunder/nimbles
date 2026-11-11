import { esc, glyph, GLYPH_BG, ic, avatar, lvBadge, pipImg } from './lib'
import { S } from './state'
import { fmtNim, fmtNimCompact } from '../../shared/types'
import { expectIncoming, nextShownBalance, type ShownBalance } from '../../shared/pay-balance'

export const HEX = '<svg class="hex" viewBox="0 0 24 24"><path d="M12 1.8l8.8 5.1v10.2L12 22.2l-8.8-5.1V6.9z" fill="#F4B323" stroke="#1F2348" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6l4.7 2.7v5.4L12 16.8l-4.7-2.7V8.7z" fill="none" stroke="#C98E0A" stroke-width="1.6" stroke-linejoin="round"/></svg>'
export const FLAME = '<svg viewBox="0 0 48 56"><path d="M24 3c1.6 11 17 15 17 31a17 17 0 0 1-34 0c0-9 6.5-12.5 9-20 3 3.6 3.8 5.4 6.2 5.4C23 19 20 12 24 3z" fill="#F4B323" stroke="#1F2348" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 30c1.3 6 8 8 8 14a8 8 0 0 1-16 0c0-4.5 3.5-6 5-10 1.2 1.8 1.6 2.6 3 2.6z" fill="#FFFCF5"/></svg>'
export const JAR = '<svg class="jarart" viewBox="0 0 72 88"><defs><clipPath id="jc"><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z"/></clipPath></defs><rect x="14" y="6" width="44" height="12" rx="4" fill="#F4B323"/><rect x="18" y="16" width="36" height="8" rx="2" fill="#C98E0A"/><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="#2E3365"/><g clip-path="url(#jc)"><rect x="12" y="46" width="48" height="40" fill="#F4B323"/><ellipse cx="26" cy="62" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="44" cy="70" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="30" cy="76" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="50" cy="55" rx="7" ry="3" fill="#C98E0A"/></g><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="none" stroke="#F5F0E6" stroke-width="2.5"/><rect x="17" y="30" width="4" height="22" rx="2" fill="#F5F0E6" opacity=".35"/></svg>'

export const netBadge = () => {
  // Nimiq Pay's own network wins. When the host does not say, fall back to the network this server runs on
  const n = S.wallet?.network && S.wallet.network !== 'unknown' ? S.wallet.network : S.cfg?.network
  if (S.wallet?.kind === 'preview' && !S.cfg.mock) return '<span class="net off">Preview</span>'
  if (n === 'mainnet') return '<span class="net">Mainnet</span>'
  return '<span class="net test">Testnet</span>'
}

export const coinLabel = (b: number | null | undefined = S.balance) =>
  b === undefined ? '…' : b == null ? '—' : fmtNimCompact(b)

/** Header chip: confirmed connected-wallet spendable NIM only (compact). Tap opens exact amount. Jar stays on its own card. */
export const coin = () => {
  const b = S.balance
  const txt = coinLabel(b)
  const exact = b == null || b === undefined ? 'Wallet balance' : `${fmtNim(b)} NIM confirmed`
  return `<button type="button" class="coin nb" data-act="balance" data-bal aria-haspopup="dialog" aria-label="${esc(exact)}. Tap for exact amount">${HEX}<span data-bal-txt>${txt}</span><small>NIM</small><small class="inc" data-bal-inc>${incomingLabel()}</small></button>`
}

const incomingLabel = () => {
  const i = bal.incoming
  return i && Date.now() <= i.until ? `+${fmtNim(i.luna)} incoming` : ''
}

/** Paint every header chip currently on screen after a balance refresh. */
export const paintBalance = () => {
  const txt = coinLabel()
  document.querySelectorAll<HTMLElement>('[data-bal-txt]').forEach((el) => { el.textContent = txt })
  const inc = incomingLabel()
  document.querySelectorAll<HTMLElement>('[data-bal-inc]').forEach((el) => { el.textContent = inc })
  document.querySelectorAll<HTMLElement>('[data-bal]').forEach((el) => {
    const b = S.balance
    el.setAttribute('aria-label', (b == null || b === undefined ? 'Wallet balance' : `${fmtNim(b)} NIM confirmed`) + '. Tap for exact amount')
  })
}

/** Monotonic request id so a slow stale balance() cannot overwrite a newer result. */
let balGen = 0

/** What the header shows, and why (see nextShownBalance): the last good number survives failed reads and the brief 0
 *  Nimiq Pay reports while it moves funds into a new HTLC after a payout arrives. */
let bal: ShownBalance = { shown: undefined }
let retryTimer: ReturnType<typeof setTimeout> | undefined

/** A payout to this wallet was just sent: show "+x incoming" until the balance includes it. */
export function noteIncoming(luna: number) {
  bal = expectIncoming({ ...bal, shown: S.balance }, luna)
  paintBalance()
  scheduleBalance(4000)
}

function scheduleBalance(ms: number) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => { retryTimer = undefined; void refreshBalance() }, ms)
}

export async function refreshBalance() {
  if (!S.wallet) { S.balance = null; bal = { shown: null }; paintBalance(); return null }
  const gen = ++balGen
  // Keep showing the previous value (or … on first load) while a fetch is in flight, never a fake 0.
  if (S.balance === undefined) paintBalance()
  let read: number | null = null
  try {
    read = await S.wallet.balance()
  } catch {
    read = null
  }
  if (gen !== balGen) return S.balance ?? null
  const r = nextShownBalance({ ...bal, shown: S.balance }, read)
  bal = r.state
  S.balance = r.state.shown
  if (r.retryMs) scheduleBalance(r.retryMs)
  paintBalance()
  return S.balance
}

let balDlg: HTMLDialogElement | null = null
/** Wallet-only detail. Does not list the savings jar (that stays on the jar card). */
function balanceDialogBody(b: number | null | undefined) {
  // Keep copy short for players; HTLC/basic mechanics stay in code, not the dialog.
  if (b === undefined) return { exact: 'Loading…', note: 'Checking Nimiq Pay…' }
  if (b === null) return { exact: 'Unavailable', note: 'Could not read balance. Try again.' }
  const i = bal.incoming && Date.now() <= bal.incoming.until ? bal.incoming : null
  return { exact: `${fmtNim(b)} NIM`, note: i ? `Plus ${fmtNim(i.luna)} NIM on its way to your wallet` : 'Available to spend in Nimiq Pay' }
}

export function openBalanceDialog() {
  const { exact, note } = balanceDialogBody(S.balance)
  if (!balDlg) {
    balDlg = document.createElement('dialog')
    balDlg.id = 'bal-dlg'
    balDlg.className = 'bal-dlg'
    balDlg.setAttribute('aria-labelledby', 'bal-title')
    // closedby is progressive enhancement; Esc + form method=dialog still work without it
    balDlg.setAttribute('closedby', 'any')
    document.body.appendChild(balDlg)
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false
      const outside = (e: PointerEvent, d: HTMLDialogElement) => {
        const r = d.getBoundingClientRect()
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
      }
      balDlg.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, balDlg!) })
      balDlg.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, balDlg!)) balDlg!.close() })
    }
  }
  balDlg.innerHTML = `<div class="bal-card"><h2 id="bal-title">Wallet</h2><div class="bal-exact mono" data-bal-exact>${esc(exact)}</div><p class="bal-note" data-bal-note>${esc(note)}</p><form method="dialog"><button type="submit" class="btn gold block" value="ok" autofocus>Close</button></form></div>`
  if (!balDlg.open) balDlg.showModal()
  void refreshBalance().then(() => {
    if (!balDlg?.open) return
    const body = balanceDialogBody(S.balance)
    const exactEl = balDlg.querySelector('[data-bal-exact]')
    const noteEl = balDlg.querySelector('[data-bal-note]')
    if (exactEl) exactEl.textContent = body.exact
    if (noteEl) noteEl.textContent = body.note
  })
}

export const topbar = (title: string, left: 'back' | 'close' | 'none' = 'back', right = coin()) =>
  `<div class="top">${left === 'none' ? '<span style="width:40px"></span>' : `<button class="back" data-act="back" aria-label="${left === 'back' ? 'Back' : 'Close'}">${ic(left === 'back' ? 'chevron-left' : 'x', 's20')}</button>`}<div class="ttl">${esc(title)}</div>${right}</div>`

export const TABS = [
  ['gamepad-2', 'Play', '/'],
  ['piggy-bank', 'Jar', '/jar'],
  ['trophy', 'Rank', '/rank'],
  ['users', 'Friends', '/friends'],
  ['message-circle', 'Nimo', '/pip'],
] as const
export const tabs = (on: string) =>
  `<nav class="tabs">${TABS.map(([i, n, href]) => `<a class="tab ${n === on ? 'on' : ''}" href="#${href}" data-act="tab"><span class="p">${ic(i)}${href === '/friends' ? `<i class="tbadge" data-badge="friends">${challengeCount || ''}</i>` : ''}</span>${n}</a>`).join('')}</nav>`

/** Waiting friend challenges, kept by the global poll (notify.ts) so a freshly drawn tab bar shows the badge at once */
let challengeCount = 0
export const setChallengeCount = (n: number) => { challengeCount = n }

export const gameCard = (id: string, g: { name: string; blurb: string; tag?: string; level: number }, soon = false) => {
  if (soon) return `<button class="gc soon" data-id="${id}" disabled aria-disabled="true"><div class="art" style="background:${GLYPH_BG[id]}">${glyph(id)}<span class="tg" style="background:#6B6F8C">Soon</span></div><div class="f"><span class="n">${esc(g.name)}</span><span class="m">Coming soon</span></div></button>`
  const tgc = g.tag === 'Hot' ? '#D0432E' : '#1F8A5B'
  return `<button class="gc" data-act="game" data-id="${id}"><div class="art" style="background:${GLYPH_BG[id]}">${glyph(id)}${g.tag ? `<span class="tg" style="background:${tgc}">${g.tag}</span>` : ''}${lvBadge(g.level, 28).replace('class="lvb"', 'class="lv"')}</div><div class="f"><span class="n">${esc(g.name)}</span><span class="m">${esc(g.blurb)}</span></div></button>`
}

export const pipRow = (mood: string, text: string) => `<div class="pipr">${pipImg(mood)}<div class="bubble">${text}</div></div>`
export const errBox = (msg: string) => `<div class="err" role="alert">${ic('triangle-alert', 's20')}<span>${esc(msg)}</span></div>`
export { avatar }

/** Show the first `shown` rows with a "Show more" button when there are more. Pages are 5 rows. */
export const PAGE = 5
export const pageRows = (rows: string[], shown: number, act: string) =>
  rows.slice(0, shown).join('') + (rows.length > shown ? `<button class="btn ghost block more" data-act="${act}">Show more<small>${rows.length - shown} left</small></button>` : '')
