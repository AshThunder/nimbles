import { LUNA, type Mode } from './types'

/** Share of the bill each rank pays in Spend mode, best rank first. Always sums to 1. */
export const SPLIT_WEIGHTS: Record<number, number[]> = {
  2: [0.4, 0.6],
  3: [0.2, 0.3, 0.5],
  4: [0.15, 0.2, 0.3, 0.35],
}

export const toLuna = (n: number) => Math.round(n * LUNA)

/**
 * Luna each player must lock in escrow before a match starts.
 * Play: nothing. Save: the stake. Spend: the biggest share they could end up owing
 * (the player who fronted the bill locks nothing, they just receive the settlements).
 */
export function escrowRequired(mode: Mode, stakeNim: number, nPlayers: number, isPayer: boolean): number {
  const lunaAmt = toLuna(stakeNim)
  if (mode === 'play') return 0
  if (mode === 'save') return lunaAmt
  if (isPayer) return 0
  const w = SPLIT_WEIGHTS[Math.max(2, Math.min(4, nPlayers))]
  return Math.ceil(lunaAmt * w[w.length - 1])
}

/** Luna each rank owes, last rank absorbs rounding so the shares add up to the bill exactly. */
export function billShares(stakeNim: number, nPlayers: number, ranks: number[] | null): number[] {
  const total = toLuna(stakeNim)
  const n = Math.max(2, Math.min(4, nPlayers))
  const w = ranks ? SPLIT_WEIGHTS[n] : new Array(n).fill(1 / n)
  const shares = w.map((x) => Math.floor(total * x))
  shares[n - 1] += total - shares.reduce((a, b) => a + b, 0)
  return shares
}
