// Nimbles Showdown, season 2. No instant rewards: NIM is only won on the weekly ladder (staked games against real
// players), in two weekend knockout tournaments, and for invites (at season end). Every prize is HELD when it is worked
// out, the owner reviews the flags and approves or withholds each wallet, then pays the approved ones in one batch from
// the separate campaign wallet. Payouts stay paused until the owner unpauses them.
//
// Joining has no gates. The checks happen at payout: opponent diversity, linked wallets (shared IP, device, funding
// source or payout address on chain, invites) and robotic timing. Linked wallets share one prize.
import { randomInt } from 'node:crypto'
import { sameAddr, type Chain } from './chain'
import { ApiError, type Engine } from './engine'
import type { MatchRec, ProfileRec } from './store'
import { earlyFee } from '../shared/rewards'
import {
  BUDGET_NIM, CAMPAIGN_NAME, INVITES, LADDER, LADDER_CURVES_NIM, LEGACY_POOLS, POOL_IDS, POOL_LABEL, RULES, SEASON1_CAPS_NIM, SEASON2_CAPS_NIM,
  SEASON2_POOLS, TIMING, TOURNEY, campaignDay, campaignWindow, componentFactor, isLive, ladderPool, nimToLuna, runwayDays, trustOf, walletKey,
  weekCount, weekIndex, weekRange, winWeight, type PoolId, type Window,
} from '../shared/campaign'
import { LUNA, GAMES, type GameId } from '../shared/types'

export type RewardStatus = 'queued' | 'sending' | 'paid' | 'review' | 'cancelled'
export type RewardRec = {
  id: string // deterministic, so the same prize can never be paid twice
  pool: PoolId
  player: string
  luna: number
  wallet: number // paid to the wallet (season 2: all of it)
  jar: number // season 1 only: locked in the Savings Jar
  note: string
  at: number
  status: RewardStatus
  wait?: string
  released?: string
  jarCredited?: boolean
  tx?: string
  attempts: number
  lastTryAt?: number
  error?: string
  paidAt?: number
  match?: string
  game?: string
  hold?: string // season 2: the reviewed hold it came from
}

/** One counted ladder game. Points are worked out again at week close from the whole season's games. */
export type LadderGame = { id: string; at: number; day: string; week: number; winner: string; loser: string; base: number; game: string; stake: number }
export type HoldStatus = 'held' | 'approved' | 'withheld' | 'paid'
export type HoldRec = {
  id: string
  pool: 'ladder1' | 'ladder2' | 'tourney' | 'invite2'
  player: string
  luna: number
  note: string
  place?: number
  points?: number
  at: number
  status: HoldStatus
  flags: string[]
  linkedTo?: string[] // other wallets in the same group
  reason?: string // why it was withheld
  decidedAt?: number
  reward?: string
}
export type TourneyStatus = 'open' | 'running' | 'done' | 'cancelled'
export type Tourney = {
  id: string
  name: string
  game: GameId
  stake: number // NIM per match
  startsAt: number
  maxPlayers: number
  status: TourneyStatus
  players: string[] // registration order
  devices: Record<string, string> // address -> hashed device
  flags: Record<string, string[]>
  seeds?: string[] // bracket order, null slots are byes
  rounds?: { matches: { a: string | null; b: string | null; match?: string; winner?: string | null; note?: string }[]; deadline: number }[]
  places?: Record<string, number> // finishing place
  note?: string
}
export type CampaignState = {
  paused: boolean
  caps: Record<PoolId, number> // luna
  rewards: Record<string, RewardRec>
  dayReleased: Record<string, number>
  alerts: { at: number; pool: PoolId | 'wallet' | 'season'; msg: string }[]
  alerted: Record<string, boolean>
  feesBack: number
  v2?: { at: number; legacyAllocated: number; reserve: number }
  ladder: { games: LadderGame[]; ratings: Record<string, number>; pairDay: Record<string, number>; pairSeason: Record<string, number> }
  holds: Record<string, HoldRec>
  weeksClosed: Record<string, boolean>
  invitesClosed?: boolean
  tourneys: Record<string, Tourney>
  chainLinks: Record<string, { from: string[]; to: string[]; at: number }>
  // season 1 leftovers (kept as history)
  amounts?: unknown
  players?: unknown
  pairDay?: unknown
  weeksDone?: unknown
  beatNimoStart?: number
}

const bad = (m: string, s = 400) => new ApiError(s, m)
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }
const stdev = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }
const SEASON2_POOL_SET = new Set<string>(SEASON2_POOLS)
/** Games a tournament can use: two-player games with a server-checked or server-run result. */
export const TOURNEY_GAMES: GameId[] = (['trivia', 'chess', 'pool', 'word', 'solitaire', 'bubble'] as GameId[]).filter((g) => !!GAMES[g])

/** Union-find over wallets. */
class Groups {
  private p = new Map<string, string>()
  find(a: string): string { const q = this.p.get(a); if (q === undefined || q === a) { this.p.set(a, a); return a } const r = this.find(q); this.p.set(a, r); return r }
  union(a: string, b: string) { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x < y ? y : x, x < y ? x : y) }
  same(a: string, b: string) { return this.find(a) === this.find(b) }
}

export type Standing = {
  address: string
  points: number
  games: number // counted wins and losses this week
  activeDays: number // this week
  opponents: number // distinct eligible opponents this season (not linked)
  ranked: boolean
  need: { opponents: number; days: number }
}

export class Campaign {
  readonly name = CAMPAIGN_NAME
  readonly window: Window
  envPaused = false
  private running = false
  private rerun = false
  private cachedBalance: { luna: number; at: number } | null = null
  constructor(private engine: Engine, public payer: Chain | null, env: Record<string, string | undefined> = process.env) {
    this.window = campaignWindow(env)
    if (env.CAMPAIGN_PAUSED === 'yes' || env.CAMPAIGN_PAUSED === 'true' || env.CAMPAIGN_PAUSED === '1') this.envPaused = true
    engine.onSettled = (m, forfeit) => this.onSettled(m, forfeit)
    engine.onCancelled = (m) => this.onTourneyMatchEnded(m)
    migrateV2(this.st, (p) => this.allocated(p))
    // a payout that was mid-send when the server stopped may or may not have gone out. Never resend it blindly
    for (const r of Object.values(this.st.rewards)) if (r.status === 'sending') { r.status = 'review'; r.error = 'Server restarted during the send. Check the wallet history before retrying' }
    engine.store.save()
  }
  get db() { return this.engine.db }
  get st(): CampaignState {
    const d = this.db as any
    d.campaign ??= {
      paused: false, caps: Object.fromEntries(POOL_IDS.map((p) => [p, nimToLuna((SEASON1_CAPS_NIM as any)[p] ?? 0)])) as Record<PoolId, number>,
      rewards: {}, dayReleased: {}, alerts: [], alerted: {}, feesBack: 0,
    }
    const st = d.campaign as CampaignState
    st.ladder ??= { games: [], ratings: {}, pairDay: {}, pairSeason: {} }
    st.holds ??= {}
    st.weeksClosed ??= {}
    st.tourneys ??= {}
    st.chainLinks ??= {}
    for (const p of POOL_IDS) st.caps[p] ??= 0
    return st
  }
  get paused() { return this.envPaused || this.st.paused }
  live(now = Date.now()) { return isLive(this.window, now) }

  // ---------------- pools ----------------
  /** Paid or committed: rewards not cancelled, plus season 2 holds that are still held or approved. */
  allocated(pool: PoolId) {
    let s = 0
    for (const r of Object.values(this.st.rewards)) if (r.pool === pool && r.status !== 'cancelled') s += r.luna
    for (const h of Object.values(this.st.holds ?? {})) if (h.pool === pool && (h.status === 'held' || h.status === 'approved')) s += h.luna
    return s
  }
  remaining(pool: PoolId) { return Math.max(0, this.st.caps[pool] - (pool === 'reserve' ? 0 : this.allocated(pool))) }

  // ---------------- ladder: recording games ----------------
  /** Why a finished match does not count for the ladder, or '' when it does. */
  ladderCheck(m: MatchRec, forfeit: boolean): string {
    if (m.tourney) return 'tournament match'
    if (m.mode !== 'win' && m.mode !== 'save') return 'not a staked match'
    if (m.players.length !== 2 || m.players.some((p) => p.isBot) || m.opp === 'pip') return 'not two real players'
    if (m.stake < LADDER.minStakeNim) return `stake under ${LADDER.minStakeNim} NIM`
    if (!m.players.every((p) => p.funded && p.escrowed > 0)) return 'not both locked'
    if (forfeit || m.status !== 'settled' || !m.settlement) return 'not finished'
    if (m.settlement.draw || !m.settlement.winner) return 'no winner'
    if (!m.players.every((p) => p.result && p.result.score >= 0)) return 'someone did not finish'
    const [a, b] = m.players.map((p) => p.player.address)
    if (sameAddr(a, b) || walletKey(a) === walletKey(b)) return 'same wallet'
    return ''
  }

  onSettled(m: MatchRec, forfeit: boolean, now = Date.now()) {
    if (m.tourney) return this.onTourneyMatchEnded(m)
    if (!this.live(now) || this.ladderCheck(m, forfeit)) return
    const L = this.st.ladder
    if (L.games.some((g) => g.id === m.id)) return
    const winner = m.settlement!.winner!
    const loser = m.players.map((p) => p.player.address).find((a) => a !== winner)!
    const pk = pairKey(winner, loser)
    const day = campaignDay(now)
    const dk = `${day}:${pk}`
    if ((L.pairDay[dk] ?? 0) >= LADDER.pairPerDay || (L.pairSeason[pk] ?? 0) >= LADDER.pairPerSeason) return
    const repeat = L.pairSeason[pk] ?? 0
    const loserGames = L.games.filter((g) => g.winner === loser || g.loser === loser).length
    const wr = L.ratings[winner] ?? LADDER.startRating, lr = L.ratings[loser] ?? LADDER.startRating
    const base = Math.round(LADDER.basePoints * winWeight({ winnerRating: wr, loserRating: lr, repeat, loserGames }) * 100) / 100
    const e = 1 / (1 + 10 ** ((lr - wr) / 400))
    L.ratings[winner] = Math.round(wr + LADDER.k * (1 - e))
    L.ratings[loser] = Math.round(lr - LADDER.k * (1 - e))
    L.pairDay[dk] = (L.pairDay[dk] ?? 0) + 1
    L.pairSeason[pk] = repeat + 1
    L.games.push({ id: m.id, at: now, day, week: weekIndex(this.window, now), winner, loser, base, game: m.game, stake: m.stake })
    for (const k of Object.keys(L.pairDay)) if (!k.startsWith(day)) delete L.pairDay[k]
    this.engine.store.save()
  }

  // ---------------- grouping and standings ----------------
  /** Wallets that look like one person: the same device, a direct transfer or a shared private funding source on chain.
   *  A shared IP and invites are softer links: shown to the reviewer, never merged on their own. */
  groups(): { g: Groups; why: Map<string, Set<string>>; invite: Map<string, string> } {
    const g = new Groups()
    const why = new Map<string, Set<string>>()
    const note = (a: string, b: string, r: string) => { for (const [x, y] of [[a, b], [b, a]]) { let s = why.get(x); if (!s) why.set(x, (s = new Set())); s.add(`${r} with ${this.nameOf(y)}`) } }
    const players = new Set<string>()
    for (const x of this.st.ladder.games) { players.add(x.winner); players.add(x.loser) }
    for (const t of Object.values(this.st.tourneys)) for (const p of t.players) players.add(p)
    const sig = (this.db as any).signals?.by ?? {}
    const byIp = new Map<string, string[]>(), byDev = new Map<string, string[]>()
    for (const a of players) {
      for (const h of sig[a]?.ips ?? []) byIp.set(h, [...(byIp.get(h) ?? []), a])
      for (const h of sig[a]?.devs ?? []) byDev.set(h, [...(byDev.get(h) ?? []), a])
    }
    // the same device merges wallets. The same IP is only shown to the reviewer: mobile networks put many real
    // players behind one address, so an IP alone never takes a prize away
    for (const xs of byDev.values()) for (let i = 1; i < xs.length; i++) { g.union(xs[0], xs[i]); note(xs[0], xs[i], 'Same device') }
    for (const xs of byIp.values()) if (xs.length <= 6) for (let i = 1; i < xs.length; i++) note(xs[0], xs[i], 'Same IP')
    // chain: a direct transfer between two players, or one funding source shared by at most 3 players (more than that is
    // probably an exchange or a faucet, which is shown but not merged)
    const skip = new Set([this.engine.chain.escrowAddress, this.payer?.escrowAddress].filter(Boolean).map((a) => walletKey(a!)))
    const byKey = new Map([...players].map((a) => [walletKey(a), a]))
    const shared = new Map<string, string[]>()
    for (const a of players) {
      const l = this.st.chainLinks[a]
      if (!l) continue
      for (const c of [...l.from, ...l.to]) {
        const k = walletKey(c)
        if (skip.has(k)) continue
        const other = byKey.get(k)
        if (other && other !== a) { g.union(a, other); note(a, other, 'Sent NIM directly') }
        else if (l.from.some((f) => walletKey(f) === k)) shared.set(k, [...new Set([...(shared.get(k) ?? []), a])])
      }
    }
    for (const xs of shared.values()) if (xs.length >= 2 && xs.length <= 3) for (let i = 1; i < xs.length; i++) { g.union(xs[0], xs[i]); note(xs[0], xs[i], 'Same funding wallet') }
    const invite = new Map<string, string>()
    for (const a of players) { const by = this.db.profiles[a]?.invitedBy; if (by) invite.set(a, by) }
    return { g, why, invite }
  }

  /** Standings for a week, from all counted games of the season so far. Points are weighted by how trusted each beaten
   *  opponent is (how many different people they have played) and by the size of the circle they play in. */
  standings(week: number, now = Date.now()): Standing[] {
    const { g } = this.groups()
    const end = week >= 0 && week < weekCount(this.window) ? weekRange(this.window, week).end : now
    const games = this.st.ladder.games.filter((x) => x.at < end && !g.same(x.winner, x.loser))
    const opps = new Map<string, Set<string>>()
    const add = (a: string, b: string) => { let s = opps.get(a); if (!s) opps.set(a, (s = new Set())); s.add(b) }
    for (const x of games) { add(x.winner, x.loser); add(x.loser, x.winner) }
    // connected circles of the game graph
    const comp = new Groups()
    for (const x of games) comp.union(x.winner, x.loser)
    const size = new Map<string, number>()
    for (const a of opps.keys()) size.set(comp.find(a), (size.get(comp.find(a)) ?? 0) + 1)
    const eligibleOpp = (o: string) => (opps.get(o)?.size ?? 0) >= LADDER.eligibleOppMinOpponents
    const rows = new Map<string, Standing>()
    const row = (a: string) => {
      let r = rows.get(a)
      if (!r) {
        const eo = [...(opps.get(a) ?? [])].filter(eligibleOpp).length
        r = { address: a, points: 0, games: 0, activeDays: 0, opponents: eo, ranked: false, need: { opponents: Math.max(0, LADDER.minOpponents - eo), days: LADDER.minActiveDays } }
        rows.set(a, r)
      }
      return r
    }
    const days = new Map<string, Set<string>>()
    for (const x of games) {
      if (x.week !== week) continue
      const w = row(x.winner), l = row(x.loser)
      w.games++; l.games++
      for (const a of [x.winner, x.loser]) { let s = days.get(a); if (!s) days.set(a, (s = new Set())); s.add(x.day) }
      w.points += x.base * trustOf(opps.get(x.loser)?.size ?? 0) * componentFactor(size.get(comp.find(x.loser)) ?? 1)
    }
    for (const r of rows.values()) {
      r.activeDays = days.get(r.address)?.size ?? 0
      r.points = Math.round(r.points * 100) / 100
      r.need.days = Math.max(0, LADDER.minActiveDays - r.activeDays)
      r.ranked = r.need.opponents === 0 && r.need.days === 0 && r.points > 0
    }
    return [...rows.values()].sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.points - a.points || b.opponents - a.opponents || a.address.localeCompare(b.address))
  }

  /** Flags for the reviewer about one wallet. Never automatic. */
  flagsOf(a: string, why: Map<string, Set<string>>, invite: Map<string, string>): string[] {
    const f = [...(why.get(a) ?? [])]
    const by = invite.get(a)
    if (by) f.push(`Invited by ${this.nameOf(by)}`)
    const invited = [...invite.entries()].filter(([, b]) => b === a).map(([x]) => this.nameOf(x))
    if (invited.length) f.push(`Invited ${invited.slice(0, 3).join(', ')}${invited.length > 3 ? ` and ${invited.length - 3} more` : ''}`)
    // trivia answer timing, measured on the server
    const ms: number[] = []
    for (const m of Object.values(this.db.matches)) {
      if (m.game !== 'trivia' || m.createdAt < this.window.start) continue
      for (const x of m.trivia?.answers?.[a] ?? []) if (x.choice >= 0) ms.push(x.ms)
    }
    if (ms.length >= TIMING.minAnswers) {
      const sd = stdev(ms), md = median(ms)
      if (sd < TIMING.spreadMs) f.push(`Robotic trivia timing: answers vary by only ${Math.round(sd)} ms over ${ms.length} answers`)
      if (md < TIMING.medianMs) f.push(`Very fast trivia answers: median ${Math.round(md)} ms`)
    }
    // the same short match length again and again
    const dur = this.st.ladder.games.filter((x) => x.winner === a).map((x) => { const m = this.db.matches[x.id]; return m?.startsAt && m.endsAt ? m.endsAt - m.startsAt : 0 }).filter((d) => d > 0)
    if (dur.length >= 6 && stdev(dur) < 1500) f.push(`Near-identical game lengths over ${dur.length} wins`)
    const sig = (this.db as any).signals?.by?.[a]
    if (!sig) f.push('No device or IP on record')
    return f
  }

  nameOf(a: string) { return this.db.profiles[a]?.name ?? a.slice(0, 9) }

  /** Looks up recent chain counterparties for wallets about to be reviewed (cached for a day). */
  async refreshChainLinks(addrs: string[], now = Date.now()) {
    const chain = this.payer ?? this.engine.chain
    for (const a of addrs.slice(0, 80)) {
      const c = this.st.chainLinks[a]
      if (c && now - c.at < 864e5) continue
      const r = await chain.counterparties(a).catch(() => null)
      if (r) this.st.chainLinks[a] = { from: r.from.slice(0, 60), to: r.to.slice(0, 60), at: now }
    }
  }

  /** Turns a ranked list into held prizes. One prize per linked group; a linked duplicate is listed with 0 so the
   *  reviewer sees it. Places nobody qualified for stay in the pool. */
  private holdPlaces(pool: HoldRec['pool'], idBase: string, label: string, ranked: { address: string; points?: number; place?: number }[], amounts: number[], now: number) {
    const { g, why, invite } = this.groups()
    const paidGroups = new Map<string, string>()
    let i = 0
    for (const r of ranked) {
      const grp = g.find(r.address)
      const first = paidGroups.get(grp)
      const place = r.place ?? i + 1
      const nim = r.place ? amounts[r.place - 1] ?? 0 : amounts[i] ?? 0
      if (!first && nim <= 0) break
      const id = `${idBase}:${walletKey(r.address)}`
      if (this.st.holds[id]) { if (!first) { paidGroups.set(grp, r.address); i++ }; continue }
      const flags = this.flagsOf(r.address, why, invite)
      const linkedTo = [...(why.get(r.address) ?? [])].length ? ranked.filter((o) => o.address !== r.address && g.same(o.address, r.address)).map((o) => o.address) : undefined
      if (first) {
        this.st.holds[id] = { id, pool, player: r.address, luna: 0, note: `${label}: linked to ${this.nameOf(first)}, who holds this group's prize`, place, points: r.points, at: now, status: 'withheld', flags, linkedTo, reason: 'Linked wallets share one prize', decidedAt: now }
        continue
      }
      const luna = Math.min(nimToLuna(nim), this.remaining(pool))
      if (luna <= 0) break
      this.st.holds[id] = { id, pool, player: r.address, luna, note: `${label}, place ${place}`, place, points: r.points, at: now, status: 'held', flags, linkedTo }
      paidGroups.set(grp, r.address)
      i++
    }
  }

  /** At the end of each ladder week: rank, check links, and hold the prizes for review. Runs any number of times. */
  async closeWeeks(now = Date.now()) {
    for (let w = 0; w < weekCount(this.window); w++) {
      const key = String(w)
      if (this.st.weeksClosed[key] || now < weekRange(this.window, w).end) continue
      const pool = ladderPool(w)
      const prelim = this.standings(w, now).filter((r) => r.ranked)
      await this.refreshChainLinks(prelim.map((r) => r.address), now)
      if (this.st.weeksClosed[key]) continue
      this.st.weeksClosed[key] = true
      const ranked = this.standings(w, now).filter((r) => r.ranked)
      this.holdPlaces(pool, `lad:${w}`, `Ladder week ${w + 1}`, ranked, LADDER_CURVES_NIM[pool], now)
      this.alert('season', `Ladder week ${w + 1} closed: ${Object.values(this.st.holds).filter((h) => h.id.startsWith(`lad:${w}:`) && h.status === 'held').length} prizes held for review`, now)
      this.engine.store.save()
    }
  }

  // ---------------- invites (season end) ----------------
  /** An invited player counts once they have counted ladder games against INVITES.inviteeGames different eligible
   *  opponents, and are not linked to the person who invited them. */
  inviteeEligible(a: string, g?: Groups) {
    const games = this.st.ladder.games
    const opps = new Map<string, Set<string>>()
    for (const x of games) { for (const [p, q] of [[x.winner, x.loser], [x.loser, x.winner]]) { let s = opps.get(p); if (!s) opps.set(p, (s = new Set())); s.add(q) } }
    const by = this.db.profiles[a]?.invitedBy
    const mine = [...(opps.get(a) ?? [])].filter((o) => (opps.get(o)?.size ?? 0) >= LADDER.eligibleOppMinOpponents && o !== by && !(g && g.same(o, a)))
    return { done: mine.length, need: INVITES.inviteeGames, ok: mine.length >= INVITES.inviteeGames && !(g && by && g.same(a, by)) }
  }

  async closeInvites(now = Date.now()) {
    if (this.st.invitesClosed || now < this.window.end) return
    const inviters = new Map<string, string[]>()
    for (const p of Object.values(this.db.profiles)) if (p.invitedBy) inviters.set(p.invitedBy, [...(inviters.get(p.invitedBy) ?? []), p.address])
    await this.refreshChainLinks([...inviters.keys(), ...[...inviters.values()].flat()], now)
    if (this.st.invitesClosed) return
    this.st.invitesClosed = true
    const { g, why, invite } = this.groups()
    const want: { inviter: string; n: number }[] = []
    for (const [inv, list] of inviters) {
      const n = Math.min(INVITES.maxPerInviter, list.filter((a) => this.inviteeEligible(a, g).ok).length)
      if (n > 0) want.push({ inviter: inv, n })
    }
    const total = want.reduce((s, x) => s + x.n * nimToLuna(INVITES.perInviteNim), 0)
    const scale = total > 0 ? Math.min(1, this.remaining('invite2') / total) : 0
    for (const x of want) {
      const luna = Math.floor(x.n * nimToLuna(INVITES.perInviteNim) * scale)
      if (luna <= 0) continue
      const id = `inv2:${walletKey(x.inviter)}`
      this.st.holds[id] = { id, pool: 'invite2', player: x.inviter, luna, note: `Invites: ${x.n} invited player${x.n > 1 ? 's' : ''} played the ladder${scale < 1 ? ' (shared pro rata)' : ''}`, at: now, status: 'held', flags: this.flagsOf(x.inviter, why, invite) }
    }
    this.alert('season', `Invites closed: ${want.length} inviters held for review`, now)
    this.engine.store.save()
  }

  // ---------------- tournaments ----------------
  createTourney(b: any, now = Date.now()): Tourney {
    const game = String(b?.game) as GameId
    if (!TOURNEY_GAMES.includes(game)) throw bad(`Pick one of: ${TOURNEY_GAMES.join(', ')}`)
    const startsAt = Number(b?.startsAt ?? Date.parse(String(b?.starts)))
    if (!Number.isFinite(startsAt) || startsAt < now + 10 * 60_000) throw bad('Start at least 10 minutes from now')
    const stake = Math.round(Number(b?.stake ?? TOURNEY.defaultStakeNim))
    if (!(stake >= LADDER.minStakeNim && stake <= 100)) throw bad(`The entry stake is ${LADDER.minStakeNim} to 100 NIM per match`)
    const maxPlayers = Math.round(Number(b?.maxPlayers ?? TOURNEY.maxPlayers))
    if (!(maxPlayers >= TOURNEY.minPlayers && maxPlayers <= TOURNEY.maxPlayers)) throw bad(`Between ${TOURNEY.minPlayers} and ${TOURNEY.maxPlayers} players`)
    const live = Object.values(this.st.tourneys).filter((t) => t.status !== 'cancelled')
    if (live.length >= TOURNEY.count) throw bad(`This season has ${TOURNEY.count} tournaments`)
    const id = `t${live.length + 1}-${now.toString(36)}`
    const t: Tourney = { id, name: String(b?.name || `Weekend knockout ${live.length + 1}`).slice(0, 40), game, stake, startsAt, maxPlayers, status: 'open', players: [], devices: {}, flags: {} }
    this.st.tourneys[id] = t
    this.engine.store.save()
    return t
  }

  /** Free to register. A second registration from a device already registered is refused; the same IP is flagged. */
  registerTourney(a: string, id: string, ctx: { dev?: string; ip?: string } = {}, now = Date.now()) {
    const t = this.st.tourneys[id]
    if (!t) throw bad('Tournament not found', 404)
    if (t.status !== 'open' || now >= t.startsAt) throw bad('Registration is closed')
    if (t.players.includes(a)) return this.tourneyView(t, a)
    if (t.players.length >= t.maxPlayers) throw bad('The bracket is full')
    if (!this.db.profiles[a]) throw bad('Sign in first')
    if (ctx.dev) {
      const other = Object.entries(t.devices).find(([x, d]) => d === ctx.dev && x !== a)
      if (other) throw bad('This device already has a player in this tournament')
      t.devices[a] = ctx.dev
    }
    if (ctx.ip) {
      const sig = (this.db as any).signals?.by ?? {}
      const same = t.players.filter((x) => (sig[x]?.ips ?? []).includes(ctx.ip))
      if (same.length) (t.flags[a] ??= []).push(`Same IP as ${same.map((x) => this.nameOf(x)).join(', ')}`)
    }
    t.players.push(a)
    this.engine.store.save()
    return this.tourneyView(t, a)
  }

  unregisterTourney(a: string, id: string, now = Date.now()) {
    const t = this.st.tourneys[id]
    if (!t || t.status !== 'open' || now >= t.startsAt) throw bad('Registration is closed')
    t.players = t.players.filter((x) => x !== a)
    delete t.devices[a]
    this.engine.store.save()
    return this.tourneyView(t, a)
  }

  /** Starts tournaments that are due and moves running ones on: rounds end when every match is done or the deadline passed. */
  async tickTourneys(now = Date.now()) {
    for (const t of Object.values(this.st.tourneys)) {
      if (t.status === 'open' && now >= t.startsAt) {
        if (t.players.length < TOURNEY.minPlayers) { t.status = 'cancelled'; t.note = `Fewer than ${TOURNEY.minPlayers} players registered`; this.engine.store.save(); continue }
        // random seeding, from a cryptographic source
        const order = [...t.players]
        for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]] }
        let size = 2
        while (size < order.length) size *= 2
        const byes = size - order.length
        // the first `byes` players get a bye in round 1
        const matches: NonNullable<Tourney['rounds']>[number]['matches'] = []
        let k = 0
        for (let i = 0; i < size / 2; i++) {
          if (i < byes) matches.push({ a: order[k++], b: null, winner: undefined })
          else matches.push({ a: order[k++], b: order[k++] })
        }
        t.seeds = order
        t.rounds = [{ matches, deadline: now + TOURNEY.roundMinutes * 60_000 }]
        t.status = 'running'
        this.engine.store.save()
        await this.startRound(t, 0)
      } else if (t.status === 'running') await this.advance(t, now)
    }
  }

  private async startRound(t: Tourney, r: number) {
    const round = t.rounds![r]
    for (const [slot, x] of round.matches.entries()) {
      if (x.match || x.winner !== undefined) continue
      if (!x.a || !x.b) { x.winner = x.a ?? x.b ?? null; x.note = 'Bye'; continue }
      try {
        const m = await this.engine.createPaired(x.a, x.b, { game: t.game, stake: t.stake }, { id: t.id, round: r, slot })
        x.match = m.id
      } catch (e: any) {
        x.note = 'Could not start: ' + String(e?.message ?? e).slice(0, 80)
        x.winner = null
      }
    }
    this.engine.store.save()
  }

  /** A tournament match settled or was cancelled. */
  onTourneyMatchEnded(m: MatchRec) {
    if (!m.tourney) return
    const t = this.st.tourneys[m.tourney.id]
    const x = t?.rounds?.[m.tourney.round]?.matches[m.tourney.slot]
    if (!t || !x || x.match !== m.id || x.winner !== undefined) return
    if (m.status === 'settled' && m.settlement?.winner && !m.settlement.draw) x.winner = m.settlement.winner
    else if (m.status === 'settled') {
      // a draw: the faster finish goes through, then the earlier registration
      const r = m.settlement?.ranks ?? []
      const [p, q] = [x.a!, x.b!].map((a) => r.find((y) => y.address === a)?.time ?? Infinity)
      x.winner = p < q ? x.a : q < p ? x.b : t.players.indexOf(x.a!) <= t.players.indexOf(x.b!) ? x.a : x.b
      x.note = 'Draw, faster finish goes through'
    } else {
      // cancelled: whoever locked their stake goes through; if nobody did, nobody does
      const funded = m.players.filter((p) => p.funded && !p.isBot).map((p) => p.player.address)
      x.winner = funded.length === 1 ? funded[0] : null
      x.note = funded.length === 1 ? 'Walkover, the other player did not lock in' : 'Neither player locked in'
    }
    this.engine.store.save()
  }

  private async advance(t: Tourney, now: number) {
    const r = t.rounds!.length - 1
    const round = t.rounds![r]
    for (const x of round.matches) {
      if (x.winner !== undefined || !x.match) continue
      const m = this.db.matches[x.match]
      if (!m) { x.winner = null; continue }
      if (m.status === 'settled' || m.status === 'cancelled') this.onTourneyMatchEnded(m)
      else if (now > round.deadline && (m.status === 'funding' || m.status === 'lobby')) {
        await this.engine.cancelById(m.id, 'Tournament round time is up')
        this.onTourneyMatchEnded(m)
      }
    }
    if (round.matches.some((x) => x.winner === undefined)) return
    const through = round.matches.map((x) => x.winner ?? null)
    // places: losers of this round finish together
    t.places ??= {}
    const placeOf = through.length // 1 match left -> losers are 2nd, 2 -> 3rd-4th, 4 -> 5th-8th
    for (const x of round.matches) for (const p of [x.a, x.b]) if (p && p !== x.winner && t.places[p] === undefined) t.places[p] = placeOf + 1
    if (through.length === 1) {
      if (through[0]) t.places[through[0]] = 1
      t.status = 'done'
      this.finishTourney(t, now)
      return
    }
    const next: NonNullable<Tourney['rounds']>[number]['matches'] = []
    for (let i = 0; i < through.length; i += 2) next.push({ a: through[i], b: through[i + 1] })
    t.rounds!.push({ matches: next, deadline: now + TOURNEY.roundMinutes * 60_000 })
    this.engine.store.save()
    await this.startRound(t, r + 1)
  }

  private finishTourney(t: Tourney, now: number) {
    const places = Object.entries(t.places ?? {}).sort((a, b) => a[1] - b[1])
    const amounts: number[] = [...TOURNEY.places]
    const ranked = places.filter(([, p]) => p <= amounts.length).map(([address, place]) => ({ address, place }))
    // tied places (3rd-4th, 5th-8th) each take the next slot's amount
    const slot: Record<number, number> = {}
    const withSlot = ranked.map((r) => { const s = (slot[r.place] ?? r.place); slot[r.place] = s + 1; return { address: r.address, place: s } })
    this.holdPlaces('tourney', `tour:${t.id}`, t.name, withSlot, amounts, now)
    for (const h of Object.values(this.st.holds)) if (h.id.startsWith(`tour:${t.id}:`)) for (const f of t.flags[h.player] ?? []) if (!h.flags.includes(f)) h.flags.push(f)
    this.alert('season', `${t.name} finished, prizes held for review`, now)
    this.engine.store.save()
  }

  tourneyView(t: Tourney, a?: string) {
    const name = (x: string | null | undefined) => (x ? this.nameOf(x) : '')
    return {
      id: t.id, name: t.name, game: t.game, stake: t.stake, startsAt: t.startsAt, maxPlayers: t.maxPlayers, status: t.status, note: t.note,
      count: t.players.length, registered: !!a && t.players.includes(a),
      prizes: TOURNEY.places.map((n) => nimToLuna(n)),
      rounds: (t.rounds ?? []).map((r) => ({ deadline: r.deadline, matches: r.matches.map((x) => ({ a: name(x.a), b: name(x.b), winner: x.winner === undefined ? undefined : name(x.winner), note: x.note, mine: !!a && (x.a === a || x.b === a), match: !!a && (x.a === a || x.b === a) ? x.match : undefined })) })),
      place: a ? t.places?.[a] : undefined,
    }
  }

  /** The tournament match this player should open now, if any. */
  myTourneyMatch(a: string) {
    for (const t of Object.values(this.st.tourneys)) {
      if (t.status !== 'running') continue
      const r = t.rounds![t.rounds!.length - 1]
      const x = r.matches.find((y) => (y.a === a || y.b === a) && y.match && y.winner === undefined)
      if (x) { const m = this.db.matches[x.match!]; if (m && m.status !== 'settled' && m.status !== 'cancelled') return { id: m.id, tourney: t.name, status: m.status, deadline: r.deadline } }
    }
    return null
  }

  // ---------------- payouts ----------------
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
    if (fresh) { j.startAt = now; j.unlockAt = now + this.engine.planOf(p).lockDays * 864e5 }
  }

  /** Closes weeks, runs tournaments, then (only when not paused) sends queued rewards one at a time. */
  async tick(now = Date.now()) {
    if (this.running) { this.rerun = true; return }
    this.running = true
    this.rerun = false
    try {
      await this.closeWeeks(now)
      await this.closeInvites(now)
      await this.tickTourneys(now)
      if (this.paused) return
      const queue = Object.values(this.st.rewards).filter((r) => r.status === 'queued').sort((a, b) => a.at - b.at)
      if (!queue.length) return
      const today = campaignDay(now)
      let bal = await this.walletBalance(0)
      for (const r of queue) {
        if (this.paused) break
        const legacy = !SEASON2_POOL_SET.has(r.pool) && r.pool !== 'leaderboard' && r.pool !== 'beatnimo'
        if (!r.released) {
          if (!this.payer || bal === null) { r.wait = this.payer ? 'Could not read the campaign wallet' : 'Campaign wallet not set up'; continue }
          if (legacy && (this.st.dayReleased[today] ?? 0) + r.luna > nimToLuna(RULES.dailyCapNim)) { r.wait = 'Daily pace reached, pays tomorrow'; continue }
          const free = bal - this.liabilities().total - Number((this.payer as any).payFee ?? 0)
          if (free < r.luna) { r.wait = 'Waiting for campaign wallet funds'; this.fundsAlert(now); continue }
          r.released = today
          if (legacy) this.st.dayReleased[today] = (this.st.dayReleased[today] ?? 0) + r.luna
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
          if (r.hold && this.st.holds[r.hold]) this.st.holds[r.hold].status = 'paid'
        } catch (e: any) {
          r.status = r.attempts >= 54 ? 'review' : 'queued'
          r.error = String(e?.message ?? e).slice(0, 120)
        }
        this.engine.store.save()
      }
      this.engine.store.save()
    } finally {
      this.running = false
      if (this.rerun) { this.rerun = false; setTimeout(() => void this.tick().catch((e) => console.error('[campaign] tick', e)), 0) }
    }
  }

  private alert(pool: CampaignState['alerts'][number]['pool'], msg: string, now = Date.now()) {
    this.st.alerts.unshift({ at: now, pool, msg })
    this.st.alerts = this.st.alerts.slice(0, 50)
    console.warn('[campaign]', msg)
  }

  private fundsAlert(now: number) {
    const k = 'wallet:' + campaignDay(now)
    if (this.st.alerted[k]) return
    this.st.alerted[k] = true
    this.alert('wallet', 'The campaign wallet is short of funds. Approved prizes are queued until it is topped up', now)
  }

  // ---------------- the player's own view ----------------
  me(a: string, now = Date.now()) {
    const wk = weekIndex(this.window, now)
    const list = wk >= 0 ? this.standings(wk, now) : []
    const mine = list.find((r) => r.address === a)
    const rankedList = list.filter((r) => r.ranked)
    const rank = rankedList.findIndex((r) => r.address === a)
    const prizes = Object.values(this.st.holds).filter((h) => h.player === a && h.luna > 0 && h.status !== 'withheld')
    const legacy = Object.values(this.st.rewards).filter((r) => r.player === a && r.status !== 'cancelled' && !SEASON2_POOL_SET.has(r.pool))
    return {
      name: CAMPAIGN_NAME, live: this.live(now), start: this.window.start, end: this.window.end, paused: this.paused,
      week: {
        index: wk, weeks: weekCount(this.window), endsAt: wk >= 0 ? weekRange(this.window, wk).end : this.window.end,
        paidPlaces: wk >= 0 ? LADDER_CURVES_NIM[ladderPool(wk)].length : 0,
        points: mine?.points ?? 0, games: mine?.games ?? 0, activeDays: mine?.activeDays ?? 0, opponents: mine?.opponents ?? 0,
        ranked: !!mine?.ranked, rank: rank >= 0 ? rank + 1 : 0,
        need: { opponents: LADDER.minOpponents, days: LADDER.minActiveDays, stake: LADDER.minStakeNim, pairPerDay: LADDER.pairPerDay, pairPerSeason: LADDER.pairPerSeason },
      },
      invites: { per: nimToLuna(INVITES.perInviteNim), max: INVITES.maxPerInviter, list: this.invitesOf(a) },
      tourneys: Object.values(this.st.tourneys).filter((t) => t.status !== 'cancelled' || now - t.startsAt < 864e5).sort((x, y) => x.startsAt - y.startsAt).map((t) => this.tourneyView(t, a)),
      tourneyMatch: this.myTourneyMatch(a),
      prizes: prizes.map((h) => ({ note: h.note, luna: h.luna, status: h.status === 'paid' ? 'paid' : 'in review', at: h.at })),
      season1: { total: legacy.reduce((x, r) => x + r.luna, 0), paid: legacy.filter((r) => r.status === 'paid').reduce((x, r) => x + r.wallet, 0) },
      jar: this.jarOf(a, now),
      serverNow: now,
    }
  }

  invitesOf(a: string) {
    return Object.values(this.db.profiles)
      .filter((p) => p.invitedBy === a)
      .map((p) => { const e = this.inviteeEligible(p.address); return { name: p.name, done: Math.min(e.done, e.need), need: e.need, ok: e.ok } })
      .sort((x, y) => Number(y.ok) - Number(x.ok) || y.done - x.done)
      .slice(0, 20)
  }

  /** The weekly ladder as players see it: names and points, never prize amounts or flags. */
  weekBoard(a: string, now = Date.now()) {
    const n = weekCount(this.window)
    let wk = weekIndex(this.window, now)
    if (wk < 0) wk = now >= this.window.end ? n - 1 : -1
    const range = wk >= 0 ? weekRange(this.window, wk) : null
    const all = wk >= 0 ? this.standings(wk, now).filter((r) => r.points > 0) : []
    const row = (r: Standing, i: number) => {
      const p = this.db.profiles[r.address]
      return { rank: r.ranked ? i + 1 : 0, name: p?.name ?? 'Player', avatar: p?.avatar ?? '', frame: p?.frame ?? '', points: r.points, ranked: r.ranked, me: r.address === a }
    }
    const ranked = all.filter((r) => r.ranked)
    const top = Math.max(LADDER_CURVES_NIM.ladder2.length, 30)
    const rows = ranked.slice(0, top).map(row)
    const mi = ranked.findIndex((r) => r.address === a)
    const unr = all.find((r) => !r.ranked && r.address === a)
    return { week: wk, weeks: n, start: range?.start ?? this.window.start, endsAt: range?.end ?? this.window.end, top, live: this.live(now), rows, me: mi >= top ? row(ranked[mi], mi) : unr ? row(unr, 0) : null }
  }

  jarOf(a: string, now = Date.now()) {
    const p = this.db.profiles[a]
    const j = p?.cjar ?? { luna: 0, unlockAt: 0, startAt: 0 }
    const locked = j.luna > 0 && j.unlockAt > now
    const q = locked ? earlyFee(j.luna, j.startAt, j.unlockAt, now) : { fee: 0, pct: 0 }
    return { luna: j.luna, unlockAt: j.unlockAt, locked, early: { fee: q.fee, pct: q.pct, net: j.luna - q.fee } }
  }

  /** Season 1 locked halves follow the jar's normal rules. Paid from the campaign wallet, even while prizes are paused. */
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
    p.cjar = { luna: 0, unlockAt: 0, startAt: 0 }
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
    const pools = POOL_IDS.map((p) => ({ id: p, label: POOL_LABEL[p], legacy: (LEGACY_POOLS as string[]).includes(p), cap: st.caps[p], allocated: p === 'reserve' ? 0 : this.allocated(p), remaining: this.remaining(p) }))
    const rewards = Object.values(st.rewards).sort((a, b) => b.at - a.at)
    const bal = await this.walletBalance()
    const wk = weekIndex(this.window, now)
    const holds = Object.values(st.holds).sort((a, b) => a.pool.localeCompare(b.pool) || (a.place ?? 99) - (b.place ?? 99) || a.at - b.at)
    const days: number[] = []
    for (let i = 0; i < 3; i++) days.push(st.dayReleased[campaignDay(now - i * 864e5)] ?? 0)
    const runway = runwayDays(pools.filter((p) => !p.legacy && p.id !== 'reserve').reduce((s, p) => s + p.remaining, 0), days)
    const orphans = Object.values(this.db.orphans ?? {}).sort((a, b) => b.at - a.at)
    return {
      name: CAMPAIGN_NAME, live: this.live(now), start: this.window.start, end: this.window.end, season: st.v2 ? 2 : 1, migratedAt: st.v2?.at,
      paused: this.paused, pausedBy: this.envPaused ? 'env' : st.paused ? 'admin' : '',
      rules: { ladder: LADDER, curves: LADDER_CURVES_NIM, tourney: TOURNEY, invites: INVITES, timing: TIMING },
      wallet: { address: this.payer?.escrowAddress ?? '', balance: bal, liabilities: this.liabilities(), feesBack: st.feesBack },
      budget: POOL_IDS.reduce((s, p) => s + st.caps[p], 0), budgetCap: nimToLuna(BUDGET_NIM),
      allocated: POOL_IDS.reduce((s, p) => s + (p === 'reserve' ? 0 : this.allocated(p)), 0),
      paid: rewards.filter((r) => r.status === 'paid').reduce((s, r) => s + r.luna, 0),
      pools,
      pace: { runwayDays: Number.isFinite(runway) ? Math.round(runway * 10) / 10 : null, daysLeft: Math.max(0, Math.ceil((this.window.end - now) / 864e5)) },
      counts: {
        held: holds.filter((h) => h.status === 'held').length, approved: holds.filter((h) => h.status === 'approved').length,
        queued: rewards.filter((r) => r.status === 'queued').length, review: rewards.filter((r) => r.status === 'review').length, paid: rewards.filter((r) => r.status === 'paid').length,
      },
      holds: holds.map((h) => ({ ...h, name: this.nameOf(h.player), linkedTo: h.linkedTo?.map((x) => ({ address: x, name: this.nameOf(x) })) })),
      board: wk >= 0 ? this.standings(wk, now).slice(0, 40).map((r) => ({ ...r, name: this.nameOf(r.address) })) : [],
      tourneys: Object.values(st.tourneys).map((t) => ({ ...this.tourneyView(t), flags: t.flags, players: t.players.map((x) => ({ address: x, name: this.nameOf(x) })) })),
      tourneyGames: TOURNEY_GAMES,
      orphans,
      alerts: st.alerts.slice(0, 20),
      payouts: rewards.slice(0, 200),
      serverNow: now,
    }
  }

  async adminSet(b: any, now = Date.now()) {
    const st = this.st
    if (typeof b.paused === 'boolean') st.paused = b.paused
    if (b.moveFromReserve) {
      // shifts budget from the reserve to a season 2 pool; the total never changes
      const pool = b.moveFromReserve.pool as PoolId
      const nim = Number(b.moveFromReserve.nim)
      if (!SEASON2_POOL_SET.has(pool) || pool === 'reserve') throw bad('Pick a season 2 pool')
      if (!(nim > 0)) throw bad('Enter an amount')
      const luna = nimToLuna(nim)
      if (luna > st.caps.reserve) throw bad('The reserve does not have that much')
      st.caps.reserve -= luna
      st.caps[pool] += luna
    }
    const hold = (id: unknown) => { const h = st.holds[String(id)]; if (!h) throw bad('Prize not found', 404); return h }
    if (b.approve) {
      const h = hold(b.approve)
      if (h.status !== 'held' && h.status !== 'withheld') throw bad('Only held or withheld prizes can be approved')
      if (h.luna <= 0) throw bad('This entry has no prize (linked to another wallet)')
      if (h.status === 'withheld' && this.remaining(h.pool) < h.luna) throw bad('That pool no longer has room for this prize')
      h.status = 'approved'; h.decidedAt = now; delete h.reason
    }
    if (b.withhold) {
      const h = hold(b.withhold)
      if (h.status !== 'held' && h.status !== 'approved') throw bad('Only held or approved prizes can be withheld')
      h.status = 'withheld'; h.decidedAt = now; h.reason = String(b.reason || 'Withheld after review').slice(0, 120)
    }
    if (b.payApproved) {
      // one batch: each approved prize becomes a queued payout, paid in full to the wallet. Sent only while not paused
      let n = 0
      for (const h of Object.values(st.holds)) {
        if (h.status !== 'approved' || h.reward) continue
        const id = `s2:${h.id}`
        st.rewards[id] = { id, pool: h.pool, player: h.player, luna: h.luna, wallet: h.luna, jar: 0, note: h.note, at: now, status: 'queued', attempts: 0, hold: h.id }
        h.reward = id
        n++
      }
      if (!n) throw bad('Nothing approved to pay')
      this.alert('season', `${n} approved prizes queued for payout${this.paused ? ' (payouts are paused)' : ''}`, now)
    }
    if (b.createTourney) this.createTourney(b.createTourney, now)
    if (b.cancelTourney) {
      const t = st.tourneys[String(b.cancelTourney)]
      if (!t || t.status !== 'open') throw bad('Only a tournament that has not started can be cancelled')
      t.status = 'cancelled'; t.note = 'Cancelled by the organiser'
    }
    if (b.cancel) {
      const r = st.rewards[String(b.cancel)]
      if (!r || (r.status !== 'queued' && r.status !== 'review') || r.released) throw bad('Only queued rewards that have not been released can be cancelled')
      r.status = 'cancelled'
      if (r.hold && st.holds[r.hold]) { st.holds[r.hold].status = 'withheld'; st.holds[r.hold].reason = 'Payout cancelled'; delete st.holds[r.hold].reward }
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
      r.paidAt = now
      r.tx = typeof b.tx === 'string' ? b.tx.slice(0, 80) : r.tx
      if (r.hold && st.holds[r.hold]) st.holds[r.hold].status = 'paid'
    }
    if (b.refundOrphan) await this.engine.refundOrphan(String(b.refundOrphan))
    if (b.dismissOrphan) this.engine.dismissOrphan(String(b.dismissOrphan))
    this.engine.store.save()
  }
}

/** Season 2 migration. Idempotent: closes the season 1 pools at what they already paid or committed, sets the season 2
 *  pools, puts whatever is left of the 50,000 NIM in the reserve, holds unreleased season 1 rewards for review, and
 *  pauses payouts. Returns a report. */
export function migrateV2(st: CampaignState, allocated: (p: PoolId) => number, now = Date.now()) {
  if (st.v2) return null
  const before = { ...st.caps }
  // season 1 rewards that were earned but not sent yet: hold them for the owner instead of paying them automatically
  let heldLegacy = 0
  for (const r of Object.values(st.rewards)) if (r.status === 'queued' && !r.released) { r.status = 'review'; r.error = 'Held at the season 2 change. Retry to pay it, or cancel it'; heldLegacy++ }
  let legacy = 0
  for (const p of LEGACY_POOLS) { const a = allocated(p); st.caps[p] = a; legacy += a }
  const fixed = (['ladder1', 'ladder2', 'tourney', 'invite2'] as const).reduce((s, p) => s + nimToLuna(SEASON2_CAPS_NIM[p]), 0)
  const left = nimToLuna(BUDGET_NIM) - legacy
  if (left < fixed) {
    // season 1 spent more than planned: scale the season 2 pools down, never the other way round
    const k = Math.max(0, left) / fixed
    for (const p of ['ladder1', 'ladder2', 'tourney', 'invite2'] as const) st.caps[p] = Math.floor(nimToLuna(SEASON2_CAPS_NIM[p]) * k)
    st.caps.reserve = 0
  } else {
    for (const p of ['ladder1', 'ladder2', 'tourney', 'invite2'] as const) st.caps[p] = nimToLuna(SEASON2_CAPS_NIM[p])
    st.caps.reserve = left - fixed
  }
  st.paused = true
  st.v2 = { at: now, legacyAllocated: legacy, reserve: st.caps.reserve }
  st.alerts.unshift({ at: now, pool: 'season', msg: `Season 2 set up: season 1 closed at ${(legacy / LUNA).toFixed(2)} NIM, reserve ${(st.caps.reserve / LUNA).toFixed(2)} NIM, ${heldLegacy} unsent season 1 rewards held, payouts paused` })
  return { before, after: { ...st.caps }, legacyAllocated: legacy, heldLegacy }
}

export const ADMIN_DEFAULT = 'NQ20 9393 TV0B TTL5 R1X1 8DN6 P0CY 3C47 NHGR'
/** Admin wallets: ADMIN_ADDRESSES (comma separated) or the owner's wallet. Exact address match, never a prefix or suffix. */
export function isAdmin(address: string, env: Record<string, string | undefined> = process.env) {
  const list = (env.ADMIN_ADDRESSES ?? ADMIN_DEFAULT).split(',').map((s) => s.trim()).filter(Boolean)
  return list.some((x) => sameAddr(x, address))
}
