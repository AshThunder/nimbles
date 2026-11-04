import type { ChessLive } from '../shared/chessgame'
import type { PoolLive } from '../shared/poolgame'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Payout, PublicMatch, Result, Settlement } from '../shared/types'
import type { Question } from './bank'

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
    pip?: { choice: number; ms: number; correct: boolean; points: number }[]
  }
  settlement?: Settlement
  settled?: boolean
  live?: ChessLive | PoolLive
}

export type DB = {
  profiles: Record<string, ProfileRec>
  tokens: Record<string, string>
  matches: Record<string, MatchRec>
  usedTx: Record<string, string>
  pool?: { luna: number; lastPayDay?: string; paidTotal?: number; feesTotal?: number } // the saver interest pool, held in the escrow wallet like jar balances
  version: 1
}

const empty = (): DB => ({ profiles: {}, tokens: {}, matches: {}, usedTx: {}, version: 1 })

export class Store {
  db: DB
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(public dir: string, persist = true) {
    this.file = persist ? join(dir, 'db.json') : ''
    if (persist) mkdirSync(dir, { recursive: true })
    this.db = this.file && existsSync(this.file) ? { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) } : empty()
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
