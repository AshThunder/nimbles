// Nimbles Showdown, season 2 rules. Skill only: no dice, no draws, no random prizes.
// Everything here is pure, so the server and the tests share one source of truth.
//
// Season 2 (from Nov 11, 2026) ends every instant reward. NIM is only earned from staked games against real players,
// ranked on a weekly ladder, plus two weekend knockout tournaments and invites that pay at season end. Every prize is
// HELD for the owner's review first, then paid in one batch. Playing Nimo stays free and pays no NIM.
import { LUNA } from './types'

/** The campaign's name lives here and only here. */
export const CAMPAIGN_NAME = 'Nimbles Showdown'

/** Season 1 pools stay in the data as history (they are closed: their caps equal what they already paid).
 *  Season 2 pools: ladder week 1, ladder week 2, tournaments, invites (paid at season end), reserve. */
export type LegacyPoolId = 'welcome' | 'friend' | 'invite' | 'leaderboard' | 'nimo' | 'beatnimo'
export type PoolId = LegacyPoolId | 'reserve' | 'ladder1' | 'ladder2' | 'tourney' | 'invite2'
export const LEGACY_POOLS: LegacyPoolId[] = ['welcome', 'friend', 'invite', 'leaderboard', 'nimo', 'beatnimo']
export const SEASON2_POOLS = ['ladder1', 'ladder2', 'tourney', 'invite2', 'reserve'] as const
export const POOL_IDS: PoolId[] = [...LEGACY_POOLS, ...SEASON2_POOLS]
export const POOL_LABEL: Record<PoolId, string> = {
  welcome: 'Welcome (closed)', friend: 'Friend duels (closed)', invite: 'Invites, season 1 (closed)', leaderboard: 'Weekly leaderboard, season 1 (closed)',
  nimo: 'Nimo Hard wins (closed)', beatnimo: 'First Win Bonus (closed)',
  ladder1: 'Ladder week 1', ladder2: 'Ladder week 2', tourney: 'Weekend tournaments', invite2: 'Invites (season end)', reserve: 'Reserve',
}

/** The whole budget, 50,000 NIM, never grows. */
export const BUDGET_NIM = 50_000
/** Season 2 split of what season 1 left (43,876 NIM). The 136 NIM owed to jars is ring-fenced separately (it is a
 *  liability of the campaign wallet, never part of a pool). */
export const SEASON2_CAPS_NIM = { ladder1: 8_000, ladder2: 14_000, tourney: 8_000, invite2: 2_000, reserve: 11_876 } as const
export const SEASON2_TOTAL_NIM = Object.values(SEASON2_CAPS_NIM).reduce((a, b) => a + b, 0) // 43,876
/** What season 1 had paid (or committed) when it was closed. Used only as the expected figure in the migration report. */
export const SEASON1_SPENT_NIM = BUDGET_NIM - SEASON2_TOTAL_NIM // 6,124

/** Season 1 caps, kept so a brand new database (tests, dev) starts from the same place production did. */
export const SEASON1_CAPS_NIM: Record<LegacyPoolId | 'reserve', number> = { welcome: 5_000, friend: 20_000, invite: 5_000, leaderboard: 12_000, nimo: 3_000, reserve: 0, beatnimo: 5_000 }

/** One key per wallet, whatever spacing or case the address arrives in. */
export const walletKey = (a: string) => a.replace(/\s+/g, '').toUpperCase()

export const LADDER = {
  minStakeNim: 10, // staked games below this never count
  pairPerDay: 2, // counted games per pair per campaign day
  pairPerSeason: 6, // counted games per pair for the whole season
  minOpponents: 5, // distinct eligible opponents (season) to be ranked
  minActiveDays: 3, // days with a counted game, in the week being ranked
  eligibleOppMinOpponents: 3, // an opponent is "eligible" once they have faced this many different players
  trustFullAt: 5, // an opponent with this many different opponents gives full weight
  newOpponentGames: 3, // an opponent with fewer counted games than this is "new"
  newOpponentWeight: 0.3,
  repeatWeights: [1, 0.6, 0.35, 0.2, 0.1, 0.05], // 1st, 2nd... counted game against the same opponent this season
  basePoints: 10,
  k: 24, // rating step
  startRating: 1000,
  componentFull: 8, // a group of players that only ever play each other counts fully once it has this many people
} as const

/** Fixed payout curves, 1st first, in NIM. Week 1 pays 25 places, week 2 pays 30. They add up to the pools exactly. */
export const LADDER_CURVES_NIM: Record<'ladder1' | 'ladder2', number[]> = {
  ladder1: [960, 765, 635, 545, 480, 425, 380, 345, 320, 295, 275, 255, 240, 225, 210, 200, 190, 180, 175, 165, 160, 155, 145, 140, 135],
  ladder2: [1555, 1240, 1035, 885, 775, 690, 620, 565, 515, 475, 445, 415, 390, 365, 345, 325, 310, 295, 280, 270, 260, 250, 240, 230, 220, 215, 205, 200, 195, 190],
}
export const ladderPool = (week: number): 'ladder1' | 'ladder2' => (week <= 0 ? 'ladder1' : 'ladder2')

/** Knockout tournaments: 4,000 NIM each. 1st, 2nd, the two semi-final losers, the four quarter-final losers. */
export const TOURNEY = {
  count: 2,
  prizeNim: 4_000,
  places: [1600, 900, 400, 400, 175, 175, 175, 175], // by finishing place: 1, 2, 3-4, 5-8
  minPlayers: 4,
  maxPlayers: 32,
  defaultStakeNim: 10,
  roundMinutes: 20, // each round's deadline; a player who does not lock or finish loses that round
} as const

export const INVITES = {
  perInviteNim: 50,
  maxPerInviter: 5,
  inviteeGames: 5, // counted staked games against different eligible opponents
} as const

/** Robotic-timing flags (shown to the admin, never automatic). */
export const TIMING = {
  minAnswers: 10,
  spreadMs: 150, // trivia answers with less spread than this look scripted
  medianMs: 700, // a median answer under this is faster than people read
} as const

export const RULES = {
  dailyCapNim: 3_000, // legacy daily pace for the closed season 1 pools (queued season 1 rewards only)
  alertPct: 20,
} as const

/** Every season 1 reward was split: half to the wallet now, half locked in the Savings Jar. Season 2 prizes are paid in full. */
export function splitReward(luna: number): { wallet: number; jar: number } {
  const wallet = Math.floor(Math.max(0, luna) / 2)
  return { wallet, jar: Math.max(0, luna) - wallet }
}

export type Window = { start: number; end: number }
/** Dates come from env (ISO with offset), defaulting to Nov 9 to Nov 23, 2026, WAT. `end` is exclusive (the start of Nov 24 WAT). */
export function campaignWindow(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): Window {
  const start = Date.parse(env.CAMPAIGN_START || '2026-11-09T00:00:00+01:00')
  const end = Date.parse(env.CAMPAIGN_END || '2026-11-24T00:00:00+01:00')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('CAMPAIGN_START and CAMPAIGN_END must be ISO dates with start before end')
  return { start, end }
}
export const isLive = (w: Window, now = Date.now()) => now >= w.start && now < w.end

/** Ladder weeks: 7 days from the start; the last week runs to the end. Returns -1 outside the campaign. */
export function weekIndex(w: Window, now = Date.now()): number {
  if (!isLive(w, now)) return -1
  const weeks = weekCount(w)
  return Math.min(weeks - 1, Math.floor((now - w.start) / (7 * 864e5)))
}
export const weekCount = (w: Window) => Math.max(1, Math.floor((w.end - w.start) / (7 * 864e5)))
export function weekRange(w: Window, i: number): Window {
  const start = w.start + i * 7 * 864e5
  return { start, end: i >= weekCount(w) - 1 ? w.end : start + 7 * 864e5 }
}

/** Day key in WAT (UTC+1), so a campaign day matches the organiser's calendar. */
export const campaignDay = (t = Date.now()) => new Date(t + 36e5).toISOString().slice(0, 10)

/** Elo expectation that `a` beats `b`. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400))

/** Weight of one counted win at the time it is played: beating a stronger player is worth more, a weaker one less,
 *  a repeat opponent and a brand new opponent count little. */
export function winWeight(o: { winnerRating: number; loserRating: number; repeat: number; loserGames: number }) {
  const elo = 2 * (1 - expected(o.winnerRating, o.loserRating)) // 0..2, 1 for equal ratings
  const rep = LADDER.repeatWeights[Math.min(o.repeat, LADDER.repeatWeights.length - 1)]
  const fresh = o.loserGames < LADDER.newOpponentGames ? LADDER.newOpponentWeight : 1
  return elo * rep * fresh
}

/** Opponent trust at payout time: someone who has only played one or two people is worth little. */
export const trustOf = (distinctOpponents: number) => Math.max(0.05, Math.min(1, (distinctOpponents - 1) / (LADDER.trustFullAt - 1)))
/** A self-contained group of players (nobody outside it ever played them) counts in proportion to its size. */
export const componentFactor = (size: number) => Math.max(0.1, Math.min(1, size / LADDER.componentFull))

/** Days the remaining budget lasts at the recent pace. Infinity when nothing is being paid. */
export function runwayDays(remainingLuna: number, paidLastDaysLuna: number[]): number {
  const days = paidLastDaysLuna.length || 1
  const pace = paidLastDaysLuna.reduce((a, b) => a + b, 0) / days
  return pace > 0 ? remainingLuna / pace : Infinity
}

export const nimToLuna = (n: number) => Math.round(n * LUNA)
