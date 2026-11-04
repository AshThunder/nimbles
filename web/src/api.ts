import type { ChessLive } from '../../shared/chessgame'
import type { PoolLive } from '../../shared/poolgame'
import type { Profile, PublicMatch } from '../../shared/types'

let token = sessionStorage.getItem('nb:token') ?? ''
export const setToken = (t: string) => {
  token = t
  sessionStorage.setItem('nb:token', t)
}

export class ApiErr extends Error {
  constructor(public status: number, msg: string) {
    super(msg)
  }
}

let serverSkew = 0
export const serverNow = () => Date.now() + serverSkew

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiErr(0, 'Cannot reach the Nimbles server. Check your connection')
  }
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiErr(res.status, j?.error || j?.message || `Request failed (${res.status})`)
  if (typeof j?.serverNow === 'number') serverSkew = j.serverNow - Date.now()
  return j as T
}

/** Last pool shot number each match has already animated, so the server only sends the ball paths once */
export const liveSeen: Record<string, number> = {}
export type Config = { chain: 'mock' | 'nimiq'; network: 'testnet' | 'mainnet'; escrow: string; lockDays: number; ai: { gemini: boolean; model: string | null }; mock: boolean; serverNow: number }
export type Row = { rank: number; address: string; name: string; avatar: string; weekXp: number; level: number; me: boolean }
export type MatchView = Omit<PublicMatch, 'players'> & {
  size?: number
  fundBy?: number
  serverNow?: number
  pending?: boolean
  pendingReason?: string
  live?: ChessLive | PoolLive
  trivia?: {
    topic: string; source?: string; verified?: boolean; count?: number; qMs?: number
    questions?: { q: string; options: string[]; category: string; answer?: number; fact?: string }[]
    mine?: { choice: number; ms: number; correct: boolean; points: number }[]
    pip?: { choice: number; ms: number; correct: boolean; points: number }[]
  }
  players: (PublicMatch['players'][number] & { escrowed?: number; isBot?: boolean })[]
}

export const api = {
  config: () => call<Config>('GET', '/config'),
  challenge: () => call<{ nonce: string; message: string }>('GET', '/auth/challenge'),
  session: (address: string, name?: string, avatar?: string, proof?: { nonce: string; publicKey: string; signature: string }) =>
    call<{ token: string; verified: boolean; profile: Profile & { vaultToday?: boolean } }>('POST', '/session', { address, name, avatar, proof }),
  me: () => call<Profile & { vaultToday?: boolean }>('GET', '/me'),
  setMe: (b: { name?: string; avatar?: string }) => call<Profile>('POST', '/me', b),
  board: (scope: 'global' | 'friends') => call<{ rows: Row[]; me: Row | null; total: number; week: string }>('GET', '/leaderboard?scope=' + scope),
  matches: () => call<MatchView[]>('GET', '/matches'),
  create: (b: unknown) => call<MatchView>('POST', '/matches', b),
  join: (code: string) => call<MatchView>('POST', '/matches/join', { code }),
  match: (id: string) => call<MatchView>('GET', `/matches/${id}?shot=${liveSeen[id] ?? 0}`),
  move: (id: string, b: unknown) => call<MatchView>('POST', `/matches/${id}/move`, b),
  fund: (id: string, txHash: string) => call<MatchView>('POST', `/matches/${id}/fund`, { txHash }),
  cancel: (id: string) => call<MatchView>('POST', `/matches/${id}/cancel`, {}),
  answer: (id: string, q: number, choice: number, ms: number) => call<any>('POST', `/matches/${id}/answer`, { q, choice, ms }),
  progress: (id: string, score: number) => call<any>('POST', `/matches/${id}/progress`, { score }),
  result: (id: string, b: { score: number; time: number; detail?: unknown }) => call<MatchView>('POST', `/matches/${id}/result`, b),
  vaultPuzzle: () => call<{ day: string; size: number; puzzle: number[] }>('GET', '/vault/puzzle'),
  vaultSolve: (grid: number[]) => call<any>('POST', '/vault/solve', { grid }),
  vaultDeposit: (txHash: string, amount: number) => call<any>('POST', '/vault/deposit', { txHash, amount }),
  withdraw: () => call<any>('POST', '/jar/withdraw', {}),
  receipt: (b: { imageBase64?: string; mime?: string; text?: string }) => call<any>('POST', '/ai/receipt', b),
  mockTx: (b: { from: string; to: string; luna: number; memo: string }) => call<{ hash: string }>('POST', '/dev/mock-tx', b),
}
