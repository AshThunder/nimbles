import { api, type MatchView } from '../api'
import { board } from '../games/sudoku'
import { actions, avatar, confetti, esc, glyph, GLYPH_BG, ic, isMuted, lvBadge, pipImg, setMuted, sfx, shortAddr, tap, toast, $ } from '../lib'
import { S, go, route } from '../state'
import { FLAME, JAR, PAGE, errBox, pageRows, pipRow, tabs, topbar } from '../ui'
import { friendlyWalletError } from '../wallet'
import { GAMES, fmtNim, type GameId } from '../../../shared/types'
import { ALL_BADGES, COSMETICS } from '../../../shared/rewards'
import { makeSudoku } from '../../../shared/puzzles'
import { lockText } from './home'

const AVATARS = ['ada', 'bisi', 'dee', 'ife', 'ivy', 'jay', 'kai', 'kemi', 'leo', 'max', 'me', 'mia', 'rue', 'sam', 'tobi', 'zoe']

// ---------------- leaderboard ----------------
route('/rank', async (root) => {
  let scope: 'global' | 'friends' | 'savers' = 'global'
  let shown = PAGE
  const TABS = [['global', 'Players'], ['friends', 'Friends'], ['savers', 'Savers']] as const
  const medal = (r: number) => (r === 1 ? 'g' : r === 2 ? 's' : r === 3 ? 'b' : 'c')
  const load = async () => {
    const keep = root.querySelector('.scroll')?.scrollTop ?? 0
    root.innerHTML = `${topbar('Leaderboard', 'none')}<div class="scroll center" style="justify-content:center">${pipImg('think')}</div>${tabs('Rank')}`
    let list = ''
    let sub = 'This week<small>Resets Monday, UTC</small>'
    try {
      if (scope === 'savers') {
        const d = await api.savers()
        sub = 'Interest this week<small>Resets Monday, UTC</small>'
        list = d.rows.length
          ? `<div class="rank" style="gap:8px">${pageRows(d.rows.map((r) => `<div class="rw ${r.me ? 'me' : ''}"><span class="med ${medal(r.rank)}">${r.rank}</span><span class="avs">${avatar(r.avatar, 'av', r.frame)}</span><span class="nm"><b>${r.me ? 'You' : esc(r.name)}</b><span>${r.locked ? r.lockDays + '-day lock' : 'Unlocked'} · ${fmtNim(r.saved)} saved</span></span><span class="am"><b>+${fmtNim(r.interest)}</b><span>interest</span></span></div>`), shown, 'rmore')}</div>`
          : pipRow('sleepy', '<b>No savers yet.</b> Lock some NIM in your jar and earn a share of the pool')
      } else {
        const d = await api.board(scope)
        list = d.rows.length
          ? `<div class="rank" style="gap:8px">${pageRows(d.rows.map((r) => `<div class="rw ${r.me ? 'me' : ''}"><span class="med ${medal(r.rank)}">${r.rank}</span><span class="avs">${avatar(r.avatar, 'av', r.frame)}</span><span class="nm"><b>${r.me ? 'You' : esc(r.name)}</b><span>Level ${r.level}</span></span><span class="am"><b>${r.weekXp}</b><span>XP</span></span></div>`), shown, 'rmore')}</div>`
          : pipRow('sleepy', scope === 'friends' ? '<b>No friends yet.</b> Duel someone and they show up here' : '<b>Quiet week.</b> Play a duel to get on the board')
      }
    } catch (e: any) { toast(e.message) }
    root.innerHTML = `${topbar('Leaderboard', 'none')}<div class="scroll" style="gap:12px">
      <div class="seg" style="grid-template-columns:1fr 1fr 1fr">${TABS.map(([s, label]) => `<button class="sg ${scope === s ? 'on' : ''}" data-act="scope" data-s="${s}"><b style="font-size:15px">${label}</b>${scope === s ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div>
      <div class="lab" style="margin:0">${sub}</div>
      ${list}</div>${tabs('Rank')}`
    const sc = root.querySelector('.scroll')
    if (sc) sc.scrollTop = keep
  }
  await load()
  actions(root, { scope: (el) => ((scope = el.dataset.s as typeof scope), (shown = PAGE), sfx('ui/select'), void load()), rmore: () => ((shown += PAGE), sfx('ui/select'), void load()), tab: () => sfx('ui/select', 0.4) })
})

// ---------------- Nimo: assistant, chat and receipt reader ----------------
route('/pip', async (root) => {
  type Msg = { role: 'me' | 'nimo'; text: string; link?: [string, string] }
  let receipt: { items: { name: string; price: number }[]; total: number; currency: string; merchant?: string } | null = null
  let n = 2
  let busy = false
  let thinking = false
  let err = ''
  let text = ''
  let typed = false
  let q = ''
  const msgs: Msg[] = []
  const CHIPS: [string, string][] = [['trophy', 'How do I win more?'], ['receipt', 'Start a Settle'], ['piggy-bank', 'My savings plan'], ['book-open', 'Explain the rules']]
  const planText = () => {
    const me = S.me
    const goal = fmtNim(me.plan.goalLuna)
    const jar = fmtNim(me.jarLuna)
    const left = me.jarLuna > 0 && me.jarUnlockAt > Date.now() ? `locked for ${Math.max(1, Math.ceil((me.jarUnlockAt - Date.now()) / 864e5))} more days` : me.jarLuna > 0 ? 'unlocked and ready to withdraw' : 'empty, the lock starts with your first deposit'
    return `Your goal is ${goal} NIM with a ${me.plan.lockDays}-day lock. The jar holds ${jar} NIM, ${left}. Win Save matches to fill it.`
  }
  const bubbles = () => msgs.map((m) => `<div class="nb ${m.role}">${m.role === 'nimo' ? pipImg('happy') : ''}<div class="bb">${esc(m.text)}${m.link ? `<button class="btn gold sm" data-act="lnk" data-to="${m.link[1]}" >${esc(m.link[0])}</button>` : ''}</div></div>`).join('') + (thinking ? `<div class="nb nimo">${pipImg('think')}<div class="bb dots"><i></i><i></i><i></i></div></div>` : '')
  const draw = () => {
    const keep = root.querySelector('.scroll')?.scrollTop ?? 0
    root.innerHTML = `${topbar('Nimo', 'none')}<div class="scroll" style="gap:12px">
      ${pipRow('wink', `<b>Hi ${esc((S.me.name || 'there').split(' ')[0])}, I am Nimo.</b> Ask me about the games, your savings or splitting a bill`)}
      <div class="qc" role="group" aria-label="Quick actions">${CHIPS.map(([i, t]) => `<button class="pc" data-act="chip" data-q="${esc(t)}">${ic(i, 's16')}${esc(t)}</button>`).join('')}</div>
      ${msgs.length || thinking ? `<div class="chat" id="chat">${bubbles()}</div>` : ''}
      <div class="row" style="gap:8px"><input id="q" class="field" placeholder="Ask Nimo anything" aria-label="Ask Nimo" maxlength="300" autocomplete="off" value="${esc(q)}" style="flex:1;min-width:0;height:48px"><button class="btn gold sm" data-act="ask" aria-label="Send" ${thinking || q.trim().length < 2 ? 'disabled' : ''} style="flex:none;width:48px;padding:0">${ic('send', 's20')}</button></div>
      <div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="row" style="gap:8px"><b style="font-size:17px">${ic('receipt', 's20')} Receipt reader</b><span class="sp"></span><button class="pc" data-act="typed">${typed ? ic('check') : ''}Type lines</button></div>
        <button class="btn gold block" data-act="snap" ${busy ? 'disabled' : ''}>${busy ? ic('refresh-cw', 's20 spin') + 'Reading…' : ic('camera', 's20') + 'Snap or pick a receipt'}</button>
        <input type="file" id="rf" accept="image/*" class="hide">
        ${typed ? `<textarea id="rt" class="field" rows="3" placeholder="Pizza 12.5&#10;Drinks 6&#10;Dessert 4" style="min-height:auto;padding:10px">${esc(text)}</textarea><button class="btn ghost block" data-act="parse" ${busy || text.trim().length < 3 ? 'disabled' : ''}>${ic('sparkles', 's20')}Read the lines</button>` : ''}
        ${err ? errBox(err) : ''}${receipt ? resultCard() : ''}</div></div>${tabs('Nimo')}`
    const sc = root.querySelector('.scroll')
    if (sc) sc.scrollTop = keep
    if (q || thinking) { const el = $('#q', root) as HTMLInputElement | null; if (el && !thinking) el.focus() }
  }
  const resultCard = () => {
    const r = receipt!
    const each = r.total / n
    return `<div class="rc"><div class="paper"><i></i><i class="s"></i><i></i><i class="s"></i></div><div class="info"><small>${esc(r.merchant || 'Receipt')}, ${r.items.length} item${r.items.length === 1 ? '' : 's'}</small><span class="tot">${r.total}<small> ${esc(r.currency || '')}</small></span></div></div>
    <div class="card flat" style="display:flex;flex-direction:column;gap:6px">${r.items.map((i) => `<div class="row" style="font-size:14px"><span>${esc(i.name)}</span><span class="sp"></span><b>${i.price}</b></div>`).join('')}</div>
    <div class="lab" style="margin:0">Split between</div><div class="pick">${[2, 3, 4, 5, 6].map((k) => `<button class="pc ${n === k ? 'on' : ''}" data-act="n" data-n="${k}">${n === k ? ic('check') : ''}${k}</button>`).join('')}</div>
    <div class="card" style="background:var(--gold-tint)"><div class="row"><b>Even split</b><span class="sp"></span><b style="font-size:22px">${(Math.round(each * 100) / 100).toFixed(2)}</b></div><div style="font-size:13px;color:var(--ink2)">per person. Or settle it with a Last Bite duel, where the winner pays the least</div></div>
    <button class="btn gold block" data-act="duel">${ic('swords', 's20')}Settle the bill with a friend</button>`
  }
  draw()
  const ask = async (text0: string) => {
    const t = text0.trim()
    if (t.length < 2 || thinking) return
    msgs.push({ role: 'me', text: t })
    q = ''
    if (t === 'Start a Settle') {
      msgs.push({ role: 'nimo', text: 'Easy. Invite a friend, agree the bill and who pays, then play Last Bite. Whoever loses pays their share. Got a receipt? Read it below first and I will fill in the total.', link: ['Open Settle', '/g/lastbite'] })
      return draw()
    }
    if (t === 'My savings plan') {
      msgs.push({ role: 'nimo', text: planText(), link: ['Open my jar', '/jar'] })
      return draw()
    }
    thinking = true
    draw()
    try {
      const hist = msgs.slice(0, -1).map((m) => ({ role: m.role, text: m.text }))
      const r = await api.chat({ text: t, history: hist })
      msgs.push({ role: 'nimo', text: r.reply })
    } catch (e: any) {
      msgs.push({ role: 'nimo', text: e.message || 'I lost my train of thought. Try again in a moment.' })
    }
    thinking = false
    draw()
    const c = $('#chat', root)
    const sc = root.querySelector('.scroll')
    if (c && sc) sc.scrollTop = c.offsetTop + c.offsetHeight
  }
  const run = async (b: { imageBase64?: string; mime?: string; text?: string }) => {
    busy = true
    err = ''
    draw()
    try {
      const r = await api.receipt(b)
      receipt = { items: r.items ?? [], total: Number(r.total) || 0, currency: r.currency || '', merchant: r.merchant }
      sfx('ui/confirm')
    } catch (e: any) {
      err = e.message
      sfx('ui/error')
    }
    busy = false
    draw()
  }
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement
    if (t.id === 'rt') {
      text = t.value
      const b = root.querySelector<HTMLButtonElement>('[data-act=parse]')
      if (b) b.disabled = busy || text.trim().length < 3
    }
    if (t.id === 'q') {
      q = t.value
      const b = root.querySelector<HTMLButtonElement>('[data-act=ask]')
      if (b) b.disabled = thinking || q.trim().length < 2
    }
  })
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id === 'q' && (e as KeyboardEvent).key === 'Enter') void ask(q)
  })
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement
    if (t.id !== 'rf' || !t.files?.[0]) return
    const bmp = await createImageBitmap(t.files[0])
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
    const cv = document.createElement('canvas')
    cv.width = Math.round(bmp.width * k)
    cv.height = Math.round(bmp.height * k)
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
    void run({ imageBase64: cv.toDataURL('image/jpeg', 0.82).split(',')[1], mime: 'image/jpeg' })
  })
  actions(root, {
    chip: (el) => (sfx('ui/select'), void ask(el.dataset.q!)),
    ask: () => void ask(q),
    lnk: (el) => go(el.dataset.to!),
    typed: () => ((typed = !typed), sfx('ui/select'), draw()),
    snap: () => $('#rf', root)!.click(),
    parse: () => void run({ text }),
    n: (el) => ((n = Number(el.dataset.n)), sfx('ui/select'), draw()),
    duel: () => (sessionStorage.setItem('nb:bill', String(receipt?.total ?? '')), go('/g/lastbite')),
    tab: () => sfx('ui/select', 0.4),
  })
})

// ---------------- Streak vault ----------------
route('/vault', async (root) => {
  let pz: { day: string; size: number; puzzle: number[] }
  try { pz = await api.vaultPuzzle() } catch (e: any) { root.innerHTML = `${topbar('Streak vault')}<div class="scroll">${errBox(e.message)}</div>`; actions(root, { back: () => go('/') }); return }
  let phase: 'play' | 'done' = S.me.vaultToday ? 'done' : 'play'
  let err = ''
  let busy = ''
  let gotXp = 0
  let deposited = false
  const t0 = Date.now()
  const draw = () => {
    if (phase === 'play') {
      root.innerHTML = `${topbar('Streak vault')}<div class="scroll" style="gap:14px">${pipRow('think', `<b>Today's vault.</b> Fill every row, column and box with 1 to 4`)}<div id="bd" style="display:flex;flex-direction:column;gap:14px"></div>${err ? errBox(err) : ''}</div>`
      board($('#bd', root)!, 4, pz.puzzle, undefined, (b) => {
        if (b.solved()) void solved(b.grid)
      })
      return
    }
    root.innerHTML = `${topbar('Streak vault')}<div class="scroll center" style="gap:14px"><div class="flame" style="width:84px">${FLAME}</div><b style="font-size:26px">${S.me.streak}-day streak</b>${gotXp ? `<span class="rwd">${ic('star', 's16')}+${gotXp} XP</span>` : ''}
      <div class="card" style="width:100%;display:flex;flex-direction:column;gap:10px"><div class="lab" style="margin:0">Drop a little into your jar<small>Optional</small></div>
      ${S.wallet.kind === 'preview' && !S.cfg.mock ? '<div style="font-size:14px;color:var(--ink2)">Open Nimbles inside Nimiq Pay to add NIM.</div>' : deposited ? '<div style="font-weight:700">Added to your jar.</div>' : `<div class="pick">${[0.5, 1, 2].map((a) => `<button class="pc stk" data-act="dep" data-a="${a}" ${busy ? 'disabled' : ''}>${a} NIM</button>`).join('')}</div>`}
      ${busy ? `<div style="font-weight:700">${esc(busy)}</div>` : ''}${err ? errBox(err) : ''}</div></div>
      <div class="foot"><button class="btn gold block" data-act="home">Done</button></div>`
    if (gotXp) confetti(80)
  }
  const solved = async (grid: number[]) => {
    try {
      const r = await api.vaultSolve(grid)
      gotXp = r.xp ?? 0
      S.me = { ...S.me, ...r.profile, vaultToday: true }
      phase = 'done'
      sfx('reward/chest-open')
      draw()
    } catch (e: any) {
      err = e.message
      sfx('ui/error')
      draw()
    }
  }
  draw()
  void t0
  actions(root, {
    back: () => go('/'),
    home: () => go('/'),
    dep: async (el) => {
      const amt = Number(el.dataset.a)
      err = ''
      if (S.wallet.kind === 'nimiq-pay' && S.wallet.network !== 'unknown' && S.wallet.network !== S.cfg.network) {
        err = `Nimiq Pay is on ${S.wallet.network}, this server runs on ${S.cfg.network}. Switch networks and try again`
        return void draw()
      }
      try {
        busy = 'Approve the payment in Nimiq Pay…'
        draw()
        const hash = await S.wallet.send(S.cfg.escrow, Math.round(amt * 1e5), 'nb:vault:' + pz.day.replace(/-/g, ''))
        busy = 'Confirming on the network…'
        draw()
        for (let i = 0; i < 60; i++) {
          const r = await api.vaultDeposit(hash, amt)
          if (!r.pending) {
            S.me = { ...S.me, ...r.profile, vaultToday: true }
            break
          }
          await new Promise((r2) => setTimeout(r2, 2500))
        }
        deposited = true
        sfx('reward/coin')
      } catch (e: any) {
        err = friendlyWalletError(e)
        sfx('ui/error')
      }
      busy = ''
      draw()
    },
  })
})

// ---------------- profile, settings, credits ----------------
const styleBlock = (me: typeof S.me) => {
  const worn = me.style ?? { frame: '', theme: '' }
  const own = new Set(me.unlocked ?? [])
  const group = (kind: 'frame' | 'theme', title: string, cur: string) => `<div class="lab" style="margin:0">${title}</div><div class="stl">${[{ id: '', name: 'None', color: '#1F2348', tint: '#ECE5D5', level: 0, chest: false }, ...COSMETICS.filter((c) => c.kind === kind)].map((c) => {
    const have = c.id === '' || own.has(c.id), on = cur === c.id
    const need = !have ? ('level' in c && c.level ? 'Level ' + c.level : 'From a chest') : ''
    return `<button class="stc ${on ? 'on' : ''}" data-act="style" data-k="${kind}" data-id="${c.id}" ${have ? '' : 'disabled'}><span class="sw" style="background:${c.id ? c.tint : 'var(--raised)'};${kind === 'frame' ? `border-color:${c.id ? c.color : 'var(--ink)'}` : ''}">${on ? ic('check', 's16') : !have ? ic('lock', 's16') : ''}</span><b>${esc(c.name)}</b>${need ? `<small>${need}</small>` : ''}</button>`
  }).join('')}</div>`
  const badges = me.badges ?? []
  return `${group('frame', 'Avatar frame', worn.frame)}${group('theme', 'Table theme', worn.theme)}
    <div class="lab" style="margin:0">Badges<small>${badges.length} of ${ALL_BADGES().length}</small></div>
    <div class="bgs">${ALL_BADGES().map((b) => { const got = badges.includes(b.id); return `<div class="bgc ${got ? 'got' : ''}"><img src="/badges/${b.icon}.svg" alt="" width="36" height="36"><b>${esc(b.name)}</b><small>${esc(b.why)}</small></div>` }).join('')}</div>`
}

route('/me', (root) => {
  const draw = () => {
    const me = S.me
    root.innerHTML = `${topbar('You', 'back', '<span style="width:40px"></span>')}<div class="scroll" style="gap:14px">
      <div class="card" style="display:flex;gap:14px;align-items:center"><div class="pav" style="position:relative;width:64px;height:64px">${avatar(me.avatar, 'av', me.style?.frame)}</div><div style="flex:1"><b style="font-size:20px">${esc(me.name)}</b><div class="mono" style="font-size:12px;color:var(--muted)">${shortAddr(me.address)}</div><div style="margin-top:4px;display:flex;gap:6px;align-items:center">${lvBadge(me.level, 22)}<span style="font-size:13px;color:var(--ink2)">${me.xp} XP · ${me.wins} wins / ${me.played} played</span></div></div></div>
      <div class="lab" style="margin:0">Name</div><input id="nm" class="field" value="${esc(me.name)}" maxlength="16" autocomplete="off">
      <div class="lab" style="margin:0">Avatar</div><div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px">${AVATARS.map((a) => `<button data-act="av" data-a="${a}" aria-label="${a}" style="position:relative;border-radius:50%;padding:0;${me.avatar === a ? 'outline:3px solid var(--ink);outline-offset:1px' : ''}">${avatar(a, 'av')}${me.avatar === a ? `<span class="ck" style="position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;border-radius:8px;background:var(--ink);color:var(--gold);display:grid;place-items:center">${ic('check', 's12')}</span>` : ''}</button>`).join('')}</div>
      ${styleBlock(me)}
      <div class="opt ${isMuted() ? '' : 'on'}" data-act="mute" role="switch" aria-checked="${!isMuted()}" tabindex="0" style="min-height:52px"><span class="ic" style="width:36px;height:36px">${ic(isMuted() ? 'volume-x' : 'volume-2', 's20')}</span><span class="tx"><span class="n">Sound</span><span class="m">${isMuted() ? 'Off' : 'On'}</span></span>${isMuted() ? '<span class="ring"></span>' : `<span class="ck">${ic('check')}</span>`}</div>
      <div class="card flat" style="font-size:13px;line-height:19px;color:var(--ink2)"><div class="row"><b style="color:var(--ink)">Wallet</b><span class="sp"></span><span class="mono">${S.wallet.kind === 'nimiq-pay' ? 'Nimiq Pay' : 'Preview'}</span></div><div class="row"><b style="color:var(--ink)">Network</b><span class="sp"></span><span class="mono">${esc(S.wallet.network)} (server: ${esc(S.cfg.network)}${S.cfg.mock ? ', mock chain' : ''})</span></div><div class="row"><b style="color:var(--ink)">AI</b><span class="sp"></span><span class="mono">${S.cfg.ai.gemini ? 'Gemini' : 'Built-in bank'}</span></div></div>
      <button class="btn ghost block" data-act="credits">${ic('heart', 's20')}Credits</button></div>`
  }
  draw()
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement
    if (t.id === 'nm' && t.value.trim()) {
      S.me = { ...S.me, ...(await api.setMe({ name: t.value })) }
      toast('Saved')
    }
  })
  actions(root, {
    back: () => go('/'),
    av: async (el) => {
      S.me = { ...S.me, ...(await api.setMe({ avatar: el.dataset.a })) }
      sfx('ui/select')
      draw()
    },
    style: async (el) => {
      try {
        S.me = { ...S.me, ...(await api.setStyle({ [el.dataset.k!]: el.dataset.id! })) }
        sfx('ui/select')
      } catch (e: any) { toast(e.message) }
      draw()
    },
    mute: () => (setMuted(!isMuted()), tap(), draw()),
    credits: () => go('/credits'),
  })
})

route('/credits', (root) => {
  root.innerHTML = `${topbar('Credits', 'back', '<span style="width:40px"></span>')}<div class="scroll" style="gap:12px">
    ${pipRow('love', '<b>Thank you</b> to the folks whose work makes Nimbles look and sound good')}
    <div class="card flat credit"><b>Chess piece icons</b><span>Skoll, from game-icons.net, licensed <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>. Recoloured and outlined for Nimbles</span></div>
    <div class="card flat credit"><b>Sounds and music</b><span>Kenney (kenney.nl), Cleyton Kauffman and congusbongus via OpenGameArt, all CC0</span></div>
    <div class="card flat credit"><b>Icons</b><span>Lucide, ISC licence</span></div>
    <div class="card flat credit"><b>Word list</b><span>Word Rush uses SCOWL, Kevin Atkinson and contributors, permissive licence</span></div>
    <div class="card flat credit"><b>Fonts</b><span>Bricolage Grotesque and DM Mono, SIL Open Font License 1.1</span></div>
    <div class="card flat credit"><b>Everything else</b><span>Cards, Nimo, avatars, badges and UI art drawn for Nimbles, MIT licence</span></div>
    <div class="card flat credit"><b>Built on</b><span>Nimiq Pay mini app SDK (@nimiq/mini-app-sdk), @nimiq/core, Vite, chess.js, qrcode-generator. AI by Google Gemini</span></div>
    <div class="mono" style="font-size:12px;color:var(--muted);text-align:center">Full list in CREDITS.md</div></div>`
  actions(root, { back: () => history.back() })
})
export { glyph, GAMES, makeSudoku, ic }
export type { GameId }
