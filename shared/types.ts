export type GameId = 'trivia' | 'solitaire' | 'chess' | 'pool' | 'sudoku' | 'bubble' | 'word' | 'lastbite'
export type Mode = 'play' | 'save' | 'settle'
export type OppKind = 'invite' | 'auto' | 'pip'
export type PipLevel = 'easy' | 'med' | 'hard'

export const LUNA = 100_000 // 1 NIM = 100,000 luna

export const GAMES: Record<GameId, { name: string; blurb: string; tag?: 'Hot' | 'New'; minutes: string; level: number; maxPlayers: number }> = {
  trivia: { name: 'AI Trivia Duel', blurb: 'Any topic', tag: 'Hot', minutes: '2 min', level: 5, maxPlayers: 2 },
  solitaire: { name: 'Solitaire Duel', blurb: 'Same deal', minutes: '3 min', level: 4, maxPlayers: 2 },
  chess: { name: 'Chess Blitz', blurb: '3 min', minutes: '3 min', level: 2, maxPlayers: 2 },
  pool: { name: '8-Ball Pool', blurb: 'Live duel', tag: 'New', minutes: '3 min', level: 1, maxPlayers: 2 },
  sudoku: { name: 'Sudoku', blurb: 'Race a grid', minutes: '3 min', level: 6, maxPlayers: 2 },
  bubble: { name: 'Bubble Shooter', blurb: '90 sec', tag: 'Hot', minutes: '90 sec', level: 3, maxPlayers: 2 },
  word: { name: 'Word Rush', blurb: 'Same letters', tag: 'New', minutes: '1 min', level: 1, maxPlayers: 2 },
  lastbite: { name: 'Last Bite', blurb: 'Quick 4x4 sprint', minutes: '2 min', level: 2, maxPlayers: 2 },
}

export const STAKES = [1, 2, 5, 10] as const

export type Player = { address: string; name: string; avatar: string }

export type Result = { score: number; time: number; detail?: unknown }

export type MatchStatus =
  | 'lobby' // waiting for opponent(s)
  | 'terms' // Settle: both players are in, agreeing the bill, payee and split
  | 'funding' // opponent present, collecting escrow deposits
  | 'ready' // everyone funded, countdown
  | 'playing'
  | 'settled'
  | 'cancelled'

export type PublicMatch = {
  id: string
  code: string
  game: GameId
  mode: Mode
  opp: OppKind
  pipLevel?: PipLevel
  stake: number // NIM per player (Settle: the whole bill in NIM)
  status: MatchStatus
  host: string
  players: { player: Player; funded: boolean; result?: Result; progress?: number; share?: number; paidFrom?: string }[]
  seedCommit: string // sha256(seed), published before play
  seed?: string // revealed once playing
  config: Record<string, unknown>
  startsAt?: number
  endsAt?: number
  settlement?: Settlement
  terms?: SettleTerms
  escrow: { address: string; network: string; memo: string }
  createdAt: number
}

/** Who receives the bill: one of the two players (by seat) or any other wallet address. */
export type Payee = { seat: 0 | 1 } | { address: string }

/** Settle: what both friends agree to before anything is locked. Changing any field clears the other side's agreement. */
export type SettleTerms = {
  bill: number // NIM
  loserPct: number // 50..100: share of the bill the loser pays, the winner pays the rest. A draw splits 50/50
  payee: Payee
  agreed: string[] // addresses that agreed to this exact revision
  proposedBy: string
  rev: number
  lock?: number // luna each player locks (the most they could owe), filled in by the server view
}

/** `for` is the seat the money belongs to, when it was paid out to a different address than the seat's own */
export type Payout = { to: string; for?: string; luna: number; kind: 'prize' | 'refund' | 'settle' | 'jar'; tx?: string; note?: string }

export type Settlement = {
  winner?: string
  draw?: boolean
  ranks: { address: string; rank: number; score: number; time: number }[]
  payouts: Payout[]
  xp: Record<string, number>
  jarCredit: Record<string, number>
  fee?: number // the saver pool's share of the pot
  xpBonus?: Record<string, number> // percent added to each player's XP from streak and lock
  reason: string
}

export type Profile = {
  address: string
  name: string
  avatar: string
  xp: number
  level: number
  levelXp: number
  nextXp: number
  streak: number
  lastStreakDay: string
  streakDays: string[]
  wins: number
  played: number
  jarLuna: number
  jarUnlockAt: number
  plan: { goalLuna: number; lockDays: 7 | 30 | 90; lockStartAt: number }
  questWins: number
  questDay: string
  weekXp: number
  chests: number // earned and not opened yet
  badges: string[]
  unlocked: string[] // frames and themes the player may wear
  style: { frame: string; theme: string }
}

export function levelFor(xp: number) {
  // level n needs 100*n*(n+1)/2 ... gentle curve; level 1 at 0 xp
  let level = 1
  let need = 300
  let base = 0
  while (xp >= base + need) {
    base += need
    level++
    need = 300 + (level - 1) * 100
  }
  return { level, levelXp: xp - base, nextXp: need }
}

export const nim = (luna: number) => luna / LUNA
export const fmtNim = (luna: number) => {
  const v = luna / LUNA
  return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })
}
