import { api, type JarInfo, type MatchView, type Showdown } from '../api'
import { actions, esc, glyph, GLYPH_BG, ic, sfx, tap, toast, $ } from '../lib'
import { S, go, route } from '../state'
import { PAGE, errBox, pageRows, pipRow, tabs, topbar, refreshBalance } from '../ui'
import { GAMES, fmtNim } from '../../../shared/types'
import { LOCK_TIERS, LOCK_XP_PCT } from '../../../shared/rewards'

const DAY = 864e5
const GOAL_CHIPS = [25, 50, 100, 250, 500, 1000]
const dateText = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** A flat progress ring: a track, a gold arc, the amount in the middle. */
export const ring = (luna: number, goalLuna: number, size = 164) => {
  const pct = goalLuna > 0 ? Math.min(1, luna / goalLuna) : 0
  const r = 64
  const c = 2 * Math.PI * r
  return `<div class="ringw" style="width:${size}px;height:${size}px"><svg viewBox="0 0 160 160" width="${size}" height="${size}" aria-hidden="true"><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--raised)" stroke-width="16"/><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--gold)" stroke-width="16" stroke-linecap="butt" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 80 80)"/></svg><div class="rc2"><b>${fmtNim(luna)}</b><span>of ${fmtNim(goalLuna)} NIM</span><em>${Math.floor(pct * 100)}%</em></div></div>`
}

const hoursLeft = (t: number) => {
  const m = Math.max(0, Math.floor((t - Date.now()) / 60000))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const poolCard = (i: JarInfo, locked: boolean) => `<div class="lab" style="margin:0">Saver pool<small>Pays out daily</small></div>
  <div class="card"><div class="tc">
    <div class="kv"><span>In the pool</span><b>${fmtNim(i.pool.luna)} NIM</b></div>
    <div class="kv"><span>Next payout in</span><b>${hoursLeft(i.pool.nextPayoutAt)}</b></div>
    <div class="kv"><span>Your share today</span><b>${locked ? '~' + fmtNim(i.pool.estimate) + ' NIM' : 'Lock the jar to earn'}</b></div>
    <div class="kv"><span>Earned this week</span><b>${fmtNim(i.interest.week)} NIM</b></div>
    <div class="kv"><span>Earned in total</span><b>${fmtNim(i.interest.total)} NIM</b></div>
    <div class="kv"><span>Your boost</span><b>${i.boost.totalPct ? '+' + i.boost.totalPct + '%' : 'None yet'}</b></div>
  </div><span class="sm2" style="display:block;margin-top:10px">2% of every Save pot (up to 1 NIM) and early unlock fees go in. Savers split it by balance and lock days. Every 5 levels adds +5% to your share, up to +25%.</span></div>`

route('/jar', async (root) => {
  try { S.me = await api.me() } catch { /* cached */ }
  let info = await api.jar().catch(() => null)
  const sd: Showdown | null = await api.showdown().catch(() => null)
  let hist: MatchView[] = []
  try { hist = (await api.matches()).filter((m) => m.status === 'settled').slice(0, 60) } catch { /* ignore */ }
  let err = ''
  let confirm = false
  let busy = false

  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th']
  const nim = (l: number) => fmtNim(Math.abs(l))
  type Row = { m: MatchView; mode: string; won: boolean; draw: boolean; rank: number; net: number; xp: number; label: string }
  /** What really happened to my NIM in one finished match: everything that came to me, plus the jar credit, minus what I locked. */
  const rowOf = (m: MatchView): Row => {
    const me = S.wallet.address
    const st = m.settlement!
    const mode = m.mode === ('spend' as string) ? 'settle' : m.mode // older matches were saved as 'spend'
    const mine = m.players.find((p) => p.player.address === me)
    const locked = mine?.escrowed ?? 0
    const pays = st.payouts.filter((p) => (p.for ?? p.to) === me)
    const sum = (k: string) => pays.filter((p) => p.kind === k).reduce((s, p) => s + p.luna, 0)
    const refund = sum('refund'), got = sum('settle'), prize = sum('prize'), jar = st.jarCredit[me] ?? 0
    const net = refund + got + prize + jar - locked
    const rank = st.ranks.find((r) => r.address === me)?.rank ?? 2
    const won = st.winner === me
    const out = st.draw ? 'draw' : m.players.length > 2 ? ORD[rank - 1] : won ? 'won' : 'lost'
    const name = mode[0].toUpperCase() + mode.slice(1)
    let label = `${name} · ${out}`
    if (mode === 'settle') {
      if (got > 0) label += ` · ${nim(got)} NIM reimbursed${refund ? ', ' + nim(refund) + ' returned' : ''}`
      else if (locked > 0 && refund > 0 && refund < locked) label += ` · paid ${nim(locked - refund)} NIM, ${nim(refund)} refunded`
      else if (refund > 0) label += ` · ${nim(refund)} NIM refunded`
      else if (locked > 0) label += ` · paid ${nim(locked)} NIM`
    } else if (mode === 'win' || mode === 'save') {
      if (prize) label += ` · ${nim(prize)} NIM to wallet`
      else if (jar) label += ` · ${nim(jar)} NIM to jar`
      else if (st.draw || (refund && refund >= locked)) label += ' · stake back'
      else if (locked) label += ` · ${nim(locked)} NIM staked`
    } else label += ' · free'
    return { m, mode, won, draw: !!st.draw, rank, net, xp: st.xp?.[me] ?? 0, label }
  }
  const histRow = (r: Row) => {
    const { m } = r
    const amt = r.mode === 'play' ? `<b>+${r.xp}</b><span>XP</span>` : `<b>${r.net > 0 ? '+' : r.net < 0 ? '−' : ''}${nim(r.net)}</b><span>NIM</span>`
    return `<div class="rw" style="min-height:52px"><span class="avs" style="background:${GLYPH_BG[m.game]};border-radius:10px;padding:4px">${glyph(m.game)}</span><span class="nm"><b>${GAMES[m.game].name}</b><span>${r.label}</span></span><span class="am ${r.net < 0 && r.mode !== 'play' ? 'neg' : ''}">${amt}</span></div>`
  }
  /** Repeated free games of the same title collapse into one line: "Splat Royale · Play ×7". */
  const rowsFor = (tab: string): string[] => {
    const rows = hist.map(rowOf).filter((r) => tab === 'all' || r.mode === tab)
    const out: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      let j = i
      while (r.mode === 'play' && j + 1 < rows.length && rows[j + 1].mode === 'play' && rows[j + 1].m.game === r.m.game) j++
      if (j > i) {
        const grp = rows.slice(i, j + 1)
        const w = grp.filter((x) => x.won).length
        const xp = grp.reduce((s, x) => s + x.xp, 0)
        out.push(`<div class="rw" style="min-height:52px"><span class="avs" style="background:${GLYPH_BG[r.m.game]};border-radius:10px;padding:4px">${glyph(r.m.game)}</span><span class="nm"><b>${GAMES[r.m.game].name} · Play ×${grp.length}</b><span>${w} won · ${grp.length - w} other · free</span></span><span class="am"><b>+${xp}</b><span>XP</span></span></div>`)
        i = j
      } else out.push(histRow(r))
    }
    return out
  }
  let tab = 'all'
  let shown = PAGE
  const HTABS = [['all', 'All'], ['play', 'Play'], ['win', 'Win'], ['save', 'Save'], ['settle', 'Settle']]

  const draw = () => {
    const me = S.me
    const plan = info?.plan ?? me.plan
    const now = Date.now()
    const locked = me.jarLuna > 0 && me.jarUnlockAt > now
    const free = me.jarLuna > 0 && !locked
    const q = info?.early ?? { fee: 0, pct: 0, net: me.jarLuna }
    const left = Math.max(0, Math.ceil((me.jarUnlockAt - now) / DAY))
    const lockLine = me.jarLuna <= 0 ? 'Empty. The lock starts with your first deposit' : locked ? `Locked until ${dateText(me.jarUnlockAt)}, ${left} day${left === 1 ? '' : 's'} to go` : 'Unlocked, ready to withdraw'
    const canTier = !locked
    root.innerHTML = `${topbar('Savings jar', 'none')}<div class="scroll" style="gap:14px">
      <div class="card jr"><div class="jrr">${ring(me.jarLuna, plan.goalLuna)}</div><div class="m jrl">${ic('lock', 's16')}<span>${lockLine}</span></div></div>
      ${err ? errBox(err) : ''}
      ${free ? `<button class="btn gold block" data-act="withdraw" ${busy ? 'disabled' : ''}>${ic('wallet', 's20')}Withdraw ${fmtNim(me.jarLuna)} NIM</button>` : ''}
      ${locked && !confirm ? `<button class="btn ghost block" data-act="early">${ic('lock-open', 's20')}Unlock early</button>` : ''}
      ${locked && confirm ? `<div class="card cfm"><b>Unlock early?</b><div class="tc"><div class="kv"><span>Fee now</span><b>${fmtNim(q.fee)} NIM (${(q.pct * 100).toFixed(1)}%)</b></div><div class="kv"><span>You receive</span><b>${fmtNim(q.net)} NIM</b></div><div class="kv"><span>Fee is 0 on</span><b>${dateText(me.jarUnlockAt)}</b></div></div><span class="sm2">The fee starts at 10% and shrinks every day you hold. It goes to the savers who stay.</span><div class="two"><button class="btn ghost" data-act="keep">Keep saving</button><button class="btn coral" data-act="early-go" ${busy ? 'disabled' : ''}>Unlock, pay ${fmtNim(q.fee)}</button></div></div>` : ''}
      <div class="lab" style="margin:0">Your goal<small>${fmtNim(plan.goalLuna)} NIM</small></div>
      <div class="pick">${GOAL_CHIPS.map((g) => { const on = plan.goalLuna === g * 1e5; return `<button class="pc ${on ? 'on' : ''}" data-act="goal" data-n="${g}">${on ? ic('check') : ''}${g}</button>` }).join('')}</div>
      <div class="row" style="gap:8px"><input id="goal" class="field" inputmode="decimal" placeholder="Other amount" aria-label="Goal in NIM" style="flex:1;min-width:0"><button class="btn ghost sm" data-act="goal-set" style="flex:none">Set</button></div>
      <div class="lab" style="margin:0">Lock length<small>${canTier ? 'Applies to your next deposit' : 'Fixed while locked'}</small></div>
      <div class="seg">${LOCK_TIERS.map((d) => { const on = plan.lockDays === d; return `<button class="sg ${on ? 'on' : ''}" data-act="tier" data-d="${d}" ${canTier ? '' : 'disabled'}><b>${d}</b><small>days</small>${on ? `<span class="ck">${ic('check')}</span>` : ''}</button>` }).join('')}</div>
      <div style="font-size:13px;line-height:19px;color:var(--ink2)">While locked, duel XP is higher: ${LOCK_TIERS.map((d) => `<b>${d} days +${LOCK_XP_PCT[d]}%`).join('</b>, ')}</b>.</div>
      ${sd && sd.jar.luna > 0 ? `<button class="card chr" data-act="sd" style="background:var(--gold-tint)"><span class="avs" style="width:44px;height:44px;border-radius:12px;background:var(--ink);color:var(--gold);display:grid;place-items:center;flex:none">${ic('swords', 's20')}</span><span class="nm"><b>${fmtNim(sd.jar.luna)} NIM Showdown rewards</b><span>${sd.jar.locked ? 'Locked until ' + dateText(sd.jar.unlockAt) : 'Unlocked, ready to withdraw'}. Same jar rules</span></span>${ic('chevron-right', 's20')}</button>` : ''}
      ${info ? poolCard(info, locked) : ''}
      ${pipRow(locked ? 'sleepy' : 'happy', locked ? '<b>New deposits join the lock</b> without restarting it. Your date stays put' : '<b>Pick a goal and a lock.</b> Win Save duels or add to the vault to fill the jar')}
      <div class="lab">Recent games<small>${hist.length ? '' : 'Nothing yet'}</small></div>
      ${hist.length ? `<div class="htabs" role="tablist">${HTABS.map(([k, n]) => `<button class="pc ${tab === k ? 'on' : ''}" data-act="htab" data-k="${k}" role="tab" aria-selected="${tab === k}">${tab === k ? ic('check') : ''}${n}</button>`).join('')}</div>` : ''}
      <div class="rank" style="gap:8px">${(() => { const r = rowsFor(tab); return r.length ? pageRows(r, shown, 'hmore') : hist.length ? '<div class="sm2">Nothing in this tab yet</div>' : '' })()}</div></div>${tabs('Jar')}`
  }

  const refresh = async () => {
    try { S.me = await api.me(); info = await api.jar() } catch { /* keep */ }
  }
  const withdraw = async (early: boolean) => {
    if (busy) return
    busy = true
    err = ''
    draw()
    try {
      await api.withdraw(early)
      sfx('reward/coin')
      toast(early ? 'Unlocked early, payout sent' : 'Withdrawal sent')
      confirm = false
      await refresh()
      void refreshBalance()
    } catch (e: any) {
      err = e.message
      sfx('ui/error')
    }
    busy = false
    draw()
  }
  const setPlan = async (b: { goalNim?: number; lockDays?: number }) => {
    try {
      info = await api.setPlan(b)
      S.me = await api.me()
      err = ''
      sfx('ui/select')
    } catch (e: any) {
      err = e.message
      sfx('ui/error')
    }
    draw()
  }
  draw()
  const keepScroll = (fn: () => void) => { const y = root.querySelector('.scroll')?.scrollTop ?? 0; fn(); const sc = root.querySelector('.scroll'); if (sc) sc.scrollTop = y }
  actions(root, {
    sd: () => (tap(), go("/showdown")),
    htab: (el) => (tap(), (tab = el.dataset.k!), (shown = PAGE), keepScroll(draw)),
    hmore: () => (tap(), (shown += PAGE), keepScroll(draw)),
    withdraw: () => withdraw(false),
    early: () => (tap(), (confirm = true), (err = ''), draw()),
    keep: () => (tap(), (confirm = false), draw()),
    'early-go': () => withdraw(true),
    goal: (el) => void setPlan({ goalNim: Number(el.dataset.n) }),
    'goal-set': () => {
      const v = Number(($<HTMLInputElement>('#goal', root)?.value ?? '').replace(',', '.'))
      if (!Number.isFinite(v) || v < 1) return toast('Type a goal of at least 1 NIM')
      void setPlan({ goalNim: v })
    },
    tier: (el) => void setPlan({ lockDays: Number(el.dataset.d) }),
    tab: () => sfx('ui/select', 0.4),
  })
  void esc
})
