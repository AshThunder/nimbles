import qrcode from 'qrcode-generator'
import { api, serverNow, type MatchView } from '../api'
import { LIVE_MODS, MODS } from '../games'
import { SEAT_COL } from '../games/splat'
import { meOf, others, type GameInst } from '../games/common'
import { actions, avatar, confetti, esc, fmtTime, glyph, GLYPH_BG, ic, pipImg, shortAddr, sfx, buzz, toast, tap, $ } from '../lib'
import { S, go, route } from '../state'
import { errBox, pipRow, topbar } from '../ui'
import { friendlyWalletError } from '../wallet'
import { GAMES, fmtNim } from '../../../shared/types'
import { settleShares } from '../../../shared/economy'
import { draftBody, draftOk, newDraft, payeeLabel, termsActions, termsForm, termsInput, type TermsDraft } from './terms'

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th']
const shareLink = (code: string) => `${location.origin}/#/join/${code}`

route('/join/:code', async (root, p) => {
  root.innerHTML = `${topbar('Joining', 'close')}<div class="scroll center" style="justify-content:center">${pipImg('think')}<b>Joining ${esc(p.code)}…</b></div>`
  actions(root, { back: () => go('/') })
  try {
    const m = await api.join(p.code)
    go('/m/' + m.id)
  } catch (e: any) {
    root.innerHTML = `${topbar('Join failed', 'close')}<div class="scroll" style="gap:14px">${errBox(e.message)}<button class="btn gold block" data-act="home">Back home</button></div>`
    actions(root, { back: () => go('/'), home: () => go('/') })
  }
})

route('/m/:id', async (root, { id }) => {
  let m: MatchView
  try {
    m = await api.match(id)
  } catch (e: any) {
    root.innerHTML = `${topbar('Match', 'close')}<div class="scroll" style="gap:14px">${errBox(e.message)}<button class="btn gold block" data-act="home">Back home</button></div>`
    actions(root, { back: () => go('/'), home: () => go('/') })
    return
  }
  let alive = true
  let busy = ''
  let err = ''
  let sig = ''
  let game: GameInst | undefined
  let gameRoot: HTMLElement | undefined
  let cdTimer: ReturnType<typeof setInterval> | undefined
  let poll: ReturnType<typeof setTimeout> | undefined
  let tail = 0
  let shown = false
  let showQr = false
  let proposing = false
  let draft: TermsDraft = newDraft()

  const me = () => meOf(m, S.wallet.address)
  const teardownGame = () => {
    game?.destroy()
    game = undefined
    gameRoot?.remove()
    gameRoot = undefined
  }
  const header = (title = GAMES[m.game].name, left: 'back' | 'close' = 'close') => topbar(title, left, `<div class="coin nb">${m.mode === 'play' ? 'Free play' : m.mode === 'save' || m.mode === 'win' ? `Pot ${m.stake * (m.size ?? 2)}` : `Bill ${m.stake}`}</div>`)

  const refresh = async () => {
    try {
      const next = await api.match(id)
      if (!alive) return
      m = next
      onMatch()
    } catch (e: any) {
      if (e.status === 0) toast('Reconnecting…')
    }
  }

  const finish = async (r: { score: number; time: number; detail?: unknown }) => {
    if (m.game === 'trivia') return refresh()
    try {
      m = await api.result(id, r)
      onMatch()
    } catch (e: any) {
      toast(e.message)
      await refresh()
    }
  }
  const progress = (() => {
    let last = 0
    return (s: number) => {
      if (Date.now() - last > 1200) {
        last = Date.now()
        void api.progress(id, s).catch(() => {})
      }
    }
  })()

  function onMatch() {
    const mine = me()
    const s = [m.status, m.players.length, m.players.map((p) => +p.funded).join(''), m.terms ? m.terms.rev + ':' + m.terms.agreed.length : '', proposing, busy, err, showQr, m.status === 'playing' && mine?.result ? 'done' : '', m.settlement?.payouts.filter((p) => p.tx).length ?? ''].join('|')
    if (m.status === 'playing' && game && !mine?.result) game.update(m)
    if (s === sig) return
    sig = s
    render()
  }

  function render() {
    const mine = me()
    clearInterval(cdTimer)
    if (m.status !== 'playing' || mine?.result) teardownGame()
    switch (m.status) {
      case 'lobby': return lobby()
      case 'terms': return terms()
      case 'funding': return funding()
      case 'ready': return ready()
      case 'playing': return mine?.result ? waiting() : play()
      case 'settled': return result()
      case 'cancelled': return cancelled()
    }
  }

  // ---------------- lobby ----------------
  function lobby() {
    const need = (m.size ?? 2) - m.players.length
    const staked = m.mode !== 'play'
    const detail = m.mode === 'save' || m.mode === 'win' ? `${m.stake} NIM each` : m.mode === 'settle' ? `${m.stake} NIM bill` : 'Free play'
    if (m.opp === 'auto') {
      root.innerHTML = `${header()}<div class="scroll" style="gap:14px">
        <div class="banner" style="background:${GLYPH_BG[m.game]}"><div class="c"><b>${esc(GAMES[m.game].name)}</b><span>${detail}</span></div><span class="art" style="display:block">${glyph(m.game)}</span></div>
        <div class="wait"><div class="ghostav">${ic('search', 's20')}</div><div class="tx"><b>Looking for an opponent</b><span>Same game, same stake. This can take a minute</span></div><div class="dotsw"><i></i><i></i><i></i></div></div>
        ${pipRow('sleepy', 'Nobody yet. Want to <b>invite a friend</b> instead? Cancel and pick Invite')}</div>
        <div class="foot"><button class="btn ghost block" data-act="cancel">Cancel search</button></div>`
      return
    }
    const link = shareLink(m.code)
    const q = qrcode(0, 'M')
    q.addData(link)
    q.make()
    root.innerHTML = `${header()}<div class="scroll" style="gap:14px">
      <div class="banner" style="background:${GLYPH_BG[m.game]}"><div class="c"><b>${esc(GAMES[m.game].name)}</b><span>${detail}${m.size && m.size > 2 ? `, ${m.size} players` : ''}</span></div><span class="art" style="display:block">${glyph(m.game)}</span></div>
      <div class="card" style="display:flex;flex-direction:column;gap:12px"><div class="lab" style="margin:0">Invite code<small>Share it, they type or scan it</small></div>
        <div class="inv-row"><div class="qrbox" aria-label="QR code for the invite link">${q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div>
        <div class="inv-col"><div class="mono" style="font-size:28px;font-weight:700;letter-spacing:.04em" id="code">${m.code}</div>
        <button class="btn gold sm" data-act="share">${ic('share-2', 's16')}Share link</button><button class="btn ghost sm" data-act="copy">${ic('copy', 's16')}Copy code</button></div></div></div>
      ${royale ? royaleSeats() : ''}
      <div class="wait"><div class="ghostav">${ic('user-plus', 's20')}</div><div class="tx"><b>${royale ? `${m.players.length} of ${m.size} in` : `Waiting for ${need > 1 ? need + ' players' : 'your friend'}`}</b><span>${royale ? (staked ? 'Everyone locks the stake when the match fills, or when the host starts it' : 'Nimos fill the empty seats when the host starts') : m.mode === 'settle' ? 'You both agree the terms once they join' : staked ? 'Both lock the stake once they join' : 'The game starts when they join'}</span></div><div class="dotsw"><i></i><i></i><i></i></div></div>
      ${pipRow('wink', `Seeds are sealed: <span class="mono" style="font-size:12px">${m.seedCommit.slice(0, 10)}…</span> proves nobody can rig the deal`)}</div>
      <div class="foot">${royale && m.host === S.wallet.address ? `<button class="btn gold block" data-act="start" ${busy || (staked && m.players.length < 2) ? 'disabled' : ''}>${ic('zap', 's20')}${staked ? (m.players.length < 2 ? 'Need one more player' : `Start now with ${m.players.length}`) : 'Start now'}</button>` : ''}<button class="btn ghost block" data-act="cancel">Cancel match</button></div>`
  }
  const royale = m.game === 'splat'
  function royaleSeats() {
    const dots = (i: number) => `<i class="sdot" style="background:${SEAT_COL[i % SEAT_COL.length]}"></i>`
    const rows = Array.from({ length: m.size ?? 2 }, (_, i) => {
      const p = m.players[i]
      if (!p) return `<div class="rw" style="min-height:48px;border-style:dashed"><span class="avs"><span class="ghostav" style="width:36px;height:36px;border-radius:18px;border:2px dashed var(--ink);display:grid;place-items:center">${dots(i)}</span></span><span class="nm"><b style="color:var(--muted)">${m.mode === 'play' ? 'Nimo joins' : 'Open seat'}</b></span></div>`
      const you = p.player.address === S.wallet.address
      return `<div class="rw ${you ? 'me' : ''}" style="min-height:48px"><span class="avs">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}</span><span class="nm"><b>${you ? 'You' : esc(p.player.name)}${p.player.address === m.host ? '<span class="tg2" style="background:var(--ink)">Host</span>' : ''}</b></span>${dots(i)}</div>`
    }).join('')
    const pay = m.mode === 'save' || m.mode === 'win' ? (royale ? (m.config.payout === 'top3' ? 'Top 3 split the pot 60 / 30 / 10' : 'Last one standing takes the pot') : 'Winner takes the pot') : 'Free play, earns XP'
    return `<div class="sec"><div class="lab">Players<small>${esc(pay)}</small></div><div class="rank" style="gap:8px">${rows}</div></div>`
  }

  // ---------------- terms (Settle) ----------------
  function terms() {
    const t = m.terms!
    const addr = S.wallet.address
    const iAgreed = t.agreed.includes(addr)
    const left = fmtTime((m.fundBy ?? 0) - serverNow())
    if (proposing) {
      root.innerHTML = `${header('Change terms')}<div class="scroll" style="gap:14px"><div class="tc">${termsForm(draft)}</div>${err ? errBox(err) : ''}</div>
        <div class="foot"><button class="btn gold block" data-act="send-terms" ${draftOk(draft) && !busy ? '' : 'disabled'}>${ic('send', 's20')}Send new terms</button><button class="btn ghost block" data-act="keep">Keep the current terms</button></div>`
      return
    }
    const s = settleShares(t.bill, t.loserPct)
    const rows = m.players
      .map((p) => {
        const ok = t.agreed.includes(p.player.address)
        return `<div class="rw ${p.player.address === addr ? 'me' : ''}"><span class="avs">${avatar(p.player.avatar)}</span><span class="nm"><b>${p.player.address === addr ? 'You' : esc(p.player.name)}</b><span>${ok ? 'Agreed' : 'Has not agreed yet'}</span></span><span class="okb ${ok ? 'on' : ''}">${ok ? ic('check', 's16') : ic('clock', 's16')}</span></div>`
      })
      .join('')
    root.innerHTML = `${header('Agree the terms')}<div class="scroll" style="gap:12px">
      <div class="card tc"><div class="row"><b style="font-size:18px">${GAMES[m.game].name}</b><span class="sp"></span><span class="mono" style="font-size:13px" id="terms-left">${left}</span></div>
        <div class="kv"><span>Bill</span><b>${t.bill} NIM</b></div>
        <div class="kv"><span>Loser pays</span><b>${fmtNim(s.loser)} NIM (${t.loserPct}%)</b></div>
        <div class="kv"><span>Winner pays</span><b>${fmtNim(s.winner)} NIM</b></div>
        <div class="kv"><span>If it is a draw</span><b>Half each</b></div>
        <div class="kv"><span>Money goes to</span><b>${esc(payeeLabel(t.payee, m.players, addr))}</b></div>
        <div class="kv"><span>Each of you locks</span><b>${fmtNim(t.lock ?? 0)} NIM</b></div></div>
      <div class="rank" style="gap:8px">${rows}</div>
      ${err ? errBox(err) : ''}
      ${iAgreed ? pipRow('sleepy', '<b>You agreed.</b> Waiting for the other player. Nothing is locked yet') : pipRow('happy', '<b>Check the terms.</b> Nothing is locked until you both agree')}</div>
    <div class="foot">${iAgreed ? '' : `<button class="btn gold block" data-act="agree" ${busy ? 'disabled' : ''}>${ic('check', 's20')}Agree to these terms</button>`}<button class="btn ghost block" data-act="change">${ic('pencil', 's20')}Change terms</button><button class="btn ghost block" data-act="cancel">Decline and cancel</button></div>`
    cdTimer = setInterval(() => {
      const el = $('#terms-left', root)
      if (el) el.textContent = fmtTime((m.fundBy ?? 0) - serverNow())
    }, 500)
  }

  const termsCall = async (body: unknown) => {
    err = ''
    busy = 'Sending…'
    sig = ''
    onMatch()
    try {
      m = await api.terms(id, body)
      proposing = false
      sfx('ui/select')
    } catch (e: any) {
      err = e.message
      sfx('ui/error')
    }
    busy = ''
    sig = ''
    onMatch()
  }

  // ---------------- funding ----------------
  function funding() {
    const mine = me()
    const fundBy = m.fundBy ?? 0
    const required = mine?.escrowed ?? 0
    const need = !mine.funded && required > 0
    const rows = m.players
      .map((p) => `<div class="rw ${p.player.address === S.wallet.address ? 'me' : ''}"><span class="avs">${avatar(p.player.avatar)}</span><span class="nm"><b>${p.player.address === S.wallet.address ? 'You' : esc(p.player.name)}</b><span>${p.funded ? (p.escrowed ? 'Locked ' + fmtNim(p.escrowed) + ' NIM' + (p.paidFrom ? ' · paid from ' + shortAddr(p.paidFrom) : '') : 'Nothing to lock') : 'Waiting to lock ' + fmtNim(p.escrowed ?? 0) + ' NIM'}</span></span><span class="okb ${p.funded ? 'on' : ''}">${p.funded ? ic('check', 's16') : ic('clock', 's16')}</span></div>`)
      .join('')
    const what =
      m.mode === 'win'
        ? royale
          ? `All ${m.players.length} lock <b>${m.stake} NIM</b>. The pot is <b>${m.stake * m.players.length} NIM</b>. ${m.config.payout === 'top3' && m.players.length >= 3 ? 'The top 3 split it 60 / 30 / 10' : 'The last one standing takes it'}, paid straight to their wallets after the 2% fee. If the match cannot finish, every stake comes back`
          : `Both lock <b>${m.stake} NIM</b>. The winner is paid <b>${(m.stake * 2 * 0.98).toFixed(2)} NIM</b> straight to their wallet after the 2% fee. A draw returns both stakes`
        : m.mode === 'save'
        ? royale
          ? `All ${m.players.length} lock <b>${m.stake} NIM</b>. The pot is <b>${m.stake * m.players.length} NIM</b>. ${m.config.payout === 'top3' && m.players.length >= 3 ? 'The top 3 split it 60 / 30 / 10' : 'The last one standing takes it'}, into locked savings jars. If the match cannot finish, every stake comes back`
          : `Both lock <b>${m.stake} NIM</b>. Winner's <b>${m.stake * 2} NIM</b> goes into their locked savings jar. Draw returns both stakes`
        : m.terms
          ? `Terms agreed: bill <b>${m.terms.bill} NIM</b>, loser pays ${m.terms.loserPct}%. Each locks the most they could owe. Whatever is not owed comes back`
          : ''
    root.innerHTML = `${header('Lock in')}<div class="scroll" style="gap:12px">
      <div class="card" style="display:flex;flex-direction:column;gap:6px"><div class="row"><b style="font-size:18px">${GAMES[m.game].name}</b><span class="sp"></span><span class="mono" style="font-size:13px" id="fund-left">${fmtTime(fundBy - serverNow())}</span></div><div style="font-size:14px;line-height:20px;color:var(--ink2)">${what}</div></div>
      <div class="rank" style="gap:8px">${rows}</div>
      <div class="note"><span class="paid">${ic('shield-check', 's16')}Held in escrow, refunded if anything fails</span><span class="mono" style="font-size:12px;color:var(--muted)">${shortAddr(m.escrow.address)} · ${esc(m.escrow.network)}</span></div>
      ${err ? errBox(err) : ''}
      ${busy ? pipRow('think', `<b>${esc(busy)}</b>`) : need ? pipRow('happy', '<b>Lock your stake</b> to start. Nothing moves until both are in') : pipRow('sleepy', '<b>You are in.</b> Waiting for the others to lock')}</div>
    <div class="foot">${need ? `<button class="btn gold block" data-act="fund" ${busy ? 'disabled' : ''}>${busy ? ic('refresh-cw', 's20 spin') + 'Working…' : ic('lock', 's20') + 'Lock ' + fmtNim(required) + ' NIM'}</button>` : ''}<button class="btn ghost block" data-act="cancel">Cancel match</button></div>`
    cdTimer = setInterval(() => {
      const el = $('#fund-left', root)
      if (el) el.textContent = fmtTime((m.fundBy ?? 0) - serverNow())
    }, 500)
  }

  async function fund() {
    const mine = me()
    err = ''
    if (S.wallet.kind === 'nimiq-pay' && S.wallet.network !== 'unknown' && S.wallet.network !== m.escrow.network) {
      err = `Nimiq Pay is on ${S.wallet.network}, this match runs on ${m.escrow.network}. Switch networks and try again`
      return void ((sig = ''), onMatch())
    }
    try {
      busy = 'Approve the payment in Nimiq Pay…'
      sig = ''
      onMatch()
      const hash = await S.wallet.send(m.escrow.address, mine.escrowed ?? 0, m.escrow.memo)
      busy = 'Confirming on the network…'
      sig = ''
      onMatch()
      for (let i = 0; i < 60 && alive; i++) {
        const v = await api.fund(id, hash)
        if (!v.pending) {
          m = v
          break
        }
        await new Promise((r) => setTimeout(r, 2500))
      }
      sfx('reward/coin')
      S.wallet.balance().then((b) => (S.balance = b))
    } catch (e: any) {
      err = friendlyWalletError(e)
      sfx('ui/error')
    }
    busy = ''
    sig = ''
    await refresh()
    sig = ''
    onMatch()
  }

  // ---------------- ready / play ----------------
  function ready() {
    const players = m.players
    root.innerHTML = `${header()}<div class="scroll center" style="gap:16px;justify-content:center">
      ${royale ? `<div class="sqd">${players.map((p, i) => `<div class="sq" style="border-color:${SEAT_COL[i % SEAT_COL.length]}">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}<span>${p.player.address === S.wallet.address ? 'You' : esc(p.player.name.split(' ')[0])}</span></div>`).join('')}</div>` : `
      <div class="arena" style="width:100%"><div class="l"></div><div class="r"></div>
      ${[players[0], players[1] ?? players[0]].map((p, i) => `<div class="pl ${i ? 'b' : 'a'}">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}<span class="nm">${p.player.address === S.wallet.address ? 'You' : esc(p.player.name.split(' ')[0])}</span></div>`).join('')}<div class="vs">VS</div></div>`}
      <div class="cd" id="cd">3</div><div style="font-weight:700;color:var(--ink2)">${royale ? 'Same arena for everyone' : 'Same seed for both'}: <span class="mono" style="font-size:13px">${m.seedCommit.slice(0, 8)}…</span></div></div>`
    let last = -1
    const tick = () => {
      const left = (m.startsAt ?? 0) - serverNow()
      const n = Math.ceil(left / 1000)
      const el = $('#cd', root)
      if (!el) return
      if (n !== last) {
        last = n
        el.textContent = n > 0 ? String(n) : 'Go!'
        el.classList.remove('pop2')
        void el.offsetWidth
        el.classList.add('pop2')
        if (n > 1) sfx('ui/countdown-tick')
        else if (n === 1) sfx('ui/countdown-last')
        else sfx('ui/countdown-go')
        buzz(20)
      }
      if (left <= -200) {
        clearInterval(cdTimer)
        void refresh()
      }
    }
    tick()
    cdTimer = setInterval(tick, 100)
  }

  function play() {
    const mod = m.game === 'splat' ? MODS.splat : m.live ? LIVE_MODS[m.game] : MODS[m.game]
    if (!mod) {
      root.innerHTML = `${header()}<div class="scroll" style="gap:14px">${pipRow('sleepy', `<b>${GAMES[m.game].name} is not built yet.</b> Cancel and pick another game`)}</div>`
      return
    }
    if (game) return
    root.innerHTML = ''
    gameRoot = document.createElement('div')
    gameRoot.className = 'view'
    root.appendChild(gameRoot)
    game = mod({ root: gameRoot, m, me: S.wallet.address, finish, progress, sync: (nm) => { m = nm; onMatch() } })
  }

  function waiting() {
    const rest = others(m, S.wallet.address)
    root.innerHTML = `${header()}<div class="scroll center" style="gap:14px;justify-content:center">${pipImg('sleepy')}<b style="font-size:22px">You are done</b>
      <div class="wait" style="width:100%"><div class="ghostav">${rest[0]?.isBot ? pipImg('cool') : avatar(rest[0]?.player.avatar ?? 'ada')}</div><div class="tx"><b>${rest.length > 1 ? 'Others are' : esc(rest[0]?.player.name ?? 'Opponent') + ' is'} still playing</b><span>The result appears when everyone finishes</span></div><div class="dotsw"><i></i><i></i><i></i></div></div></div>`
  }

  // ---------------- result ----------------
  function result() {
    const st = m.settlement!
    const addr = S.wallet.address
    const mr = st.ranks.find((r) => r.address === addr)
    const rank = mr?.rank ?? 2
    const win = !st.draw && rank === 1
    const n = m.players.length
    const headline = st.draw ? 'Dead heat' : n > 2 ? `${ORD[rank - 1]} place` : win ? 'Victory' : 'Defeat'
    const mood = st.draw ? 'love' : win ? 'cheer' : rank === 2 && n > 2 ? 'happy' : 'sad'
    const xp = st.xp[addr] ?? 0
    const chestCard = `<button class="card chr" data-act="chests" style="background:var(--gold-tint);min-height:56px;padding:6px 12px 6px 8px"><img src="/badges/chest-closed.svg" alt="" width="40" height="40"><span class="nm"><b>Chest earned</b><span>Hold to open. See what is inside first</span></span><span class="chip gold">Open</span></button>`
    const myPay = st.payouts.filter((p) => (p.for ?? p.to) === addr)
    const jar = st.jarCredit[addr] ?? 0
    const unit = (s: number, a?: string) => (m.game === 'splat' ? splatLine(a) : m.game === 'trivia' ? `${s} pts` : m.game === 'solitaire' ? `${s / 10} cards` : `${s} pts`)
    const splatLine = (a?: string) => {
      const d: any = m.players.find((x) => x.player.address === a)?.result?.detail
      if (!d) return ''
      return `${d.alive ? 'Last standing' : 'Out at ' + fmtTime(d.out ?? 0)} · ${d.splats} ${d.splats === 1 ? 'splat' : 'splats'}`
    }
    const jarOf = (a: string) => st.jarCredit[a] ?? 0
    const prizeOf = (a: string) => st.payouts.filter((p) => p.kind === 'prize' && (p.for ?? p.to) === a).reduce((t, p) => t + p.luna, 0)
    const settle = m.mode === 'settle'
    const rows = st.ranks
      .map((r) => {
        const p = m.players.find((x) => x.player.address === r.address)!
        const you = r.address === addr
        const medal = r.rank === 1 ? 'g' : r.rank === 2 ? 's' : r.rank === 3 ? 'b' : 'c'
        return `<div class="rw ${you ? 'me' : ''}"><span class="med ${medal}">${r.rank}</span><span class="avs">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}</span><span class="nm"><b>${you ? 'You' : esc(p.player.name)}</b><span>${unit(r.score, r.address)}</span></span>${m.game === 'splat' && jarOf(r.address) ? `<span class="am"><b>+${fmtNim(jarOf(r.address))}</b><span>to jar</span></span>` : ''}${prizeOf(r.address) ? `<span class="am"><b>+${fmtNim(prizeOf(r.address))}</b><span>to wallet</span></span>` : ''}${settle ? `<span class="am"><b>${fmtNim(p.share ?? 0)}</b><span>${st.draw ? 'half' : r.rank === 1 ? 'winner share' : 'owes'}</span></span>` : ''}</div>`
      })
      .join('')
    const lines = [
      ...(jar ? [`<div class="rw" style="min-height:48px"><span class="nm"><b>${ic('piggy-bank', 's16')} Added to your jar</b><span>Joins your ${S.me.plan.lockDays}-day lock</span></span><span class="am"><b>+${fmtNim(jar)}</b><span>NIM</span></span></div>`, ...(st.fee ? [`<div class="rw" style="min-height:48px"><span class="nm"><b>${ic('coins', 's16')} Saver pool</b><span>2% of the pot, shared with savers</span></span><span class="am"><b>${fmtNim(st.fee)}</b><span>NIM</span></span></div>`] : [])] : []),
      ...(settle ? st.payouts.filter((p) => p.kind === 'settle' && (p.for ?? p.to) !== addr).map((p) => `<div class="rw" style="min-height:48px"><span class="nm"><b>Bill paid out</b><span>To ${esc(shortAddr(p.to))}${p.tx ? ' · sent ' + shortAddr(p.tx) : ' · sending…'}</span></span><span class="am"><b>${fmtNim(p.luna)}</b><span>NIM</span></span></div>`) : []),
      ...myPay.map((p) => `<div class="rw" style="min-height:48px"><span class="nm"><b>${p.kind === 'settle' ? 'Bill received' : p.kind === 'prize' ? 'Prize' : 'Refund'}</b><span>${p.tx ? 'Sent ' + shortAddr(p.tx) : 'Sending…'} · ${esc(p.note ?? '')}</span></span><span class="am"><b>+${fmtNim(p.luna)}</b><span>NIM</span></span></div>`),
    ].join('')
    root.innerHTML = `${header(st.draw ? 'Draw' : win ? 'You won' : 'Result')}<div class="scroll" style="gap:12px">
      <div class="res"><canvas class="cf" id="cf"></canvas>${pipImg(mood).replace('<img', '<img class="pipx"')}<div class="txt"><b>${headline}</b><div class="rw2"><span class="rwd">${ic('star', 's16')}+${xp} XP${st.xpBonus?.[addr] ? ` (+${st.xpBonus[addr]}%)` : ''}</span>${m.mode !== 'play' ? `<span class="rwd b">${m.mode === 'save' || m.mode === 'win' ? (st.draw ? 'Stake back' : prizeOf(addr) || jar ? 'Won ' + fmtNim(prizeOf(addr) || jar) : 'Lost ' + m.stake) : 'Bill ' + m.stake}</span>` : ''}</div></div></div>
      <div class="rank" style="gap:8px">${rows}</div>
      ${lines ? `<div class="sec"><div class="lab">Your NIM</div><div class="rank" style="gap:8px">${lines}</div></div>` : ''}
      <div class="note"><span class="paid">${ic('shield-check', 's16')}${esc(st.reason)}</span><span class="mono" style="font-size:12px;color:var(--muted)">Seed ${esc((m.seed ?? '').slice(0, 10))}…</span></div>
      <div id="chestslot">${win && S.me.chests > 0 ? chestCard : pipRow(mood, win ? '<b>Well played.</b> Want a rematch?' : st.draw ? '<b>So close.</b> Rematch settles it' : '<b>Good fight.</b> Rematch and take it back?')}</div></div>
    <div class="foot" style="gap:8px"><button class="btn gold block" data-act="again">${ic('rotate-ccw', 's20')}Play again</button><button class="btn ghost block" data-act="home">Home</button></div>`
    if (!shown && (win || st.draw)) {
      const cv = $('#cf', root) as HTMLCanvasElement | null
      if (cv) confetti(win ? 90 : 40, cv.parentElement!)
    }
    if (!shown) {
      shown = true
      if (win) sfx('reward/win-big')
      else if (st.draw) sfx('reward/draw')
      else sfx('reward/lose')
      if (win) buzz([60, 40, 60])
      if (xp) setTimeout(() => sfx('reward/xp', 0.4), 700)
      S.wallet.balance().then((b) => (S.balance = b))
      api.me().then((p) => {
        S.me = p
        const slot = $('#chestslot', root)
        if (slot && p.chests > 0 && win) slot.innerHTML = chestCard
      }).catch(() => {})
    }
  }

  function cancelled() {
    root.innerHTML = `${header('Cancelled')}<div class="scroll center" style="gap:14px;justify-content:center">${pipImg('sad')}<b style="font-size:22px">Match cancelled</b><div style="color:var(--ink2);font-size:15px;line-height:22px;max-width:300px">${m.mode === 'play' ? 'No stake was involved.' : m.mode === 'settle' ? 'The deal is off. Nothing is locked until both agree, and anything already locked is on its way back.' : 'Any NIM you locked is on its way back to your wallet.'}</div></div><div class="foot"><button class="btn gold block" data-act="home">Home</button></div>`
  }

  root.addEventListener('input', (ev) => {
    if (proposing && termsInput(draft, ev.target as HTMLInputElement, root)) {
      const b = $('[data-act=send-terms]', root) as HTMLButtonElement | null
      if (b) b.disabled = !draftOk(draft)
    }
  })

  actions(root, {
    ...termsActions(draft, () => render()),
    agree: () => void termsCall({ action: 'agree', rev: m.terms!.rev }),
    change: () => {
      const t = m.terms!
      const idx = m.players.findIndex((p) => p.player.address === S.wallet.address)
      Object.assign(draft, newDraft(String(t.bill)))
      draft.pct = t.loserPct
      if ('address' in t.payee) { draft.payee = 'other'; draft.other = t.payee.address } else draft.payee = t.payee.seat === idx ? 'me' : 'friend'
      proposing = true
      err = ''
      sig = ''
      onMatch()
    },
    keep: () => { proposing = false; err = ''; sig = ''; onMatch() },
    'send-terms': () => void termsCall({ action: 'propose', ...draftBody(draft) }),
    back: () => (m.status === 'settled' || m.status === 'cancelled' ? go('/') : m.status === 'lobby' || m.status === 'funding' || m.status === 'terms' ? go('/') : toast('Finish the round first, or you forfeit')),
    home: () => go('/'),
    chests: () => go('/chests'),
    again: () => go('/g/' + m.game),
    start: async () => {
      busy = 'Starting…'
      sig = ''
      onMatch()
      try {
        m = await api.start(id)
        sfx('ui/confirm')
      } catch (e: any) {
        toast(e.message)
        sfx('ui/error')
      }
      busy = ''
      sig = ''
      onMatch()
    },
    cancel: async () => {
      try {
        await api.cancel(id)
        sfx('ui/back')
        go('/')
      } catch (e: any) {
        toast(e.message)
      }
    },
    fund: () => void fund(),
    copy: async () => {
      try {
        await navigator.clipboard.writeText(m.code)
      } catch {
        /* clipboard blocked */
      }
      toast('Code copied')
      tap()
    },
    share: async () => {
      const data = { title: 'Nimbles duel', text: `Join my ${GAMES[m.game].name} duel on Nimbles. Code ${m.code}`, url: shareLink(m.code) }
      if (navigator.share) await navigator.share(data).catch(() => {})
      else {
        await navigator.clipboard?.writeText(`${data.text} ${data.url}`).catch(() => {})
        toast('Link copied')
      }
    },
  })

  const loop = async () => {
    if (!alive) return
    await refresh()
    if (!alive) return
    if (m.status === 'cancelled') return
    if (m.status === 'settled') {
      if (tail++ >= 10 || !m.settlement!.payouts.some((p) => !p.tx && p.luna >= 1)) return
    }
    poll = setTimeout(loop, m.live && m.status === 'playing' ? 700 : m.status === 'playing' || m.status === 'ready' ? 1200 : 2000)
  }
  onMatch()
  poll = setTimeout(loop, 1200)
  return () => {
    alive = false
    clearTimeout(poll)
    clearInterval(cdTimer)
    teardownGame()
  }
})
