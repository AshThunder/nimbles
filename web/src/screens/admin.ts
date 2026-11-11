// Owner-only admin page. The server checks the signed-in wallet on every admin call; this screen only shows what it returns.
import { api } from '../api'
import { actions, esc, ic, keepScroll, pipImg, sfx, toast } from '../lib'
import { go, route } from '../state'
import { errBox, topbar } from '../ui'
import { fmtNim } from '../../../shared/types'

const nimS = (l: number) => fmtNim(l)
const when = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const short = (a: string) => { const s = a.replace(/\s+/g, ''); return s.slice(0, 4) + '…' + s.slice(-4) }

route('/admin', async (root) => {
  let tab: 'campaign' | 'stats' = 'campaign'
  let c: any = null
  let s: any = null
  let err = ''
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let filter = 'all'
  let hfilter = 'held'
  root.innerHTML = `${topbar('Admin')}<div class="scroll center">${pipImg('think')}</div>`
  actions(root, { back: () => go('/') })
  const ok = await api.adminMe().then((r) => r.admin).catch(() => false)
  if (!ok) {
    root.innerHTML = `${topbar('Admin')}<div class="scroll" style="gap:14px">${errBox('This page is only for the Nimbles owner wallet.')}<button class="btn gold block" data-act="home">Back home</button></div>`
    actions(root, { back: () => go('/'), home: () => go('/') })
    return
  }

  const campaignTab = () => {
    if (!c) return `<div class="center">${pipImg('think')}</div>`
    const lowPool = (p: any) => p.cap > 0 && p.remaining < p.cap * 0.2
    const runway = c.pace.runwayDays === null ? 'No spend yet' : `${c.pace.runwayDays} days`
    const rows = c.payouts.filter((r: any) => filter === 'all' || r.status === filter)
    const holds = c.holds.filter((h: any) => hfilter === 'all' || h.status === hfilter)
    const s2 = c.pools.filter((p: any) => !p.legacy)
    const s1 = c.pools.filter((p: any) => p.legacy)
    const openOrphans = c.orphans.filter((o: any) => o.status === 'open')
    return `
      <div class="row" style="gap:8px"><span class="chip" style="background:${c.live ? 'var(--green-tint)' : 'var(--raised)'}">${c.live ? 'Live' : 'Not live'}</span><span class="chip">Season ${c.season}</span><span class="sm2">${when(c.start)} to ${when(c.end - 1)}</span></div>
      <div class="card row" style="gap:10px;${c.paused ? 'background:var(--coral-tint)' : ''}"><span style="flex:1;font-weight:800">${c.paused ? 'Payouts paused' : 'Payouts running'}${c.pausedBy === 'env' ? '<br><span class="sm2">Paused by CAMPAIGN_PAUSED on the server</span>' : ''}</span><button class="btn ${c.paused ? 'gold' : 'ghost'} sm" data-act="pause" ${busy || c.pausedBy === 'env' ? 'disabled' : ''}>${ic(c.paused ? 'play' : 'pause', 's16')}${c.paused ? 'Resume' : 'Pause'}</button></div>
      ${c.alerts.length ? `<div class="lob">${c.alerts.slice(0, 5).map((a: any) => `<div class="alert">${ic('triangle-alert', 's16')} ${esc(a.msg)} <span class="sm2">${when(a.at)}</span></div>`).join('')}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><span>Allocated</span><b>${nimS(c.allocated)}</b><span>of ${nimS(c.budget)} NIM (cap ${nimS(c.budgetCap)})</span></div>
        <div class="kpi"><span>Paid out</span><b>${nimS(c.paid)}</b><span>${c.counts.paid} payouts</span></div>
        <div class="kpi ${c.counts.held ? 'warn' : ''}"><span>To review</span><b>${c.counts.held}</b><span>${c.counts.approved} approved, not paid</span></div>
        <div class="kpi"><span>Funds last</span><b>${runway}</b><span>${c.pace.daysLeft} days left</span></div>
        <div class="kpi ${c.wallet.balance !== null && c.wallet.balance < c.wallet.liabilities.total ? 'warn' : ''}"><span>Campaign wallet</span><b>${c.wallet.balance === null ? '—' : nimS(c.wallet.balance)}</b><span>${c.wallet.address ? short(c.wallet.address) : 'not set up'}</span></div>
        <div class="kpi"><span>Owed to jars</span><b>${nimS(c.wallet.liabilities.jars)}</b><span>ring-fenced · ${c.counts.queued} queued · ${c.counts.review} to check</span></div>
      </div>

      <div class="lab" style="margin:0">Prize review<small>Approve or withhold each wallet, then pay the approved ones</small></div>
      <div class="pick">${['held', 'approved', 'withheld', 'paid', 'all'].map((f) => `<button class="pc ${hfilter === f ? 'on' : ''}" data-act="hfilter" data-f="${f}">${hfilter === f ? ic('check') : ''}${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
      <div class="card" style="padding:8px">${holds.length ? `<table><tr><th>Prize</th><th>Player</th><th>Flags</th><th class="n">NIM</th><th>State</th></tr>${holds.map((h: any) => `<tr>
        <td>${esc(h.note)}${h.points !== undefined ? `<br><span class="sm2">${h.points} pts</span>` : ''}</td>
        <td><b>${esc(h.name)}</b><br><span class="mono sm2">${short(h.player)}</span></td>
        <td>${h.flags.length ? h.flags.map((f: string) => `<span class="sm2" style="display:block;color:var(--coral)">${esc(f)}</span>`).join('') : '<span class="sm2">None</span>'}${h.reason ? `<span class="sm2" style="display:block">${esc(h.reason)}</span>` : ''}</td>
        <td class="n">${nimS(h.luna)}</td>
        <td><span class="st ${h.status}">${h.status}</span>${(h.status === 'held' || h.status === 'withheld') && h.luna > 0 ? `<br><button class="chip" style="margin-top:4px" data-act="approve" data-id="${esc(h.id)}">Approve</button>` : ''}${h.status === 'held' || h.status === 'approved' ? `<br><button class="chip" style="margin-top:4px" data-act="withhold" data-id="${esc(h.id)}">Withhold</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="hint" style="padding:8px">Nothing here. Prizes are held when a ladder week, a tournament or the season ends</div>'}</div>
      <button class="btn gold block" data-act="payapproved" ${busy || !c.counts.approved ? 'disabled' : ''}>${ic('send', 's16')}Pay ${c.counts.approved} approved${c.paused ? ' (sends once you resume payouts)' : ''}</button>

      <div class="lab" style="margin:0">This week's ladder<small>live, before review</small></div>
      ${c.board.length ? `<div class="card" style="padding:8px"><table><tr><th>#</th><th>Player</th><th class="n">Points</th><th class="n">Rivals</th><th class="n">Days</th></tr>${c.board.map((r: any, i: number) => `<tr><td>${r.ranked ? i + 1 : '-'}</td><td>${esc(r.name)}<br><span class="mono sm2">${short(r.address)}</span></td><td class="n">${r.points}</td><td class="n">${r.opponents}</td><td class="n">${r.activeDays}</td></tr>`).join('')}</table></div>` : '<div class="hint">No counted games yet this week</div>'}

      <div class="lab" style="margin:0">Weekend tournaments</div>
      ${c.tourneys.map((t: any) => `<div class="card"><div class="tc"><div class="kv"><span><b>${esc(t.name)}</b> · ${esc(t.game)}</span><b>${t.status}</b></div><div class="kv"><span>${when(t.startsAt)} · ${t.stake} NIM a match</span><b>${t.count}/${t.maxPlayers}</b></div>
        ${t.players.length ? `<span class="sm2">${t.players.map((p: any) => esc(p.name) + (t.flags[p.address]?.length ? ' (' + esc(t.flags[p.address].join(', ')) + ')' : '')).join(', ')}</span>` : ''}
        ${t.rounds.map((r: any, i: number) => `<span class="sm2" style="display:block;margin-top:6px"><b>Round ${i + 1}</b>: ${r.matches.map((m: any) => `${esc(m.a || 'bye')} v ${esc(m.b || 'bye')}${m.winner !== undefined ? ' > ' + esc(m.winner || 'nobody') : ''}`).join(' · ')}</span>`).join('')}
        ${t.status === 'open' ? `<button class="chip" style="margin-top:8px" data-act="tcancel" data-id="${esc(t.id)}">Cancel</button>` : ''}</div></div>`).join('')}
      ${c.tourneys.filter((t: any) => t.status !== 'cancelled').length < c.rules.tourney.count ? `<div class="card"><div class="tc">
        <label class="amt"><span>Game</span><select id="tg" style="height:40px;border-radius:10px;border:2px solid var(--ink);background:var(--card);font:inherit;font-weight:700">${c.tourneyGames.map((g: string) => `<option value="${g}">${esc(g)}</option>`).join('')}</select></label>
        <label class="amt"><span>Starts (your time)</span><input id="tstart" type="datetime-local"></label>
        <label class="amt"><span>Stake per match, NIM</span><input id="tstake" inputmode="decimal" value="${c.rules.tourney.defaultStakeNim}"></label>
        <label class="amt"><span>Max players</span><input id="tmax" inputmode="numeric" value="${c.rules.tourney.maxPlayers}"></label>
        <button class="btn gold sm block" data-act="tcreate" ${busy ? 'disabled' : ''}>Create tournament</button></div></div>` : ''}

      <div class="lab" style="margin:0">Escrow deposits to refund<small>${openOrphans.length} open</small></div>
      <div class="card" style="padding:8px">${c.orphans.length ? `<table><tr><th>When</th><th>From</th><th>Why</th><th class="n">NIM</th><th></th></tr>${c.orphans.map((o: any) => `<tr><td>${when(o.at)}</td><td class="mono sm2">${short(o.owner ?? o.from)}<br>match ${esc(o.match)}</td><td>${esc(o.why)}${o.error ? `<br><span class="sm2" style="color:var(--coral)">${esc(o.error)}</span>` : ''}</td><td class="n">${nimS(o.luna)}</td><td>${o.status === 'open' ? `<button class="chip" data-act="refund" data-id="${esc(o.hash)}">Refund</button><br><button class="chip" style="margin-top:4px" data-act="dismiss" data-id="${esc(o.hash)}">Handled</button>` : `<span class="st">${o.status}</span>`}</td></tr>`).join('')}</table>` : '<div class="hint" style="padding:8px">None</div>'}</div>

      <div class="lab" style="margin:0">Pools</div>
      <div class="card">${s2.map((p: any) => `<div class="poolr"><div class="r"><b>${esc(p.label)}</b><span>${nimS(p.remaining)} / ${nimS(p.cap)} left</span></div><div class="bar2"><i class="${lowPool(p) ? 'lo' : ''}" style="width:${p.cap ? Math.round((p.remaining / p.cap) * 100) : 0}%"></i></div></div>`).join('')}
        <form class="amt" id="mv" style="margin-top:10px"><select id="mvp" style="min-width:0;width:100%;height:40px;border-radius:10px;border:2px solid var(--ink);background:var(--card);font:inherit;font-weight:700;padding:0 8px">${s2.filter((p: any) => p.id !== 'reserve').map((p: any) => `<option value="${p.id}">Reserve to ${esc(p.label)}</option>`).join('')}</select><input id="mvn" inputmode="decimal" placeholder="NIM"></form>
        <button class="btn ghost sm block" style="margin-top:8px" data-act="move" ${busy ? 'disabled' : ''}>Move from reserve</button>
        <div class="sm2" style="margin-top:10px">Season 1, closed: ${s1.map((p: any) => `${esc(p.label.replace(' (closed)', ''))} ${nimS(p.allocated)}`).join(' · ')}</div></div>

      <div class="lab" style="margin:0">Payouts<small>${c.payouts.length} latest</small></div>
      <div class="pick">${['all', 'queued', 'sending', 'review', 'paid', 'cancelled'].map((f) => `<button class="pc ${filter === f ? 'on' : ''}" data-act="filter" data-f="${f}">${filter === f ? ic('check') : ''}${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
      <div class="card" style="padding:8px">${rows.length ? `<table><tr><th>When</th><th>Player</th><th>Why</th><th class="n">NIM</th><th>State</th></tr>${rows.map((r: any) => `<tr><td>${when(r.at)}</td><td class="mono">${short(r.player)}</td><td>${esc(r.note)}${r.wait ? `<br><span class="sm2">${esc(r.wait)}</span>` : ''}${r.error ? `<br><span class="sm2" style="color:var(--coral)">${esc(r.error)}</span>` : ''}</td><td class="n">${nimS(r.luna)}</td><td><span class="st ${r.status}">${r.status}</span>${(r.status === 'queued' || r.status === 'review') && !r.released ? `<br><button class="chip" style="margin-top:4px" data-act="cancel" data-id="${esc(r.id)}">Cancel</button>` : ''}${r.status === 'review' ? `<br><button class="chip" style="margin-top:4px" data-act="retry" data-id="${esc(r.id)}">Retry</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="hint" style="padding:8px">Nothing here yet</div>'}</div>`
  }
  const statsTab = () => {
    if (!s) return `<div class="center">${pipImg('think')}</div>`
    const max = Math.max(1, ...s.dau.map((d: any) => d.n))
    const maxN = Math.max(1, ...s.users.newPerDay.map((d: any) => d.n))
    const spark = (list: any[], m: number, col: string) => `<div class="spark">${list.map((d) => `<i title="${d.day}: ${d.n}" style="height:${Math.round((d.n / m) * 100)}%;background:${col}"></i>`).join('')}</div>`
    return `
      <div class="kpis">
        <div class="kpi"><span>Total users</span><b>${s.users.total}</b><span>${s.users.active7} active in 7 days</span></div>
        <div class="kpi"><span>Active today</span><b>${s.dau[s.dau.length - 1].n}</b><span>daily active players</span></div>
        <div class="kpi"><span>Matches played</span><b>${s.matches.settled}</b><span>${s.matches.staked} staked</span></div>
        <div class="kpi"><span>Staked volume</span><b>${nimS(s.matches.stakedLuna)}</b><span>NIM locked in matches</span></div>
        <div class="kpi"><span>Friend links</span><b>${s.social.friendLinks}</b><span>${s.social.invited} joined by invite</span></div>
        <div class="kpi"><span>Savings Jars</span><b>${nimS(s.jars.luna)}</b><span>${s.jars.count} jars · ${nimS(s.jars.showdownLocked)} Showdown locked</span></div>
      </div>
      <div class="card"><div class="row"><b>Daily active players</b><span class="sp"></span><span class="sm2">14 days</span></div>${spark(s.dau, max, 'var(--blue)')}</div>
      <div class="card"><div class="row"><b>New users per day</b><span class="sp"></span><span class="sm2">14 days</span></div>${spark(s.users.newPerDay, maxN, 'var(--green)')}</div>
      <div class="lab" style="margin:0">Matches by game and mode</div>
      <div class="card" style="padding:8px"><table><tr><th>Game</th><th class="n">Play</th><th class="n">Win</th><th class="n">Save</th><th class="n">Settle</th><th class="n">All</th></tr>${s.matches.byGame.map((g: any) => `<tr><td>${esc(g.name)}</td><td class="n">${g.play}</td><td class="n">${g.win}</td><td class="n">${g.save}</td><td class="n">${g.settle}</td><td class="n"><b>${g.total}</b></td></tr>`).join('') || '<tr><td colspan="6">No matches yet</td></tr>'}</table></div>
      <div class="lab" style="margin:0">Top players</div>
      <div class="card" style="padding:8px"><table><tr><th>#</th><th>Player</th><th class="n">Wins</th><th class="n">Played</th><th class="n">Level</th></tr>${s.top.map((r: any) => `<tr><td>${r.rank}</td><td class="mono">${esc(r.addr)}</td><td class="n">${r.wins}</td><td class="n">${r.played}</td><td class="n">${r.level}</td></tr>`).join('')}</table></div>
      <p class="sm2">Counted from Nimbles' own server data. No outside tracking.</p>`
  }
  const draw = () => {
    root.innerHTML = `${topbar('Admin')}<div class="scroll adm" style="gap:12px">
      <div class="seg" style="grid-template-columns:1fr 1fr">${([['campaign', 'Campaign'], ['stats', 'App stats']] as const).map(([k, n]) => `<button class="sg ${tab === k ? 'on' : ''}" data-act="tab" data-k="${k}" style="height:52px"><b style="font-size:15px">${n}</b>${tab === k ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div>
      ${err ? errBox(err) : ''}
      ${tab === 'campaign' ? campaignTab() : statsTab()}
    </div>`
  }
  const load = async () => {
    clearTimeout(timer)
    try {
      if (tab === 'campaign') c = await api.adminCampaign()
      else s = await api.adminStats()
      err = ''
    } catch (e: any) { err = e.message }
    if (!root.isConnected) return
    const typing = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT' || (document.activeElement as HTMLElement | null)?.tagName === 'SELECT'
    if (!typing) { const back = keepScroll(root); draw(); back() }
    timer = setTimeout(() => void load(), 15000)
  }
  const set = async (b: unknown, msg: string) => {
    busy = true
    draw()
    try { c = await api.adminSet(b); toast(msg); sfx('ui/confirm') } catch (e: any) { err = e.message; sfx('ui/error') }
    busy = false
    draw()
  }
  draw()
  await load()
  actions(root, {
    back: () => go('/'),
    tab: (el) => { tab = el.dataset.k as typeof tab; sfx('ui/select'); draw(); void load() },
    filter: (el) => { filter = el.dataset.f!; draw() },
    pause: () => set({ paused: !c.paused }, c.paused ? 'Payouts resumed' : 'Payouts paused'),
    hfilter: (el) => { hfilter = el.dataset.f!; draw() },
    approve: (el) => set({ approve: el.dataset.id }, 'Approved'),
    withhold: (el) => {
      const reason = prompt('Why is this prize withheld? (kept in the record)') ?? ''
      return set({ withhold: el.dataset.id, reason }, 'Withheld')
    },
    payapproved: () => (confirm(`Queue ${c.counts.approved} approved prizes for payout?${c.paused ? ' Payouts are paused, so nothing is sent until you resume.' : ''}`) ? set({ payApproved: true }, 'Approved prizes queued') : undefined),
    refund: (el) => (confirm('Send this deposit back to the wallet that paid it?') ? set({ refundOrphan: el.dataset.id }, 'Refund sent') : undefined),
    dismiss: (el) => (confirm('Mark this deposit as handled outside the app? Nothing is sent.') ? set({ dismissOrphan: el.dataset.id }, 'Marked handled') : undefined),
    tcancel: (el) => set({ cancelTourney: el.dataset.id }, 'Tournament cancelled'),
    tcreate: () => {
      const v = (id: string) => (root.querySelector('#' + id) as HTMLInputElement).value
      const startsAt = Date.parse(v('tstart'))
      return set({ createTourney: { game: v('tg'), startsAt, stake: Number(v('tstake')), maxPlayers: Number(v('tmax')) } }, 'Tournament created')
    },
    move: () => {
      const pool = (root.querySelector('#mvp') as HTMLSelectElement).value
      const nim = Number((root.querySelector('#mvn') as HTMLInputElement).value)
      return set({ moveFromReserve: { pool, nim } }, 'Moved from reserve')
    },
    cancel: (el) => set({ cancel: el.dataset.id }, 'Reward cancelled'),
    retry: (el) => set({ retry: el.dataset.id }, 'Queued again'),
  })
  return () => clearTimeout(timer)
})
