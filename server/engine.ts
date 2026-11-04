import { createHash, randomBytes } from 'node:crypto'
import { Store, type MatchRec, type ProfileRec } from './store'
import { isNimiqAddress, sameAddr, type Chain } from './chain'
import { generateTrivia } from './ai'
import { billShares, escrowRequired, toLuna } from '../shared/economy'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sevensOf, scoreWords, wordRack } from '../shared/words'
import { chessMove, chessResign, chessScore, chessTick, chessTimeUp, initChess, type ChessLive } from '../shared/chessgame'
import { initPool, poolResign, poolScore, poolShot, poolTick, poolTimeUp, type PoolLive } from '../shared/poolgame'
import { ENGINE_GAMES, GAME_DURATION_MS, PIP_ADDRESS, PIP_NAMES, PIP_TRIVIA, pipScore } from '../shared/pip'
import { rng } from '../shared/rng'
import { replaySolitaire } from '../shared/solitaire'
import { replayBubble } from '../shared/bubblesim'
import { makeSudoku } from '../shared/puzzles'
import {
  GAMES, LUNA, STAKES, levelFor,
  type GameId, type Mode, type OppKind, type Payout, type PipLevel, type Profile, type PublicMatch, type Result, type Settlement,
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
const GRACE_MS = 25000
const LOBBY_TTL = 15 * 60_000
const FUND_TTL = 3 * 60_000
const FORFEIT_AFTER = 45_000

let DICT: Set<string> | undefined
const wordDict = () => (DICT ??= new Set(readFileSync(fileURLToPath(new URL('../assets/words/dict.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)))

export class Engine {
  lockDays = Number(process.env.JAR_LOCK_DAYS ?? 30)
  /** Per-match cap in NIM. Mainnet defaults to a small cap until it is raised on purpose. */
  get maxStakeNim() {
    return Number(process.env.MAX_STAKE_NIM ?? (this.chain.kind === 'nimiq' && this.chain.network === 'mainnet' ? 25 : 1000))
  }
  constructor(public store: Store, public chain: Chain) {}
  get db() {
    return this.store.db
  }

  // ---------------- profiles / sessions ----------------

  session(addressIn: string, name?: string, avatar?: string): { token: string; profile: Profile } {
    const address = String(addressIn || '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!isNimiqAddress(address)) throw bad('That is not a valid Nimiq address')
    let p = this.db.profiles[address]
    if (!p) {
      p = this.db.profiles[address] = {
        address,
        name: 'Player ' + address.replace(/\s/g, '').slice(-4),
        avatar: AVATARS[parseInt(sha(address).slice(0, 4), 16) % AVATARS.length],
        xp: 0, weekKey: weekKey(), weekXp: 0, wins: 0, played: 0, activeDays: [],
        questDay: '', questWins: 0, questChestDay: '', jarLuna: 0, jarUnlockAt: 0,
        vaultDay: '', vaultDeposits: 0, friends: [], createdAt: Date.now(),
      }
    }
    if (name) p.name = String(name).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 16) || p.name
    if (avatar && AVATARS.includes(avatar)) p.avatar = avatar
    const token = rid(24)
    this.db.tokens[token] = address
    this.store.save()
    return { token, profile: this.profile(address) }
  }

  auth(token: string | undefined): string {
    const a = token ? this.db.tokens[token] : undefined
    if (!a) throw bad('Sign in again', 401)
    return a
  }

  profile(address: string): Profile {
    const p = this.must(address)
    this.rollWeek(p)
    const lv = levelFor(p.xp)
    const today = day()
    const days = new Set(p.activeDays)
    let streak = 0
    for (let t = Date.now(); ; t -= 864e5) {
      if (days.has(day(t))) streak++
      else if (day(t) === today) continue // today not played yet doesn't break the streak
      else break
    }
    return {
      address: p.address, name: p.name, avatar: p.avatar, xp: p.xp, level: lv.level, levelXp: lv.levelXp, nextXp: lv.nextXp,
      streak, lastStreakDay: p.activeDays[p.activeDays.length - 1] ?? '', streakDays: p.activeDays.slice(-14),
      wins: p.wins, played: p.played, jarLuna: p.jarLuna, jarUnlockAt: p.jarUnlockAt,
      questWins: p.questDay === today ? p.questWins : 0, questDay: today, weekXp: p.weekXp,
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
    if (scope === 'friends') rows = all.filter((p) => p.address === address || me.friends.includes(p.address))
    rows = [...rows].sort((a, b) => b.weekXp - a.weekXp || b.xp - a.xp)
    const list = rows.map((p, i) => ({
      rank: i + 1, address: p.address, name: p.name, avatar: p.avatar, weekXp: p.weekXp, level: levelFor(p.xp).level, me: p.address === address,
    }))
    return { scope, week: weekKey(), rows: list.slice(0, 25), me: list.find((r) => r.me) ?? null, total: rows.length }
  }

  // ---------------- matches ----------------

  private view(m: MatchRec, viewer?: string, seenShot?: number): PublicMatch & Record<string, unknown> {
    const showSeed = m.status === 'playing' || m.status === 'settled'
    const out: any = { ...m }
    delete out.size
    delete out.trivia
    delete out.fundBy
    delete out.settled
    out.seed = showSeed ? m.seed : undefined
    out.size = m.size
    out.players = m.players.map((p) => ({
      player: p.player, funded: p.funded, escrowed: p.escrowed, payer: p.payer, share: p.share, isBot: p.isBot,
      progress: p.progress, result: m.status === 'settled' ? p.result : p.result ? { score: 0, time: 0, done: true } : undefined,
    }))
    out.serverNow = Date.now()
    if (m.live?.kind === 'pool' && m.live.last) {
      // the ball paths are big: send them once, to whoever has not seen that shot yet
      const last = m.live.last
      out.live = { ...m.live, last: { ...last, frames: seenShot !== undefined && seenShot < last.no ? last.frames : [] } }
    }
    out.fundBy = m.fundBy
    out.settlement = m.settlement
    if (m.trivia && (m.status === 'playing' || m.status === 'settled')) {
      const mine = viewer ? m.trivia.answers[viewer] ?? [] : []
      out.trivia = {
        topic: m.trivia.topic, source: m.trivia.source, verified: m.trivia.verified, qMs: TRIVIA_Q_MS,
        questions: m.trivia.questions.map((q, i) => ({
          q: q.q, options: q.options, category: q.category,
          ...(mine[i] || m.status === 'settled' ? { answer: q.answer, fact: q.fact } : {}),
        })),
        mine,
        pip: m.trivia.pip ? m.trivia.pip.slice(0, mine.length) : undefined,
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
      .slice(0, 30)
      .map((m) => this.view(m, address))
  }

  private playerOf(address: string) {
    const p = this.must(address)
    return { address, name: p.name, avatar: p.avatar }
  }

  private required(m: MatchRec, address: string) {
    const pl = m.players.find((p) => p.player.address === address)
    return escrowRequired(m.mode, m.stake, m.size, !!pl?.payer)
  }

  async create(host: string, b: any): Promise<PublicMatch> {
    const game = b.game as GameId
    if (!GAMES[game]) throw bad('Unknown game')
    const mode = b.mode as Mode
    if (!['play', 'save', 'spend'].includes(mode)) throw bad('Unknown mode')
    const opp = b.opp as OppKind
    if (!['invite', 'auto', 'pip'].includes(opp)) throw bad('Unknown opponent type')
    if (opp === 'pip' && mode !== 'play') throw bad('Pip only plays for fun. Staked matches need a real player')
    const pipLevel: PipLevel | undefined = opp === 'pip' ? (['easy', 'med', 'hard'].includes(b.pipLevel) ? b.pipLevel : 'med') : undefined
    if (game === 'lastbite' && mode !== 'spend') throw bad('Last Bite splits a bill, so it runs in Spend mode')

    let stake = 0
    if (mode === 'save') {
      stake = Number(b.stake)
      if (!(STAKES as readonly number[]).includes(stake)) throw bad('Pick a stake from the list')
    } else if (mode === 'spend') {
      stake = Math.round(Number(b.stake) * 100) / 100
      if (!(stake >= 0.5 && stake <= 1000)) throw bad('A bill must be between 0.5 and 1000 NIM')
    }
    if (stake > this.maxStakeNim) throw bad(`The limit on this server is ${this.maxStakeNim} NIM per match`)
    const size = game === 'lastbite' && opp !== 'auto' ? Math.max(2, Math.min(4, Math.floor(Number(b.size)) || 2)) : 2
    if (opp === 'auto') {
      const cfgTopic = game === 'trivia' ? String(b.config?.topic || 'General knowledge').slice(0, 60) : ''
      const waiting = Object.values(this.db.matches).find(
        (m) => m.opp === 'auto' && m.status === 'lobby' && m.game === game && m.mode === mode && m.stake === stake && m.players[0].player.address !== host &&
          (game !== 'trivia' || (m.config.topic as string) === cfgTopic),
      )
      if (waiting) return await this.join(host, waiting.code)
      b.config = { ...(b.config || {}), topic: cfgTopic }
    }

    const id = rid(6)
    let code = ''
    do {
      code = 'NMB-' + Array.from({ length: 4 }, () => CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length]).join('')
    } while (Object.values(this.db.matches).some((m) => m.code === code && m.status !== 'settled' && m.status !== 'cancelled'))
    const seed = rid(16)
    const config: Record<string, unknown> = {}
    const m: MatchRec = {
      id, code, game, mode, opp, pipLevel, stake, status: 'lobby', host, size, seed, seedCommit: sha(seed), config,
      players: [{ player: this.playerOf(host), funded: false, escrowed: 0, payer: mode === 'spend' }],
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
    if (game === 'lastbite') {
      const r = b.config?.receipt
      config.billNote = String(b.config?.note || '').slice(0, 40)
      if (r && typeof r === 'object') config.receiptItems = Array.isArray(r.items) ? r.items.slice(0, 40).map((i: any) => ({ name: String(i.name).slice(0, 40), price: Number(i.price) || 0 })) : []
    }
    this.db.matches[id] = m
    if (opp === 'pip') {
      m.players.push({ player: { address: PIP_ADDRESS, name: PIP_NAMES[pipLevel!], avatar: 'pip' }, funded: true, escrowed: 0, isBot: true })
      if (m.trivia) m.trivia.pip = this.rollPip(m, pipLevel!)
      this.readyUp(m)
    }
    this.store.save()
    return this.view(m, host) as any
  }

  async join(addr: string, codeIn: string): Promise<PublicMatch> {
    const code = String(codeIn || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NMB/, '')
    const m = Object.values(this.db.matches).find((x) => x.code.replace('-', '') === 'NMB' + code && x.status === 'lobby')
    if (!m) throw bad('No open match with that code. Ask for a fresh one', 404)
    if (m.players.some((p) => p.player.address === addr)) return this.view(m, addr) as any
    if (m.players.length >= m.size) throw bad('That match is full')
    m.players.push({ player: this.playerOf(addr), funded: false, escrowed: 0, payer: false })
    this.store.save()
    if (m.players.length >= m.size) this.readyUp(m)
    return this.view(m, addr) as any
  }

  /** Called when the lobby is full. */
  private readyUp(m: MatchRec) {
    for (const p of m.players) p.escrowed = this.required(m, p.player.address)
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
    if (m.status !== 'funding') throw bad(pl.funded ? 'Already locked in' : 'This match is not collecting deposits right now')
    if (pl.funded) return this.view(m, addr)
    if (typeof txHash !== 'string' || txHash.length > 100) throw bad('Bad transaction hash')
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    const need = pl.escrowed
    const check = await this.chain.verifyDeposit(txHash, { from: addr, luna: need, memo: m.escrow.memo })
    if (!check.ok) {
      if (check.pending) return { ...this.view(m, addr), pending: true, pendingReason: check.reason }
      throw bad(check.reason)
    }
    if (this.db.usedTx[txHash]) throw bad('That transaction was already used')
    this.db.usedTx[txHash] = m.id
    pl.funded = true
    pl.fundTx = txHash
    if (m.status === 'funding' && m.players.every((p) => p.funded || p.escrowed === 0)) this.beginCountdown(m)
    this.store.save()
    return this.view(m, addr)
  }

  async cancel(addr: string, id: string) {
    const m = this.db.matches[id]
    if (!m) throw bad('Match not found', 404)
    if (m.host !== addr) throw bad('Only the host can cancel', 403)
    if (m.status !== 'lobby' && m.status !== 'funding') throw bad('Too late to cancel, the game has started')
    await this.cancelMatch(m, 'Cancelled by host')
    return this.view(m, addr)
  }

  private async cancelMatch(m: MatchRec, reason: string) {
    m.status = 'cancelled'
    const payouts: Payout[] = m.players
      .filter((p) => p.funded && p.escrowed > 0 && !p.isBot)
      .map((p) => ({ to: p.player.address, luna: p.escrowed, kind: 'refund' as const, note: 'Match cancelled' }))
    m.settlement = { ranks: [], payouts, xp: {}, jarCredit: {}, reason }
    this.store.save()
    this.runPayouts(m)
  }

  // ----- trivia (server-authoritative) -----

  private rollPip(m: MatchRec, level: PipLevel) {
    const r = rng(`pip-trivia:${m.seed}:${level}`)
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
    let ms = Math.max(0, Math.min(TRIVIA_Q_MS, Math.round(Number(b.ms) || TRIVIA_Q_MS)))
    const elapsed = Date.now() - (m.startsAt ?? Date.now())
    const spentBefore = answers.reduce((s, a) => s + a.ms, 0)
    if (spentBefore + ms > elapsed + 1500) ms = Math.max(0, Math.min(ms, Math.round(elapsed - spentBefore + 1500))) // can't answer faster than the clock allows
    const correct = choice === q.answer
    const a = { choice, ms, correct, points: correct ? triviaPoints(ms) : 0 }
    answers.push(a)
    pl.progress = answers.reduce((s, x) => s + x.points, 0)
    if (answers.length >= m.trivia.questions.length && !pl.result) {
      pl.result = { score: pl.progress, time: answers.reduce((s, x) => s + x.ms, 0), detail: { correct: answers.filter((x) => x.correct).length } }
    }
    this.maybeSettle(m)
    this.store.save()
    return { ...a, answer: q.answer, fact: q.fact, pip: m.trivia.pip?.[qi], done: answers.length >= m.trivia.questions.length, match: this.view(m, addr) }
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
    let detail = b.detail
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
    if (m.status === 'lobby' && now - m.createdAt > LOBBY_TTL) void this.cancelMatch(m, 'Nobody joined in time')
    else if (m.status === 'funding' && m.fundBy && now > m.fundBy) void this.cancelMatch(m, 'Deposits were not all in on time, funds refunded')
    else if (m.status === 'ready' && m.startsAt && now >= m.startsAt) {
      m.status = 'playing'
      m.endsAt = m.startsAt + GAME_DURATION_MS[m.game] + GRACE_MS
      if (this.isLive(m)) m.live = m.game === 'chess' ? initChess(m.seed, m.startsAt) : initPool(m.seed, m.startsAt)
      this.store.save()
    } else if (m.status === 'playing' && m.live && !m.live.over) {
      this.syncLive(m, now)
    } else if (m.status === 'playing' && m.endsAt && now > m.endsAt + FORFEIT_AFTER) {
      this.settle(m, true)
    }
  }

  tickAll() {
    for (const m of Object.values(this.db.matches)) {
      if (m.status !== 'settled' && m.status !== 'cancelled') this.tick(m)
      else if (m.settlement?.payouts.some((p) => !p.tx && (p as any).attempts < 6)) this.runPayouts(m)
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
        if (m.trivia?.pip) {
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
    const xp: Record<string, number> = {}
    const humans = m.players.filter((p) => !p.isBot)

    if (m.mode === 'save' && !allForfeit) {
      if (draw) for (const p of humans) payouts.push({ to: p.player.address, luna: p.escrowed, kind: 'refund', note: 'Draw, stake returned' })
      else jarCredit[winner!] = m.players.reduce((s, p) => s + p.escrowed, 0)
    } else if (m.mode === 'spend' && !allForfeit) {
      const payer = m.players.find((p) => p.payer)!
      const shares = billShares(m.stake, m.size, draw ? null : [1])
      const order = draw ? m.players.map((_, i) => i) : ranks.map((r) => m.players.findIndex((p) => p.player.address === r.address))
      order.forEach((pi, i) => (m.players[pi].share = shares[i]))
      let toPayer = 0
      for (const p of humans) {
        if (p.payer) continue
        const share = p.share ?? 0
        toPayer += share
        const back = p.escrowed - share
        if (back > 0) payouts.push({ to: p.player.address, luna: back, kind: 'refund', note: 'Unused part of your deposit' })
      }
      if (toPayer > 0) payouts.push({ to: payer.player.address, luna: toPayer, kind: 'settle', note: 'Your friends settled the bill' })
    } else if (allForfeit || forfeit) {
      // nobody finished: give everything back
      for (const p of humans) if (p.escrowed > 0 && m.mode !== 'play') payouts.push({ to: p.player.address, luna: p.escrowed, kind: 'refund', note: 'Match did not finish' })
    }

    for (const r of ranks) {
      const rec = this.db.profiles[r.address]
      if (!rec) continue
      const won = !draw && r.rank === 1
      const base = r.score < 0 ? 5 : won ? 60 : draw ? 30 : m.size > 2 ? [60, 40, 30, 20][Math.min(3, r.rank - 1)] : 20
      const staked = m.mode === 'play' ? 0 : 20
      xp[r.address] = base + (r.score >= 0 ? staked : 0)
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
      if (rec.questWins >= 3 && rec.questChestDay !== today) {
        rec.questChestDay = today
        rec.xp += 50
        xp[r.address] += 50
      }
      if (jarCredit[r.address]) this.creditJar(rec, jarCredit[r.address])
      for (const other of humans) if (other.player.address !== r.address && !rec.friends.includes(other.player.address)) rec.friends.push(other.player.address)
    }
    m.settlement = {
      winner, draw: draw || undefined, ranks: ranks.map((r) => ({ address: r.address, rank: r.rank, score: Math.max(0, r.score), time: r.time === Number.MAX_SAFE_INTEGER ? 0 : r.time })),
      payouts, xp, jarCredit,
      reason: allForfeit ? 'Nobody finished' : forfeit ? 'A player ran out of time and forfeited' : draw ? 'Dead heat' : 'Best score wins',
    }
    this.store.save()
    this.runPayouts(m)
  }

  private creditJar(p: ProfileRec, luna: number) {
    p.jarLuna += luna
    p.jarUnlockAt = Math.max(p.jarUnlockAt, Date.now() + this.lockDays * 864e5)
  }

  private runPayouts(m: MatchRec) {
    const s = m.settlement
    if (!s) return
    s.payouts.forEach(async (p: any, i) => {
      if (p.tx || p.inflight || (p.attempts ?? 0) >= 6 || p.luna < 1) return
      p.inflight = true
      p.attempts = (p.attempts ?? 0) + 1
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

  async withdrawJar(addr: string) {
    const p = this.must(addr)
    if (p.jarLuna <= 0) throw bad('Your jar is empty')
    if (Date.now() < p.jarUnlockAt) throw bad('Your jar is still locked')
    const luna = p.jarLuna
    p.jarLuna = 0 // zero first so a double tap can't pay twice
    this.store.save()
    try {
      const tx = await this.chain.pay(addr, luna, 'nb:jar:withdraw')
      return { tx, luna, profile: this.profile(addr) }
    } catch (e) {
      p.jarLuna += luna
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
    const check = await this.chain.verifyDeposit(txHash, { from: addr, luna: toLuna(amountNim), memo })
    if (!check.ok) {
      if (check.pending) return { pending: true, reason: check.reason }
      throw bad(check.reason)
    }
    this.db.usedTx[txHash] = 'vault'
    this.creditJar(p, toLuna(amountNim))
    p.vaultDeposits++
    this.store.save()
    return { profile: this.profile(addr) }
  }
}

export const triviaPoints = (ms: number) => 100 + Math.round(40 * Math.max(0, 1 - ms / TRIVIA_Q_MS))
export const LUNA_PER_NIM = LUNA
