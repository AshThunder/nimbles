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
export function escrowRequired(mode: Mode, stakeNim: number, loserPct = 100): number {
  if (mode === 'play') return 0
  if (mode === 'save' || mode === 'win') return toLuna(stakeNim)
  return settleShares(stakeNim, loserPct).loser
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
