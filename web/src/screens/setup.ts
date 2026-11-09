import { api, type LobbyItem } from '../api'
import { actions, avatar, esc, glyph, GLYPH_BG, ic, keepScroll, lvBadge, pipImg, sfx, toast, $, $$ } from '../lib'
import { S, go, route } from '../state'
import { coin, errBox, topbar } from '../ui'
import { billOf, draftBody, draftOk, newDraft, termsActions, termsInput, termsLine, termsSheet, type TermsDraft } from './terms'
import { GAMES, MIN_STAKE_NIM, STAKES, cleanStake, isSoon, fmtNim, type GameId, type Mode, type OppKind, type PipLevel } from '../../../shared/types'
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
const HINT: Record<string, string> = { invite: 'Get a code, link and QR to share', join: "Enter a friend's code", auto: 'Same game and mode, nearest stake. Or join one below', pip: 'Free practice. You can pick how tough' }
const LEVELS: Record<PipLevel, string> = { easy: 'Easy', med: 'Medium', hard: 'Hard' }
const GCOL: Record<string, string> = GLYPH_BG

type Setup = {
  mode: Mode; opp: OppKind | 'join'; pip: PipLevel; stake: number; d: TermsDraft
  topic: string; count: number; note: string; code: string; seats: number; payout: 'wta' | 'top3'
  receipt?: { items: { name: string; price: number }[]; total: number; currency: string; merchant?: string }
  busy?: boolean; err?: string; scanning?: boolean; sheet?: boolean
  topicLocked: boolean
  custom?: boolean; customText?: string // Custom stake: the typed amount
  open?: LobbyItem[] // Match me: open challenges for this game and mode
  suggest?: LobbyItem // the nearest open stake, waiting for the player to confirm
  challenge?: { address: string; name: string } // a direct challenge to a friend
}

route('/g/:id', (root, p) => {
  const id = p.id as GameId
  const g = GAMES[id]
  if (!g || isSoon(id)) return go('/')
  const canStake = !(S.wallet.kind === 'preview' && !S.cfg.mock)
  const st: Setup = {
    mode: id === 'lastbite' ? 'settle' : 'play', opp: id === 'lastbite' ? 'invite' : 'pip', pip: 'med', stake: STAKES[0], d: newDraft(),
    topic: TOPICS[0], count: 5, note: '', code: '', seats: 4, payout: 'wta', topicLocked: true,
  }
  try {
    const ch = JSON.parse(sessionStorage.getItem('nb:challenge') || 'null')
    if (ch?.address) { st.challenge = { address: String(ch.address), name: String(ch.name || 'your friend') }; st.opp = 'invite'; if (id !== 'lastbite') st.mode = canStake ? 'win' : 'play' }
  } catch { /* none */ }
  sessionStorage.removeItem('nb:challenge')
  if (sessionStorage.getItem('nb:opp') === 'auto' && id !== 'lastbite') { st.opp = 'auto'; st.mode = canStake ? 'win' : 'play'; if (st.mode === 'play') st.opp = 'pip' }
  sessionStorage.removeItem('nb:opp')
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
  /** Why this stake cannot be used, or ''. The balance is the only ceiling: there is no fixed maximum. */
  const stakeErr = () => {
    if (!paid() || st.opp === 'join') return ''
    if (Number.isNaN(st.stake)) return st.custom && !(st.customText ?? '').trim() ? 'Enter an amount' : `Enter at least ${MIN_STAKE_NIM} NIM`
    // Pay reports spendable NIM. The mock chain's stub wallets read 0, so there only a real number is checked
    if (typeof S.balance === 'number' && (!S.cfg.mock || S.balance > 0) && toLuna(st.stake) > S.balance) return `That is more than your ${fmtNim(S.balance)} NIM. Lower the stake or add NIM`
    return ''
  }
  const valid = () => {
    if (st.opp === 'join') return st.code.replace(/[^A-Za-z0-9]/g, '').length >= 7
    if (stakeErr()) return false
    if (st.mode === 'settle') return draftOk(st.d)
    if (id === 'trivia') return st.topic.trim().length >= 2
    return true
  }
  const summary = () => {
    if (st.opp === 'join') return ['Mode and stake come from the match you join', '']
    if (st.mode === 'play') return ['Free play, earns XP', 'No NIM at risk']
    if (paid() && Number.isNaN(st.stake)) return ['Pick or enter a stake', '']
    if (paid() && stakeErr()) return ['Lower the stake to play', 'over your balance']
    if (paid()) {
      const where = st.mode === 'win' ? 'paid to wallet' : 'into the jar'
      if (royale && st.payout === 'top3' && st.seats >= 3) return [`<b>${st.stake} NIM</b> each · top 3 paid, 1st <b>${prize()}</b>`, where]
      return [`<b>${st.stake} NIM</b> each · winner gets <b>${prize()} NIM</b>`, where]
    }
    return [place() ? `Bill <b>${billOf(st.d) || 0} NIM</b> · split by place` : `Bill <b>${billOf(st.d) || 0} NIM</b> · loser pays ${st.d.pct}%`, place() ? 'everyone agrees first' : 'both agree first']
  }
  const cta = () => {
    const n = paid() && !Number.isNaN(st.stake) ? ` · ${st.stake} NIM` : ''
    if (st.opp === 'join') return ['Join match', 'scan-line']
    if (st.opp === 'pip') return [`Start vs Nimo (${LEVELS[st.pip]})`, 'zap']
    if (st.opp === 'invite' && st.challenge) return [`Challenge ${st.challenge.name}${n}`, 'swords']
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
      : st.opp === 'pip' && st.mode === 'play' ? '' : `<div class="hint">${st.opp === 'invite' && st.challenge ? `Only ${esc(st.challenge.name)} gets this challenge` : st.opp === 'auto' && royale ? 'Matched with others, starts with 2 or more' : HINT[st.opp]}</div>`
    return `<div class="sec"><div class="lab">Opponent</div>${chips()}${hint}</div>${st.opp === 'auto' && !royale ? openBlock() : ''}${
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
  /** Match me: waiting challenges for this game and mode. Tap one to join it at its stake. */
  const openBlock = () => {
    const list = st.open
    if (!list) return `<div class="sec"><div class="lab">Open challenges</div><div class="hint">Looking…</div></div>`
    if (!list.length) return `<div class="sec"><div class="lab">Open challenges</div><div class="hint">None waiting right now. Yours will show here for others</div></div>`
    return `<div class="sec"><div class="lab">Open challenges<small>${list.length} waiting</small></div><div class="lob">${list.slice(0, 6).map(lobRow).join('')}</div></div>`
  }
  const stakeBlock = () => {
    const chip = (v: number) => { const on = !st.custom && st.stake === v; return `<button class="pc stk ${on ? 'on' : ''}" data-act="stake" data-s="${v}" role="radio" aria-checked="${on}">${on ? ic('check') : ''}${v}<small>NIM</small></button>` }
    const err = stakeErr()
    const bal = typeof S.balance === 'number' ? `You have ${fmtNim(S.balance)} NIM` : `At least ${MIN_STAKE_NIM} NIM`
    return `<div class="sec"><div class="lab">Stake<small>NIM each</small></div><div class="stkrow" role="radiogroup" aria-label="Stake">${STAKES.map(chip).join('')}<button class="pc stk cus ${st.custom ? 'on' : ''}" data-act="stkc" role="radio" aria-checked="${!!st.custom}">${st.custom ? ic('check') : ic('pencil', 's16')}Custom</button></div>
      ${st.custom ? `<form class="field stkf ${err && (st.customText ?? '').trim() ? 'bad' : ''}" id="stkf" autocomplete="off"><input id="stkin" inputmode="decimal" enterkeyhint="done" placeholder="Amount" value="${esc(st.customText ?? '')}" aria-label="Custom stake in NIM" aria-describedby="stkerr"><span class="u">NIM</span></form>` : ''}
      <div class="stkh ${err ? 'bad' : ''}" id="stkerr" role="${err ? 'alert' : 'note'}">${err ? esc(err) : st.custom ? bal : ''}</div></div>`
  }
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

  /** The topic box: type, then Enter or the enter button locks it in. Locked shows a solid fill with a tick, and Edit. */
  const topicField = () => st.topicLocked
    ? `<div class="tpk" role="status"><span class="tck">${ic('check')}</span><span class="tx"><small>Topic locked in</small><b>${esc(st.topic)}</b></span><button class="tpe" data-act="tedit" aria-label="Edit topic">${ic('pencil', 's16')}Edit</button></div>`
    : `<form class="field tpf" id="tform" autocomplete="off">${ic('search')}<input id="topic" value="${esc(st.topic)}" maxlength="60" placeholder="Type any topic" enterkeyhint="done" aria-label="Trivia topic"><button type="submit" class="tps" data-act="tlock" aria-label="Lock in topic" ${st.topic.trim().length < 2 ? 'disabled' : ''}>${ic('corner-down-left', 's20')}</button></form>`
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
          ? `<div class="sec"><div class="lab">Topic<small>Nimo writes the questions</small></div>${topicField()}<div class="pick">${TOPICS.map((t) => `<button class="pc ${st.topicLocked && st.topic === t ? 'on' : ''}" data-act="topic" data-t="${esc(t)}">${st.topicLocked && st.topic === t ? ic('check') : ''}${t}</button>`).join('')}</div></div>
      <div class="sec"><div class="lab">Questions<small>More questions, more XP</small></div><div class="seg">${[5, 7, 10].map((n) => `<button class="sg ${st.count === n ? 'on' : ''}" data-act="count" data-n="${n}"><b>${n}</b><small>${n * 12} XP</small>${st.count === n ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div></div>`
          : ''
      }
      ${oppBlock()}
      ${royale && st.opp !== 'join' ? seatsBlock() : ''}
      ${st.opp === 'join' ? '' : paid() ? stakeBlock() : st.mode === 'settle' ? settleCard() : ''}
      ${st.err ? errBox(st.err) : ''}
    </div>${st.suggest ? suggestSheet(st.suggest) : ''}
    <div class="foot" style="gap:8px;border-top:2px solid var(--ink);background:var(--bg);padding-top:12px"><div class="sumr"><span id="sum1">${c1}</span><span class="mono" id="sum2">${c2}</span></div>
      <button class="btn gold block" data-act="go" id="go" ${valid() && !st.busy ? '' : 'disabled'}>${st.busy ? ic('refresh-cw', 's20 spin') + 'Working…' : ic(ctaIcon, 's20') + ctaTxt}</button></div>${st.sheet && st.mode === 'settle' ? sheet() : ''}`
  }
  const suggestSheet = (x: LobbyItem) => `<div class="scrim" data-act="sgx"></div><div class="sheet mk" role="dialog" aria-label="Nearest stake"><div class="grab"></div>
    <div class="sh-h" style="align-items:center"><div><div class="sh-t">Play at ${x.stake} NIM?</div><div class="sub">Nobody is waiting at ${st.stake} NIM. ${esc(x.host.name)} is waiting at ${x.stake} NIM</div></div><button class="sh-x" data-act="sgx" aria-label="Close">${ic('x', 's20')}</button></div>
    ${lobRow(x).replace('data-act="ljoin"', 'data-act="none"')}
    <button class="btn gold block" data-act="ljoin" data-code="${esc(x.code)}" data-stake="${x.stake}">${ic('swords', 's20')}Join at ${x.stake} NIM</button>
    <button class="btn ghost block" data-act="mine">Wait at ${st.stake} NIM instead</button></div>`
  const lobRow = (x: LobbyItem) => `<button class="rw lobr" data-act="ljoin" data-code="${esc(x.code)}" data-stake="${x.stake}"><span class="avs">${avatar(x.host.avatar, 'av', x.host.frame)}</span><span class="nm"><b>${esc(x.host.name)}</b><span>${x.mode === 'save' ? 'Save' : x.mode === 'win' ? 'Win' : 'Play'}${x.topic ? ' · ' + esc(x.topic) : ''} · waiting ${x.waitingSec < 60 ? x.waitingSec + 's' : Math.floor(x.waitingSec / 60) + 'm'}</span></span><span class="am"><b>${x.mode === 'play' ? 'Free' : x.stake + ' NIM'}</b><span>Join</span></span></button>`
  let lobbyTimer: ReturnType<typeof setTimeout> | undefined
  const loadLobby = async () => {
    clearTimeout(lobbyTimer)
    if (st.opp !== 'auto' || royale || !root.isConnected) return
    try {
      const r = await api.lobby(id, st.mode)
      st.open = r.open
      if (st.opp === 'auto' && !st.busy && !st.sheet && !st.suggest && document.activeElement?.id !== 'topic') { const back = keepScroll(root); draw(); back() }
    } catch { /* the lobby is a bonus, matching still works */ }
    lobbyTimer = setTimeout(() => void loadLobby(), 5000)
  }
  draw()
  void loadLobby()

  root.addEventListener('submit', (e) => {
    e.preventDefault()
    if ((e.target as HTMLElement).id === 'stkf') return void ($('#stkin', root) as HTMLInputElement | null)?.blur()
    if ((e.target as HTMLElement).id !== 'tform') return
    lockTopic()
  })
  const lockTopic = () => {
    if (st.topic.trim().length < 2) return toast('Type a topic first')
    st.topic = st.topic.trim()
    st.topicLocked = true
    sfx('ui/confirm')
    const back = keepScroll(root)
    draw()
    back()
  }

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.id === 'topic') {
      st.topic = t.value
      const lb = $('.tps', root) as HTMLButtonElement | null
      if (lb) lb.disabled = st.topic.trim().length < 2
    }
    termsInput(st.d, t, root, place())
    if (t.id === 'code') st.code = t.value.toUpperCase()
    if (t.id === 'stkin') {
      st.customText = t.value.replace(/[^0-9.,]/g, '').replace(',', '.')
      if (t.value !== st.customText) t.value = st.customText
      st.stake = cleanStake(st.customText || 'x')
      const err = stakeErr()
      const h = $('#stkerr', root)
      if (h) { h.textContent = err || (typeof S.balance === 'number' ? `You have ${fmtNim(S.balance)} NIM` : `At least ${MIN_STAKE_NIM} NIM`); h.className = 'stkh' + (err ? ' bad' : ''); h.setAttribute('role', err ? 'alert' : 'note') }
      $('#stkf', root)?.classList.toggle('bad', !!err && !!st.customText)
      const g = $('#go', root)
      if (g && !st.busy) { const [ct, ci] = cta(); g.innerHTML = ic(ci, 's20') + ct }
    }
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
      st.open = undefined
      draw()
      void loadLobby()
    },
    opp: (el) => {
      const k = el.dataset.k as Setup['opp']
      if (k === 'pip' && staked()) return toast('Nimo plays free matches only')
      sfx('ui/select')
      st.opp = k
      if (k !== 'invite') st.challenge = undefined
      st.open = undefined
      draw()
      void loadLobby()
      if (k === 'join') ($('#code', root) as HTMLInputElement | null)?.focus()
    },
    pip: (el) => ((st.pip = el.dataset.l as PipLevel), sfx('ui/select'), draw()),
    topic: (el) => ((st.topic = el.dataset.t!), (st.topicLocked = true), sfx('ui/select'), draw()),
    tedit: () => {
      st.topicLocked = false
      sfx('ui/select')
      draw()
      const inp = $('#topic', root) as HTMLInputElement | null
      inp?.focus({ preventScroll: true })
      inp?.select()
    },
    tlock: () => { /* the form submit handles it */ },
    sgx: () => ((st.suggest = undefined), sfx('ui/back'), draw()),
    none: () => {},
    mine: async () => {
      st.suggest = undefined
      await startMatch(true)
    },
    ljoin: async (el) => {
      if (st.busy) return
      const stake = Number(el.dataset.stake)
      if (stake > 0 && !canStake) return toast('Open Nimbles inside Nimiq Pay to stake NIM')
      st.busy = true
      st.suggest = undefined
      draw()
      try {
        const m = await api.join(el.dataset.code!)
        sfx('ui/confirm')
        go('/m/' + m.id)
      } catch (e: any) {
        st.err = e.message
        st.busy = false
        sfx('ui/error')
        draw()
        void loadLobby()
      }
    },
    count: (el) => ((st.count = Number(el.dataset.n)), sfx('ui/select'), draw()),
    seats: (el) => ((st.seats = Number(el.dataset.n)), sfx('ui/select'), draw()),
    payout: (el) => ((st.payout = el.dataset.k as 'wta' | 'top3'), sfx('ui/select'), draw()),
    stake: (el) => ((st.stake = Number(el.dataset.s)), (st.custom = false), sfx('ui/select'), draw()),
    stkc: () => {
      st.custom = true
      st.stake = cleanStake(st.customText || 'x')
      sfx('ui/select')
      draw()
      const inp = $('#stkin', root) as HTMLInputElement | null
      inp?.focus({ preventScroll: true })
    },
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
    go: () => startMatch(false),
  })
  async function startMatch(noNearby: boolean) {
    if (!valid() || st.busy) return
    if (id === 'trivia') { st.topic = st.topic.trim(); st.topicLocked = true }
    st.busy = true
    st.err = ''
    draw()
    try {
      let m: any
      if (st.opp === 'join') m = await api.join(st.code)
      else {
        m = await api.create({
          game: id, mode: st.mode, opp: st.opp, pipLevel: st.opp === 'pip' ? st.pip : undefined,
          stake: paid() ? st.stake : 0, terms: st.mode === 'settle' ? draftBody(st.d) : undefined, noNearby,
          challenge: st.opp === 'invite' ? st.challenge?.address : undefined,
          config: royale ? { seats: st.seats, payout: st.payout } : { topic: st.topic, count: st.count, note: st.note, receipt: st.receipt },
        })
      }
      if (m?.suggest) {
        st.busy = false
        st.suggest = m.suggest
        sfx('ui/select')
        draw()
        return
      }
      sfx('ui/confirm')
      go('/m/' + m.id)
    } catch (e: any) {
      st.err = e.message
      st.busy = false
      sfx('ui/error')
      draw()
    }
  }
  return () => clearTimeout(lobbyTimer)
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
