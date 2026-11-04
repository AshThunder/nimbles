import { esc, ic } from '../lib'
import { clampPct, settleShares } from '../../../shared/economy'
import { fmtNim, type Payee } from '../../../shared/types'

/** The Settle terms a player is editing: bill, how hard the loser pays, and who receives the money. */
export type TermsDraft = { bill: string; pct: number; payee: 'me' | 'friend' | 'other'; other: string }

export const newDraft = (bill = '10'): TermsDraft => ({ bill, pct: 100, payee: 'me', other: '' })
export const billOf = (d: TermsDraft) => Math.round(Number(d.bill) * 100) / 100
export const validAddr = (a: string) => /^NQ\d{2}( ?[0-9A-HJ-NP-Z]{4}){8}$/i.test(a.trim())
export const draftOk = (d: TermsDraft) => billOf(d) >= 0.5 && billOf(d) <= 1000 && (d.payee !== 'other' || validAddr(d.other))
export const draftBody = (d: TermsDraft) => ({ bill: billOf(d), loserPct: d.pct, payee: d.payee === 'other' ? d.other.trim().toUpperCase() : d.payee })

const PRESETS = [100, 70]
const splitText = (d: TermsDraft) => {
  const s = settleShares(billOf(d) || 0, d.pct)
  return `Loser pays <b>${fmtNim(s.loser)} NIM</b>, winner <b>${fmtNim(s.winner)}</b>. A draw splits it 50/50`
}

/** Editable terms form. Re-render it by calling this again after the draft changes. */
export function termsForm(d: TermsDraft): string {
  const custom = !PRESETS.includes(d.pct)
  const rule = (key: string, label: string, sub: string, on: boolean) =>
    `<button class="opt ${on ? 'on' : ''}" data-act="tpct" data-k="${key}" role="radio" aria-checked="${on}"><span class="tx"><span class="n">${label}</span><span class="m">${sub}</span></span>${on ? `<span class="ck">${ic('check')}</span>` : '<span class="ring"></span>'}</button>`
  const who = (key: string, label: string, on: boolean) =>
    `<button class="pc ${on ? 'on' : ''}" data-act="tpay" data-k="${key}" role="radio" aria-checked="${on}">${on ? ic('check') : ''}${label}</button>`
  return `<div class="sec"><div class="lab">The bill<small>NIM, the total to settle</small></div>
      <div class="field"><input id="t-bill" class="field" inputmode="decimal" style="border:0;box-shadow:none;height:48px;padding:0" value="${esc(d.bill)}" placeholder="0.00" autocomplete="off"><span class="mono-s">NIM</span></div></div>
    <div class="sec"><div class="lab">Who pays<small>decided by the game</small></div>
      ${rule('100', 'Loser pays all', 'The winner pays nothing', d.pct === 100)}
      ${rule('70', '70 / 30', 'Loser pays 70%, winner 30%', d.pct === 70)}
      ${rule('custom', 'Custom', custom ? `Loser pays ${d.pct}%, winner ${100 - d.pct}%` : 'Pick your own split', custom)}
      ${custom ? `<div class="stp"><button class="pc" data-act="tstep" data-d="-5" aria-label="Loser pays less">${ic('minus')}</button><b class="mono" id="t-pct">${d.pct}%</b><button class="pc" data-act="tstep" data-d="5" aria-label="Loser pays more">${ic('plus')}</button></div>` : ''}
      <div class="note" style="font-size:13px"><span id="t-split">${splitText(d)}</span></div></div>
    <div class="sec"><div class="lab">Who gets the money<small>paid out when the game ends</small></div>
      <div class="pick">${who('me', 'Me', d.payee === 'me')}${who('friend', 'My friend', d.payee === 'friend')}${who('other', 'Other address', d.payee === 'other')}</div>
      ${d.payee === 'other' ? `<div class="field">${ic('wallet')}<input id="t-other" class="field" style="border:0;box-shadow:none;height:48px;padding:0;font-size:14px" value="${esc(d.other)}" placeholder="NQ.. wallet address" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>${d.other && !validAddr(d.other) ? '<div class="note" style="font-size:13px;color:var(--bad,#D0432E)">That is not a Nimiq address yet</div>' : ''}` : ''}</div>`
}

/** The compact Settle form for the setup bottom sheet: bill (with a scan button), who pays, who gets the money. */
export function termsSheet(d: TermsDraft, scanHtml: string, billHint: string): string {
  const custom = !PRESETS.includes(d.pct)
  const chip = (act: string, key: string, label: string, on: boolean) =>
    `<button class="pc ${on ? 'on' : ''}" data-act="${act}" data-k="${key}" role="radio" aria-checked="${on}">${on ? ic('check') : ''}${label}</button>`
  return `<div class="sec"><div class="lab">Bill<small>NIM, the total</small></div>
      <div class="brow"><div class="fl"><input id="t-bill" inputmode="decimal" value="${esc(d.bill)}" placeholder="0.00" autocomplete="off" aria-label="Bill in NIM"><span class="u">NIM</span></div>${scanHtml}</div>
      <div class="hint">${billHint}</div></div>
    <div class="sec"><div class="lab">Who pays<small>decided by the game</small></div>
      <div class="pick" role="radiogroup">${chip('tpct', '100', 'Loser all', d.pct === 100)}${chip('tpct', '70', '70 / 30', d.pct === 70)}${chip('tpct', 'custom', 'Custom', custom)}</div>
      ${custom ? `<div class="stp"><button class="pc" data-act="tstep" data-d="-5" aria-label="Loser pays less">${ic('minus')}</button><b class="mono" id="t-pct">${d.pct}%</b><button class="pc" data-act="tstep" data-d="5" aria-label="Loser pays more">${ic('plus')}</button></div>` : ''}
      <div class="hint" id="t-split">${splitText(d)}</div></div>
    <div class="sec"><div class="lab">Who gets the money<small>paid out at the end</small></div>
      <div class="pick" role="radiogroup">${chip('tpay', 'me', 'Me', d.payee === 'me')}${chip('tpay', 'friend', 'My friend', d.payee === 'friend')}${chip('tpay', 'other', 'Other', d.payee === 'other')}</div>
      ${d.payee === 'other' ? `<div class="field">${ic('wallet')}<input id="t-other" class="field" style="border:0;box-shadow:none;height:48px;padding:0;font-size:14px" value="${esc(d.other)}" placeholder="NQ.. wallet address" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>${d.other && !validAddr(d.other) ? '<div class="hint" style="color:#D0432E">That is not a Nimiq address yet</div>' : ''}` : ''}</div>`
}

/** One line for the Settle card: how the bill splits and who is paid. */
export function termsLine(d: TermsDraft): string {
  const who = d.payee === 'me' ? 'paid to me' : d.payee === 'friend' ? 'paid to my friend' : 'paid to another wallet'
  return `${d.pct === 100 ? 'Loser pays all' : `Loser pays ${d.pct}%`} · ${who}`
}

/** Click handlers for termsForm, to merge into a screen's `actions` map. `redraw` re-renders the form after a change. */
export function termsActions(d: TermsDraft, redraw: () => void) {
  return {
    tpct: (el: HTMLElement) => {
      const k = el.dataset.k!
      d.pct = k === 'custom' ? (PRESETS.includes(d.pct) ? 80 : d.pct) : Number(k)
      redraw()
    },
    tstep: (el: HTMLElement) => {
      d.pct = Math.max(50, Math.min(95, clampPct(d.pct + Number(el.dataset.d))))
      redraw()
    },
    tpay: (el: HTMLElement) => {
      d.payee = el.dataset.k as TermsDraft['payee']
      redraw()
    },
  }
}

/** Input handler for the form's text fields. Returns true when it handled the event. */
export function termsInput(d: TermsDraft, t: HTMLInputElement, root: HTMLElement): boolean {
  if (t.id === 't-bill') {
    d.bill = t.value.replace(/[^0-9.]/g, '')
    const s = root.querySelector('#t-split')
    if (s) s.innerHTML = splitText(d)
    return true
  }
  if (t.id === 't-other') {
    d.other = t.value.toUpperCase()
    return true
  }
  return false
}

/** Plain-words summary of agreed terms, from either player's point of view. */
export function payeeLabel(payee: Payee, players: { player: { address: string; name: string } }[], me: string): string {
  if ('address' in payee) return payee.address.replace(/\s/g, '').slice(0, 4) + '…' + payee.address.replace(/\s/g, '').slice(-4)
  const p = players[payee.seat]
  if (!p) return payee.seat === 0 ? 'The host' : 'Your friend'
  return p.player.address === me ? 'You' : p.player.name
}
