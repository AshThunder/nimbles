import type { ChessLive } from '../../shared/chessgame'
import type { ChestKind, Contents } from '../../shared/rewards'
import type { PoolLive } from '../../shared/poolgame'
import type { Profile, PublicMatch } from '../../shared/types'

let token = sessionStorage.getItem('nb:token') ?? ''
export const setToken = (t: string) => {
  token = t
  sessionStorage.setItem('nb:token', t)
}

/** Set by the app: signs a fresh wallet challenge and opens a new session. Called when the server says the token expired. */
let reauth: (() => Promise<void>) | null = null
let reauthing: Promise<void> | null = null
export const setReauth = (f: () => Promise<void>) => { reauth = f }

export class ApiErr extends Error {
  constructor(public status: number, msg: string) {
    super(msg)
  }
}

let serverSkew = 0
export const serverNow = () => Date.now() + serverSkew

async function call<T = any>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
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
  if (res.status === 401 && !retried && reauth && path !== '/session') {
    reauthing ??= reauth().finally(() => { reauthing = null })
    await reauthing
    return call<T>(method, path, body, true)
  }
  if (!res.ok) throw new ApiErr(res.status, j?.error || j?.message || `Request failed (${res.status})`)
  if (typeof j?.serverNow === 'number') serverSkew = j.serverNow - Date.now()
  return j as T
}

/** Last pool shot number each match has already animated, so the server only sends the ball paths once */
export const liveSeen: Record<string, number> = {}
export type JarInfo = {
  plan: { goalLuna: number; lockDays: 7 | 30 | 90; lockStartAt: number }
  jarLuna: number; unlockAt: number; locked: boolean; canChangeLock: boolean; serverNow: number
  early: { fee: number; pct: number; net: number }
  pool: { luna: number; dailyCap: number; dailyPct: number; savers: number; today: number; estimate: number; nextPayoutAt: number }
  boost: { levelPct: number; totalPct: number }
  interest: { last: number; lastDay: string; week: number; total: number }
}
export type Config = { chain: 'mock' | 'nimiq'; network: 'testnet' | 'mainnet'; escrow: string; lockDays: number; ai: { gemini: boolean; model: string | null }; mock: boolean; serverNow: number; showdown?: { name: string; start: number; end: number } }
export type SaverRow = { rank: number; address: string; name: string; avatar: string; frame: string; level: number; interest: number; saved: number; lockDays: number; locked: boolean; me: boolean }
export type Row = { rank: number; address: string; name: string; avatar: string; frame: string; weekXp: number; level: number; me: boolean }
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

export type ChestView = {
  id: string; kind: ChestKind; level?: number; title: string; why: string; at: number; openedAt: number; contents: Contents
}
export type ChestList = { chests: ChestView[]; boost: { levelPct: number; chestPct: number; until: number; totalPct: number }; badges: string[]; cosmetics: string[] }

export type Showdown = {
  name: string; live: boolean; start: number; end: number; paused: boolean
  earned: { total: number; wallet: number; jar: number; pending: number }
  steps: {
    welcome: { done: number; need: number; real: number; needReal: number; got: boolean }
    friends: { opponents: number; need: number; unlocked: boolean; friends: number }
    invites: { rewarded: number; max: number; need: number; list: { name: string; done: number; need: number; real: boolean; earned: number }[] }
    nimo: { today: number; perDay: number; capped: boolean }
    week: { index: number; wins: number; rank: number; top: number; endsAt: number }
  }
  byStep: Partial<Record<'welcome' | 'friend' | 'invite' | 'nimo' | 'leaderboard', number>>
  capped: boolean
  history: { note: string; luna: number; wallet: number; jar: number; status: 'paid' | 'pending'; at: number; tx?: string }[]
  jar: { luna: number; unlockAt: number; locked: boolean; early: { fee: number; pct: number; net: number } }
  beatNimo?: BeatNimo
}
export type BeatNimo = { name: string; start: number; slots: number; left: number; reward: number; paused: boolean; mine: { luna: number; status: 'paid' | 'pending'; tx?: string; match?: string; at: number } | null }
export type ShowdownBoard = { week: number; weeks: number; start: number; endsAt: number; top: number; live: boolean; rows: SdRow[]; me: SdRow | null }
export type SdRow = { rank: number; name: string; avatar: string; frame: string; wins: number; me: boolean }
export type LobbyItem = { code: string; game: string; mode: string; stake: number; topic?: string; host: { name: string; avatar: string; frame: string }; players: number; size: number; waitingSec: number }
export type FriendCard = { address: string; name: string; avatar: string; frame: string; level: number; online: boolean; asked?: boolean }
export type Friends = { code: string; friends: FriendCard[]; recent: FriendCard[]; incoming: FriendCard[]; challenges: { code: string; game: string; mode: string; stake: number; from: FriendCard }[] }

export const api = {
  showdown: () => call<Showdown>('GET', '/showdown'),
  showdownBoard: () => call<ShowdownBoard>('GET', '/showdown/board'),
  showdownWithdraw: (early = false) => call<{ tx: string; luna: number; fee: number }>('POST', '/showdown/jar/withdraw', { early }),
  lobby: (game?: string, mode?: string) => call<{ open: LobbyItem[] }>('GET', `/lobby?game=${game ?? ''}&mode=${mode ?? ''}`),
  friends: () => call<Friends>('GET', '/friends'),
  friendDo: (act: 'add' | 'request' | 'accept' | 'decline' | 'remove', b: { code?: string; address?: string }) => call<Friends>('POST', '/friends/' + act, b),
  adminMe: () => call<{ admin: boolean }>('GET', '/admin/me'),
  adminCampaign: () => call<any>('GET', '/admin/campaign'),
  adminSet: (b: unknown) => call<any>('POST', '/admin/campaign', b),
  adminStats: () => call<any>('GET', '/admin/stats'),
  config: () => call<Config>('GET', '/config'),
  challenge: () => call<{ nonce: string; message: string }>('GET', '/auth/challenge'),
  session: (address: string, name?: string, avatar?: string, proof?: { nonce: string; publicKey: string; signature: string }) =>
    call<{ token: string; verified: boolean; profile: Profile & { vaultToday?: boolean } }>('POST', '/session', { address, name, avatar, proof }),
  me: () => call<Profile & { vaultToday?: boolean }>('GET', '/me'),
  setStyle: (b: { frame?: string; theme?: string }) => call<Profile>('POST', '/me/style', b),
  savers: () => call<{ rows: SaverRow[]; me: SaverRow | null; total: number; week: string }>('GET', '/leaderboard/savers'),
  setMe: (b: { name?: string; avatar?: string }) => call<Profile>('POST', '/me', b),
  board: (scope: 'global' | 'friends') => call<{ rows: Row[]; me: Row | null; total: number; week: string }>('GET', '/leaderboard?scope=' + scope),
  matches: () => call<MatchView[]>('GET', '/matches'),
  create: (b: unknown) => call<MatchView>('POST', '/matches', b),
  join: (code: string) => call<MatchView>('POST', '/matches/join', { code }),
  match: (id: string) => call<MatchView>('GET', `/matches/${id}?shot=${liveSeen[id] ?? 0}`),
  move: (id: string, b: unknown) => call<MatchView>('POST', `/matches/${id}/move`, b),
  fund: (id: string, txHash: string) => call<MatchView>('POST', `/matches/${id}/fund`, { txHash }),
  start: (id: string) => call<MatchView>('POST', `/matches/${id}/start`, {}),
  cancel: (id: string) => call<MatchView>('POST', `/matches/${id}/cancel`, {}),
  terms: (id: string, b: unknown) => call<MatchView>('POST', `/matches/${id}/terms`, b),
  answer: (id: string, q: number, choice: number, ms: number) => call<any>('POST', `/matches/${id}/answer`, { q, choice, ms }),
  progress: (id: string, score: number) => call<any>('POST', `/matches/${id}/progress`, { score }),
  result: (id: string, b: { score: number; time: number; detail?: unknown }) => call<MatchView>('POST', `/matches/${id}/result`, b),
  vaultPuzzle: () => call<{ day: string; size: number; puzzle: number[] }>('GET', '/vault/puzzle'),
  vaultSolve: (grid: number[]) => call<any>('POST', '/vault/solve', { grid }),
  vaultDeposit: (txHash: string, amount: number) => call<any>('POST', '/vault/deposit', { txHash, amount }),
  jar: () => call<JarInfo>('GET', '/jar'),
  setPlan: (b: { goalNim?: number; lockDays?: number }) => call<JarInfo>('POST', '/jar/plan', b),
  withdraw: (early = false) => call<any>('POST', '/jar/withdraw', { early }),
  chests: () => call<ChestList>('GET', '/chests'),
  openChest: (id: string) => call<{ opened: { id: string; kind: ChestKind; level?: number; contents: Contents }; profile: Profile }>('POST', '/chests/open', { id }),
  chat: (b: { text: string; history?: { role: string; text: string }[] }) => call<{ reply: string; source: string }>('POST', '/ai/chat', b),
  receipt: (b: { imageBase64?: string; mime?: string; text?: string }) => call<any>('POST', '/ai/receipt', b),
  mockTx: (b: { from: string; to: string; luna: number; memo: string }) => call<{ hash: string }>('POST', '/dev/mock-tx', b),
  /** Confirmed wallet balance in luna. Pending incoming NIM is excluded. */
  addressBalance: (address: string) => call<{ address: string; luna: number; confirmed: true; pendingExcluded: true }>('GET', '/address-balance?address=' + encodeURIComponent(address)),
}

