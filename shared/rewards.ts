import { LUNA } from './types'

// ---- savings plan ----
export const LOCK_TIERS = [7, 30, 90] as const
export type LockDays = (typeof LOCK_TIERS)[number]
export const DEFAULT_GOAL_LUNA = 100 * LUNA
export const MAX_GOAL_NIM = 1_000_000
/** Unlocking early costs this share of the jar at the start of the lock, shrinking in a straight line to zero at the end. */
export const EARLY_FEE_MAX = 0.1

export type Plan = { goalLuna: number; lockDays: LockDays; lockStartAt: number }

export const isTier = (n: unknown): n is LockDays => (LOCK_TIERS as readonly number[]).includes(Number(n))

/** The early unlock fee for a jar. 10% at the start of the lock, 0 once it ends. Always a whole number of luna, never negative. */
export function earlyFee(jarLuna: number, lockStartAt: number, unlockAt: number, now = Date.now()) {
  const total = unlockAt - lockStartAt
  if (jarLuna <= 0 || now >= unlockAt || total <= 0) return { fee: 0, pct: 0 }
  const left = Math.min(1, Math.max(0, (unlockAt - now) / total))
  const pct = EARLY_FEE_MAX * left
  return { fee: Math.max(0, Math.min(jarLuna, Math.floor(jarLuna * pct))), pct }
}

// ---- saver interest pool ----
/** Every Save win puts this share of the pot in the pool, up to the cap. */
export const POOL_FEE_PCT = 0.02
export const POOL_FEE_CAP = 1 * LUNA
/** Each UTC day the pool pays out this share of itself, never more than the cap. */
export const POOL_DAILY_PCT = 0.05
export const POOL_DAILY_CAP = 2 * LUNA

export const saveFee = (pot: number) => Math.max(0, Math.min(POOL_FEE_CAP, Math.floor(pot * POOL_FEE_PCT)))

/** XP boost for savers: +5% of share for every 5 levels, up to +25%. */
export const SAVER_BOOST_STEP = 5
export const SAVER_BOOST_MAX = 25
export const levelBoostPct = (level: number) => Math.min(SAVER_BOOST_MAX, Math.floor(Math.max(0, level) / 5) * SAVER_BOOST_STEP)
/** Boosts from level and chests together never pass this. */
export const BOOST_TOTAL_MAX = 40

/** A saver's weight: balance times lock days, lifted by their boost. Whole numbers. */
export const poolWeight = (jarLuna: number, lockDays: number, boostPct: number) =>
  jarLuna > 0 ? BigInt(Math.floor(jarLuna)) * BigInt(lockDays) * BigInt(100 + Math.max(0, Math.min(BOOST_TOTAL_MAX, boostPct))) : 0n

/** Splits one day's payout in proportion to weight. Floors every share, so the total never goes past the day's amount or the pool. */
export function poolDay(poolLuna: number, weights: Record<string, bigint>, cap = POOL_DAILY_CAP, pct = POOL_DAILY_PCT) {
  const day = Math.max(0, Math.min(cap, Math.floor(poolLuna * pct), poolLuna))
  const total = Object.values(weights).reduce((s, w) => s + w, 0n)
  const shares: Record<string, number> = {}
  let paid = 0
  if (day > 0 && total > 0n) {
    for (const [a, w] of Object.entries(weights)) {
      const s = Number((BigInt(day) * w) / total)
      if (s > 0) {
        shares[a] = s
        paid += s
      }
    }
  }
  return { day, shares, paid }
}
