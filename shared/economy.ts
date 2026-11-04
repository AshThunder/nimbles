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
 * Play: nothing. Save: the stake. Settle: the most they could owe, which is the loser's share.
 */
export function escrowRequired(mode: Mode, stakeNim: number, loserPct = 100): number {
  if (mode === 'play') return 0
  if (mode === 'save') return toLuna(stakeNim)
  return settleShares(stakeNim, loserPct).loser
}
