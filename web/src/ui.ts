import { esc, glyph, GLYPH_BG, ic, avatar, lvBadge, pipImg } from './lib'
import { S } from './state'
import { fmtNim } from '../../shared/types'

export const HEX = '<svg class="hex" viewBox="0 0 24 24"><path d="M12 1.8l8.8 5.1v10.2L12 22.2l-8.8-5.1V6.9z" fill="#F4B323" stroke="#1F2348" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6l4.7 2.7v5.4L12 16.8l-4.7-2.7V8.7z" fill="none" stroke="#C98E0A" stroke-width="1.6" stroke-linejoin="round"/></svg>'
export const FLAME = '<svg viewBox="0 0 48 56"><path d="M24 3c1.6 11 17 15 17 31a17 17 0 0 1-34 0c0-9 6.5-12.5 9-20 3 3.6 3.8 5.4 6.2 5.4C23 19 20 12 24 3z" fill="#F4B323" stroke="#1F2348" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 30c1.3 6 8 8 8 14a8 8 0 0 1-16 0c0-4.5 3.5-6 5-10 1.2 1.8 1.6 2.6 3 2.6z" fill="#FFFCF5"/></svg>'
export const JAR = '<svg class="jarart" viewBox="0 0 72 88"><defs><clipPath id="jc"><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z"/></clipPath></defs><rect x="14" y="6" width="44" height="12" rx="4" fill="#F4B323"/><rect x="18" y="16" width="36" height="8" rx="2" fill="#C98E0A"/><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="#2E3365"/><g clip-path="url(#jc)"><rect x="12" y="46" width="48" height="40" fill="#F4B323"/><ellipse cx="26" cy="62" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="44" cy="70" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="30" cy="76" rx="9" ry="3.6" fill="#C98E0A"/><ellipse cx="50" cy="55" rx="7" ry="3" fill="#C98E0A"/></g><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="none" stroke="#F5F0E6" stroke-width="2.5"/><rect x="17" y="30" width="4" height="22" rx="2" fill="#F5F0E6" opacity=".35"/></svg>'

export const netBadge = () => {
  const n = S.wallet?.network
  if (S.wallet?.kind === 'preview' && !S.cfg.mock) return '<span class="net off">Preview</span>'
  if (n === 'mainnet') return '<span class="net">Mainnet</span>'
  return '<span class="net test">Testnet</span>'
}

export const coin = () => {
  const b = S.balance
  const txt = b == null ? '—' : fmtNim(b)
  return `<div class="coin nb" title="Wallet balance">${HEX}<span>${txt}</span><small>NIM</small></div>`
}

export const topbar = (title: string, left: 'back' | 'close' | 'none' = 'back', right = coin()) =>
  `<div class="top">${left === 'none' ? '<span style="width:40px"></span>' : `<button class="back" data-act="back" aria-label="${left === 'back' ? 'Back' : 'Close'}">${ic(left === 'back' ? 'chevron-left' : 'x', 's20')}</button>`}<div class="ttl">${esc(title)}</div>${right}</div>`

export const TABS = [
  ['gamepad-2', 'Play', '/'],
  ['piggy-bank', 'Jar', '/jar'],
  ['trophy', 'Rank', '/rank'],
  ['message-circle', 'Nimo', '/pip'],
] as const
export const tabs = (on: string) =>
  `<nav class="tabs">${TABS.map(([i, n, href]) => `<a class="tab ${n === on ? 'on' : ''}" href="#${href}" data-act="tab"><span class="p">${ic(i)}</span>${n}</a>`).join('')}</nav>`

export const gameCard = (id: string, g: { name: string; blurb: string; tag?: string; level: number }) => {
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
