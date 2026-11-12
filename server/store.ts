import type { ChessLive } from '../shared/chessgame'
import type { PoolLive } from '../shared/poolgame'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChestRec } from '../shared/rewards'
import type { Payout, PublicMatch, Result, Settlement } from '../shared/types'
import type { Question } from './bank'
import type { SignalDB } from './signals'

export type ProfileRec = {
  address: string
  name: string
  avatar: string
  xp: number
  weekKey: string
  weekXp: number
  wins: number
  played: number
  activeDays: string[] // ISO days (UTC) with a finished match or vault solve
  questDay: string
  questWins: number
  questChestDay: string
  jarLuna: number
  payAddr?: string // where jar withdrawals go when deposits come from a different wallet than the signed-in one
  jarUnlockAt: number
  vaultDay: string // last day the vault puzzle was solved
  vaultDeposits: number
  friends: string[]
  createdAt: number
  plan?: { goalLuna: number; lockDays: number } // the saver's own goal and lock length
  lockStartAt?: number // when the current lock began
  interestDay?: string // the last day the pool paid this saver
  interestLast?: number
  interestWeekKey?: string
  interestWeek?: number
  interestTotal?: number
  chests?: ChestRec[] // earned chests, opened or not
  lvlSeen?: number // the highest level that has already been given its chest
  badges?: string[]
  cosmetics?: string[] // frames and themes unlocked from chests
  frame?: string // worn avatar frame
  theme?: string // worn table theme
  boosts?: { pct: number; until: number }[] // temporary saver pool lifts from chests
  lastSeen?: number // last signed-in API call, for the friends list "online" dot
  friendCode?: string // the player's own add-me code
  friendList?: string[] // accepted friends (both sides accepted)
  friendIn?: string[] // requests waiting for this player to accept
  friendOut?: string[] // requests this player sent
  invitedBy?: string // set once, when a brand new player adds a friend code before their first match
  cjar?: { luna: number; unlockAt: number; startAt: number } // Nimbles Showdown locked rewards, held in the campaign wallet
}

export type MatchRec = Omit<PublicMatch, 'seed' | 'players'> & {
  seed: string
  size: number // players needed
  players: {
    player: { address: string; name: string; avatar: string }
    funded: boolean
    fundTx?: string
    payTo?: string // winnings and refunds go here when the lock was paid from a different wallet than the seat's
    paidFrom?: string // the account that actually paid the lock
    escrowed: number
    result?: Result
    progress?: number
    share?: number
    isBot?: boolean
  }[]
  fundBy?: number
  trivia?: {
    questions: Question[]
    source: string
    verified: boolean
    topic: string
    answers: Record<string, { choice: number; ms: number; correct: boolean; points: number }[]>
    served?: Record<string, number[]> // when the server first showed each question to each player (server-timed answers)
    pip?: { choice: number; ms: number; correct: boolean; points: number }[]
  }
  settlement?: Settlement
  settled?: boolean
  live?: ChessLive | PoolLive
  challengeTo?: string // a direct challenge to one friend
  pipSalt?: string // server-only salt for Nimo's trivia answers, so the public seed cannot predict them
  tourney?: { id: string; round: number; slot: number } // a knockout tournament round
  paying?: Record<string, number> // when each seat said its wallet was sending (the funding window waits a little for it)
  payFails?: Record<string, number> // how many times each seat's wallet failed before sending (Nimiq Pay busy); each gives the seat a little more time, up to a cap
  scannedAt?: number // last time the escrow was scanned for this match's deposits
}

export type OrphanDeposit = { hash: string; match: string; from: string; owner: string | null; luna: number; at: number; why: string; status: 'open' | 'refunded' | 'dismissed'; refundTx?: string; error?: string }

export type DB = {
  profiles: Record<string, ProfileRec>
  tokens: Record<string, string> // legacy never-expiring tokens, no longer accepted
  authSecret?: string // HMAC key for session tokens
  matches: Record<string, MatchRec>
  usedTx: Record<string, string>
  campaign?: unknown // Nimbles Showdown state, owned by server/campaign.ts
  signals?: SignalDB // hashed IPs and device fingerprints per address, server-side only (server/signals.ts)
  /** Deposits that reached the escrow but could not be counted for a seat: a second payment for the same seat, a payment
   *  after the match was cancelled, or a memo for no open match. They wait for the owner to refund them from the admin page. */
  orphans?: Record<string, OrphanDeposit>
  pool?: { luna: number; lastPayDay?: string; paidTotal?: number; feesTotal?: number } // the saver interest pool, held in the escrow wallet like jar balances
  version: 1
  /** Which network this database belongs to. A mainnet server refuses a database that is not stamped mainnet. */
  network?: 'testnet' | 'mainnet'
}

const empty = (): DB => ({ profiles: {}, tokens: {}, matches: {}, usedTx: {}, version: 1 })

export class Store {
  db: DB
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(public dir: string, persist = true, network?: 'testnet' | 'mainnet') {
    this.file = persist ? join(dir, 'db.json') : ''
    if (persist) mkdirSync(dir, { recursive: true })
    this.db = this.file && existsSync(this.file) ? { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) } : empty()
    if (network) {
      const found = this.db.network
      const used = Object.keys(this.db.profiles).length + Object.keys(this.db.matches).length + Object.keys(this.db.usedTx).length > 0
      // an unstamped database is an older testnet or mock one. It may continue on testnet and must never become mainnet money
      if ((found && found !== network) || (network === 'mainnet' && !found && used)) {
        throw new Error(`${this.file || dir} belongs to ${found ?? 'an unstamped (testnet or mock)'} data, but this server runs on ${network}. Refusing to load it. Use a fresh volume or folder for ${network}.`)
      }
      this.db.network = network
    }
  }

  save() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.db))
      renameSync(tmp, this.file)
    }, 300)
  }

  flush() {
    if (!this.file) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.db))
    renameSync(tmp, this.file)
  }
}

export type { Payout }
