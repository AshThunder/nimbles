// Nimbles Showdown: rewards are earned on the server from verified, finished matches, then paid from a SEPARATE campaign
// wallet. Half of every reward goes to the player's wallet, half is locked in their Savings Jar (held in the campaign
// wallet, never in the game escrow). Fixed amounts only. Pool caps add up to the budget, so payouts can never pass it.
import { sameAddr, type Chain } from './chain'
import { ApiError, type Engine } from './engine'
import type { MatchRec, ProfileRec } from './store'
import { earlyFee } from '../shared/rewards'
import {
  CAMPAIGN_NAME, DEFAULT_AMOUNTS, LEADERBOARD_TIERS_NIM, MAX_AMOUNTS, POOL_CAPS_NIM, POOL_IDS, POOL_LABEL, RULES,
  campaignDay, campaignWindow, isLive, nimToLuna, rankBoard, runwayDays, splitReward, weekCount, weekIndex, weekRange,
  type Amounts, type PoolId, type Window,
} from '../shared/campaign'
import { LUNA } from '../shared/types'

export type RewardStatus = 'queued' | 'sending' | 'paid' | 'review' | 'cancelled'
export type RewardRec = {
  id: string // deterministic, so the same event can never be rewarded twice
  pool: PoolId
  player: string
  luna: number
  wallet: number // half paid to the wallet
  jar: number // half locked in the Savings Jar
  note: string
  at: number
  status: RewardStatus
  wait?: string // why it is still queued
  released?: string // the campaign day it counted against the daily pace
  jarCredited?: boolean
  tx?: string
  attempts: number
  lastTryAt?: number
  error?: string
  paidAt?: number
}
export type PlayerStat = {
  done: number // finished matches during the campaign
  human: number // of those, against a real player
  opps: string[] // distinct real opponents faced
  nimoDay: string
  nimoToday: number
  nimoLuna: number
  invites: number // rewarded invites
  weeks: Record<string, { wins: number; reachedAt: number }> // verified staked wins per leaderboard week
}
export type CampaignState = {
  paused: boolean
  amounts: Amounts
  caps: Record<PoolId, number> // luna
  rewards: Record<string, RewardRec>
  dayReleased: Record<string, number> // luna released per campaign day (leaderboard excluded)
  players: Record<string, PlayerStat>
  pairDay: Record<string, number>
  weeksDone: Record<string, boolean>
  alerts: { at: number; pool: PoolId | 'wallet'; msg: string }[]
  alerted: Record<string, boolean>
  feesBack: number // early unlock fees from campaign jars, they stay in the campaign wallet
}

const bad = (m: string, s = 400) => new ApiError(s, m)
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export class Campaign {
  readonly name = CAMPAIGN_NAME
  readonly window: Window
  private running = false
  private cachedBalance: { luna: number; at: number } | null = null
  constructor(private engine: Engine, public payer: Chain | null, env: Record<string, string | undefined> = process.env) {
    this.window = campaignWindow(env)
    if (env.CAMPAIGN_PAUSED === 'yes' || env.CAMPAIGN_PAUSED === 'true' || env.CAMPAIGN_PAUSED === '1') this.envPaused = true
    engine.onSettled = (m, forfeit) => this.onSettled(m, forfeit)
    // a payout that was mid-send when the server stopped may or may not have gone out. Never resend it blindly
    for (const r of Object.values(this.st.rewards)) if (r.status === 'sending') { r.status = 'review'; r.error = 'Server restarted during the send. Check the wallet history before retrying' }
  }
  envPaused = false
  get db() { return this.engine.db }
  get st(): CampaignState {
    const d = this.db as any
    d.campaign ??= {
      paused: false, amounts: { ...DEFAULT_AMOUNTS }, caps: Object.fromEntries(POOL_IDS.map((p) => [p, nimToLuna(POOL_CAPS_NIM[p])])) as Record<PoolId, number>,
      rewards: {}, dayReleased: {}, players: {}, pairDay: {}, weeksDone: {}, alerts: [], alerted: {}, feesBack: 0,
    } satisfies CampaignState
    return d.campaign
  }
  get paused() { return this.envPaused || this.st.paused }
  live(now = Date.now()) { return isLive(this.window, now) }

  private stat(a: string): PlayerStat {
    return (this.st.players[a] ??= { done: 0, human: 0, opps: [], nimoDay: '', nimoToday: 0, nimoLuna: 0, invites: 0, weeks: {} })
  }

  // ---------------- pools ----------------
  allocated(pool: PoolId) {
    let s = 0
    for (const r of Object.values(this.st.rewards)) if (r.pool === pool && r.status !== 'cancelled') s += r.luna
    return s
  }
  remaining(pool: PoolId) { return Math.max(0, this.st.caps[pool] - this.allocated(pool)) }
  earnedBy(a: string) {
    let s = 0
    for (const r of Object.values(this.st.rewards)) if (r.player === a && r.status !== 'cancelled') s += r.luna
    return s
  }

  /** Records a reward once. Clamped to what the pool and the player's cap have left; nothing is recorded if either is empty. */
  award(pool: PoolId, player: string, nim: number, id: string, note: string, now = Date.now()): RewardRec | null {
    if (pool === 'reserve') return null
    if (this.st.rewards[id]) return null
    if (!this.live(now) && pool !== 'leaderboard') return null
    const playerLeft = nimToLuna(RULES.playerCapNim) - this.earnedBy(player)
    const luna = Math.min(nimToLuna(nim), this.remaining(pool), Math.max(0, playerLeft))
    if (luna <= 0) return null
    const { wallet, jar } = splitReward(luna)
    const r: RewardRec = { id, pool, player, luna, wallet, jar, note, at: now, status: 'queued', attempts: 0 }
    this.st.rewards[id] = r
    this.checkAlerts(now)
    this.engine.store.save()
    return r
  }

  private checkAlerts(now = Date.now()) {
    for (const p of POOL_IDS) {
      if (p === 'reserve') continue
      const cap = this.st.caps[p]
      const left = this.remaining(p)
      if (cap > 0 && left < (cap * RULES.alertPct) / 100 && !this.st.alerted[p]) {
        this.st.alerted[p] = true
        const msg = `${POOL_LABEL[p]} pool is below ${RULES.alertPct}%: ${(left / LUNA).toFixed(0)} NIM left`
        this.st.alerts.unshift({ at: now, pool: p, msg })
        console.warn('[campaign] ALERT', msg)
      }
    }
    this.st.alerts = this.st.alerts.slice(0, 50)
  }

  // ---------------- earning, from finished matches ----------------
  isFriend(a: string, b: string) {
    const pa = this.db.profiles[a], pb = this.db.profiles[b]
    if (!pa || !pb) return false
    const mutual = (pa.friendList ?? []).includes(b) && (pb.friendList ?? []).includes(a)
    return mutual || pa.invitedBy === b || pb.invitedBy === a
  }

  /** A score the server worked out itself, so a client cannot claim a win against Nimo. */
  private verifiedWin(m: MatchRec, human: MatchRec['players'][number]) {
    if (m.game === 'trivia' || m.game === 'word' || m.game === 'splat') return true
    const d = human.result?.detail as any
    return !!d && d.verified === true
  }

  onSettled(m: MatchRec, forfeit: boolean, now = Date.now()) {
    if (!this.live(now) || !m.settlement) return
    const humans = m.players.filter((p) => !p.isBot)
    const finished = humans.filter((p) => p.result && p.result.score >= 0)
    if (!finished.length || m.status !== 'settled') return
    const allDone = finished.length === humans.length && !forfeit
    for (const h of finished) {
      const a = h.player.address
      const s = this.stat(a)
      s.done++
      const opps = humans.filter((o) => o.player.address !== a).map((o) => o.player.address)
      if (opps.length) s.human++
      for (const o of opps) if (!s.opps.includes(o)) s.opps.push(o)
      s.opps = s.opps.slice(-200)
      // welcome: a few finished matches, at least one against a real player
      if (s.done >= RULES.welcomeMatches && s.human >= RULES.welcomeMinHuman) this.award('welcome', a, this.st.amounts.welcome, `welcome:${a}`, 'Welcome reward', now)
      // invite: the person who invited this player is rewarded once this player has really played
      const p = this.db.profiles[a]
      if (p?.invitedBy && s.done >= RULES.inviteMatches && s.human >= RULES.inviteMinHuman) {
        const inv = this.stat(p.invitedBy)
        if (inv.invites < RULES.inviteMax && !this.st.rewards[`invite:${a}`]) {
          if (this.award('invite', p.invitedBy, this.st.amounts.invite, `invite:${a}`, `Invite: ${p.name} joined and played`, now)) inv.invites++
        }
      }
    }
    // friend duel: a finished staked match between two friends
    if (allDone && humans.length === 2 && (m.mode === 'win' || m.mode === 'save') && m.stake >= RULES.friendMinStakeNim && humans.every((p) => p.funded && p.escrowed > 0)) {
      const [x, y] = humans.map((p) => p.player.address)
      if (this.isFriend(x, y)) {
        const k = `${campaignDay(now)}:${pairKey(x, y)}`
        if ((this.st.pairDay[k] ?? 0) < RULES.friendPairPerDay) {
          this.st.pairDay[k] = (this.st.pairDay[k] ?? 0) + 1
          for (const a of [x, y]) {
            if (this.stat(a).opps.length >= RULES.friendMinOpponents) this.award('friend', a, this.st.amounts.friend, `friend:${m.id}:${a}`, 'Friend duel', now)
          }
        }
      }
    }
    // weekly leaderboard: verified wins in finished staked matches against real players, same per-pair daily limit
    if (allDone && humans.length >= 2 && (m.mode === 'win' || m.mode === 'save') && m.stake >= RULES.friendMinStakeNim && m.settlement.winner && !m.settlement.draw) {
      const w = m.settlement.winner
      const wk = String(weekIndex(this.window, now))
      const k = `lb:${campaignDay(now)}:${pairKey(humans[0].player.address, humans[1].player.address)}`
      if (wk !== '-1' && (this.st.pairDay[k] ?? 0) < RULES.friendPairPerDay && humans.some((p) => p.player.address === w)) {
        this.st.pairDay[k] = (this.st.pairDay[k] ?? 0) + 1
        const row = (this.stat(w).weeks[wk] ??= { wins: 0, reachedAt: now })
        row.wins++
        row.reachedAt = now
      }
    }
    // Nimo on Hard: a server-verified free-play win
    if (m.opp === 'pip' && m.pipLevel === 'hard' && m.mode === 'play' && humans.length === 1) {
      const h = humans[0]
      const a = h.player.address
      if (m.settlement.winner === a && !m.settlement.draw && this.verifiedWin(m, h)) {
        const s = this.stat(a)
        const today = campaignDay(now)
        if (s.nimoDay !== today) { s.nimoDay = today; s.nimoToday = 0 }
        const left = nimToLuna(RULES.nimoLifetimeNim) - s.nimoLuna
        if (s.nimoToday < RULES.nimoPerDay && left > 0) {
          const r = this.award('nimo', a, Math.min(this.st.amounts.nimo, left / LUNA), `nimo:${m.id}`, 'Beat Nimo on Hard', now)
          if (r) { s.nimoToday++; s.nimoLuna += r.luna }
        }
      }
    }
    // prune old pair counters
    const today = campaignDay(now)
    for (const k of Object.keys(this.st.pairDay)) if (!k.includes(today)) delete this.st.pairDay[k]
    this.engine.store.save()
  }

  // ---------------- weekly leaderboard ----------------
  board(week: number) {
    const wk = String(week)
    return rankBoard(Object.entries(this.st.players).map(([address, s]) => ({ address, wins: s.weeks[wk]?.wins ?? 0, reachedAt: s.weeks[wk]?.reachedAt ?? 0 })))
  }
  /** Once a week has ended, its top 20 are rewarded from the leaderboard pool. Runs any number of times, pays once. */
  closeWeeks(now = Date.now()) {
    for (let i = 0; i < weekCount(this.window); i++) {
      if (this.st.weeksDone[i] || now < weekRange(this.window, i).end) continue
      this.st.weeksDone[i] = true
      this.board(i).slice(0, RULES.leaderboardTop).forEach((r, j) => {
        this.award('leaderboard', r.address, LEADERBOARD_TIERS_NIM[j], `lb:${i}:${j + 1}`, `Week ${i + 1} leaderboard, place ${j + 1}`, now)
      })
      this.engine.store.save()
    }
  }

  // ---------------- payouts ----------------
  /** NIM the campaign wallet must keep for jars and for rewards already released but not sent. */
  liabilities() {
    let jars = 0
    for (const p of Object.values(this.db.profiles)) jars += p.cjar?.luna ?? 0
    let unsent = 0
    for (const r of Object.values(this.st.rewards)) if (r.released && (r.status === 'queued' || r.status === 'sending' || r.status === 'review')) unsent += r.wallet
    return { jars, unsent, total: jars + unsent }
  }

  async walletBalance(maxAgeMs = 15_000): Promise<number | null> {
    if (!this.payer) return null
    if (this.cachedBalance && Date.now() - this.cachedBalance.at < maxAgeMs) return this.cachedBalance.luna
    try {
      const luna = await this.payer.balance()
      this.cachedBalance = { luna, at: Date.now() }
      return luna
    } catch { return null }
  }

  private creditJar(p: ProfileRec, luna: number, now = Date.now()) {
    const j = (p.cjar ??= { luna: 0, unlockAt: 0, startAt: 0 })
    const fresh = j.luna <= 0 || j.unlockAt <= now
    j.luna += luna
    if (fresh) {
      j.startAt = now
      j.unlockAt = now + this.engine.planOf(p).lockDays * 864e5
    }
  }

  /** Releases queued rewards within the daily pace and the wallet's funds, then sends the wallet halves one at a time. */
  async tick(now = Date.now()) {
    if (this.running) return
    this.running = true
    try {
      this.closeWeeks(now)
      if (this.paused) return
      const queue = Object.values(this.st.rewards).filter((r) => r.status === 'queued').sort((a, b) => a.at - b.at)
      if (!queue.length) return
      const today = campaignDay(now)
      let bal = await this.walletBalance(0)
      for (const r of queue) {
        if (this.paused) break
        if (!r.released) {
          if (!this.payer || bal === null) { r.wait = this.payer ? 'Could not read the campaign wallet' : 'Campaign wallet not set up'; continue }
          if (r.pool !== 'leaderboard' && (this.st.dayReleased[today] ?? 0) + r.luna > nimToLuna(RULES.dailyCapNim)) { r.wait = 'Daily pace reached, pays tomorrow'; continue }
          const free = bal - this.liabilities().total - Number((this.payer as any).payFee ?? 0)
          if (free < r.luna) { r.wait = 'Waiting for campaign wallet funds'; this.fundsAlert(now); continue }
          r.released = today
          if (r.pool !== 'leaderboard') this.st.dayReleased[today] = (this.st.dayReleased[today] ?? 0) + r.luna
          const p = this.db.profiles[r.player]
          if (p && r.jar > 0 && !r.jarCredited) { this.creditJar(p, r.jar, now); r.jarCredited = true }
          delete r.wait
          this.engine.store.flush()
        }
        if (r.wallet <= 0) { r.status = 'paid'; r.paidAt = now; continue }
        if (r.attempts >= 6 && now - (r.lastTryAt ?? 0) < 5 * 60_000) continue
        r.status = 'sending'
        r.attempts++
        r.lastTryAt = now
        this.engine.store.flush()
        try {
          r.tx = await this.payer!.pay(r.player, r.wallet, `nb:sd:${r.id}`.slice(0, 64))
          r.status = 'paid'
          r.paidAt = Date.now()
          delete r.error
          bal = (bal ?? 0) - r.wallet
        } catch (e: any) {
          r.status = r.attempts >= 54 ? 'review' : 'queued'
          r.error = String(e?.message ?? e).slice(0, 120)
        }
        this.engine.store.save()
      }
      this.engine.store.save()
    } finally { this.running = false }
  }

  private fundsAlert(now: number) {
    const k = 'wallet:' + campaignDay(now)
    if (this.st.alerted[k]) return
    this.st.alerted[k] = true
    this.st.alerts.unshift({ at: now, pool: 'wallet', msg: 'The campaign wallet is short of funds. Rewards are queued until it is topped up' })
  }

  // ---------------- the player's own view ----------------
  /** Only the player's own progress and their own earned amounts. No budget, no pool sizes, no reward prices. */
  me(a: string, now = Date.now()) {
    const s = this.stat(a)
    const p = this.db.profiles[a]
    const mine = Object.values(this.st.rewards).filter((r) => r.player === a && r.status !== 'cancelled')
    const wk = weekIndex(this.window, now)
    const board = wk >= 0 ? this.board(wk) : []
    const rank = board.findIndex((r) => r.address === a)
    const friends = (p?.friendList ?? []).filter((f) => this.isFriend(a, f)).length
    return {
      name: CAMPAIGN_NAME, live: this.live(now), start: this.window.start, end: this.window.end, paused: this.paused,
      earned: { total: mine.reduce((x, r) => x + r.luna, 0), wallet: mine.filter((r) => r.status === 'paid').reduce((x, r) => x + r.wallet, 0), jar: mine.filter((r) => r.jarCredited).reduce((x, r) => x + r.jar, 0), pending: mine.filter((r) => r.status !== 'paid').reduce((x, r) => x + r.luna, 0) },
      steps: {
        welcome: { done: Math.min(s.done, RULES.welcomeMatches), need: RULES.welcomeMatches, real: Math.min(s.human, RULES.welcomeMinHuman), needReal: RULES.welcomeMinHuman, got: !!this.st.rewards[`welcome:${a}`] },
        friends: { opponents: Math.min(s.opps.length, RULES.friendMinOpponents), need: RULES.friendMinOpponents, unlocked: s.opps.length >= RULES.friendMinOpponents, friends },
        invites: { rewarded: s.invites, max: RULES.inviteMax },
        nimo: { today: s.nimoDay === campaignDay(now) ? s.nimoToday : 0, perDay: RULES.nimoPerDay, capped: s.nimoLuna >= nimToLuna(RULES.nimoLifetimeNim) },
        week: { index: wk, wins: wk >= 0 ? s.weeks[String(wk)]?.wins ?? 0 : 0, rank: rank >= 0 ? rank + 1 : 0, top: RULES.leaderboardTop, endsAt: wk >= 0 ? weekRange(this.window, wk).end : 0 },
      },
      capped: this.earnedBy(a) >= nimToLuna(RULES.playerCapNim),
      history: mine.sort((x, y) => y.at - x.at).slice(0, 20).map((r) => ({ note: r.note, luna: r.luna, wallet: r.wallet, jar: r.jar, status: r.status === 'paid' ? 'paid' : 'pending', at: r.at, tx: r.tx })),
      jar: this.jarOf(a, now),
      serverNow: now,
    }
  }

  jarOf(a: string, now = Date.now()) {
    const p = this.db.profiles[a]
    const j = p?.cjar ?? { luna: 0, unlockAt: 0, startAt: 0 }
    const locked = j.luna > 0 && j.unlockAt > now
    const q = locked ? earlyFee(j.luna, j.startAt, j.unlockAt, now) : { fee: 0, pct: 0 }
    return { luna: j.luna, unlockAt: j.unlockAt, locked, early: { fee: q.fee, pct: q.pct, net: j.luna - q.fee } }
  }

  /** The locked half follows the jar's normal rules: free after the lock, or early with the same sliding fee. Paid from the campaign wallet. */
  async withdrawJar(a: string, early: boolean, now = Date.now()) {
    const p = this.db.profiles[a]
    const j = p?.cjar
    if (!p || !j || j.luna <= 0) throw bad('No locked rewards to withdraw')
    if (!this.payer) throw bad('Withdrawals open soon. Your rewards are safe')
    const locked = now < j.unlockAt
    if (locked && !early) throw bad('Your rewards are still locked')
    const fee = locked ? earlyFee(j.luna, j.startAt, j.unlockAt, now).fee : 0
    const held = { ...j }
    const luna = j.luna - fee
    p.cjar = { luna: 0, unlockAt: 0, startAt: 0 } // zero first so a double tap can't pay twice
    this.st.feesBack += fee
    this.engine.store.flush()
    try {
      const tx = await this.payer.pay(a, luna, fee ? 'nb:sd:jar:early' : 'nb:sd:jar')
      return { tx, luna, fee }
    } catch {
      p.cjar = held
      this.st.feesBack -= fee
      this.engine.store.save()
      throw bad('The payout did not go through, your locked rewards are untouched. Try again')
    }
  }

  // ---------------- admin ----------------
  async adminView(now = Date.now()) {
    const st = this.st
    const pools = POOL_IDS.map((p) => ({ id: p, label: POOL_LABEL[p], cap: st.caps[p], allocated: p === 'reserve' ? 0 : this.allocated(p), remaining: p === 'reserve' ? st.caps[p] : this.remaining(p) }))
    const nonLb = pools.filter((p) => p.id !== 'leaderboard' && p.id !== 'reserve').reduce((s, p) => s + p.remaining, 0)
    const days: number[] = []
    for (let i = 0; i < 3; i++) {
      const d = campaignDay(now - i * 864e5)
      if (now - i * 864e5 >= this.window.start) days.push(st.dayReleased[d] ?? 0)
    }
    const rewards = Object.values(st.rewards).sort((a, b) => b.at - a.at)
    const bal = await this.walletBalance()
    const totalCap = POOL_IDS.reduce((s, p) => s + st.caps[p], 0)
    const allocated = POOL_IDS.reduce((s, p) => s + (p === 'reserve' ? 0 : this.allocated(p)), 0)
    const runway = runwayDays(nonLb, days)
    return {
      name: CAMPAIGN_NAME, live: this.live(now), start: this.window.start, end: this.window.end,
      paused: this.paused, pausedBy: this.envPaused ? 'env' : st.paused ? 'admin' : '',
      amounts: st.amounts, maxAmounts: MAX_AMOUNTS, rules: RULES,
      wallet: { address: this.payer?.escrowAddress ?? '', balance: bal, liabilities: this.liabilities(), feesBack: st.feesBack },
      budget: totalCap, allocated, paid: rewards.filter((r) => r.status === 'paid').reduce((s, r) => s + r.luna, 0),
      pools,
      pace: { today: st.dayReleased[campaignDay(now)] ?? 0, dailyCap: nimToLuna(RULES.dailyCapNim), recent: days, runwayDays: Number.isFinite(runway) ? Math.round(runway * 10) / 10 : null, daysLeft: Math.max(0, Math.ceil((this.window.end - now) / 864e5)) },
      counts: { queued: rewards.filter((r) => r.status === 'queued').length, sending: rewards.filter((r) => r.status === 'sending').length, review: rewards.filter((r) => r.status === 'review').length, paid: rewards.filter((r) => r.status === 'paid').length },
      alerts: st.alerts.slice(0, 20),
      payouts: rewards.slice(0, 200),
      board: (() => { const w = weekIndex(this.window, now); return w < 0 ? [] : this.board(w).slice(0, 20).map((r, i) => ({ rank: i + 1, ...r })) })(),
      serverNow: now,
    }
  }

  adminSet(b: any) {
    const st = this.st
    if (typeof b.paused === 'boolean') st.paused = b.paused
    if (b.amounts && typeof b.amounts === 'object') {
      for (const k of Object.keys(DEFAULT_AMOUNTS) as (keyof Amounts)[]) {
        if (b.amounts[k] === undefined) continue
        const v = Number(b.amounts[k])
        if (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNTS[k]) throw bad(`${k} must be between 0 and ${MAX_AMOUNTS[k]} NIM`)
        st.amounts[k] = Math.round(v * 100) / 100
      }
    }
    if (b.moveFromReserve) {
      // shifts budget between pools; the total never changes, so the budget can never grow
      const pool = b.moveFromReserve.pool as PoolId
      const nim = Number(b.moveFromReserve.nim)
      if (!POOL_IDS.includes(pool) || pool === 'reserve') throw bad('Pick a pool')
      if (!(nim > 0)) throw bad('Enter an amount')
      const luna = nimToLuna(nim)
      if (luna > st.caps.reserve) throw bad('The reserve does not have that much')
      st.caps.reserve -= luna
      st.caps[pool] += luna
      delete st.alerted[pool]
    }
    if (b.cancel) {
      const r = st.rewards[String(b.cancel)]
      if (!r || r.status !== 'queued' || r.released) throw bad('Only queued rewards that have not been released can be cancelled')
      r.status = 'cancelled'
    }
    if (b.retry) {
      const r = st.rewards[String(b.retry)]
      if (!r || r.status !== 'review') throw bad('Only rewards marked for review can be retried')
      r.status = 'queued'
      r.attempts = 0
    }
    if (b.markPaid) {
      const r = st.rewards[String(b.markPaid)]
      if (!r || r.status !== 'review') throw bad('Only rewards marked for review can be marked paid')
      r.status = 'paid'
      r.paidAt = Date.now()
      r.tx = typeof b.tx === 'string' ? b.tx.slice(0, 80) : r.tx
    }
    this.engine.store.save()
  }
}

export const ADMIN_DEFAULT = 'NQ20 9393 TV0B TTL5 R1X1 8DN6 P0CY 3C47 NHGR'
/** Admin wallets: ADMIN_ADDRESSES (comma separated) or the owner's wallet. Exact address match, never a prefix or suffix. */
export function isAdmin(address: string, env: Record<string, string | undefined> = process.env) {
  const list = (env.ADMIN_ADDRESSES ?? ADMIN_DEFAULT).split(',').map((s) => s.trim()).filter(Boolean)
  return list.some((x) => sameAddr(x, address))
}
