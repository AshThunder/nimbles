// Nimbles Showdown: fixed, skill-only rewards. No dice, no draws, no random prizes.
// Everything here is pure, so the server and the tests share one source of truth.
import { LUNA } from './types'

/** The campaign's name lives here and only here. */
export const CAMPAIGN_NAME = 'Nimbles Showdown'

export type PoolId = 'welcome' | 'friend' | 'invite' | 'leaderboard' | 'nimo' | 'reserve'
export const POOL_IDS: PoolId[] = ['welcome', 'friend', 'invite', 'leaderboard', 'nimo', 'reserve']
export const POOL_LABEL: Record<PoolId, string> = {
  welcome: 'Welcome', friend: 'Friend duels', invite: 'Invites', leaderboard: 'Weekly leaderboard', nimo: 'Nimo Hard wins', reserve: 'Reserve',
}

/** NIM per pool. They add up to the whole budget, so no rule can ever pay more than the budget in total. */
export const POOL_CAPS_NIM: Record<PoolId, number> = { welcome: 5_000, friend: 20_000, invite: 5_000, leaderboard: 12_000, nimo: 5_000, reserve: 3_000 }
export const BUDGET_NIM = Object.values(POOL_CAPS_NIM).reduce((a, b) => a + b, 0) // 50,000

/** Reward amounts in NIM. The admin can change these at runtime; the caps below cannot be raised past the budget. */
export type Amounts = { welcome: number; friend: number; invite: number; nimo: number }
export const DEFAULT_AMOUNTS: Amounts = { welcome: 50, friend: 20, invite: 100, nimo: 2 }
/** Upper bounds for the admin controls, so a typo cannot pay 2,000 NIM a win. */
export const MAX_AMOUNTS: Amounts = { welcome: 200, friend: 100, invite: 300, nimo: 10 }

export const RULES = {
  welcomeMatches: 3, // finished matches before the welcome reward
  welcomeMinHuman: 1, // of those, at least this many against a real player
  friendMinStakeNim: 1,
  friendPairPerDay: 3, // rewarded friend duels per pair per day
  friendMinOpponents: 3, // distinct real opponents faced before friend duel rewards unlock
  inviteMatches: 5, // matches the invitee must finish
  inviteMinHuman: 1, // of those, at least this many against a real player
  inviteMax: 5, // rewarded invites per inviter
  nimoPerDay: 10,
  nimoLifetimeNim: 150,
  playerCapNim: 1_000, // hard cap per player across every pool
  dailyCapNim: 3_000, // global pace for everything except the weekly leaderboard
  leaderboardTop: 20,
  alertPct: 20, // alert when a pool has less than this share left
} as const

/** Weekly leaderboard tiers, 1st first. Fixed, and they add up to exactly 6,000 NIM a week. */
export const LEADERBOARD_TIERS_NIM = [1000, 800, 600, 600, 400, 350, 300, 250, 225, 200, 175, 150, 150, 125, 125, 125, 125, 100, 100, 100]
export const LEADERBOARD_WEEK_NIM = LEADERBOARD_TIERS_NIM.reduce((a, b) => a + b, 0)

/** Every reward is split: half to the wallet now, half locked in the Savings Jar. The odd luna goes to the jar. */
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

/** Leaderboard weeks: 7 days from the start; the last week runs to the end. Returns -1 outside the campaign. */
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

/** Leaderboard order: more wins first; a tie goes to whoever reached that number of wins first. Deterministic, no luck. */
export function rankBoard(rows: { address: string; wins: number; reachedAt: number }[]) {
  return [...rows].filter((r) => r.wins > 0).sort((a, b) => b.wins - a.wins || a.reachedAt - b.reachedAt || (a.address < b.address ? -1 : 1))
}

/** Days the remaining non-leaderboard budget lasts at the recent pace. Infinity when nothing is being paid. */
export function runwayDays(remainingLuna: number, paidLastDaysLuna: number[], ): number {
  const days = paidLastDaysLuna.length || 1
  const pace = paidLastDaysLuna.reduce((a, b) => a + b, 0) / days
  return pace > 0 ? remainingLuna / pace : Infinity
}

export const nimToLuna = (n: number) => Math.round(n * LUNA)
