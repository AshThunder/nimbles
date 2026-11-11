import { Sessions } from './auth'
import { createHash, randomBytes } from 'node:crypto'
import { Store, type MatchRec, type ProfileRec } from './store'
import { isNimiqAddress, sameAddr, type Chain, type DepositCheck, type IncomingTx } from './chain'

const normAddr = (a: string) => a.replace(/\s+/g, ' ').trim().toUpperCase()
import { generateTrivia } from './ai'
import { TICK_MS as SPLAT_TICK_MS } from '../shared/splat'
import { isLegacyName, nickOf } from '../shared/nick'
import { clampPct, drawShares, escrowRequired, evenShares, placePcts, placeShares, settleShares, toLuna } from '../shared/economy'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sevensOf, scoreWords, wordRack } from '../shared/words'
import { chessMove, chessResign, chessScore, chessTick, chessTimeUp, initChess, type ChessLive } from '../shared/chessgame'
import { initPool, poolResign, poolScore, poolShot, poolTick, poolTimeUp, type PoolLive } from '../shared/poolgame'
import { SplatRuns } from './splat'
import { splatShares, type Payout3 } from '../shared/economy'
import { ENGINE_GAMES, GAME_DURATION_MS, PIP_ADDRESS, PIP_NAMES, PIP_TRIVIA, pipScore } from '../shared/pip'
import { rng } from '../shared/rng'
import { replaySolitaire } from '../shared/solitaire'
import { replayBubble } from '../shared/bubblesim'
import { REPLAYS } from '../shared/replays'
import { makeSudoku } from '../shared/puzzles'
import { COSMETICS, LOCK_XP_PCT, derivedBadges, lockXpPct, streakXpPct, unlockedCosmetics, withXpBonus, BOOST_TOTAL_MAX, CHEST_TITLES, CHEST_WHY, chestContents, chestsDue,  DEFAULT_GOAL_LUNA, MAX_GOAL_NIM, POOL_DAILY_CAP, POOL_DAILY_PCT, earlyFee, isTier, levelBoostPct, poolDay, poolWeight, saveFee, type LockDays, type Plan } from '../shared/rewards'
import {
  GAMES, LUNA, MIN_STAKE_NIM, cleanStake, isSoon, levelFor, nearStake,
  type GameId, type Mode, type OppKind, type Payee, type Payout, type PipLevel, type Profile, type PublicMatch, type Result, type Settlement, type SettleTerms,
} from '../shared/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
const bad = (m: string, status = 400) => new ApiError(status, m)

const AVATARS = ['ada', 'bisi', 'dee', 'ife', 'ivy', 'jay', 'kai', 'kemi', 'leo', 'max', 'me', 'mia', 'rue', 'sam', 'tobi', 'zoe']
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)
const weekKey = (t = Date.now()) => {
  const d = new Date(t)
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)))
  return mon.toISOString().slice(0, 10)
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const rid = (n = 8) => randomBytes(n).toString('hex')

export const TRIVIA_Q_MS = 15000
const TRIVIA_NET_MS = 300
// pause the app shows between questions (the fact or the right answer); TRIVIA_PAUSE_MS overrides it (tests use 0)
const triviaPause = (fact: boolean) => (process.env.TRIVIA_PAUSE_MS ? Number(process.env.TRIVIA_PAUSE_MS) : fact ? 1800 : 1100) // allowance for the round trip when the server times an answer
const GRACE_MS = 25000
const LOBBY_TTL = 15 * 60_000
const AUTO_SPLAT_WAIT = 45_000 // an auto-matched Splat Royale lobby starts after this with 2 or more players
const TERMS_TTL = 10 * 60_000
// Long enough for the second player to open Nimiq Pay, let it reach the network and approve. A seat that has started
// paying gets a little more (see paying()), and the escrow is scanned for deposits whose hash never reached us.
const FUND_TTL = 5 * 60_000
const PAYING_GRACE = 3 * 60_000
const SCAN_EVERY = 10_000
const ORPHAN_LOOKBACK = 2 * 3600_000
const FORFEIT_AFTER = 45_000

let DICT: Set<string> | undefined
const wordDict = () => (DICT ??= new Set(readFileSync(fileURLToPath(new URL('../assets/words/dict.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)))

export class Engine {
  lockDays = Number(process.env.JAR_LOCK_DAYS ?? 30)
  /** Optional per-match cap in NIM, only when MAX_STAKE_NIM is set. By default stakes are open and the player's balance is the limit. */
  get maxStakeNim() {
    const v = Number(process.env.MAX_STAKE_NIM)
    return v > 0 ? v : Infinity
  }
  /** Live Splat Royale runs. The sim itself lives in shared/splat.ts. */
  splat = new SplatRuns((m, order, sim) => this.splatFinish(m, order, sim))
  constructor(public store: Store, public chain: Chain) {
    // older profiles were named 'Player 0002'. Give them the friendly nickname for their address
    for (const p of Object.values(this.store.db.profiles)) if (isLegacyName(p.name)) p.name = nickOf(p.address)
  }
  get db() {
    return this.store.db
  }

  // ---------------- profiles / sessions ----------------

  /** Session tokens expire (SESSION_TTL_MIN, default 60 on mainnet and 12 hours elsewhere) and are bound to one address. */
  get sessions(): Sessions {
    if (!this._sessions) {
      const secret = process.env.SESSION_SECRET || (this.db.authSecret ??= randomBytes(32).toString('hex'))
      const mainnet = this.chain.network === 'mainnet'
      const min = Number(process.env.SESSION_TTL_MIN ?? (mainnet ? 60 : 720))
      this._sessions = new Sessions(secret, Math.max(1, min) * 60_000)
      this.store.save()
    }
    return this._sessions
  }
  private _sessions?: Sessions
  /** Mainnet moves real NIM, so it never accepts a session that is not backed by a signed challenge. */
  get requireSigned() {
    return process.env.REQUIRE_SIGNED === 'yes' || (this.chain.network === 'mainnet')
  }

  session(addressIn: string, name?: string, avatar?: string, verified = false): { token: string; expiresAt: number; profile: Profile } {
    const address = String(addressIn || '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!isNimiqAddress(address)) throw bad('That is not a valid Nimiq address')
    let p = this.db.profiles[address]
    if (!p) {
      p = this.db.profiles[address] = {
        address,
        name: nickOf(address),
        avatar: AVATARS[parseInt(sha(address).slice(0, 4), 16) % AVATARS.length],
        xp: 0, weekKey: weekKey(), weekXp: 0, wins: 0, played: 0, activeDays: [],
        questDay: '', questWins: 0, questChestDay: '', jarLuna: 0, jarUnlockAt: 0,
        vaultDay: '', vaultDeposits: 0, friends: [], createdAt: Date.now(),
      }
    }
    if (name) p.name = String(name).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 16) || p.name
    if (avatar && AVATARS.includes(avatar)) p.avatar = avatar
    const { token, expiresAt } = this.sessions.issue(address, verified)
    this.store.save()
    return { token, expiresAt, profile: this.profile(address) }
  }

  auth(token: string | undefined): string {
    const s = this.sessions.check(token)
    if (!s) throw bad('Sign in again', 401)
    if (this.requireSigned && !s.verified) throw bad('Sign in again', 401)
    const p = this.db.profiles[s.address]
    const now = Date.now()
    if (p && now - (p.lastSeen ?? 0) > 30_000) {
      p.lastSeen = now
      this.store.save()
    }
    return s.address
  }

  /** Called after every settlement (the campaign listens here). Errors never break a settlement. */
  onSettled?: (m: MatchRec, forfeit: boolean) => void

  /** The current run of days, and the first day of it. Today not played yet does not break the run. */
  streakOf(p: ProfileRec, now = Date.now()) {
    const days = new Set(p.activeDays)
    const today = day(now)
    let streak = 0
    let start = today
    for (let t = now; ; t -= 864e5) {
      if (days.has(day(t))) { streak++; start = day(t) }
      else if (day(t) === today) continue
      else break
    }
    return { streak, start }
  }

  profile(address: string): Profile {
    const p = this.must(address)
    this.rollWeek(p)
    const lv = levelFor(p.xp)
    const today = day()
    const { streak } = this.streakOf(p)
    return {
      address: p.address, name: p.name, avatar: p.avatar, xp: p.xp, level: lv.level, levelXp: lv.levelXp, nextXp: lv.nextXp,
      streak, lastStreakDay: p.activeDays[p.activeDays.length - 1] ?? '', streakDays: p.activeDays.slice(-14),
      wins: p.wins, played: p.played, jarLuna: p.jarLuna, jarUnlockAt: p.jarUnlockAt, plan: this.planOf(p),
      questWins: p.questDay === today ? p.questWins : 0, questDay: today, weekXp: p.weekXp,
      chests: (p.chests ?? []).filter((c) => !c.openedAt).length,
      badges: [...new Set([...derivedBadges({ wins: p.wins, saved: p.vaultDeposits > 0 || p.jarLuna > 0 || (p.interestTotal ?? 0) > 0 }), ...(p.badges ?? [])])],
      unlocked: unlockedCosmetics(lv.level, p.cosmetics ?? []),
      style: { frame: p.frame ?? '', theme: p.theme ?? '' },
      ...({ vaultToday: p.vaultDay === today, vaultDay: p.vaultDay } as object),
    } as Profile
  }

  private must(address: string): ProfileRec {
    const p = this.db.profiles[address]
    if (!p) throw bad('Unknown player', 401)
    return p
  }

  private rollWeek(p: ProfileRec) {
    if (p.weekKey !== weekKey()) {
      p.weekKey = weekKey()
      p.weekXp = 0
    }
  }

  setProfile(address: string, name?: string, avatar?: string) {
    const p = this.must(address)
    if (name) p.name = String(name).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 16) || p.name
    if (avatar && AVATARS.includes(avatar)) p.avatar = avatar
    this.store.save()
    return this.profile(address)
  }

  leaderboard(address: string, scope: 'global' | 'friends') {
    const all = Object.values(this.db.profiles)
    all.forEach((p) => this.rollWeek(p))
    const me = this.must(address)
    let rows = all
    if (scope === 'friends') rows = all.filter((p) => p.address === address || me.friends.includes(p.address) || (me.friendList ?? []).includes(p.address))
    rows = [...rows].sort((a, b) => b.weekXp - a.weekXp || b.xp - a.xp)
    const list = rows.map((p, i) => ({
      rank: i + 1, address: p.address, name: p.name, avatar: p.avatar, frame: p.frame ?? '', weekXp: p.weekXp, level: levelFor(p.xp).level, me: p.address === address,
    }))
    return { scope, week: weekKey(), rows: list.slice(0, 25), me: list.find((r) => r.me) ?? null, total: rows.length }
  }

  // ---------------- matches ----------------

  private view(m: MatchRec, viewer?: string, seenShot?: number): PublicMatch & Record<string, unknown> {
    // Trivia never needs the seed on the device, and against Nimo the seed would let a script predict the deal. It is shown
    // once the match is settled, so anyone can still check it against the commitment.
    const showSeed = m.game === 'trivia' ? m.status === 'settled' : m.status === 'playing' || m.status === 'settled'
    const out: any = { ...m }
    delete out.pipSalt
    delete out.paying
    delete out.scannedAt
    delete out.size
    delete out.trivia
    delete out.fundBy
    delete out.settled
    out.seed = showSeed ? m.seed : undefined
    out.size = m.size
    out.players = m.players.map((p) => ({
      player: isLegacyName(p.player.name) ? { ...p.player, name: nickOf(p.player.address) } : p.player, funded: p.funded, escrowed: p.escrowed, share: p.share, isBot: p.isBot,
      progress: p.progress, paidFrom: viewer && p.player.address === viewer ? p.paidFrom : undefined, result: m.status === 'settled' ? p.result : p.result ? { score: 0, time: 0, done: true } : undefined,
    }))
    out.serverNow = Date.now()
    if (m.live?.kind === 'pool' && m.live.last) {
      // the ball paths are big: send them once, to whoever has not seen that shot yet
      const last = m.live.last
      out.live = { ...m.live, last: { ...last, frames: seenShot !== undefined && seenShot < last.no ? last.frames : [] } }
    }
    out.fundBy = m.fundBy
    if (m.terms) out.terms = { ...m.terms, lock: escrowRequired('settle', m.terms.bill, m.terms.loserPct, m.terms.split === 'place' ? m.size : 0) }
    out.settlement = m.settlement
    if (m.trivia && (m.status === 'playing' || m.status === 'settled')) {
      const mine = viewer ? m.trivia.answers[viewer] ?? [] : []
      const settled = m.status === 'settled'
      // Questions are shown one at a time, and the server notes when each one was first shown to this player, so the
      // answer time is measured here, not reported by the device.
      const live = m.status === 'playing'
      if (live && viewer) this.serve(m, viewer, mine.length)
      out.trivia = {
        topic: m.trivia.topic, source: m.trivia.source, verified: m.trivia.verified, qMs: TRIVIA_Q_MS, count: m.trivia.questions.length,
        questions: m.trivia.questions.map((q, i) => (settled || (live && i <= mine.length)
          ? { q: q.q, options: q.options, category: q.category, ...(mine[i] || settled ? { answer: q.answer, fact: q.fact } : {}) }
          : { q: '', options: [], category: '' })),
        mine,
        // Nimo's answer to a question is shown only after this player has answered it. Its rolls use a server-only salt,
        // so the public seed cannot predict them
        pip: m.trivia.pip ? (settled ? m.trivia.pip : m.trivia.pip.slice(0, mine.length)) : undefined,
      }
    } else if (m.trivia) out.trivia = { topic: m.trivia.topic, count: m.trivia.questions.length, source: m.trivia.source, verified: m.trivia.verified }
    return out
  }

  get(id: string, viewer: string, seenShot?: number) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    if (!m.players.some((p) => p.player.address === viewer)) throw bad('Not your match', 403)
    this.tick(m)
    return this.view(m, viewer, seenShot)
  }

  mine(address: string) {
    return Object.values(this.db.matches)
      .filter((m) => m.players.some((p) => p.player.address === address))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .map((m) => this.view(m, address))
  }

  /** Open "Match me" challenges anyone can join: game, mode, stake, how long they have waited. Never the viewer's own. */
  openLobby(viewer: string, game?: string, mode?: string) {
    const now = Date.now()
    return Object.values(this.db.matches)
      .filter((m) => m.opp === 'auto' && m.status === 'lobby' && m.players.length < m.size && now - m.createdAt < LOBBY_TTL &&
        !m.players.some((p) => p.player.address === viewer) && (!game || m.game === game) && (!mode || m.mode === mode))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 40)
      .map((m) => {
        const h = this.db.profiles[m.host]
        return {
          code: m.code, game: m.game, mode: m.mode, stake: m.stake, topic: m.game === 'trivia' ? String(m.config.topic ?? '') : undefined,
          host: { name: h?.name ?? 'Player', avatar: h?.avatar ?? 'me', frame: h?.frame ?? '' }, players: m.players.length, size: m.size,
          waitingSec: Math.round((now - m.createdAt) / 1000),
        }
      })
  }

  private playerOf(address: string) {
    const p = this.must(address)
    return { address, name: p.name, avatar: p.avatar }
  }

  private required(m: MatchRec) {
    return escrowRequired(m.mode, m.stake, m.terms?.loserPct, m.terms?.split === 'place' ? m.size : 0)
  }

  /** Settle terms from a request: bill, split and payee. `who` is the seat proposing, so 'me' and 'friend' resolve to seats. */
  private async parseTerms(m: { players: { player: { address: string } }[]; terms?: SettleTerms }, who: number, b: any, place = 0): Promise<{ bill: number; loserPct: number; payee: Payee; split?: 'place' }> {
    const bill = Math.round(Number(b.bill) * 100) / 100
    if (!(bill >= 0.5 && bill <= 1000)) throw bad('A bill must be between 0.5 and 1000 NIM')
    if (bill > this.maxStakeNim) throw bad(`The limit on this server is ${this.maxStakeNim} NIM per match`)
    // placement split (Splat Royale): the shares come from the preset for this many players, so there is no percent to pick
    const pct = place >= 2 ? Math.max(...placePcts(place)) : Math.round(Number(b.loserPct))
    if (!Number.isInteger(pct) || pct < (place >= 2 ? 1 : 50) || pct > 100) throw bad('The loser pays between 50% and 100% of the bill')
    let payee: Payee
    const raw = b.payee
    if (raw === 'me') payee = { seat: who }
    else if (raw === 'friend' && place <= 2) payee = { seat: 1 - who }
    else if (raw && typeof raw === 'object' && Number.isInteger(raw.seat) && raw.seat >= 0 && raw.seat < (place || 2)) payee = { seat: raw.seat }
    else {
      const a = normAddr(String(typeof raw === 'object' && raw ? raw.address : raw ?? ''))
      if (!isNimiqAddress(a)) throw bad('The payee must be "me", "friend" or a valid Nimiq address')
      if (sameAddr(a, this.chain.escrowAddress)) throw bad('The payee cannot be the escrow account')
      const seat = m.players.findIndex((p) => sameAddr(p.player.address, a))
      if (seat >= 0) payee = { seat }
      else {
        if (!(await this.chain.isWallet(a))) throw bad('That address is a contract, not a wallet. A payment there would fail. Use a normal wallet address')
        payee = { address: a }
      }
    }
    return place >= 2 ? { bill, loserPct: pct, payee, split: 'place' } : { bill, loserPct: pct, payee }
  }

  async create(host: string, b: any): Promise<PublicMatch> {
    const game = b.game as GameId
    if (!GAMES[game]) throw bad('Unknown game')
    if (isSoon(game)) throw bad(`${GAMES[game].name} is coming soon`)
    const mode = b.mode as Mode
    if (!['play', 'win', 'save', 'settle'].includes(mode)) throw bad('Unknown mode')
    const opp = b.opp as OppKind
    if (!['invite', 'auto', 'pip'].includes(opp)) throw bad('Unknown opponent type')
    if (opp === 'pip' && mode !== 'play') throw bad('Nimo only plays for fun. Staked matches need a real player')
    const pipLevel: PipLevel | undefined = opp === 'pip' ? (['easy', 'med', 'hard'].includes(b.pipLevel) ? b.pipLevel : 'med') : undefined
    if (mode === 'settle' && opp !== 'invite') throw bad('Settle is for friends only. Invite them with a code or link')

    let stake = 0
    if (mode === 'save' || mode === 'win') {
      stake = cleanStake(b.stake)
      if (Number.isNaN(stake)) throw bad(`A stake must be at least ${MIN_STAKE_NIM} NIM`)
    }
    let terms: SettleTerms | undefined
    if (mode === 'settle') {
      const placeN = game === 'splat' ? Math.round(Number(b.config?.seats ?? 4)) : 0
      if (game === 'splat' && !(placeN >= 2 && placeN <= GAMES.splat.maxPlayers)) throw bad('Pick 2 to 6 players')
      const t = await this.parseTerms({ players: [{ player: { address: host } }] }, 0, b.terms ?? b, placeN)
      stake = t.bill
      terms = { ...t, agreed: [host], proposedBy: host, rev: 1 }
    }
    if (stake > this.maxStakeNim) throw bad(`The limit on this server is ${this.maxStakeNim} NIM per match`)
    let size = 2
    if (game === 'splat') {
      size = Math.round(Number(b.config?.seats ?? 4))
      if (!(size >= 2 && size <= GAMES.splat.maxPlayers)) throw bad('Pick 2 to 6 players')
    }
    if (opp === 'auto') {
      const cfgTopic = game === 'trivia' ? String(b.config?.topic || 'General knowledge').slice(0, 60) : ''
      const waiting = Object.values(this.db.matches).find(
        (m) => m.opp === 'auto' && m.status === 'lobby' && m.game === game && m.mode === mode && m.stake === stake && m.players[0].player.address !== host && (game !== 'splat' || (m.size === size && m.players.length < m.size && !m.players.some((p) => p.player.address === host))) &&
          (game !== 'trivia' || (m.config.topic as string) === cfgTopic),
      )
      if (waiting) return await this.join(host, waiting.code)
      // nothing at this exact stake: offer the nearest open challenge within ±NEAR_STAKE_PCT%. The player confirms it by joining
      // (the host already chose that stake), so both sides agree to the amount before anything is locked
      if (game !== 'splat' && (mode === 'win' || mode === 'save') && !b.noNearby) {
        const near = this.openLobby(host, game, mode)
          .filter((x) => nearStake(x.stake, stake) && (game !== 'trivia' || x.topic === cfgTopic))
          .sort((x, y) => Math.abs(x.stake - stake) - Math.abs(y.stake - stake) || y.waitingSec - x.waitingSec)[0]
        if (near) return { suggest: near } as any
      }
      b.config = { ...(b.config || {}), topic: cfgTopic }
    }

    let m_challenge: string | undefined
    const id = rid(6)
    let code = ''
    do {
      code = 'NMB-' + Array.from({ length: 4 }, () => CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length]).join('')
    } while (Object.values(this.db.matches).some((m) => m.code === code && m.status !== 'settled' && m.status !== 'cancelled'))
    const seed = rid(16)
    const config: Record<string, unknown> = {}
    if (game === 'splat') {
      config.seats = size
      config.payout = b.config?.payout === 'top3' ? 'top3' : 'wta'
    }
    const m: MatchRec = {
      id, code, game, mode, opp, pipLevel, stake, status: 'lobby', host, size, seed, seedCommit: sha(seed), config,
      players: [{ player: this.playerOf(host), funded: false, escrowed: 0 }], terms,
      escrow: { address: this.chain.escrowAddress, network: this.chain.network, memo: 'nb:' + id },
      createdAt: Date.now(),
    }
    if (game === 'trivia') {
      const topic = String(b.config?.topic || 'General knowledge')
      const count = [5, 7, 10].includes(Number(b.config?.count)) ? Number(b.config.count) : 5
      const set = await generateTrivia(topic, count, seed)
      m.trivia = { questions: set.questions, source: set.source, verified: set.verified, topic: set.topic, answers: {} }
      config.topic = set.topic
      config.count = set.questions.length
    }
    if (opp === 'invite' && typeof b.challenge === 'string' && b.challenge) {
      const to = normAddr(b.challenge)
      const me = this.must(host)
      if (!(me.friendList ?? []).includes(to)) throw bad('You can challenge friends from your list')
      m_challenge = to
    }
    if (mode === 'settle') {
      const r = b.config?.receipt
      config.billNote = String(b.config?.note || '').slice(0, 40)
      if (r && typeof r === 'object') config.receiptItems = Array.isArray(r.items) ? r.items.slice(0, 40).map((i: any) => ({ name: String(i.name).slice(0, 40), price: Number(i.price) || 0 })) : []
    }
    if (m_challenge) m.challengeTo = m_challenge
    this.db.matches[id] = m
    if (opp === 'pip') {
      if (game === 'splat') this.fillBots(m)
      else m.players.push({ player: { address: PIP_ADDRESS, name: PIP_NAMES[pipLevel!], avatar: 'pip' }, funded: true, escrowed: 0, isBot: true })
      m.pipSalt = rid(16)
      if (m.trivia) m.trivia.pip = this.rollPip(m, pipLevel!)
      this.readyUp(m)
    }
    this.store.save()
    return this.view(m, host) as any
  }

  /** Tournament round: a staked win match with both players already seated. Each locks the stake as usual. */
  async createPaired(a: string, b: string, o: { game: GameId; stake: number }, tourney: NonNullable<MatchRec['tourney']>) {
    this.must(a); this.must(b)
    const v: any = await this.create(a, { game: o.game, mode: 'win', opp: 'invite', stake: o.stake, config: { count: 5 } })
    const m = this.db.matches[v.id]
    m.tourney = tourney
    m.players.push({ player: this.playerOf(b), funded: false, escrowed: 0 })
    this.readyUp(m)
    this.store.save()
    return m
  }

  /** Server-side cancel (tournament deadlines). Refunds whatever was locked. */
  async cancelById(id: string, reason: string) {
    const m = this.db.matches[id]
    if (m && (m.status === 'lobby' || m.status === 'terms' || m.status === 'funding')) await this.cancelMatch(m, reason)
  }

  /** Nimo takes every empty seat. Play mode only, so no money is ever against a bot. */
  private fillBots(m: MatchRec) {
    const level = m.pipLevel ?? 'med'
    for (let i = m.players.filter((p) => p.isBot).length; m.players.length < m.size; i++) {
      m.players.push({ player: { address: i ? `${PIP_ADDRESS}-${i + 1}` : PIP_ADDRESS, name: i ? `Nimo ${i + 1}` : PIP_NAMES[level], avatar: 'pip' }, funded: true, escrowed: 0, isBot: true })
    }
  }

  /** Splat Royale: the host starts early. Play fills the empty seats with Nimo, Save plays with whoever is in. */
  async startNow(addr: string, id: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    if (m.host !== addr) throw bad('Only the host can start', 403)
    if (m.game !== 'splat' || m.status !== 'lobby') throw bad('Nothing to start')
    if (m.players.length < 2 && m.mode !== 'play') throw bad('You need at least two players')
    if (m.mode === 'play') {
      m.pipLevel = m.pipLevel ?? 'med'
      this.fillBots(m)
    } else m.size = m.players.length
    m.config.seats = m.size
    if (m.mode === 'settle' && m.terms) {
      // fewer players than seats: the placement split is worked out again for the players who are here, and everyone agrees to it
      const t = m.terms
      m.terms = { ...t, loserPct: Math.max(...placePcts(m.size)), agreed: [m.host], proposedBy: m.host, rev: t.rev + 1 }
      this.openTerms(m)
    } else this.readyUp(m)
    this.store.save()
    return this.view(m, addr)
  }

  async join(addr: string, codeIn: string): Promise<PublicMatch> {
    const code = String(codeIn || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NMB/, '')
    const m = Object.values(this.db.matches).find((x) => x.code.replace('-', '') === 'NMB' + code && x.status === 'lobby')
    if (!m) throw bad('No open match with that code. Ask for a fresh one', 404)
    if (m.players.some((p) => p.player.address === addr)) return this.view(m, addr) as any
    if (m.players.length >= m.size) throw bad('That match is full')
    m.players.push({ player: this.playerOf(addr), funded: false, escrowed: 0 })
    this.store.save()
    if (m.players.length >= m.size) {
      if (m.mode === 'settle') this.openTerms(m)
      else this.readyUp(m)
    }
    return this.view(m, addr) as any
  }

  /** Settle: both friends are in. Nothing is locked until each has agreed to the same terms. */
  private openTerms(m: MatchRec) {
    m.status = 'terms'
    m.fundBy = Date.now() + TERMS_TTL
    this.store.save()
  }

  /** Propose new terms or agree to the current ones. Any change clears the other player's agreement. */
  async terms(addr: string, id: string, b: any) {
    const m = this.db.matches[id]
    if (!m || m.mode !== 'settle' || !m.terms) throw bad('Match not found', 404)
    const seat = m.players.findIndex((p) => p.player.address === addr)
    if (seat < 0) throw bad('Not your match', 403)
    this.tick(m)
    if (m.status !== 'lobby' && m.status !== 'terms') throw bad('The terms are locked in, the match has moved on')
    const t = m.terms
    if (b?.action === 'agree') {
      if (m.status !== 'terms') throw bad('Wait for the other players to join first')
      if (Number(b.rev) !== t.rev) throw bad('The terms just changed. Read them again before you agree')
      if (!t.agreed.includes(addr)) t.agreed.push(addr)
      if (m.players.every((p) => t.agreed.includes(p.player.address))) this.readyUp(m)
    } else if (b?.action === 'propose') {
      if (t.split === 'place' && addr !== m.host) throw bad('Only the host sets the bill and who gets the money. You can agree or leave')
      const n = await this.parseTerms(m, seat, b, t.split === 'place' ? m.size : 0)
      const same = n.bill === t.bill && n.loserPct === t.loserPct && JSON.stringify(n.payee) === JSON.stringify(t.payee)
      if (!same) {
        m.terms = { ...n, agreed: [addr], proposedBy: addr, rev: t.rev + 1 }
        m.stake = n.bill
        if (m.status === 'terms') m.fundBy = Date.now() + TERMS_TTL
      }
    } else throw bad('Unknown action')
    this.store.save()
    return this.view(m, addr)
  }

  /** Called when the lobby is full (or, for Settle, when both agreed). */
  private readyUp(m: MatchRec) {
    for (const p of m.players) p.escrowed = this.required(m)
    const need = m.players.some((p) => !p.isBot && p.escrowed > 0 && !p.funded)
    if (need) {
      m.status = 'funding'
      m.fundBy = Date.now() + FUND_TTL
    } else this.beginCountdown(m)
  }

  private beginCountdown(m: MatchRec) {
    m.status = 'ready'
    m.startsAt = Date.now() + 4000
    m.fundBy = undefined
  }

  async fund(addr: string, id: string, txHash: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    const pl = m.players.find((p) => p.player.address === addr)
    if (!pl) throw bad('Not your match', 403)
    if (typeof txHash !== 'string' || txHash.length > 100) throw bad('Bad transaction hash')
    if (m.status !== 'funding' || pl.funded) {
      // a payment that arrives after the seat is locked, or after the match ended, is kept for a refund, never lost
      if (txHash && !this.db.usedTx[txHash]) await this.noteOrphan(m, txHash, pl.funded ? 'A second payment for a seat that was already locked' : 'Paid after the match stopped collecting deposits')
      if (pl.funded) return this.view(m, addr)
      throw bad('This match is not collecting deposits any more. If NIM left your wallet, it is refunded to you')
    }
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    const need = pl.escrowed
    const check = await this.chain.verifyDeposit(txHash, { luna: need, memo: m.escrow.memo })
    if (!check.ok) {
      if (check.pending) return { ...this.view(m, addr), pending: true, pendingReason: check.reason }
      throw bad(check.reason)
    }
    return this.credit(m, pl, txHash, check)
  }

  /** Locks a seat with a verified deposit. Shared by the device's own report and the escrow scan. */
  private credit(m: MatchRec, pl: MatchRec['players'][number], txHash: string, check: Extract<DepositCheck, { ok: true }>) {
    const addr = pl.player.address
    // Whoever really paid is who gets paid back. Nimiq Pay may pay from another account of the same person (or from a
    // contract account its wallet funded), so the payer is accepted and the seat's payouts follow it.
    const owner = check.owner ?? (check.related.some((a) => sameAddr(a, addr)) ? addr : null)
    if (!owner) throw bad('That payment came from an account type we cannot send winnings back to. Nothing was counted')
    const rival = m.players.some((o) => o !== pl && !o.isBot && [o.player.address, o.payTo, o.paidFrom].some((a) => a && (sameAddr(a, owner) || sameAddr(a, check.from))))
    if (rival) throw bad('That payment came from another player\'s wallet in this match, so it was not counted')
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    this.db.usedTx[txHash] = m.id
    pl.paidFrom = sameAddr(check.from, addr) ? undefined : normAddr(check.from)
    pl.payTo = sameAddr(owner, addr) ? undefined : normAddr(owner)
    this.must(addr).payAddr = pl.payTo
    pl.funded = true
    pl.fundTx = txHash
    if (m.status === 'funding' && m.players.every((p) => p.funded || p.escrowed === 0)) this.beginCountdown(m)
    this.store.save()
    return this.view(m, addr)
  }

  /** Where a seat's money goes: the account that paid its lock, or the seat's own address. `for` keeps the seat findable. */
  private dest(p: MatchRec['players'][number]): { to: string; for?: string } {
    return p.payTo ? { to: p.payTo, for: p.player.address } : { to: p.player.address }
  }

  /** The device says its wallet is sending this seat's deposit right now. The funding window then waits at least
   *  PAYING_GRACE from this moment, so a slow wallet (or one that has to reach the network first) is not cut off. */
  paying(addr: string, id: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    const pl = m.players.find((p) => p.player.address === addr)
    if (!pl) throw bad('Not your match', 403)
    if (m.status === 'funding' && !pl.funded) {
      const now = Date.now()
      const first = !(m.paying ??= {})[addr]
      m.paying[addr] = now
      // extend once per seat, never past one extra grace window
      if (first && m.fundBy && m.fundBy < now + PAYING_GRACE) m.fundBy = now + PAYING_GRACE
      this.store.save()
    }
    return this.view(m, addr)
  }

  /** The device lost track of its payment (the wallet timed out, the app was closed). Look for it on chain now. */
  async findDeposit(addr: string, id: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    if (!m.players.some((p) => p.player.address === addr)) throw bad('Not your match', 403)
    await this.scanDeposits([m], true)
    return this.view(m, addr)
  }

  private scanning = false
  private lastScan = 0
  /** Every few seconds: deposits for matches still collecting, and late ones for matches that just ended. */
  async scanAll(now = Date.now()) {
    if (this.scanning || now - this.lastScan < SCAN_EVERY) return
    const list = Object.values(this.db.matches).filter((m) => m.stake > 0 && (m.status === 'funding' ||
      ((m.status === 'cancelled' || m.status === 'settled') && now - (m.endsAt ?? m.fundBy ?? m.createdAt) < ORPHAN_LOOKBACK && m.players.some((p) => !p.isBot && p.escrowed > 0 && !p.funded))))
    if (!list.length) return
    this.lastScan = now
    await this.scanDeposits(list, false).catch((e) => console.warn('[escrow] deposit scan failed:', e?.message))
  }

  private scanBusy = false
  /** Matches escrow deposits by memo to seats. A deposit from a seat's own wallet (or the contract its wallet funded)
   *  locks that seat. Anything that cannot be counted is kept as an orphan for a refund. */
  async scanDeposits(list: MatchRec[], force: boolean) {
    if (this.scanBusy && !force) return
    this.scanBusy = true
    try {
      const byMemo = new Map(list.map((m) => [m.escrow.memo, m]))
      let txs: IncomingTx[] = []
      try { txs = await this.chain.escrowDeposits(200) } catch (e: any) { if (force) throw bad('Could not reach the network to look for your payment. Try again in a moment', 502); return }
      for (const t of txs.reverse()) {
        const m = byMemo.get(t.memo)
        if (!m || this.db.usedTx[t.hash] || this.db.orphans?.[t.hash]) continue
        m.scannedAt = Date.now()
        const check = await this.chain.verifyDeposit(t.hash, { luna: 1, memo: m.escrow.memo })
        if (!check.ok) continue // pending: the next scan picks it up
        const seat = m.players.find((p) => !p.isBot && [p.player.address, p.payTo, p.paidFrom, this.db.profiles[p.player.address]?.payAddr]
          .some((a) => a && (sameAddr(a, check.from) || (check.owner && sameAddr(a, check.owner)))))
        if (m.status === 'funding' && seat && !seat.funded && t.luna >= seat.escrowed) {
          try { this.credit(m, seat, t.hash, check); console.log(`[escrow] deposit found on chain for match ${m.id}`) } catch (e: any) { await this.noteOrphan(m, t.hash, e?.message ?? 'Could not be counted', check, t.luna) }
        } else {
          const why = !seat ? 'From a wallet that is not a player in this match' : seat.funded ? 'A second payment for a seat that was already locked'
            : m.status !== 'funding' ? 'Paid after the match stopped collecting deposits' : 'Less than the stake'
          await this.noteOrphan(m, t.hash, why, check, t.luna)
        }
      }
    } finally { this.scanBusy = false }
  }

  /** Remembers a deposit that cannot be counted, so the owner can refund it from the admin page. Never pays by itself. */
  private async noteOrphan(m: MatchRec, hash: string, why: string, check?: DepositCheck, luna?: number) {
    if (this.db.usedTx[hash] || this.db.orphans?.[hash]) return
    let c = check
    if (!c) c = await this.chain.verifyDeposit(hash, { luna: 1, memo: m.escrow.memo }).catch(() => undefined)
    if (!c || !c.ok) return
    let value = luna
    if (value === undefined) value = (await this.chain.escrowDeposits(200).catch(() => [] as IncomingTx[])).find((t) => t.hash === hash)?.luna
    if (!value) return
    this.db.usedTx[hash] = 'orphan:' + m.id
    ;(this.db.orphans ??= {})[hash] = { hash, match: m.id, from: normAddr(c.from), owner: c.owner ? normAddr(c.owner) : null, luna: value, at: Date.now(), why, status: 'open' }
    console.warn(`[escrow] orphan deposit ${hash.slice(0, 10)}… for match ${m.id}: ${why}`)
    this.store.save()
  }

  /** Owner action: send an orphan deposit back to whoever paid it (the wallet behind a contract when known). */
  async refundOrphan(hash: string) {
    const o = this.db.orphans?.[hash]
    if (!o || o.status !== 'open') throw bad('Nothing to refund for that payment')
    const to = o.owner ?? o.from
    if (!(await this.chain.isWallet(to))) throw bad('That payer is a contract account. Refund it by hand')
    o.status = 'refunded'
    this.store.flush()
    try {
      o.refundTx = await this.chain.pay(to, o.luna, `nb:${o.match}:return`.slice(0, 64))
      delete o.error
    } catch (e: any) {
      o.status = 'open'
      o.error = String(e?.message ?? e).slice(0, 120)
    }
    this.store.save()
    return o
  }

  /** Owner action: an orphan that was handled outside the app (or a test payment). */
  dismissOrphan(hash: string) {
    const o = this.db.orphans?.[hash]
    if (!o || o.status !== 'open') throw bad('Nothing to dismiss')
    o.status = 'dismissed'
    this.store.save()
    return o
  }

  async cancel(addr: string, id: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    const inTerms = m.status === 'terms' && m.players.some((p) => p.player.address === addr)
    if (m.host !== addr && !inTerms) throw bad('Only the host can cancel', 403)
    if (m.status !== 'lobby' && m.status !== 'terms' && m.status !== 'funding') throw bad('Too late to cancel, the game has started')
    await this.cancelMatch(m, 'Cancelled by host')
    return this.view(m, addr)
  }

  private expiring = new Set<string>()
  /** Before giving up on a match that is still collecting, look on chain once more for deposits the devices never reported. */
  private async expireFunding(m: MatchRec) {
    if (this.expiring.has(m.id)) return
    this.expiring.add(m.id)
    try {
      await this.scanDeposits([m], true).catch(() => {})
      if (m.status === 'funding' && m.fundBy && Date.now() > m.fundBy) await this.cancelMatch(m, 'Deposits were not all in on time, funds refunded')
    } finally { this.expiring.delete(m.id) }
  }

  /** Called after a match is cancelled (tournaments listen here). */
  onCancelled?: (m: MatchRec) => void

  private async cancelMatch(m: MatchRec, reason: string) {
    m.status = 'cancelled'
    const payouts: Payout[] = m.players
      .filter((p) => p.funded && p.escrowed > 0 && !p.isBot)
      .map((p) => ({ ...this.dest(p), luna: p.escrowed, kind: 'refund' as const, note: 'Match cancelled' }))
    m.settlement = { ranks: [], payouts, xp: {}, jarCredit: {}, reason }
    this.store.save()
    this.runPayouts(m)
    try { this.onCancelled?.(m) } catch (e) { console.error('[campaign] cancel hook failed', e) }
  }

  // ----- trivia (server-authoritative) -----

  /** When question `i` was first shown to `addr` (stamped now, or at `at`, the first time it is asked). */
  private serve(m: MatchRec, addr: string, i: number, at = Date.now()) {
    const t = m.trivia!
    if (i >= t.questions.length) return at
    const list = ((t.served ??= {})[addr] ??= [])
    if (!list[i]) { list[i] = at; this.store.save() }
    return list[i]
  }

  private rollPip(m: MatchRec, level: PipLevel) {
    const r = rng(`pip-trivia:${m.seed}:${m.pipSalt ?? ''}:${level}`)
    const cfg = PIP_TRIVIA[level]
    return m.trivia!.questions.map((q) => {
      const correct = r.next() < cfg.p
      const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer)
      const ms = Math.round(cfg.ms[0] + r.next() * (cfg.ms[1] - cfg.ms[0]))
      return { choice: correct ? q.answer : r.pick(wrong), ms, correct, points: correct ? triviaPoints(ms) : 0 }
    })
  }

  answer(addr: string, id: string, b: any) {
    const m = this.db.matches[id]
    if (!m?.trivia) throw bad('Match not found', 404)
    this.tick(m)
    const pl = m.players.find((p) => p.player.address === addr)
    if (!pl) throw bad('Not your match', 403)
    if (m.status !== 'playing') throw bad('The round is not live')
    const answers = (m.trivia.answers[addr] ??= [])
    const qi = Number(b.q)
    if (qi !== answers.length) throw bad('Out of order answer')
    const q = m.trivia.questions[qi]
    if (!q) throw bad('No such question')
    const choice = Number.isInteger(b.choice) ? Number(b.choice) : -1 // -1 = timed out
    // Server-timed: from when this question was first shown to this player to now, less a small allowance for the
    // network. The device's own figure is only used when it is slower (never faster) than the server's.
    const now = Date.now()
    const shownAt = this.serve(m, addr, qi)
    if (now < shownAt - 250) throw bad('Wait for the question')
    const serverMs = Math.max(0, now - shownAt - TRIVIA_NET_MS)
    const clientMs = Number(b.ms)
    let ms = Math.max(serverMs, Number.isFinite(clientMs) ? Math.min(clientMs, now - shownAt) : 0)
    ms = Math.max(0, Math.min(TRIVIA_Q_MS, Math.round(ms)))
    const correct = choice === q.answer
    const a = { choice, ms, correct, points: correct ? triviaPoints(ms) : 0 }
    answers.push(a)
    pl.progress = answers.reduce((s, x) => s + x.points, 0)
    if (answers.length >= m.trivia.questions.length && !pl.result) {
      pl.result = { score: pl.progress, time: answers.reduce((s, x) => s + x.ms, 0), detail: { correct: answers.filter((x) => x.correct).length } }
    }
    this.maybeSettle(m)
    this.store.save()
    const done = answers.length >= m.trivia.questions.length
    // the app shows the fact (or the right answer) for a moment before the next question; the clock starts after that
    if (!done) this.serve(m, addr, answers.length, now + triviaPause(!!q.fact))
    const view = this.view(m, addr)
    const nq = !done ? m.trivia.questions[answers.length] : undefined
    return { ...a, answer: q.answer, fact: q.fact, pip: m.trivia.pip?.[qi], done, next: nq ? { q: nq.q, options: nq.options, category: nq.category } : undefined, match: view }
  }

  // ----- generic score games -----

  progress(addr: string, id: string, score: number) {
    const m = this.db.matches[id]
    const pl = m?.players.find((p) => p.player.address === addr)
    if (!m || !pl) throw bad('Match not found', 404)
    if (m.status === 'playing' && !pl.result && isFinite(score)) pl.progress = Math.max(0, Math.round(score))
    return { ok: true }
  }

  result(addr: string, id: string, b: any) {
    const m = this.db.matches[id]
    const pl = m?.players.find((p) => p.player.address === addr)
    if (!m || !pl) throw bad('Match not found', 404)
    this.tick(m)
    if (m.game === 'trivia') throw bad('Trivia is scored by the server')
    if (m.game === 'splat') throw bad('Splat Royale is scored by the server')
    if (m.live) throw bad('This game is played live, moves go through the relay')
    if (m.status !== 'playing') throw bad(m.status === 'settled' ? 'Already settled' : 'The round is not live')
    if (pl.result) return this.view(m, addr)
    const score = Math.max(0, Number(b.score) || 0)
    const time = Math.max(0, Math.min(GAME_DURATION_MS[m.game] + GRACE_MS, Number(b.time) || 0))
    if (m.game === 'sudoku' && b.detail?.solved && Array.isArray(b.detail.grid)) {
      const pz = makeSudoku(m.seed, 9)
      if (JSON.stringify(b.detail.grid) !== JSON.stringify(pz.solution)) throw bad('That grid does not solve this puzzle')
    }
    if (m.game === 'lastbite' && b.detail?.solved && Array.isArray(b.detail.grid)) {
      const pz = makeSudoku(m.seed, 4)
      if (JSON.stringify(b.detail.grid) !== JSON.stringify(pz.solution)) throw bad('That grid does not solve this puzzle')
    }
    let finalScore = score
    let finalTime = time
    // 'verified' is only ever set by the server's own replay below. A client can never claim it
    let detail = b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail) ? { ...b.detail } : b.detail
    if (detail && typeof detail === 'object' && 'verified' in detail) delete detail.verified
    // Solitaire and Bubble: the client sends its move log, the server replays it from the match seed and scores it itself.
    if (m.game === 'solitaire' || m.game === 'bubble') {
      const limitMs = GAME_DURATION_MS[m.game] + GRACE_MS
      const r = m.game === 'solitaire' ? replaySolitaire(m.seed, b.detail?.moves, limitMs) : replayBubble(m.seed, b.detail?.shots, limitMs)
      if (r.ok) {
        finalScore = r.score
        if ('lastAt' in r) finalTime = Math.max(time, r.lastAt)
        detail = { verified: true, ...('moves' in r ? { moves: r.moves } : { shots: r.shots, popped: r.popped }) }
      } else {
        finalScore = 0
        detail = { verified: false, reason: r.reason }
      }
    }
    const sk = REPLAYS[m.game]
    if (sk) {
      const r = sk.run(m.seed, b.detail?.[sk.key], GAME_DURATION_MS[m.game] + GRACE_MS)
      if (r.ok) {
        finalScore = r.score
        finalTime = Math.max(time, r.lastAt)
        detail = { verified: true, ...r.detail }
      } else {
        finalScore = 0
        detail = { verified: false, reason: r.reason }
      }
    }
    if (m.game === 'word') {
      const d = wordDict()
      finalScore = scoreWords(b.detail?.words, wordRack(m.seed, sevensOf([...d])), d).score
    }
    pl.result = { score: finalScore, time: finalTime, detail }
    pl.progress = finalScore
    this.maybeSettle(m)
    this.store.save()
    return this.view(m, addr)
  }

  // ---------------- live head-to-head (chess, pool) ----------------

  /** Chess and pool between two people run on the server, so the result cannot be reported by a client. */
  private isLive(m: MatchRec) {
    return ENGINE_GAMES.includes(m.game) && m.players.length === 2 && m.players.every((p) => !p.isBot)
  }

  private seatOf(m: MatchRec, addr: string): 0 | 1 {
    return m.players.findIndex((p) => p.player.address === addr) === 0 ? 0 : 1
  }

  move(addr: string, id: string, b: any) {
    const m = this.db.matches[id]
    if (!m || !m.players.some((p) => p.player.address === addr)) throw bad('Match not found', 404)
    this.tick(m)
    if (!m.live) throw bad(m.status === 'settled' ? 'Already settled' : 'This match is not live')
    if (m.status !== 'playing') throw bad('The match is over')
    const seat = this.seatOf(m, addr)
    const now = Date.now()
    try {
      if (b?.resign) {
        if (m.live.kind === 'chess') chessResign(m.live, seat)
        else poolResign(m.live, seat)
      } else if (m.live.kind === 'chess') chessMove(m.live, seat, b ?? {}, now)
      else poolShot(m.live, seat, b ?? {}, now)
    } catch (e) {
      throw bad(e instanceof Error ? e.message : 'Bad move')
    }
    this.syncLive(m, now)
    this.store.save()
    return this.view(m, addr, -1)
  }

  /** Clocks, match timer, and turning a finished game into results. */
  private syncLive(m: MatchRec, now: number) {
    const l = m.live as ChessLive | PoolLive | undefined
    if (!l || m.status !== 'playing') return
    if (!l.over) {
      if (l.kind === 'chess') chessTick(l, now)
      else poolTick(l, now)
    }
    if (!l.over && m.startsAt && now >= m.startsAt + GAME_DURATION_MS[m.game]) {
      if (l.kind === 'chess') chessTimeUp(l)
      else poolTimeUp(l)
    }
    if (!l.over) return
    const elapsed = Math.max(0, Math.min(GAME_DURATION_MS[m.game], now - (m.startsAt ?? now)))
    m.players.forEach((p, i) => {
      if (p.result) return
      const score = l.kind === 'chess' ? chessScore(l, i as 0 | 1) : poolScore(l, i as 0 | 1)
      p.result = { score, time: elapsed, detail: { live: true, reason: l.over!.reason } }
      p.progress = score
    })
    this.maybeSettle(m)
    if (m.settlement) {
      const o = l.over
      const why: Record<string, string> = { checkmate: 'Checkmate', timeout: 'Won on time', resign: 'Resigned', eight: 'Sank the 8-ball', idle: 'Opponent left the table', time: 'Time up' }
      m.settlement.reason = o.winner === null ? (o.reason === 'stalemate' ? 'Stalemate' : 'Draw') : (why[o.reason] ?? 'Best score wins')
    }
  }

  // ---------------- lifecycle ----------------

  tick(m: MatchRec) {
    const now = Date.now()
    if (m.game === 'splat') {
      if (m.status === 'ready') this.ensureSplatRun(m.id)
      else if (m.status === 'playing' && !this.splat.has(m.id)) return void this.abortSplat(m)
    }
    if (m.game === 'splat' && m.opp === 'auto' && m.status === 'lobby' && m.players.length >= 2 && now - m.createdAt > AUTO_SPLAT_WAIT) {
      // an auto-matched arena starts with whoever is in once the wait is up
      m.size = m.players.length
      m.config.seats = m.size
      this.readyUp(m)
      this.store.save()
    } else if (m.status === 'lobby' && now - m.createdAt > LOBBY_TTL) void this.cancelMatch(m, 'Nobody joined in time')
    else if (m.status === 'terms' && m.fundBy && now > m.fundBy) void this.cancelMatch(m, 'The terms were not agreed in time. Nothing was locked')
    else if (m.status === 'funding' && m.fundBy && now > m.fundBy) {
      // a seat that said it was paying gets one last look on chain first; otherwise cancel now
      const waiting = m.players.some((p) => !p.funded && !p.isBot && m.paying?.[p.player.address])
      if (waiting) void this.expireFunding(m)
      else void this.cancelMatch(m, 'Deposits were not all in on time, funds refunded')
    }
    else if (m.status === 'ready' && m.startsAt && now >= m.startsAt) {
      m.status = 'playing'
      m.endsAt = m.startsAt + GAME_DURATION_MS[m.game] + GRACE_MS
      if (m.game === 'splat') {
        m.endsAt = m.startsAt + Math.round(this.splat.capTicks * SPLAT_TICK_MS) + GRACE_MS
      }
      if (this.isLive(m)) m.live = m.game === 'chess' ? initChess(m.seed, m.startsAt) : initPool(m.seed, m.startsAt)
      this.store.save()
    } else if (m.status === 'playing' && m.live && !m.live.over) {
      this.syncLive(m, now)
    } else if (m.status === 'playing' && m.endsAt && now > m.endsAt + FORFEIT_AFTER) {
      this.settle(m, true)
    }
  }

  ensureSplatRun(id: string) {
    const m = this.db.matches[id]
    if (m && m.game === 'splat' && (m.status === 'ready' || m.status === 'playing')) this.splat.ensure(m)
  }

  /** The server lost the run (a restart mid-match). Nobody can be ranked fairly, so every stake goes back. */
  private abortSplat(m: MatchRec) {
    for (const p of m.players) p.result = { score: -1, time: 0 }
    this.settle(m, true)
  }

  /** The sim finished: turn its order into results. Rank 1 gets the top score, so the normal settle does the rest. */
  private splatFinish(m: MatchRec, order: number[], sim: import('../shared/splat').Sim) {
    if (m.status !== 'playing') return
    order.forEach((seat, i) => {
      const sp = sim.players[seat]
      m.players[seat].result = {
        score: m.players.length - i, time: Math.round(sp.alive ? sim.tick * SPLAT_TICK_MS : sp.out * SPLAT_TICK_MS),
        detail: { place: i + 1, out: sp.alive ? null : Math.round(sp.out * SPLAT_TICK_MS), splats: sp.splats, hp: sp.hp, alive: sp.alive },
      }
    })
    this.settle(m, false)
  }

  tickAll() {
    this.payPool()
    void this.scanAll()
    for (const m of Object.values(this.db.matches)) {
      if (m.status !== 'settled' && m.status !== 'cancelled') this.tick(m)
      else if (m.settlement?.payouts.some((p) => this.dueForPayout(p))) this.runPayouts(m)
    }
  }

  private maybeSettle(m: MatchRec) {
    if (m.status !== 'playing') return
    const humans = m.players.filter((p) => !p.isBot)
    if (humans.every((p) => p.result)) this.settle(m, false)
  }

  private settle(m: MatchRec, forfeit: boolean) {
    if (m.settled) return
    m.settled = true
    m.status = 'settled'
    // score every player; bots score from the shared seed
    const rows = m.players.map((p) => {
      let score = p.result?.score ?? -1
      let time = p.result?.time ?? Number.MAX_SAFE_INTEGER
      if (p.isBot) {
        if (m.game === 'splat') {
          score = p.result?.score ?? -1
          time = p.result?.time ?? 0
        } else if (m.trivia?.pip) {
          score = m.trivia.pip.reduce((s, a) => s + a.points, 0)
          time = m.trivia.pip.reduce((s, a) => s + a.ms, 0)
        } else if (ENGINE_GAMES.includes(m.game)) {
          const human = m.players.find((x) => !x.isBot)?.result
          score = human ? 1 - human.score : 0
          time = human?.time ?? 0
        } else {
          const ps = pipScore(m.game, m.pipLevel ?? 'med', m.seed)
          score = ps.score
          time = ps.time
        }
        p.result = { score, time }
      }
      return { address: p.player.address, score, time }
    })
    const sorted = [...rows].sort((a, b) => b.score - a.score || a.time - b.time)
    const ranks = sorted.map((r, i) => ({ ...r, rank: i + 1 }))
    // equal score and time (or both forfeited) => tied
    for (let i = 1; i < ranks.length; i++) if (ranks[i].score === ranks[i - 1].score && ranks[i].time === ranks[i - 1].time) ranks[i].rank = ranks[i - 1].rank
    const allForfeit = rows.every((r) => r.score < 0)
    const draw = ranks.length > 1 && ranks.every((r) => r.rank === 1) || allForfeit
    const winner = draw ? undefined : ranks[0].address
    const payouts: Payout[] = []
    const jarCredit: Record<string, number> = {}
    let poolFee = 0
    const xpBonus: Record<string, number> = {}
    const xp: Record<string, number> = {}
    const humans = m.players.filter((p) => !p.isBot)

    if ((m.mode === 'save' || m.mode === 'win') && !allForfeit) {
      // Save: the winnings go into the winner's locked jar. Win: they are paid straight to the winner's wallet. Either way 2% goes to the savers.
      const give = (addr: string, luna: number) => {
        if (m.mode === 'save') jarCredit[addr] = luna
        else {
          const p = m.players.find((x) => x.player.address === addr)!
          payouts.push({ ...this.dest(p), luna, kind: 'prize', note: ranks.length > 2 ? `Place ${ranks.find((r) => r.address === addr)!.rank} prize` : 'You won the pot' })
        }
      }
      if (draw) for (const p of humans) payouts.push({ ...this.dest(p), luna: p.escrowed, kind: 'refund', note: 'Draw, stake returned' })
      else {
        const pot = m.players.reduce((s, p) => s + p.escrowed, 0)
        poolFee = saveFee(pot) // a small slice of every pot goes to the savers
        this.pool.luna += poolFee
        this.pool.feesTotal = (this.pool.feesTotal ?? 0) + poolFee
        if (m.size > 2 || m.game === 'splat') {
          // places are a strict order. Winner takes all, or 60/30/10 to the top three.
          const shares = splatShares(pot - poolFee, (m.config.payout as Payout3) ?? 'wta', ranks.length)
          shares.forEach((amt, i) => { if (amt > 0) give(ranks[i].address, amt) })
        } else give(winner!, pot - poolFee)
      }
    } else if (m.mode === 'settle' && m.terms && !allForfeit) {
      // the loser pays their agreed share, the winner pays the rest, a draw splits it evenly. Each player's unused lock
      // goes back to them and the bill goes to the payee they agreed. A Splat Royale bill splits by finishing place instead.
      const t = m.terms
      const n = m.players.length
      let shares: number[]
      if (t.split === 'place') {
        const byPlace = draw ? evenShares(t.bill, n) : placeShares(t.bill, n)
        shares = m.players.map((p) => byPlace[draw ? m.players.indexOf(p) : Math.max(0, ranks.findIndex((r) => r.address === p.player.address))])
      } else {
        const sh = settleShares(t.bill, t.loserPct)
        const dr = drawShares(t.bill)
        shares = m.players.map((p, i) => (draw ? dr[i] : p.player.address === winner ? sh.winner : sh.loser))
      }
      m.players.forEach((p, i) => (p.share = shares[i]))
      const payeeSeat = 'seat' in t.payee ? t.payee.seat : -1
      let toPayee = 0
      m.players.forEach((p, i) => {
        const share = p.share ?? 0
        toPayee += share
        // a payee who is also a player keeps their own share, so all of their lock comes back
        const back = i === payeeSeat ? p.escrowed : p.escrowed - share
        if (back > 0) payouts.push({ ...this.dest(p), luna: back, kind: 'refund', note: i === payeeSeat ? 'Your lock, you are the payee' : 'Unused part of your lock' })
      })
      if (payeeSeat >= 0) {
        const others = m.players.filter((_, i) => i !== payeeSeat)
        const amt = others.reduce((a, p) => a + (p.share ?? 0), 0)
        const note = others.length === 1 ? `${others[0].player.name}'s share of the bill` : `${others.length} players' shares of the bill`
        if (amt > 0) payouts.push({ ...this.dest(m.players[payeeSeat]), luna: amt, kind: 'settle', note })
      } else if (toPayee > 0 && 'address' in t.payee) payouts.push({ to: t.payee.address, luna: toPayee, kind: 'settle', note: n === 2 ? `Bill settled by ${m.players[0].player.name} and ${m.players[1].player.name}` : `Bill settled by ${n} players` })
    } else if (allForfeit || forfeit) {
      // nobody finished: give everything back
      for (const p of humans) if (p.escrowed > 0 && m.mode !== 'play') payouts.push({ ...this.dest(p), luna: p.escrowed, kind: 'refund', note: 'Match did not finish' })
    }

    for (const r of ranks) {
      const rec = this.db.profiles[r.address]
      if (!rec) continue
      const won = !draw && r.rank === 1
      const base = r.score < 0 ? 5 : won ? 60 : draw ? 30 : m.size > 2 ? [60, 40, 30, 20][Math.min(3, r.rank - 1)] : 20
      const staked = m.mode === 'play' ? 0 : 20
      const raw = base + (r.score >= 0 ? staked : 0)
      // streak and a locked jar make XP come faster; a forfeit earns no bonus
      const pctNow = r.score >= 0 ? streakXpPct(this.streakOf(rec).streak) + lockXpPct(this.planOf(rec).lockDays, rec.jarLuna > 0 && rec.jarUnlockAt > Date.now()) : 0
      xp[r.address] = withXpBonus(raw, pctNow)
      if (pctNow) xpBonus[r.address] = pctNow
      rec.xp += xp[r.address]
      this.rollWeek(rec)
      rec.weekXp += xp[r.address]
      rec.played++
      if (won) rec.wins++
      const today = day()
      if (!rec.activeDays.includes(today)) rec.activeDays.push(today)
      rec.activeDays = rec.activeDays.slice(-60)
      if (rec.questDay !== today) {
        rec.questDay = today
        rec.questWins = 0
      }
      if (won) rec.questWins++
      if (jarCredit[r.address]) this.creditJar(rec, jarCredit[r.address])
      this.syncChests(rec)
      for (const other of humans) if (other.player.address !== r.address && !rec.friends.includes(other.player.address)) rec.friends.push(other.player.address)
    }
    m.settlement = {
      winner, draw: draw || undefined, ranks: ranks.map((r) => ({ address: r.address, rank: r.rank, score: Math.max(0, r.score), time: r.time === Number.MAX_SAFE_INTEGER ? 0 : r.time })),
      payouts, xp, jarCredit, ...(poolFee ? { fee: poolFee } : {}), ...(Object.keys(xpBonus).length ? { xpBonus } : {}),
      reason: allForfeit ? (m.game === 'splat' ? 'The match could not finish, stakes returned' : 'Nobody finished') : forfeit ? 'A player ran out of time and forfeited' : draw ? 'Dead heat' : m.game === 'splat' ? 'Last one standing' : 'Best score wins',
    }
    this.store.save()
    this.runPayouts(m)
    try { this.onSettled?.(m, forfeit) } catch (e) { console.error('[campaign] settle hook failed', e) }
  }

  /** The saver's plan. Older jars have no stored plan, so they get the default tier and an inferred lock start. */
  planOf(p: ProfileRec): Plan {
    const lockDays = (isTier(p.plan?.lockDays) ? p.plan!.lockDays : isTier(this.lockDays) ? this.lockDays : 30) as LockDays
    const legacyStart = p.jarUnlockAt > 0 ? p.jarUnlockAt - this.lockDays * 864e5 : 0
    return { goalLuna: p.plan?.goalLuna ?? DEFAULT_GOAL_LUNA, lockDays, lockStartAt: p.lockStartAt ?? legacyStart }
  }

  /** Adds to the jar. A deposit into an empty or unlocked jar starts the lock. A deposit into a locked jar keeps the lock as it is. */
  private creditJar(p: ProfileRec, luna: number) {
    const now = Date.now()
    const fresh = p.jarLuna <= 0 || p.jarUnlockAt <= now
    p.jarLuna += luna
    if (fresh) {
      p.lockStartAt = now
      p.jarUnlockAt = now + this.planOf(p).lockDays * 864e5
    }
  }

  get pool() {
    return (this.db.pool ??= { luna: 0 })
  }

  /** A payout is tried six times in a row, then once every 5 minutes for about 4 hours. A refund must not be lost to an RPC outage or an empty float. */
  private dueForPayout(p: any, now = Date.now()) {
    if (p.tx || p.inflight || p.luna < 1) return false
    const n = p.attempts ?? 0
    return n < 6 || (n < 54 && now - (p.lastTryAt ?? 0) >= 5 * 60_000)
  }

  /** Everything the escrow owes right now: jars, the saver pool, stakes locked in live matches and payouts not yet sent.
   *  The escrow balance should always be at least this. The difference is the float that pays network fees. */
  liabilities() {
    let jars = 0
    for (const p of Object.values(this.db.profiles)) jars += p.jarLuna
    let live = 0
    let unpaid = 0
    for (const m of Object.values(this.db.matches)) {
      if (m.status === 'settled' || m.status === 'cancelled') {
        for (const p of m.settlement?.payouts ?? []) if (!p.tx) unpaid += p.luna
      } else {
        for (const p of m.players) if (p.funded && !p.isBot) live += p.escrowed
      }
    }
    const pool = this.pool.luna
    // deposits that could not be counted are owed back to whoever paid them
    let orphans = 0
    for (const o of Object.values(this.db.orphans ?? {})) if (o.status === 'open') orphans += o.luna
    return { jars, pool, live, unpaid, orphans, total: jars + pool + live + unpaid + orphans }
  }

  private runPayouts(m: MatchRec) {
    const s = m.settlement
    if (!s) return
    s.payouts.forEach(async (p: any, i) => {
      if (!this.dueForPayout(p)) return
      p.inflight = true
      p.attempts = (p.attempts ?? 0) + 1
      p.lastTryAt = Date.now()
      try {
        p.tx = await this.chain.pay(p.to, p.luna, `nb:${m.id}:${p.kind}${i}`)
        delete p.error
      } catch (e: any) {
        p.error = String(e?.message ?? e).slice(0, 120)
      } finally {
        p.inflight = false
        this.store.save()
      }
    })
  }

  // ---------------- jar + vault ----------------

  /** Where the jar stands: plan, lock, what an early unlock would cost right now. */
  jarInfo(addr: string) {
    this.payPool()
    const p = this.must(addr)
    const now = Date.now()
    const plan = this.planOf(p)
    const locked = p.jarLuna > 0 && p.jarUnlockAt > now
    const q = locked ? earlyFee(p.jarLuna, plan.lockStartAt, p.jarUnlockAt, now) : { fee: 0, pct: 0 }
    return {
      plan, jarLuna: p.jarLuna, unlockAt: p.jarUnlockAt, locked,
      early: { fee: q.fee, pct: q.pct, net: p.jarLuna - q.fee },
      canChangeLock: !locked,
      pool: this.poolInfo(addr),
      boost: { levelPct: levelBoostPct(levelFor(p.xp).level), totalPct: this.boostPct(p) },
      interest: { last: p.interestLast ?? 0, lastDay: p.interestDay ?? '', week: p.interestWeekKey === weekKey() ? p.interestWeek ?? 0 : 0, total: p.interestTotal ?? 0 },
      serverNow: now,
    }
  }

  setPlan(addr: string, b: { goalNim?: unknown; lockDays?: unknown }) {
    const p = this.must(addr)
    const cur = this.planOf(p)
    let { goalLuna, lockDays } = cur
    if (b.goalNim !== undefined) {
      const g = Number(b.goalNim)
      if (!Number.isFinite(g) || g < 1 || g > MAX_GOAL_NIM) throw bad(`A goal is between 1 and ${MAX_GOAL_NIM.toLocaleString('en-US')} NIM`)
      goalLuna = Math.round(g * LUNA)
    }
    if (b.lockDays !== undefined) {
      if (!isTier(b.lockDays)) throw bad('Pick a lock of 7, 30 or 90 days')
      if (b.lockDays !== lockDays && p.jarLuna > 0 && p.jarUnlockAt > Date.now()) throw bad('The lock length can change when your jar is empty or unlocked')
      lockDays = b.lockDays
    }
    p.plan = { goalLuna, lockDays }
    this.store.save()
    return this.jarInfo(addr)
  }

  // ---------------- chests ----------------
  /** Gives out every chest the player has earned and not yet received. Safe to run any number of times. */
  syncChests(p: ProfileRec) {
    const today = day()
    const { streak, start } = this.streakOf(p)
    const level = levelFor(p.xp).level
    if (p.lvlSeen === undefined) p.lvlSeen = level // players from before chests do not get a flood
    p.chests ??= []
    const have = new Set(p.chests.map((c) => c.id))
    const due = chestsDue({ today, wins: p.questDay === today ? p.questWins : 0, streak, streakStart: start, level, lvlSeen: p.lvlSeen })
    for (const c of due) if (!have.has(c.id)) p.chests.push(c)
    p.lvlSeen = Math.max(p.lvlSeen, level)
    p.chests = p.chests.slice(-60)
  }

  weekKeyNow() { return weekKey() }

  devThreeWins(addr: string) {
    const p = this.must(addr)
    p.questDay = day()
    p.questWins = 3
    if (!p.activeDays.includes(day())) p.activeDays.push(day())
    this.syncChests(p)
    this.store.save()
    return { chests: (p.chests ?? []).length }
  }

  setStyle(addr: string, b: { frame?: unknown; theme?: unknown }) {
    const p = this.must(addr)
    const owned = unlockedCosmetics(levelFor(p.xp).level, p.cosmetics ?? [])
    const pick = (v: unknown, kind: 'frame' | 'theme') => {
      if (v === undefined) return undefined
      if (v === '' || v === null) return ''
      const id = String(v)
      if (!id.startsWith(kind + ':') || !COSMETICS.some((c) => c.id === id)) throw bad('Unknown style')
      if (!owned.includes(id)) throw bad('Not unlocked yet')
      return id
    }
    const f = pick(b.frame, 'frame'), t = pick(b.theme, 'theme')
    if (f !== undefined) p.frame = f
    if (t !== undefined) p.theme = t
    this.store.save()
    return this.profile(addr)
  }

  /** Weekly saver board: ranked by interest earned this week, then by how much is locked and for how long. */
  saverBoard(address: string) {
    this.payPool()
    const now = Date.now()
    const wk = weekKey()
    const rows = Object.values(this.db.profiles)
      .map((p) => ({ p, interest: p.interestWeekKey === wk ? p.interestWeek ?? 0 : 0, locked: p.jarLuna > 0 && p.jarUnlockAt > now }))
      .filter((r) => r.interest > 0 || r.locked)
      .map((r) => ({ ...r, weight: r.locked ? Number(poolWeight(r.p.jarLuna, this.planOf(r.p).lockDays, 0)) : 0 }))
      .sort((a, b) => b.interest - a.interest || b.weight - a.weight || a.p.createdAt - b.p.createdAt)
    const list = rows.map((r, i) => ({
      rank: i + 1, address: r.p.address, name: r.p.name, avatar: r.p.avatar, frame: r.p.frame ?? '', level: levelFor(r.p.xp).level,
      interest: r.interest, saved: r.p.jarLuna, lockDays: this.planOf(r.p).lockDays, locked: r.locked, me: r.p.address === address,
    }))
    return { week: wk, rows: list.slice(0, 25), me: list.find((r) => r.me) ?? null, total: rows.length }
  }

  chestList(addr: string) {
    const p = this.must(addr)
    this.syncChests(p)
    this.store.save()
    const now = Date.now()
    return {
      chests: [...p.chests!].sort((a, b) => (a.openedAt ? 1 : 0) - (b.openedAt ? 1 : 0) || b.at - a.at).map((c) => ({
        id: c.id, kind: c.kind, level: c.level, title: CHEST_TITLES[c.kind], why: CHEST_WHY[c.kind] + (c.level ? ` ${c.level}` : ''),
        at: c.at, openedAt: c.openedAt ?? 0, contents: chestContents(c.kind, c.level),
      })),
      boost: { levelPct: levelBoostPct(levelFor(p.xp).level), chestPct: Math.max(0, ...(p.boosts ?? []).filter((b) => b.until > now).map((b) => b.pct)), until: Math.max(0, ...(p.boosts ?? []).filter((b) => b.until > now).map((b) => b.until)), totalPct: this.boostPct(p) },
      badges: p.badges ?? [], cosmetics: p.cosmetics ?? [],
    }
  }

  /** Opens a chest and hands over exactly what its kind says. No NIM, no dice. */
  openChest(addr: string, id: string) {
    const p = this.must(addr)
    this.syncChests(p)
    const c = p.chests!.find((x) => x.id === id)
    if (!c) throw bad('No such chest')
    if (c.openedAt) throw bad('That chest is already open')
    const ct = chestContents(c.kind, c.level)
    c.openedAt = Date.now()
    p.xp += ct.xp
    this.rollWeek(p)
    p.weekXp += ct.xp
    if (ct.badge && !(p.badges ??= []).includes(ct.badge)) p.badges.push(ct.badge)
    if (ct.cosmetic && !(p.cosmetics ??= []).includes(ct.cosmetic)) p.cosmetics.push(ct.cosmetic)
    if (ct.boost) (p.boosts ??= []).push({ pct: ct.boost.pct, until: Date.now() + ct.boost.hours * 36e5 })
    p.boosts = (p.boosts ?? []).filter((b) => b.until > Date.now()).slice(-10)
    this.syncChests(p) // the XP can lift the level, which earns its own chest
    this.store.save()
    return { opened: { id: c.id, kind: c.kind, level: c.level, contents: ct }, profile: this.profile(addr) }
  }

  /** Total saver boost, in percent: level plus chests, capped. */
  boostPct(p: ProfileRec): number {
    const now = Date.now()
    const chest = Math.max(0, ...(p.boosts ?? []).filter((b) => b.until > now).map((b) => b.pct))
    return Math.min(BOOST_TOTAL_MAX, levelBoostPct(levelFor(p.xp).level) + chest)
  }

  private weights(now = Date.now()) {
    const w: Record<string, bigint> = {}
    for (const p of Object.values(this.db.profiles)) {
      if (p.jarLuna <= 0 || p.jarUnlockAt <= now) continue // only locked jars earn: the lock is the deal
      const x = poolWeight(p.jarLuna, this.planOf(p).lockDays, this.boostPct(p))
      if (x > 0n) w[p.address] = x
    }
    return w
  }

  poolInfo(addr?: string) {
    const now = Date.now()
    const w = this.weights(now)
    const d = poolDay(this.pool.luna, w, this.poolCap, POOL_DAILY_PCT)
    const mine = addr && w[addr] ? Number((BigInt(d.day) * w[addr]) / Object.values(w).reduce((s, x) => s + x, 0n)) : 0
    const next = new Date(now)
    return {
      luna: this.pool.luna, dailyCap: this.poolCap, dailyPct: POOL_DAILY_PCT, savers: Object.keys(w).length,
      today: d.day, estimate: mine, nextPayoutAt: Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate() + 1),
    }
  }

  get poolCap() {
    return process.env.POOL_DAILY_CAP_NIM ? Math.round(Number(process.env.POOL_DAILY_CAP_NIM) * LUNA) : POOL_DAILY_CAP
  }

  /** Pays today's interest once per UTC day. The pool only moves money between claims already held in escrow. */
  payPool(now = Date.now()) {
    const today = day(now)
    if (this.pool.lastPayDay === today) return { paid: 0 }
    this.pool.lastPayDay = today
    const d = poolDay(this.pool.luna, this.weights(now), this.poolCap, POOL_DAILY_PCT)
    for (const [a, luna] of Object.entries(d.shares)) {
      const p = this.db.profiles[a]
      p.jarLuna += luna // the lock is untouched
      p.interestDay = today
      p.interestLast = luna
      const wk = weekKey(now)
      p.interestWeek = (p.interestWeekKey === wk ? p.interestWeek ?? 0 : 0) + luna
      p.interestWeekKey = wk
      p.interestTotal = (p.interestTotal ?? 0) + luna
    }
    this.pool.luna = Math.max(0, this.pool.luna - d.paid)
    this.pool.paidTotal = (this.pool.paidTotal ?? 0) + d.paid
    this.store.save()
    return { paid: d.paid }
  }

  async withdrawJar(addr: string, early = false) {
    const p = this.must(addr)
    if (p.jarLuna <= 0) throw bad('Your jar is empty')
    const now = Date.now()
    const locked = now < p.jarUnlockAt
    if (locked && !early) throw bad('Your jar is still locked')
    const plan = this.planOf(p)
    const fee = locked ? earlyFee(p.jarLuna, plan.lockStartAt, p.jarUnlockAt, now).fee : 0
    const held = p.jarLuna
    const luna = held - fee
    const was = { unlockAt: p.jarUnlockAt, startAt: p.lockStartAt }
    p.jarLuna = 0 // zero first so a double tap can't pay twice
    p.jarUnlockAt = 0
    p.lockStartAt = 0
    this.pool.luna += fee // the fee stays in escrow and goes to the savers who stay
    this.store.save()
    try {
      const tx = await this.chain.pay(p.payAddr ?? addr, luna, fee ? 'nb:jar:early' : 'nb:jar:withdraw')
      return { tx, luna, fee, profile: this.profile(addr) }
    } catch (e) {
      p.jarLuna += held
      p.jarUnlockAt = was.unlockAt
      p.lockStartAt = was.startAt
      this.pool.luna -= fee
      this.store.save()
      throw bad('The payout did not go through, your jar is untouched. Try again')
    }
  }

  vaultPuzzle(dayKey = day()) {
    return makeSudoku('vault:' + dayKey, 4, 7)
  }

  vaultSolve(addr: string, grid: number[]) {
    const p = this.must(addr)
    const today = day()
    if (p.vaultDay === today) return { already: true, profile: this.profile(addr) }
    const pz = this.vaultPuzzle(today)
    if (!Array.isArray(grid) || JSON.stringify(grid) !== JSON.stringify(pz.solution)) throw bad('That grid is not right yet')
    p.vaultDay = today
    if (!p.activeDays.includes(today)) p.activeDays.push(today)
    const before = this.profile(addr).streak
    p.xp += 30
    this.rollWeek(p)
    p.weekXp += 30
    let bonus = 0
    if (before > 0 && before % 7 === 0) {
      bonus = 100
      p.xp += bonus
      p.weekXp += bonus
    }
    this.syncChests(p)
    this.store.save()
    return { solved: true, xp: 30 + bonus, profile: this.profile(addr) }
  }

  async vaultDeposit(addr: string, txHash: string, amountNim: number) {
    const p = this.must(addr)
    const today = day()
    if (p.vaultDay !== today) throw bad('Solve today\'s vault puzzle first')
    if (![0.5, 1, 2].includes(amountNim)) throw bad('Pick 0.5, 1 or 2 NIM')
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    const memo = 'nb:vault:' + today.replace(/-/g, '')
    const check = await this.chain.verifyDeposit(txHash, { luna: toLuna(amountNim), memo })
    if (!check.ok) {
      if (check.pending) return { pending: true, reason: check.reason }
      throw bad(check.reason)
    }
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    this.db.usedTx[txHash] = 'vault'
    // the jar is the signed-in profile's; if a different wallet paid, withdrawals go back to that wallet
    p.payAddr = check.owner && !sameAddr(check.owner, addr) ? normAddr(check.owner) : undefined
    this.creditJar(p, toLuna(amountNim))
    p.vaultDeposits++
    this.store.save()
    return { profile: this.profile(addr) }
  }
}

export const triviaPoints = (ms: number) => 100 + Math.round(40 * Math.max(0, 1 - ms / TRIVIA_Q_MS))
export const LUNA_PER_NIM = LUNA
