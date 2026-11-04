import { api } from '../api'
import { actions, esc, glyph, GLYPH_BG, ic, lvBadge, pipImg, sfx, toast, $, $$ } from '../lib'
import { S, go, route } from '../state'
import { coin, errBox, topbar } from '../ui'
import { billOf, draftBody, draftOk, newDraft, termsActions, termsInput, termsLine, termsSheet, type TermsDraft } from './terms'
import { GAMES, STAKES, fmtNim, type GameId, type Mode, type OppKind, type PipLevel } from '../../../shared/types'
import { toLuna } from '../../../shared/economy'
import { saveFee } from '../../../shared/rewards'

const TOPICS = ['Space exploration', 'Football history', '90s cartoons', 'World capitals', 'Nollywood', 'Human body']
const MODES: [Mode, string, string, string, string][] = [
  ['play', 'gamepad-2', 'Play', 'Free, earn XP', '#D7E9F8'],
  ['win', 'trophy', 'Win', 'Winner takes the pot', '#F4B323'],
  ['save', 'piggy-bank', 'Save', 'Pot to your jar', '#D3EBDD'],
  ['settle', 'receipt', 'Settle', 'Split a bill', '#F6D8D1'],
]
const OPPS: [string, string, string][] = [['invite', 'users', 'Invite'], ['join', 'scan-line', 'Code'], ['auto', 'swords', 'Match me'], ['pip', '', 'Nimo']]
const HINT: Record<string, string> = { invite: 'Get a code, link and QR to share', join: "Enter a friend's code", auto: 'Automatic, same game and stake', pip: 'Free practice. You can pick how tough' }
const LEVELS: Record<PipLevel, string> = { easy: 'Easy', med: 'Medium', hard: 'Hard' }
const GCOL: Record<string, string> = GLYPH_BG

type Setup = {
  mode: Mode; opp: OppKind | 'join'; pip: PipLevel; stake: number; d: TermsDraft
  topic: string; count: number; note: string; code: string; seats: number; payout: 'wta' | 'top3'
  receipt?: { items: { name: string; price: number }[]; total: number; currency: string; merchant?: string }
  busy?: boolean; err?: string; scanning?: boolean; sheet?: boolean
}

route('/g/:id', (root, p) => {
  const id = p.id as GameId
  const g = GAMES[id]
  if (!g) return go('/')
  const canStake = !(S.wallet.kind === 'preview' && !S.cfg.mock)
  const st: Setup = {
    mode: id === 'lastbite' ? 'settle' : 'play', opp: id === 'lastbite' ? 'invite' : 'pip', pip: 'med', stake: 2, d: newDraft(),
    topic: TOPICS[0], count: 5, note: '', code: '', seats: 4, payout: 'wta',
  }
  const royale = id === 'splat'
  const pre = sessionStorage.getItem('nb:bill')
  if (pre) { st.d.bill = pre; st.mode = 'settle'; st.opp = 'invite'; sessionStorage.removeItem('nb:bill') }
  const staked = () => st.mode !== 'play'
  const paid = () => st.mode === 'win' || st.mode === 'save'
  const pickOpp = () => {
    if (staked() && st.opp === 'pip') st.opp = 'auto' // Nimo plays free matches only
    if (st.mode === 'settle' && st.opp !== 'invite' && st.opp !== 'join') st.opp = 'invite' // Settle is for friends only
    if (st.seats < 3 || !paid()) st.payout = 'wta'
  }
  const players = () => (royale ? st.seats : 2)
  const place = () => (royale && st.mode === 'settle' ? st.seats : 0) // Splat Royale settles by finishing place
  const prize = () => {
    const pot = toLuna(st.stake) * players()
    const net = pot - saveFee(pot)
    return fmtNim(royale && st.payout === 'top3' && players() >= 3 ? net - Math.floor((net * 30) / 100) - Math.floor((net * 10) / 100) : net)
  }
  const valid = () => {
    if (st.opp === 'join') return st.code.replace(/[^A-Za-z0-9]/g, '').length >= 7
    if (st.mode === 'settle') return draftOk(st.d)
    if (id === 'trivia') return st.topic.trim().length >= 2
    return true
  }
  const summary = () => {
    if (st.opp === 'join') return ['Mode and stake come from the match you join', '']
    if (st.mode === 'play') return ['Free play, earns XP', 'No NIM at risk']
    if (paid()) {
      const where = st.mode === 'win' ? 'paid to wallet' : 'into the jar'
      if (royale && st.payout === 'top3' && st.seats >= 3) return [`<b>${st.stake} NIM</b> each · top 3 paid, 1st <b>${prize()}</b>`, where]
      return [`<b>${st.stake} NIM</b> each · winner gets <b>${prize()} NIM</b>`, where]
    }
    return [place() ? `Bill <b>${billOf(st.d) || 0} NIM</b> · split by place` : `Bill <b>${billOf(st.d) || 0} NIM</b> · loser pays ${st.d.pct}%`, place() ? 'everyone agrees first' : 'both agree first']
  }
  const cta = () => {
    const n = paid() ? ` · ${st.stake} NIM` : ''
    if (st.opp === 'join') return ['Join match', 'scan-line']
    if (st.opp === 'pip') return [`Start vs Nimo (${LEVELS[st.pip]})`, 'zap']
    if (st.opp === 'invite') return [`Create invite${n}`, 'send']
    return [`Find opponent${n}`, 'swords']
  }

  const tiles = () => `<div class="mt" role="radiogroup" aria-label="Mode">${MODES.map(([m, icon, n, d, col]) => {
    const on = st.mode === m
    const lock = m !== 'play' && !canStake
    return `<button class="t ${on ? 'on' : ''} ${lock ? 'lock' : ''}" data-act="mode" data-m="${m}" role="radio" aria-checked="${on}"><span class="h"><span class="ic" style="background:${col}">${ic(icon)}</span><span class="n">${n}</span>${m === 'win' ? '<span class="new">NEW</span>' : ''}</span><span class="m">${d}</span>${on ? `<span class="ck2">${ic('check')}</span>` : ''}</button>`
  }).join('')}</div>`
  const chips = () => {
    const list = st.mode === 'settle' ? OPPS.slice(0, 2) : OPPS
    return `<div class="oc ${st.mode === 'settle' ? 'two' : ''}" role="radiogroup" aria-label="Opponent">${list.map(([k, icon, n]) => {
      const on = st.opp === k
      const off = k === 'pip' && staked()
      return `<button class="c ${on ? 'on' : ''} ${off ? 'off' : ''}" data-act="opp" data-k="${k}" role="radio" aria-checked="${on}" ${off ? 'aria-disabled="true"' : ''}>${k === 'pip' ? pipImg('cool') : ic(icon)}<span>${n}</span>${on ? `<span class="ck2">${ic('check')}</span>` : ''}</button>`
    }).join('')}</div>`
  }
  const oppBlock = () => {
    const hint = st.opp === 'join'
      ? `<div class="field">${ic('scan-line')}<input id="code" class="field" placeholder="Enter code, like NMB-XXXX" value="${esc(st.code)}" maxlength="9" autocapitalize="characters" autocomplete="off" style="border:0;box-shadow:none;height:48px;padding:0"></div>`
      : st.opp === 'pip' && st.mode === 'play' ? '' : `<div class="hint">${st.opp === 'auto' && royale ? 'Matched with others, starts with 2 or more' : HINT[st.opp]}</div>`
    return `<div class="sec"><div class="lab">Opponent</div>${chips()}${hint}</div>${
      st.opp === 'pip' && st.mode === 'play'
        ? `<div class="sec"><div class="lab">Nimo level<small>Easy to hard</small></div><div class="lvl">${pipImg('think')}<div class="pick" role="radiogroup" aria-label="Nimo level">${(['easy', 'med', 'hard'] as PipLevel[]).map((l) => `<button class="pc ${st.pip === l ? 'on' : ''}" data-act="pip" data-l="${l}" role="radio" aria-checked="${st.pip === l}">${st.pip === l ? ic('check') : ''}${LEVELS[l]}</button>`).join('')}</div></div></div>`
        : ''
    }`
  }
  const seatsBlock = () => `<div class="sec"><div class="lab">Players<small>${st.opp === 'pip' ? 'You and Nimos' : 'Up to this many'}</small></div><div class="seatrow" role="radiogroup" aria-label="Players">${[2, 3, 4, 5, 6].map((n) => `<button class="pc ${st.seats === n ? 'on' : ''}" data-act="seats" data-n="${n}" role="radio" aria-checked="${st.seats === n}">${st.seats === n ? ic('check') : ''}${n}</button>`).join('')}</div></div>${
    paid() && st.seats >= 3
      ? `<div class="sec"><div class="lab">Prizes<small>after the 2% fee</small></div><div class="prz">${([['wta', 'Winner takes all'], ['top3', 'Top 3: 60/30/10']] as const).map(([k, n]) => `<button class="pc ${st.payout === k ? 'on' : ''}" data-act="payout" data-k="${k}">${st.payout === k ? ic('check') : ''}${n}</button>`).join('')}</div></div>`
      : ''
  }`
  const stakeBlock = () => `<div class="sec"><div class="lab">Stake<small>NIM each</small></div><div class="stkrow" role="radiogroup" aria-label="Stake">${STAKES.map((s) => `<button class="pc stk ${st.stake === s ? 'on' : ''}" data-act="stake" data-s="${s}" role="radio" aria-checked="${st.stake === s}">${st.stake === s ? ic('check') : ''}${s}<small>NIM</small></button>`).join('')}</div></div>`
  const settleCard = () => `<div class="sec"><div class="lab">Bill details</div><button class="bdc" data-act="bd"><span class="ic">${ic('receipt')}</span><span class="tx"><span class="n">${billOf(st.d) || 0} NIM bill</span><span class="m">${termsLine(st.d, place())}</span></span><span class="chip" style="background:var(--gold)">${ic('pencil', 's16')}Edit</span></button></div>`
  const sheet = () => {
    const r = st.receipt
    const scan = `<button class="scan" data-act="scan" aria-label="Scan a receipt">${st.scanning ? ic('refresh-cw', 's20 spin') + '<span>Reading…</span>' : ic('camera', 's20') + '<span>Scan receipt</span>'}</button>`
    const hint = r ? `Nimo read ${r.items.length} items${r.merchant ? ' from ' + esc(r.merchant) : ''}. Check the total` : 'Optional: Nimo can read a receipt for you'
    return `<div class="scrim" data-act="shx"></div><div class="sheet mk" role="dialog" aria-label="Settle a bill"><div class="grab"></div>
      <div class="sh-h" style="align-items:center"><div><div class="sh-t">Settle a bill</div><div class="sub">${place() ? 'Everyone agrees before anything is locked' : 'Both agree before anything is locked'}</div></div><button class="sh-x" data-act="shx" aria-label="Close">${ic('x', 's20')}</button></div>
      ${termsSheet(st.d, scan, hint, place())}
      <input type="file" id="rfile" accept="image/*" class="hide">
      <button class="btn gold block" data-act="shdone">${ic('check', 's20')}Done</button></div>`
  }

  const draw = () => {
    pickOpp()
    const [c1, c2] = summary()
    const [ctaTxt, ctaIcon] = cta()
    root.innerHTML = `${topbar(g.name)}
    <div class="scroll" style="gap:16px">
      <div class="banner" style="background:${GCOL[id]};${id === 'lastbite' || id === 'sudoku' ? 'color:var(--ink)' : ''}"><div class="c" style="${id === 'lastbite' || id === 'sudoku' ? 'color:var(--ink)' : ''}"><b>${esc(g.blurb)}</b><span class="lvx">${lvBadge(g.level, 22)}<span class="xpb"><i style="width:${Math.min(100, g.level * 12)}%"></i></span></span></div><span class="art" style="display:block">${glyph(id)}</span></div>
      <div class="sec"><div class="lab">Mode</div>${tiles()}</div>
      ${
        id === 'trivia'
          ? `<div class="sec"><div class="lab">Topic<small>Nimo writes the questions</small></div><div class="field">${ic('search')}<input id="topic" class="field" style="border:0;box-shadow:none;height:48px;padding:0" value="${esc(st.topic)}" maxlength="60" placeholder="Any topic" autocomplete="off"></div><div class="pick">${TOPICS.map((t) => `<button class="pc ${st.topic === t ? 'on' : ''}" data-act="topic" data-t="${esc(t)}">${st.topic === t ? ic('check') : ''}${t}</button>`).join('')}</div></div>
      <div class="sec"><div class="lab">Questions<small>More questions, more XP</small></div><div class="seg">${[5, 7, 10].map((n) => `<button class="sg ${st.count === n ? 'on' : ''}" data-act="count" data-n="${n}"><b>${n}</b><small>${n * 12} XP</small>${st.count === n ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div></div>`
          : ''
      }
      ${oppBlock()}
      ${royale && st.opp !== 'join' ? seatsBlock() : ''}
      ${st.opp === 'join' ? '' : paid() ? stakeBlock() : st.mode === 'settle' ? settleCard() : ''}
      ${st.err ? errBox(st.err) : ''}
    </div>
    <div class="foot" style="gap:8px;border-top:2px solid var(--ink);background:var(--bg);padding-top:12px"><div class="sumr"><span id="sum1">${c1}</span><span class="mono" id="sum2">${c2}</span></div>
      <button class="btn gold block" data-act="go" id="go" ${valid() && !st.busy ? '' : 'disabled'}>${st.busy ? ic('refresh-cw', 's20 spin') + 'Working…' : ic(ctaIcon, 's20') + ctaTxt}</button></div>${st.sheet && st.mode === 'settle' ? sheet() : ''}`
  }
  draw()

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.id === 'topic') st.topic = t.value
    termsInput(st.d, t, root, place())
    if (t.id === 'code') st.code = t.value.toUpperCase()
    const b = $('#go', root) as HTMLButtonElement | null
    if (b) b.disabled = !valid() || !!st.busy
    const [c1, c2] = summary()
    const s1 = $('#sum1', root)
    if (s1) s1.innerHTML = c1
    const s2 = $('#sum2', root)
    if (s2) s2.innerHTML = c2
  })
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement
    if (t.id !== 'rfile' || !t.files?.[0]) return
    st.scanning = true
    st.err = ''
    draw()
    try {
      const img = await downscale(t.files[0])
      const r = await api.receipt({ imageBase64: img.b64, mime: img.mime })
      st.receipt = { items: r.items ?? [], total: Number(r.total) || 0, currency: r.currency || '', merchant: r.merchant }
      if (st.receipt.total > 0) st.d.bill = String(st.receipt.total)
      sfx('ui/confirm')
    } catch (er: any) {
      st.err = er.message
      sfx('ui/error')
    }
    st.scanning = false
    draw()
  })

  actions(root, {
    back: () => (sfx('ui/back'), history.length > 1 ? history.back() : go('/')),
    mode: (el) => {
      const m = el.dataset.m as Mode
      if (m !== 'play' && !canStake) return toast('Open Nimbles inside Nimiq Pay to stake NIM')
      sfx('ui/select')
      st.mode = m
      if (m === 'play' && st.opp === 'auto') st.opp = 'pip'
      draw()
    },
    opp: (el) => {
      const k = el.dataset.k as Setup['opp']
      if (k === 'pip' && staked()) return toast('Nimo plays free matches only')
      sfx('ui/select')
      st.opp = k
      draw()
      if (k === 'join') ($('#code', root) as HTMLInputElement | null)?.focus()
    },
    pip: (el) => ((st.pip = el.dataset.l as PipLevel), sfx('ui/select'), draw()),
    topic: (el) => ((st.topic = el.dataset.t!), sfx('ui/select'), draw()),
    count: (el) => ((st.count = Number(el.dataset.n)), sfx('ui/select'), draw()),
    seats: (el) => ((st.seats = Number(el.dataset.n)), sfx('ui/select'), draw()),
    payout: (el) => ((st.payout = el.dataset.k as 'wta' | 'top3'), sfx('ui/select'), draw()),
    stake: (el) => ((st.stake = Number(el.dataset.s)), sfx('ui/select'), draw()),
    ...termsActions(st.d, () => (sfx('ui/select'), draw())),
    bd: () => ((st.sheet = true), sfx('ui/select'), draw()),
    shx: () => ((st.sheet = false), sfx('ui/back'), draw()),
    shdone: () => {
      if (!draftOk(st.d)) return toast('Check the bill and the wallet address')
      st.sheet = false
      sfx('ui/confirm')
      draw()
    },
    scan: () => $('#rfile', root)!.click(),
    go: async () => {
      if (!valid() || st.busy) return
      st.busy = true
      st.err = ''
      draw()
      try {
        let m
        if (st.opp === 'join') m = await api.join(st.code)
        else {
          m = await api.create({
            game: id, mode: st.mode, opp: st.opp, pipLevel: st.opp === 'pip' ? st.pip : undefined,
            stake: paid() ? st.stake : 0, terms: st.mode === 'settle' ? draftBody(st.d) : undefined,
            config: royale ? { seats: st.seats, payout: st.payout } : { topic: st.topic, count: st.count, note: st.note, receipt: st.receipt },
          })
        }
        sfx('ui/confirm')
        go('/m/' + m.id)
      } catch (e: any) {
        st.err = e.message
        st.busy = false
        sfx('ui/error')
        draw()
      }
    },
  })
})

async function downscale(file: File): Promise<{ b64: string; mime: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k)
  cv.height = Math.round(bmp.height * k)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const url = cv.toDataURL('image/jpeg', 0.82)
  return { b64: url.split(',')[1], mime: 'image/jpeg' }
}
export { coin, pipImg, $$ }
