import { api } from '../api'
import { actions, esc, glyph, GLYPH_BG, ic, lvBadge, pipImg, sfx, tap, toast, $, $$ } from '../lib'
import { S, go, route } from '../state'
import { coin, errBox, topbar } from '../ui'
import { billShares } from '../../../shared/economy'
import { GAMES, STAKES, type GameId, type Mode, type OppKind, type PipLevel } from '../../../shared/types'

const TOPICS = ['Space exploration', 'Football history', '90s cartoons', 'World capitals', 'Nollywood', 'Human body']
const MODES: [Mode, string, string, string, string][] = [
  ['play', 'gamepad-2', 'Play', 'Free practice, earn XP, risk nothing', '#D7E9F8'],
  ['save', 'piggy-bank', 'Save', 'Wins go into your locked savings jar', '#F4B323'],
  ['spend', 'receipt', 'Spend', 'Split a real bill, loser covers more', '#F6D8D1'],
]
const GCOL: Record<string, string> = GLYPH_BG

type Setup = {
  mode: Mode; opp: OppKind | 'join'; pip: PipLevel; stake: number; bill: string; size: number
  topic: string; count: number; note: string; code: string
  receipt?: { items: { name: string; price: number }[]; total: number; currency: string; merchant?: string }
  busy?: boolean; err?: string; scanning?: boolean
}

route('/g/:id', (root, p) => {
  const id = p.id as GameId
  const g = GAMES[id]
  if (!g) return go('/')
  const canStake = !(S.wallet.kind === 'preview' && !S.cfg.mock)
  const st: Setup = {
    mode: id === 'lastbite' ? 'spend' : 'play', opp: id === 'lastbite' ? 'invite' : 'pip', pip: 'med', stake: 2, bill: '10', size: 2,
    topic: TOPICS[0], count: 5, note: '', code: '',
  }
  const pre = sessionStorage.getItem('nb:bill')
  if (pre && id === 'lastbite') { st.bill = pre; sessionStorage.removeItem('nb:bill') }
  const engine = id === 'chess' || id === 'pool'
  const staked = () => st.mode !== 'play'
  const pickOpp = () => {
    if (staked() && st.opp === 'pip') st.opp = 'auto'
    if (!staked() && st.opp === 'auto' && false) st.opp = 'pip'
  }
  const billNum = () => Math.round(Number(st.bill) * 100) / 100
  const valid = () => {
    if (st.opp === 'join') return st.code.replace(/[^A-Za-z0-9]/g, '').length >= 7
    if (st.mode === 'spend') return billNum() >= 0.5 && billNum() <= 1000
    if (id === 'trivia') return st.topic.trim().length >= 2
    return true
  }
  const summary = () => {
    if (st.opp === 'join') return ['Mode and stake come from the match you join', '']
    if (st.mode === 'play') return ['Free play, earns XP', 'No NIM at risk']
    if (st.mode === 'save') return [`Stake <b>${st.stake} NIM</b> each, prize <b>${st.stake * 2} NIM</b>`, `Win +${st.stake * 2} to jar, lose −${st.stake}`]
    const n = id === 'lastbite' && st.opp !== 'auto' ? st.size : 2
    const shares = billShares(billNum() || 0, n, null)
    return [`Bill <b>${billNum() || 0} NIM</b>, host paid`, `Split ${shares.length ? [...SPLITS[n]].map((x) => Math.round(x * 100) + '%').join(' / ') : ''} by rank`]
  }
  const SPLITS: Record<number, number[]> = { 2: [0.4, 0.6], 3: [0.2, 0.3, 0.5], 4: [0.15, 0.2, 0.3, 0.35] }
  const cta = () => {
    if (st.opp === 'join') return ['Join match', 'scan-line']
    if (st.opp === 'pip') return [`Start vs Pip (${{ easy: 'Easy', med: 'Medium', hard: 'Hard' }[st.pip]})`, 'zap']
    if (st.opp === 'invite') return ['Create invite', 'send']
    return ['Find opponent', 'swords']
  }

  const orow = (key: string, icon: string, n: string, m: string) => {
    const on = st.opp === key
    return `<div class="opp ${on ? 'on' : ''}" data-act="opp" data-k="${key}" role="radio" aria-checked="${on}" tabindex="0" style="${on ? 'background:var(--ink);color:var(--bg)' : ''}"><div class="oh"><span class="ic" style="width:32px;height:32px;border-radius:8px;display:grid;place-items:center;flex:none;${on ? 'background:var(--gold);color:var(--ink)' : 'background:var(--raised)'}">${ic(icon)}</span><span class="tx"><span class="n">${n}</span><span class="m" style="${on ? 'color:#B8BBD3' : ''}">${m}</span></span>${on ? `<span class="ck" style="background:var(--gold);color:var(--ink)">${ic('check')}</span>` : '<span class="ring"></span>'}</div>${
      on && key === 'join' ? `<div class="ex"><input class="fld" id="code" placeholder="Enter code, like NMB-XXXX" value="${esc(st.code)}" maxlength="9" autocapitalize="characters" autocomplete="off" style="border:0;outline:0;width:100%"></div>` : ''
    }${
      on && key === 'pip' ? `<div class="ex" style="gap:8px">${(['easy', 'med', 'hard'] as PipLevel[]).map((l) => `<button class="mb ${st.pip === l ? '' : 'ghost'}" data-act="pip" data-l="${l}">${st.pip === l ? ic('check', 's16') : ''}${{ easy: 'Easy', med: 'Medium', hard: 'Hard' }[l]}</button>`).join('')}</div>` : ''
    }</div>`
  }

  const draw = () => {
    pickOpp()
    const [c1, c2] = summary()
    const [ctaTxt, ctaIcon] = cta()
    const modes = MODES.filter(([m]) => (id === 'lastbite' ? m === 'spend' : engine ? m === 'play' : true))
    root.innerHTML = `${topbar(g.name)}
    <div class="scroll" style="gap:12px">
      <div class="banner" style="background:${GCOL[id]};${id === 'lastbite' || id === 'sudoku' ? 'color:var(--ink)' : ''}"><div class="c" style="${id === 'lastbite' || id === 'sudoku' ? 'color:var(--ink)' : ''}"><b>${esc(g.blurb)}</b><span class="lvx">${lvBadge(g.level, 22)}<span class="xpb"><i style="width:${Math.min(100, g.level * 12)}%"></i></span></span></div><span class="art" style="display:block">${glyph(id)}</span></div>
      <div class="sec"><div class="lab">Mode</div>${modes
        .map(([m, icon, n, d, col]) => {
          const on = st.mode === m
          const locked = m !== 'play' && !canStake
          return `<div class="opt ${on ? 'on' : ''}" data-act="mode" data-m="${m}" role="radio" aria-checked="${on}" tabindex="0" style="height:52px;${on ? 'background:' + col : ''};${locked ? 'opacity:.55' : ''}"><span class="ic" style="width:36px;height:36px;${on ? '' : 'background:' + col}">${ic(icon, 's20')}</span><span class="tx"><span class="n">${n}</span><span class="m">${locked ? 'Open in Nimiq Pay to stake' : d}</span></span>${on ? `<span class="ck">${ic('check')}</span>` : locked ? ic('lock', 's16') : '<span class="ring"></span>'}</div>`
        })
        .join('')}</div>
      ${
        id === 'trivia'
          ? `<div class="sec"><div class="lab">Topic<small>Pip writes the questions</small></div><div class="field">${ic('search')}<input id="topic" class="field" style="border:0;box-shadow:none;height:48px;padding:0" value="${esc(st.topic)}" maxlength="60" placeholder="Any topic" autocomplete="off"></div><div class="pick">${TOPICS.map((t) => `<button class="pc ${st.topic === t ? 'on' : ''}" data-act="topic" data-t="${esc(t)}">${st.topic === t ? ic('check') : ''}${t}</button>`).join('')}</div></div>
      <div class="sec"><div class="lab">Questions<small>More questions, more XP</small></div><div class="seg">${[5, 7, 10].map((n) => `<button class="sg ${st.count === n ? 'on' : ''}" data-act="count" data-n="${n}"><b>${n}</b><small>${n * 12} XP</small>${st.count === n ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div></div>`
          : ''
      }
      <div class="sec"><div class="lab">Opponent</div>
        ${engine ? '' : orow('invite', 'users', 'Invite a friend', 'Get a code, link and QR to share')}
        ${engine ? '' : orow('join', 'scan-line', 'Join with a code', "Enter a friend's code")}
        ${id === 'lastbite' || engine ? '' : orow('auto', 'swords', 'Match me', 'Automatic, same game and stake')}
        ${!staked() ? orow('pip', 'zap', engine ? 'Play Pip' : 'Practice vs Pip', 'Free, no stake. Easy, medium or hard') : ''}
        ${engine ? '<div style="font-size:13px;color:var(--ink2);padding:2px 4px">Live head-to-head with friends needs a move relay, so staked ' + esc(g.name) + ' is coming later. Skill games with a shared seed are open for stakes today.</div>' : ''}
      </div>
      ${
        st.opp === 'join'
          ? ''
          : st.mode === 'save'
            ? `<div class="sec"><div class="lab">Stake<small>NIM, same for both</small></div><div class="pick">${STAKES.map((s) => `<button class="pc stk ${st.stake === s ? 'on' : ''}" data-act="stake" data-s="${s}">${st.stake === s ? ic('check') : ''}${s}</button>`).join('')}</div></div>`
            : st.mode === 'spend'
              ? `<div class="sec"><div class="lab">The bill<small>NIM, you fronted it</small></div>
              <div class="field"><input id="bill" class="field" inputmode="decimal" style="border:0;box-shadow:none;height:48px;padding:0" value="${esc(st.bill)}" placeholder="0.00" autocomplete="off"><span class="mono-s">NIM</span></div>
              ${id === 'lastbite' && st.opp === 'invite' ? `<div class="lab" style="font-size:15px">Players</div><div class="pick">${[2, 3, 4].map((n) => `<button class="pc ${st.size === n ? 'on' : ''}" data-act="size" data-n="${n}">${st.size === n ? ic('check') : ''}${n} players</button>`).join('')}</div>` : ''}
              ${id === 'lastbite' ? receiptBlock() : ''}</div>`
              : ''
      }
      ${st.err ? errBox(st.err) : ''}
    </div>
    <div class="foot" style="gap:8px;border-top:2px solid var(--ink);background:var(--bg);padding-top:12px"><div class="note" style="font-size:13px"><span id="sum1">${c1}</span><span class="mono" style="font-size:12px" id="sum2">${c2}</span></div>
      <button class="btn gold block" data-act="go" id="go" ${valid() && !st.busy ? '' : 'disabled'}>${st.busy ? ic('refresh-cw', 's20 spin') + 'Working…' : ic(ctaIcon, 's20') + ctaTxt}</button></div>`
  }
  const receiptBlock = () => {
    const r = st.receipt
    return `<div class="rc" style="margin-top:4px"><div class="paper"><i></i><i class="s"></i><i></i><i class="s"></i></div><div class="info">${
      r
        ? `<small>${esc(r.merchant || 'Receipt')}, ${r.items.length} items, read by Pip</small><span class="tot">${r.total}<small> ${esc(r.currency || 'NIM')}</small></span><small>Check the amount above matches</small>`
        : `<small>Optional: let Pip read a receipt</small><button class="btn ghost sm" data-act="scan" style="height:36px;font-size:14px;margin-top:4px">${st.scanning ? ic('refresh-cw', 's16 spin') + 'Reading…' : ic('camera', 's16') + 'Snap a receipt'}</button>`
    }</div><input type="file" id="rfile" accept="image/*" class="hide"></div>`
  }
  draw()

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.id === 'topic') st.topic = t.value
    if (t.id === 'bill') st.bill = t.value.replace(/[^0-9.]/g, '')
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
      if (st.receipt.total > 0) st.bill = String(st.receipt.total)
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
      if (m !== 'play' && st.opp === 'pip') st.opp = 'auto'
      if (m === 'play' && st.opp === 'auto') st.opp = 'pip'
      draw()
    },
    opp: (el) => {
      if ((e0(el) as HTMLElement).closest('input,button[data-act=pip]')) return
      sfx('ui/select')
      st.opp = el.dataset.k as Setup['opp']
      draw()
    },
    pip: (el) => ((st.pip = el.dataset.l as PipLevel), sfx('ui/select'), draw()),
    topic: (el) => ((st.topic = el.dataset.t!), sfx('ui/select'), draw()),
    count: (el) => ((st.count = Number(el.dataset.n)), sfx('ui/select'), draw()),
    stake: (el) => ((st.stake = Number(el.dataset.s)), sfx('ui/select'), draw()),
    size: (el) => ((st.size = Number(el.dataset.n)), sfx('ui/select'), draw()),
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
            stake: st.mode === 'save' ? st.stake : st.mode === 'spend' ? billNum() : 0, size: st.size,
            config: { topic: st.topic, count: st.count, note: st.note, receipt: st.receipt },
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
const e0 = (el: HTMLElement) => el

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
