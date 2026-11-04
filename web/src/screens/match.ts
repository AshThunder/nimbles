import qrcode from 'qrcode-generator'
import { api, serverNow, type MatchView } from '../api'
import { LIVE_MODS, MODS } from '../games'
import { meOf, others, type GameInst } from '../games/common'
import { actions, avatar, confetti, esc, fmtTime, glyph, GLYPH_BG, ic, pipImg, shortAddr, sfx, buzz, toast, tap, $ } from '../lib'
import { S, go, route } from '../state'
import { errBox, pipRow, topbar } from '../ui'
import { friendlyWalletError } from '../wallet'
import { GAMES, fmtNim } from '../../../shared/types'

const ORD = ['1st', '2nd', '3rd', '4th']
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

  const me = () => meOf(m, S.wallet.address)
  const teardownGame = () => {
    game?.destroy()
    game = undefined
    gameRoot?.remove()
    gameRoot = undefined
  }
  const header = (title = GAMES[m.game].name, left: 'back' | 'close' = 'close') => topbar(title, left, `<div class="coin nb">${m.mode === 'play' ? 'Free play' : m.mode === 'save' ? `Pot ${m.stake * 2}` : `Bill ${m.stake}`}</div>`)

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
    const s = [m.status, m.players.length, m.players.map((p) => +p.funded).join(''), busy, err, showQr, m.status === 'playing' && mine?.result ? 'done' : '', m.settlement?.payouts.filter((p) => p.tx).length ?? ''].join('|')
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
    const detail = m.mode === 'save' ? `${m.stake} NIM each` : m.mode === 'spend' ? `${m.stake} NIM bill` : 'Free play'
    if (m.opp === 'auto') {
      root.innerHTML = `${header()}<div class="scroll" style="gap:14px">
        <div class="banner" style="background:${GLYPH_BG[m.game]}"><div class="c"><b>${esc(GAMES[m.game].name)}</b><span>${detail}</span></div><span class="art" style="display:block">${glyph(m.game)}</span></div>
        <div class="wait"><div class="ghostav">${ic('search', 's20')}</div><div class="tx"><b>Looking for an opponent</b><span>Same game, same ${m.mode === 'spend' ? 'bill' : 'stake'}. This can take a minute</span></div><div class="dotsw"><i></i><i></i><i></i></div></div>
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
      <div class="wait"><div class="ghostav">${ic('user-plus', 's20')}</div><div class="tx"><b>Waiting for ${need > 1 ? need + ' players' : 'your friend'}</b><span>${staked ? 'Both lock the stake once they join' : 'The game starts when they join'}</span></div><div class="dotsw"><i></i><i></i><i></i></div></div>
      ${pipRow('wink', `Seeds are sealed: <span class="mono" style="font-size:12px">${m.seedCommit.slice(0, 10)}…</span> proves nobody can rig the deal`)}</div>
      <div class="foot"><button class="btn ghost block" data-act="cancel">Cancel match</button></div>`
  }

  // ---------------- funding ----------------
  function funding() {
    const mine = me()
    const fundBy = m.fundBy ?? 0
    const required = mine?.escrowed ?? 0
    const need = !mine.funded && required > 0
    const rows = m.players
      .map((p) => `<div class="rw ${p.player.address === S.wallet.address ? 'me' : ''}"><span class="avs">${avatar(p.player.avatar)}</span><span class="nm"><b>${p.player.address === S.wallet.address ? 'You' : esc(p.player.name)}${p.payer ? '<span class="tg2">Paid the bill</span>' : ''}</b><span>${p.funded ? (p.escrowed ? 'Locked ' + fmtNim(p.escrowed) + ' NIM' + (p.paidFrom ? ' · paid from ' + shortAddr(p.paidFrom) : '') : 'Nothing to lock') : 'Waiting to lock ' + fmtNim(p.escrowed ?? 0) + ' NIM'}</span></span><span class="okb ${p.funded ? 'on' : ''}">${p.funded ? ic('check', 's16') : ic('clock', 's16')}</span></div>`)
      .join('')
    const what =
      m.mode === 'save'
        ? `Both lock <b>${m.stake} NIM</b>. Winner's <b>${m.stake * 2} NIM</b> goes into their locked savings jar. Draw returns both stakes`
        : `The bill is <b>${m.stake} NIM</b>, fronted by ${m.players.find((p) => p.payer)?.player.name ?? 'the host'}. Your deposit is your highest possible share, any unused part is refunded`
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
      <div class="arena" style="width:100%"><div class="l"></div><div class="r"></div>
      ${[players[0], players[1] ?? players[0]].map((p, i) => `<div class="pl ${i ? 'b' : 'a'}">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}<span class="nm">${p.player.address === S.wallet.address ? 'You' : esc(p.player.name.split(' ')[0])}</span></div>`).join('')}<div class="vs">VS</div></div>
      <div class="cd" id="cd">3</div><div style="font-weight:700;color:var(--ink2)">Same seed for both: <span class="mono" style="font-size:13px">${m.seedCommit.slice(0, 8)}…</span></div></div>`
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
    const mod = m.live ? LIVE_MODS[m.game] : MODS[m.game]
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
    const myPay = st.payouts.filter((p) => (p.for ?? p.to) === addr)
    const jar = st.jarCredit[addr] ?? 0
    const unit = (s: number) => (m.game === 'trivia' ? `${s} pts` : m.game === 'solitaire' ? `${s / 10} cards` : `${s} pts`)
    const spend = m.mode === 'spend'
    const rows = st.ranks
      .map((r) => {
        const p = m.players.find((x) => x.player.address === r.address)!
        const you = r.address === addr
        const medal = r.rank === 1 ? 'g' : r.rank === 2 ? 's' : r.rank === 3 ? 'b' : 'c'
        return `<div class="rw ${you ? 'me' : ''}"><span class="med ${medal}">${r.rank}</span><span class="avs">${p.isBot ? pipImg('cool') : avatar(p.player.avatar)}</span><span class="nm"><b>${you ? 'You' : esc(p.player.name)}${spend && p.payer ? '<span class="tg2">Paid the bill</span>' : ''}</b><span>${unit(r.score)}</span></span>${spend ? `<span class="am"><b>${fmtNim(p.share ?? 0)}</b><span>${p.payer ? 'own share' : 'owes'}</span></span>` : ''}</div>`
      })
      .join('')
    const lines = [
      ...(jar ? [`<div class="rw" style="height:48px"><span class="nm"><b>${ic('piggy-bank', 's16')} Added to your jar</b><span>Locked for ${S.cfg.lockDays} days</span></span><span class="am"><b>+${fmtNim(jar)}</b><span>NIM</span></span></div>`] : []),
      ...myPay.map((p) => `<div class="rw" style="height:48px"><span class="nm"><b>${p.kind === 'settle' ? 'Friends settled up' : 'Refund'}</b><span>${p.tx ? 'Sent ' + shortAddr(p.tx) : 'Sending…'} · ${esc(p.note ?? '')}</span></span><span class="am"><b>+${fmtNim(p.luna)}</b><span>NIM</span></span></div>`),
    ].join('')
    root.innerHTML = `${header(st.draw ? 'Draw' : win ? 'You won' : 'Result')}<div class="scroll" style="gap:12px">
      <div class="res"><canvas class="cf" id="cf"></canvas>${pipImg(mood).replace('<img', '<img class="pipx"')}<div class="txt"><b>${headline}</b><div class="rw2"><span class="rwd">${ic('star', 's16')}+${xp} XP</span>${m.mode !== 'play' ? `<span class="rwd b">${m.mode === 'save' ? (win ? 'Pot ' + m.stake * 2 : st.draw ? 'Stake back' : 'Lost ' + m.stake) : 'Bill ' + m.stake}</span>` : ''}</div></div></div>
      <div class="rank" style="gap:8px">${rows}</div>
      ${lines ? `<div class="sec"><div class="lab">Your NIM</div><div class="rank" style="gap:8px">${lines}</div></div>` : ''}
      <div class="note"><span class="paid">${ic('shield-check', 's16')}${esc(st.reason)}</span><span class="mono" style="font-size:12px;color:var(--muted)">Seed ${esc((m.seed ?? '').slice(0, 10))}…</span></div>
      ${pipRow(mood, win ? '<b>Well played.</b> Want a rematch?' : st.draw ? '<b>So close.</b> Rematch settles it' : '<b>Good fight.</b> Rematch and take it back?')}</div>
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
      api.me().then((p) => (S.me = p)).catch(() => {})
    }
  }

  function cancelled() {
    root.innerHTML = `${header('Cancelled')}<div class="scroll center" style="gap:14px;justify-content:center">${pipImg('sad')}<b style="font-size:22px">Match cancelled</b><div style="color:var(--ink2);font-size:15px;line-height:22px;max-width:300px">${m.mode === 'play' ? 'No stake was involved.' : 'Any NIM you locked is on its way back to your wallet.'}</div></div><div class="foot"><button class="btn gold block" data-act="home">Home</button></div>`
  }

  actions(root, {
    back: () => (m.status === 'settled' || m.status === 'cancelled' ? go('/') : m.status === 'lobby' || m.status === 'funding' ? go('/') : toast('Finish the round first, or you forfeit')),
    home: () => go('/'),
    again: () => go('/g/' + m.game),
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
