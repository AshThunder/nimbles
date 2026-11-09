// Friends, the Match me lobby and the Nimbles Showdown progress screen.
import { api, type Friends, type LobbyItem, type Showdown } from '../api'
import { actions, avatar, esc, glyph, GLYPH_BG, ic, keepScroll, lvBadge, pipImg, sfx, tap, toast, $ } from '../lib'
import { S, go, route } from '../state'
import { errBox, pipRow, tabs, topbar, refreshBalance } from '../ui'
import { GAMES, fmtNim, isSoon, type GameId } from '../../../shared/types'
import { CAMPAIGN_NAME } from '../../../shared/campaign'

const friendLink = (code: string) => `${location.origin}/?invite=${code}`

/** Copy text in any webview: the Clipboard API first, then a hidden textarea. Returns false when both are blocked. */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* blocked in some webviews */ }
  try {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(t)
    t.select()
    t.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  } catch { return false }
}

/** The native share sheet when the webview has one; otherwise copy the link and say so. A cancelled share does nothing. */
async function shareInvite(code: string) {
  const url = friendLink(code)
  const text = `Add me on Nimbles and let's duel. My invite code is ${code}`
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ text, url }))) {
    try { await nav.share({ title: 'Nimbles', text, url }); return } catch (e: any) { if (e?.name === 'AbortError') return }
  }
  toast((await copyText(`${text} ${url}`)) ? 'Link copied' : 'Your invite link is ' + url)
}
const dateText = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const MODE_NAME: Record<string, string> = { play: 'Play', win: 'Win', save: 'Save', settle: 'Settle' }

// ---------------- Nimbles Showdown card (home) ----------------
/** Only the player's own progress and own earned amounts. No budget, no reward prices. */
export function showdownCard(sd: Showdown | null) {
  if (!sd || (!sd.live && sd.earned.total <= 0)) return ''
  const st = sd.steps
  const w = Math.min(st.welcome.done, st.welcome.need)
  const o = Math.min(st.friends.opponents, st.friends.need)
  // progress toward the two unlocks (welcome, then friend duels); after that the weekly board takes over
  let next = ''
  let pct = 100
  if (!st.welcome.got) { next = `${w} of ${st.welcome.need} matches`; pct = (w / st.welcome.need) * 50 }
  else if (!st.friends.unlocked) { next = `${o} of ${st.friends.need} rivals`; pct = 50 + (o / st.friends.need) * 50 }
  else next = st.week.rank > 0 ? `#${st.week.rank} this week` : `${st.week.wins} win${st.week.wins === 1 ? '' : 's'} this week`
  return `<button class="sdq" data-act="showdown" aria-label="${esc(sd.name)}, open progress"><img src="/badges/trophy-gold.svg" alt="" width="40" height="40"><span class="t"><b>${esc(sd.name)}</b><span class="s">${sd.live ? `Ends ${dateText(sd.end - 1)}` : 'Finished'} · ${next}</span><span class="sdl"><i style="width:${Math.round(pct)}%"></i></span></span><span class="e"><b>${fmtNim(sd.earned.total)}</b><small>NIM earned</small></span></button>`
}

route('/showdown', async (root) => {
  let sd: Showdown | null = null
  let err = ''
  let busy = false
  let confirm = false
  const load = async () => {
    try { sd = await api.showdown() } catch (e: any) { err = e.message }
  }
  // Every step pays on its own. Before anything is earned the tag only says "Earns NIM"; after, it shows what that step really earned.
  const item = (ok: boolean, title: string, sub: string, n: string, earned: number, more = '') => `<div class="it ${ok ? 'ok' : ''}"><span class="bx">${ok ? ic('check') : ''}</span><span class="tx"><span class="th"><b>${title}</b>${earned > 0 ? `<span class="etag got">${ic('check', 's16')}+${fmtNim(earned)} NIM</span>` : '<span class="etag">Earns NIM</span>'}</span><span>${sub}</span>${more}</span>${n ? `<span class="n">${n}</span>` : ''}</div>`
  const draw = () => {
    if (!sd) {
      root.innerHTML = `${topbar(CAMPAIGN_NAME)}<div class="scroll">${err ? errBox(err) : `<div class="center">${pipImg('think')}</div>`}</div>`
      return
    }
    const s = sd.steps
    const jar = sd.jar
    const by = sd.byStep ?? {}
    const inv = s.invites.list.length
      ? `<span class="invl">${s.invites.list.map((x) => `<span class="ivr ${x.earned > 0 ? 'ok' : ''}"><b>${esc(x.name)}</b><span>${x.earned > 0 ? `${ic('check', 's16')}+${fmtNim(x.earned)} NIM` : `${x.done}/${x.need} matches${x.done >= x.need && !x.real ? ' · needs a real-player match' : ''}`}</span></span>`).join('')}</span>`
      : '<span class="invl"><span class="ivr"><span class="em">Nobody yet. Share your invite code from the Friends tab</span></span></span>'
    root.innerHTML = `${topbar(sd.name)}<div class="scroll" style="gap:14px">
      ${pipRow('cheer', sd.live ? `<b>Play friends, beat rivals, earn NIM.</b> Skill only, no luck. Half of what you earn is paid now, half is locked in your jar.` : '<b>The Showdown has ended.</b> Thanks for playing. Your locked rewards follow your jar rules.')}
      ${sd.paused ? '<div class="tip">Payouts are paused for a moment. Everything you earn is kept and paid later.</div>' : ''}
      <div class="card"><div class="tc">
        <div class="kv"><span>You earned</span><b>${fmtNim(sd.earned.total)} NIM</b></div>
        <div class="kv"><span>Paid to your wallet</span><b>${fmtNim(sd.earned.wallet)} NIM</b></div>
        <div class="kv"><span>Locked in your jar</span><b>${fmtNim(sd.earned.jar)} NIM</b></div>
        ${sd.earned.pending > 0 ? `<div class="kv"><span>On its way</span><b>${fmtNim(sd.earned.pending)} NIM</b></div>` : ''}
      </div></div>
      <div class="lab" style="margin:0">How to earn<small>Ends ${dateText(sd.end - 1)}</small></div>
      <div class="lab" style="margin:0;font-size:15px;line-height:20px">Each step pays on its own, as soon as you complete it</div>
      <div class="chk">
        ${item(s.welcome.got, 'Welcome', s.welcome.got ? 'Done. Earned for finishing your first matches' : `Earn NIM once you finish ${s.welcome.need} matches, at least ${s.welcome.needReal} against a real player`, s.welcome.got ? '' : `${s.welcome.done}/${s.welcome.need}`, by.welcome ?? 0)}
        ${item(s.friends.unlocked, 'Friend duels', s.friends.unlocked ? 'Earn NIM for each staked duel you finish with a friend, up to 3 a day per friend' : `Earn NIM for each staked duel with a friend. Face ${s.friends.need} different players to unlock`, s.friends.unlocked ? `${s.friends.friends} friend${s.friends.friends === 1 ? '' : 's'}` : `${s.friends.opponents}/${s.friends.need}`, by.friend ?? 0)}
        ${item(s.invites.rewarded >= s.invites.max, 'Invite friends', `Earn NIM for each friend who joins with your invite code and finishes ${s.invites.need} matches, up to ${s.invites.max} friends`, `${s.invites.rewarded}/${s.invites.max}`, by.invite ?? 0, inv)}
        ${item(s.nimo.capped || s.nimo.today >= s.nimo.perDay, 'Beat Nimo on Hard', s.nimo.capped ? 'You earned all you can here. Try your friends' : `Earn NIM for each win against Nimo on Hard, up to ${s.nimo.perDay} wins a day`, `${s.nimo.today}/${s.nimo.perDay}`, by.nimo ?? 0)}
        ${item(s.week.rank > 0 && s.week.rank <= s.week.top, 'Weekly skill board', s.week.index >= 0 ? `Earn NIM each week you finish in the top ${s.week.top} by wins in staked duels against real players. This week ends ${dateText(s.week.endsAt - 1)}` : 'Opens with the next week', s.week.rank > 0 ? '#' + s.week.rank : `${s.week.wins} wins`, by.leaderboard ?? 0)}
      </div>
      <div class="qrow"><button class="btn gold" data-act="friends">${ic('users', 's20')}Friends</button><button class="btn ghost" data-act="lobby">${ic('swords', 's20')}Match me</button></div>
      ${jar.luna > 0 ? `<div class="lab" style="margin:0">Locked rewards<small>${jar.locked ? 'Until ' + dateText(jar.unlockAt) : 'Unlocked'}</small></div>
      <div class="card"><div class="tc"><div class="kv"><span>In your jar</span><b>${fmtNim(jar.luna)} NIM</b></div>${jar.locked ? `<div class="kv"><span>Early unlock fee now</span><b>${fmtNim(jar.early.fee)} NIM</b></div>` : ''}</div>
      ${confirm ? `<div class="tip" style="margin-top:10px">Unlock early and get ${fmtNim(jar.early.net)} NIM now?</div><div class="qrow" style="margin-top:10px"><button class="btn ghost" data-act="nconfirm">Keep it locked</button><button class="btn gold" data-act="wd" data-early="1" ${busy ? 'disabled' : ''}>Unlock</button></div>`
        : `<button class="btn ${jar.locked ? 'ghost' : 'gold'} block" style="margin-top:10px" data-act="${jar.locked ? 'confirm' : 'wd'}" ${busy ? 'disabled' : ''}>${jar.locked ? 'Unlock early' : 'Withdraw to wallet'}</button>`}</div>` : ''}
      ${sd.history.length ? `<div class="lab" style="margin:0">Your rewards</div><div class="lob">${sd.history.map((h) => `<div class="rw"><span class="avs" style="display:grid;place-items:center;background:var(--gold-tint);border-radius:10px">${ic(h.status === 'paid' ? 'check' : 'clock', 's20')}</span><span class="nm"><b>${esc(h.note)}</b><span>${h.status === 'paid' ? 'Paid' : 'On its way'} · ${fmtNim(h.wallet)} now, ${fmtNim(h.jar)} locked</span></span><span class="am"><b>+${fmtNim(h.luna)}</b><span>NIM</span></span></div>`).join('')}</div>` : ''}
      ${err ? errBox(err) : ''}
      <p class="sm2">Fixed rewards for finished matches, no chance involved. Each player can earn up to a set limit. Matches against your own accounts or repeated farming are not rewarded.</p>
    </div>`
  }
  await load()
  draw()
  actions(root, {
    back: () => (sfx('ui/back'), history.length > 1 ? history.back() : go('/')),
    friends: () => (tap(), go('/friends')),
    lobby: () => (tap(), go('/lobby')),
    confirm: () => ((confirm = true), sfx('ui/select'), draw()),
    nconfirm: () => ((confirm = false), sfx('ui/back'), draw()),
    wd: async (el) => {
      busy = true
      err = ''
      draw()
      try {
        const r = await api.showdownWithdraw(el.dataset.early === '1')
        toast(`${fmtNim(r.luna)} NIM is on its way to your wallet`)
        sfx('reward/coin')
        confirm = false
        void refreshBalance()
      } catch (e: any) { err = e.message; sfx('ui/error') }
      busy = false
      await load()
      draw()
    },
  })
})

// ---------------- Match me lobby (all games) ----------------
route('/lobby', async (root) => {
  let open: LobbyItem[] | null = null
  let err = ''
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const canStake = !(S.wallet.kind === 'preview' && !S.cfg.mock)
  const row = (x: LobbyItem) => `<button class="rw lobr" data-act="join" data-code="${esc(x.code)}" data-stake="${x.stake}"><span class="avs" style="background:${GLYPH_BG[x.game]};border-radius:10px;padding:4px">${glyph(x.game)}</span><span class="nm"><b>${esc(GAMES[x.game as GameId]?.name ?? x.game)}</b><span>${esc(x.host.name)} · ${MODE_NAME[x.mode] ?? x.mode}${x.topic ? ' · ' + esc(x.topic) : ''}${x.size > 2 ? ` · ${x.players}/${x.size}` : ''}</span></span><span class="am"><b>${x.mode === 'play' ? 'Free' : x.stake + ' NIM'}</b><span>Join</span></span></button>`
  const draw = () => {
    root.innerHTML = `${topbar('Match me')}<div class="scroll" style="gap:12px">
      ${pipRow('cool', '<b>Pick a waiting challenge</b> and you are in. Or start your own from any game and others can join it')}
      <div class="lab" style="margin:0">Waiting now<small>${open ? open.length : '…'} open</small></div>
      ${open === null ? '<div class="hint">Looking…</div>' : open.length ? `<div class="lob">${open.map(row).join('')}</div>` : pipRow('sleepy', '<b>Nobody is waiting.</b> Start a Match me challenge from a game, it shows up here for everyone')}
      ${err ? errBox(err) : ''}
      <div class="lab" style="margin:4px 0 0">Start your own</div>
      <div class="pick">${(Object.keys(GAMES) as GameId[]).filter((g) => !isSoon(g) && g !== 'lastbite').map((g) => `<button class="pc" data-act="game" data-id="${g}">${esc(GAMES[g].name)}</button>`).join('')}</div>
    </div>`
  }
  const load = async () => {
    clearTimeout(timer)
    try { open = (await api.lobby()).open } catch (e: any) { err = e.message }
    if (!root.isConnected) return
    if (!busy) { const back = keepScroll(root); draw(); back() }
    timer = setTimeout(() => void load(), 5000)
  }
  draw()
  void load()
  actions(root, {
    back: () => (sfx('ui/back'), history.length > 1 ? history.back() : go('/')),
    game: (el) => { tap(); sessionStorage.setItem('nb:opp', 'auto'); go('/g/' + el.dataset.id) },
    join: async (el) => {
      if (busy) return
      if (Number(el.dataset.stake) > 0 && !canStake) return toast('Open Nimbles inside Nimiq Pay to stake NIM')
      busy = true
      try {
        const m = await api.join(el.dataset.code!)
        sfx('ui/confirm')
        go('/m/' + m.id)
      } catch (e: any) {
        err = e.message
        busy = false
        sfx('ui/error')
        void load()
      }
    },
  })
  return () => clearTimeout(timer)
})

// ---------------- friends ----------------
route('/friend/:code', async (root, p) => {
  root.innerHTML = `${topbar('Adding friend', 'close')}<div class="scroll center" style="justify-content:center">${pipImg('think')}<b>Adding ${esc(p.code)}…</b></div>`
  actions(root, { back: () => go('/') })
  try {
    await api.friendDo('add', { code: p.code })
    sfx('ui/confirm')
    toast('Friend added')
    go('/friends')
  } catch (e: any) {
    root.innerHTML = `${topbar('Could not add', 'close')}<div class="scroll" style="gap:14px">${errBox(e.message)}<button class="btn gold block" data-act="fr">Open friends</button></div>`
    actions(root, { back: () => go('/'), fr: () => go('/friends') })
  }
})

route('/friends', async (root) => {
  let f: Friends | null = null
  let err = ''
  let code = ''
  let pick: string | null = null // challenging this friend: choose a game
  let timer: ReturnType<typeof setTimeout> | undefined
  const card = (x: Friends['friends'][number], right: string) => `<div class="rw"><span class="avs" style="position:relative">${avatar(x.avatar, 'av', x.frame)}<span class="dot ${x.online ? 'on' : ''}" style="position:absolute;right:-2px;bottom:-2px"></span></span><span class="nm"><b>${esc(x.name)}${lvBadge(x.level, 20)}</b><span>${x.online ? 'Online now' : 'Offline'}</span></span><span class="act">${right}</span></div>`
  const draw = () => {
    if (!f) {
      root.innerHTML = `${topbar('Friends', 'none')}<div class="scroll">${err ? errBox(err) : `<div class="center">${pipImg('think')}</div>`}</div>${tabs('Friends')}`
      return
    }
    const picking = pick ? f.friends.find((x) => x.address === pick) : undefined
    root.innerHTML = `${topbar('Friends', 'none')}<div class="scroll" style="gap:14px">
      ${f.challenges.length ? `<div class="lab" style="margin:0">Challenges for you</div><div class="lob">${f.challenges.map((c) => `<button class="rw lobr" data-act="join" data-code="${esc(c.code)}"><span class="avs" style="background:${GLYPH_BG[c.game]};border-radius:10px;padding:4px">${glyph(c.game)}</span><span class="nm"><b>${esc(c.from.name)}</b><span>${esc(GAMES[c.game as GameId]?.name ?? c.game)} · ${MODE_NAME[c.mode]}</span></span><span class="am"><b>${c.mode === 'play' ? 'Free' : c.stake + ' NIM'}</b><span>Accept</span></span></button>`).join('')}</div>` : ''}
      ${f.incoming.length ? `<div class="lab" style="margin:0">Friend requests</div><div class="lob">${f.incoming.map((x) => card(x, `<button class="btn ghost" data-act="decline" data-a="${esc(x.address)}" aria-label="Decline">${ic('x', 's16')}</button><button class="btn gold" data-act="accept" data-a="${esc(x.address)}">${ic('check', 's16')}Accept</button>`)).join('')}</div>` : ''}
      <div class="lab" style="margin:0">Your friends<small>${f.friends.filter((x) => x.online).length} online</small></div>
      ${f.friends.length ? `<div class="lob">${f.friends.map((x) => card(x, `<button class="btn gold" data-act="challenge" data-a="${esc(x.address)}">${ic('swords', 's16')}Challenge</button>`)).join('')}</div>` : pipRow('happy', '<b>No friends yet.</b> Share your invite code, or add someone you played below')}
      <div class="card"><div class="tc">
        <span class="sm2">Your invite code</span>
        <div class="fcode"><span class="cd2">${esc(f.code)}</span><div class="fbtn"><button class="btn ghost sm" data-act="copy" aria-label="Copy invite code">${ic('copy', 's16')}Copy</button><button class="btn gold sm" data-act="share" aria-label="Share invite link">${ic('share-2', 's16')}Share</button></div></div>
        <span class="sm2">New players who join with your code count as your invites in the Showdown</span>
      </div></div>
      <div class="sec"><div class="lab">Add a friend</div><form class="addf" id="addf"><div class="field">${ic('user-plus')}<input id="fcode" placeholder="Enter invite code" maxlength="8" autocapitalize="characters" autocomplete="off" value="${esc(code)}" enterkeyhint="go" aria-label="Invite code"></div><button class="btn gold sm" type="submit" style="height:52px" ${code.replace(/[^A-Za-z0-9]/g, '').length < 6 ? 'disabled' : ''} id="addb">Add</button></form></div>
      ${f.recent.length ? `<div class="lab" style="margin:0">Recent opponents</div><div class="lob">${f.recent.map((x) => card(x, x.asked ? '<span class="chip">Asked</span>' : `<button class="btn ghost" data-act="request" data-a="${esc(x.address)}">${ic('user-plus', 's16')}Add</button>`)).join('')}</div>` : ''}
      ${err ? errBox(err) : ''}
    </div>${tabs('Friends')}${picking ? `<div class="scrim" data-act="px"></div><div class="sheet mk" role="dialog" aria-label="Pick a game"><div class="grab"></div><div class="sh-h" style="align-items:center"><div><div class="sh-t">Challenge ${esc(picking.name)}</div><div class="sub">Pick a game</div></div><button class="sh-x" data-act="px" aria-label="Close">${ic('x', 's20')}</button></div><div class="pick">${(Object.keys(GAMES) as GameId[]).filter((g) => !isSoon(g) && g !== 'splat').map((g) => `<button class="pc" data-act="cgame" data-id="${g}">${esc(GAMES[g].name)}</button>`).join('')}</div></div>` : ''}`
  }
  const load = async () => {
    clearTimeout(timer)
    try { f = await api.friends(); err = '' } catch (e: any) { err = e.message }
    if (!root.isConnected) return
    if (!pick && document.activeElement?.id !== 'fcode') { const back = keepScroll(root); draw(); back() }
    timer = setTimeout(() => void load(), 15000)
  }
  const doAct = async (act: 'add' | 'request' | 'accept' | 'decline', b: { code?: string; address?: string }) => {
    try {
      f = await api.friendDo(act, b)
      err = ''
      sfx('ui/confirm')
      if (act === 'add') { code = ''; toast('Friend added') }
    } catch (e: any) { err = e.message; sfx('ui/error') }
    draw()
  }
  draw()
  await load()
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.id !== 'fcode') return
    code = t.value.toUpperCase()
    const b = $('#addb', root) as HTMLButtonElement | null
    if (b) b.disabled = code.replace(/[^A-Za-z0-9]/g, '').length < 6
  })
  root.addEventListener('submit', (e) => {
    e.preventDefault()
    if ((e.target as HTMLElement).id === 'addf' && code.replace(/[^A-Za-z0-9]/g, '').length >= 6) void doAct('add', { code })
  })
  actions(root, {
    back: () => (sfx('ui/back'), history.length > 1 ? history.back() : go('/')),
    accept: (el) => doAct('accept', { address: el.dataset.a }),
    decline: (el) => doAct('decline', { address: el.dataset.a }),
    request: (el) => doAct('request', { address: el.dataset.a }),
    challenge: (el) => ((pick = el.dataset.a!), sfx('ui/select'), draw()),
    px: () => ((pick = null), sfx('ui/back'), draw()),
    tab: () => sfx('ui/select', 0.4),
    cgame: (el) => {
      const x = f?.friends.find((y) => y.address === pick)
      if (!x) return
      sessionStorage.setItem('nb:challenge', JSON.stringify({ address: x.address, name: x.name }))
      tap()
      go('/g/' + el.dataset.id)
    },
    join: async (el) => {
      try {
        const m = await api.join(el.dataset.code!)
        sfx('ui/confirm')
        go('/m/' + m.id)
      } catch (e: any) { err = e.message; draw() }
    },
    copy: async () => { tap(); toast((await copyText(f!.code)) ? 'Invite code copied' : 'Your invite code is ' + f!.code) },
    share: () => (tap(), void shareInvite(f!.code)),
  })
  return () => clearTimeout(timer)
})
