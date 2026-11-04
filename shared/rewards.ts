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

// ---- chests ----
// A chest never holds NIM. Everything inside is fixed by the chest's kind, so players can read it before they open it.
export type ChestKind = 'win' | 'triple' | 'streak3' | 'streak7' | 'streak30' | 'level'
export type Contents = {
  xp: number
  boost?: { pct: number; hours: number } // a temporary lift to the saver pool share
  badge?: string
  cosmetic?: string // a frame or table theme id
}

export const CHEST_TITLES: Record<ChestKind, string> = {
  win: 'Daily win chest',
  triple: 'Hot hand chest',
  streak3: '3-day streak chest',
  streak7: '7-day streak chest',
  streak30: '30-day streak chest',
  level: 'Level-up chest',
}
export const CHEST_WHY: Record<ChestKind, string> = {
  win: 'You won a duel today',
  triple: 'You won 3 duels in one day',
  streak3: 'You kept a 3-day streak',
  streak7: 'You kept a 7-day streak',
  streak30: 'You kept a 30-day streak',
  level: 'You reached a new level',
}

export function chestContents(kind: ChestKind, level = 0): Contents {
  switch (kind) {
    case 'win': return { xp: 40, boost: { pct: 5, hours: 24 } }
    case 'triple': return { xp: 100, boost: { pct: 10, hours: 48 }, badge: 'hot-hand', cosmetic: 'theme:butter' }
    case 'streak3': return { xp: 75, badge: 'streak-3' }
    case 'streak7': return { xp: 150, badge: 'streak-7', cosmetic: 'theme:lilac' }
    case 'streak30': return { xp: 400, badge: 'streak-30', cosmetic: 'frame:gold' }
    case 'level': return { xp: 60, boost: { pct: 5, hours: 24 }, ...(level > 0 && level % 5 === 0 ? { badge: 'level-' + level } : {}) }
  }
}

export type ChestRec = { id: string; kind: ChestKind; level?: number; at: number; openedAt?: number }

/** The chests a player has earned but not been given yet. Ids are unique per day, per streak run and per level, so nothing is ever given twice. */
export function chestsDue(s: { today: string; wins: number; streak: number; streakStart: string; level: number; lvlSeen: number }): ChestRec[] {
  const at = Date.now()
  const out: ChestRec[] = []
  if (s.wins >= 1) out.push({ id: `win:${s.today}`, kind: 'win', at })
  if (s.wins >= 3) out.push({ id: `triple:${s.today}`, kind: 'triple', at })
  for (const n of [3, 7, 30] as const) if (s.streak >= n) out.push({ id: `streak${n}:${s.streakStart}`, kind: `streak${n}` as ChestKind, at })
  for (let l = s.lvlSeen + 1; l <= s.level; l++) out.push({ id: `lvl:${l}`, kind: 'level', level: l, at })
  return out
}

// ---- cosmetics: flat colours only ----
export type Cosmetic = { id: string; kind: 'frame' | 'theme'; name: string; color: string; tint: string; level?: number; chest?: boolean }
export const COSMETICS: Cosmetic[] = [
  { id: 'theme:sky', kind: 'theme', name: 'Sky', color: '#1F78C4', tint: '#D7E9F8', level: 3 },
  { id: 'theme:mint', kind: 'theme', name: 'Mint', color: '#1F8A5B', tint: '#D3EBDD', level: 6 },
  { id: 'theme:blush', kind: 'theme', name: 'Blush', color: '#D0432E', tint: '#F6D8D1', level: 10 },
  { id: 'theme:lilac', kind: 'theme', name: 'Lilac', color: '#7A4FC4', tint: '#E4DAF6', chest: true },
  { id: 'theme:butter', kind: 'theme', name: 'Butter', color: '#F4B323', tint: '#FBE6AE', chest: true },
  { id: 'frame:blue', kind: 'frame', name: 'Blue frame', color: '#1F78C4', tint: '#D7E9F8', level: 5 },
  { id: 'frame:green', kind: 'frame', name: 'Green frame', color: '#1F8A5B', tint: '#D3EBDD', level: 10 },
  { id: 'frame:coral', kind: 'frame', name: 'Coral frame', color: '#D0432E', tint: '#F6D8D1', level: 15 },
  { id: 'frame:gold', kind: 'frame', name: 'Gold frame', color: '#F4B323', tint: '#FBE6AE', chest: true },
]
export const cosmeticOf = (id: string) => COSMETICS.find((c) => c.id === id)

export type BadgeDef = { id: string; name: string; why: string; icon: string }
export const BADGES: BadgeDef[] = [
  { id: 'hot-hand', name: 'Hot hand', why: 'Won 3 duels in a day', icon: 'bolt' },
  { id: 'streak-3', name: '3-day streak', why: 'Kept a 3-day streak', icon: 'flame-lit' },
  { id: 'streak-7', name: '7-day streak', why: 'Kept a 7-day streak', icon: 'flame-hot' },
  { id: 'streak-30', name: '30-day streak', why: 'Kept a 30-day streak', icon: 'crown' },
  { id: 'level-5', name: 'Level 5', why: 'Reached level 5', icon: 'gem-blue' },
  { id: 'level-10', name: 'Level 10', why: 'Reached level 10', icon: 'gem-green' },
  { id: 'level-15', name: 'Level 15', why: 'Reached level 15', icon: 'gem-coral' },
  { id: 'level-20', name: 'Level 20', why: 'Reached level 20', icon: 'trophy-silver' },
  { id: 'level-25', name: 'Level 25', why: 'Reached level 25', icon: 'trophy-gold' },
]
export const badgeOf = (id: string) => [...DERIVED_BADGES, ...BADGES].find((b) => b.id === id) ?? { id, name: id.replace('level-', 'Level '), why: 'Reached a high level', icon: 'trophy-gold' }

// ---- XP boosts ----
/** Match XP grows with a running streak and with a locked jar. Both are plain percentages, so the same play always earns the same. */
export const streakXpPct = (streak: number) => (streak >= 30 ? 30 : streak >= 7 ? 20 : streak >= 3 ? 10 : 0)
export const LOCK_XP_PCT: Record<number, number> = { 7: 5, 30: 10, 90: 20 }
export const lockXpPct = (lockDays: number, locked: boolean) => (locked ? LOCK_XP_PCT[lockDays] ?? 0 : 0)
export const withXpBonus = (base: number, pct: number) => base + Math.floor((base * pct) / 100)

// ---- badges earned by playing ----
export const DERIVED_BADGES: BadgeDef[] = [
  { id: 'first-win', name: 'First win', why: 'Won your first duel', icon: 'medal-bronze' },
  { id: 'wins-10', name: '10 wins', why: 'Won 10 duels', icon: 'medal-silver' },
  { id: 'wins-50', name: '50 wins', why: 'Won 50 duels', icon: 'medal-gold' },
  { id: 'saver', name: 'Saver', why: 'Put NIM in your jar', icon: 'jar' },
]
export const derivedBadges = (s: { wins: number; saved: boolean }) => [
  ...(s.wins >= 1 ? ['first-win'] : []),
  ...(s.wins >= 10 ? ['wins-10'] : []),
  ...(s.wins >= 50 ? ['wins-50'] : []),
  ...(s.saved ? ['saver'] : []),
]
export const ALL_BADGES = (): BadgeDef[] => [...DERIVED_BADGES, ...BADGES]

/** Everything a player may wear: unlocked by level, plus whatever chests gave them. */
export const unlockedCosmetics = (level: number, fromChests: string[]) =>
  COSMETICS.filter((c) => (c.level !== undefined && level >= c.level) || fromChests.includes(c.id)).map((c) => c.id)
