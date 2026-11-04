import { LUNA, type Mode } from './types'

export const toLuna = (n: number) => Math.round(n * LUNA)

/** The split presets offered when two friends settle a bill. The loser pays this share, the winner pays the rest. */
export const SETTLE_PRESETS = [100, 70] as const
export const clampPct = (n: number) => Math.max(50, Math.min(100, Math.round(Number(n) || 0)))

/** Luna the loser and the winner owe. They always add up to the bill exactly. */
export function settleShares(billNim: number, loserPct: number): { total: number; loser: number; winner: number } {
  const total = toLuna(billNim)
  const loser = Math.round((total * clampPct(loserPct)) / 100)
  return { total, loser, winner: total - loser }
}

/** Each player's share when the game ends level: half the bill each, the odd luna goes to seat 0. */
export function drawShares(billNim: number): [number, number] {
  const total = toLuna(billNim)
  const a = Math.ceil(total / 2)
  return [a, total - a]
}

/**
 * Luna each player must lock in escrow before a match starts.
 * Play: nothing. Win and Save: the stake. Settle: the most they could owe, which is the loser's share.
 */
export function escrowRequired(mode: Mode, stakeNim: number, loserPct = 100, placeOf = 0): number {
  if (mode === 'play') return 0
  if (mode === 'save' || mode === 'win') return toLuna(stakeNim)
  if (placeOf >= 2) return Math.max(...placeShares(stakeNim, placeOf)) // placement split: anyone could finish last
  return settleShares(stakeNim, loserPct).loser
}

/**
 * Splat Royale Settle: the share of the bill each place pays, in percent, first place first.
 * Last place pays the most and the winner the least. Every row adds up to 100.
 */
export const PLACE_SPLIT: Record<number, number[]> = {
  2: [30, 70],
  3: [20, 30, 50],
  4: [10, 20, 30, 40],
  5: [6, 12, 18, 26, 38],
  6: [4, 8, 13, 20, 25, 30],
}
export const placePcts = (players: number): number[] => PLACE_SPLIT[Math.max(2, Math.min(6, Math.round(players)))]

/** Luna each place owes, first place first. They always add up to the bill exactly: the last place takes the rounding. */
export function placeShares(billNim: number, players: number): number[] {
  const pcts = placePcts(players)
  const total = toLuna(billNim)
  const out = pcts.map((p) => Math.floor((total * p) / 100))
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0)
  return out
}

/** A draw in a placement settle: everyone pays the same. The odd luna go to the first seats. */
export function evenShares(billNim: number, players: number): number[] {
  const total = toLuna(billNim)
  const base = Math.floor(total / players)
  const extra = total - base * players
  return Array.from({ length: players }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Splat Royale Save payouts, in luna. 'wta' gives the winner everything; 'top3' is 60/30/10 with the rounding going to 1st.
 * With two players there is no 2nd or 3rd pot, so top3 is the same as winner takes all. */
export type Payout3 = 'wta' | 'top3'
export function splatShares(net: number, preset: Payout3, players: number): number[] {
  if (preset !== 'top3' || players < 3) return [net]
  const second = Math.floor((net * 30) / 100)
  const third = Math.floor((net * 10) / 100)
  return [net - second - third, second, third]
}
