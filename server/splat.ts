// Splat Royale runner. The server owns the match: it steps the sim at 20 Hz, takes inputs from sockets, and sends snapshots.
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { TICK_MS, DEFAULT_CAP_TICKS, botInput, cleanInput, createSim, fastForward, forceOut, snapshot, standings, stepSim, NO_INPUT, type Input, type Sim } from '../shared/splat'
import type { PipLevel } from '../shared/types'
import type { MatchRec } from './store'
import type { Engine } from './engine'

export const RECONNECT_GRACE_MS = 10_000
const MAX_MSGS_PER_SEC = 40
const MAX_SOCKETS = 300

export type Conn = { send(s: string): void; close(): void; buffered?: () => number }
export type Run = {
  m: MatchRec; sim: Sim; level: PipLevel; startsAt: number
  seatOf: Map<string, number>; isBot: boolean[]
  inputs: Input[]; lastSeen: number[]; conns: Map<number, Conn>; ended: boolean
}

export class SplatRuns {
  runs = new Map<string, Run>()
  capTicks = Number(process.env.SPLAT_CAP_SECONDS) > 0 ? Math.max(100, Math.round((Number(process.env.SPLAT_CAP_SECONDS) * 1000) / TICK_MS)) : DEFAULT_CAP_TICKS
  constructor(private onEnd: (m: MatchRec, order: number[], sim: Sim) => void) {}

  has(id: string) { return this.runs.has(id) }
  drop(id: string) { this.runs.delete(id) }

  /** Called once everyone is locked in and the countdown starts. */
  ensure(m: MatchRec): Run {
    let r = this.runs.get(m.id)
    if (r) return r
    const n = m.players.length
    const sim = createSim(m.seed, n, this.capTicks)
    const startsAt = m.startsAt ?? Date.now() + 4000
    r = {
      m, sim, level: m.pipLevel ?? 'med', startsAt,
      seatOf: new Map(m.players.map((p, i) => [p.player.address, i])), isBot: m.players.map((p) => !!p.isBot),
      inputs: m.players.map(() => NO_INPUT), lastSeen: m.players.map(() => startsAt), conns: new Map(), ended: false,
    }
    this.runs.set(m.id, r)
    return r
  }

  initMsg(r: Run, seat: number) {
    return JSON.stringify({
      t: 'init', n: r.sim.n, seat, tickMs: TICK_MS, cap: r.sim.cap, startsAt: r.startsAt, now: Date.now(),
      walls: r.sim.walls, spots: r.sim.spots.map((s) => ({ x: s.x, y: s.y, kind: s.kind })),
      players: r.m.players.map((p, i) => ({ seat: i, name: p.player.name, avatar: p.player.avatar, bot: !!p.isBot })),
    })
  }

  connect(id: string, addr: string, c: Conn): { seat: number } | null {
    const r = this.runs.get(id)
    const seat = r?.seatOf.get(addr)
    if (!r || seat === undefined || r.isBot[seat] || r.ended) return null
    r.conns.get(seat)?.close() // one socket per player
    r.conns.set(seat, c)
    r.lastSeen[seat] = Date.now()
    c.send(this.initMsg(r, seat))
    c.send(JSON.stringify({ t: 's', ...snapshot(r.sim) }))
    return { seat }
  }
  disconnect(id: string, seat: number, c: Conn, now = Date.now()) {
    const r = this.runs.get(id)
    if (!r || r.conns.get(seat) !== c) return
    r.conns.delete(seat)
    r.lastSeen[seat] = now
  }
  input(id: string, seat: number, raw: unknown) {
    const r = this.runs.get(id)
    if (r && !r.ended) r.inputs[seat] = cleanInput(raw)
  }

  /** Move every live run up to the wall clock. Safe to call as often as you like. */
  step(now = Date.now()) {
    for (const r of [...this.runs.values()]) {
      if (r.ended || now < r.startsAt) continue
      const want = Math.floor((now - r.startsAt) / TICK_MS)
      let guard = 0
      while (!r.sim.over && r.sim.tick < want && guard++ < 4) {
        this.guardGone(r, now)
        const humansLeft = r.sim.players.some((p) => p.alive && !r.isBot[p.seat])
        if (!humansLeft) {
          // only Nimo bots are left: finish the match now, nobody is watching a bot fight
          fastForward(r.sim, (seat) => botInput(r.sim, seat, r.level))
        } else {
          stepSim(r.sim, r.sim.players.map((p) => (r.isBot[p.seat] ? botInput(r.sim, p.seat, r.level) : r.inputs[p.seat])))
        }
        this.send(r)
      }
      if (r.sim.over) this.finish(r)
    }
  }

  private guardGone(r: Run, now: number) {
    for (const p of r.sim.players) {
      if (!p.alive || r.isBot[p.seat] || r.conns.has(p.seat)) continue
      if (now - r.lastSeen[p.seat] > RECONNECT_GRACE_MS) forceOut(r.sim, p.seat)
    }
  }
  private send(r: Run) {
    if (!r.conns.size) return
    const msg = JSON.stringify({ t: 's', ...snapshot(r.sim) })
    for (const c of r.conns.values()) {
      if ((c.buffered?.() ?? 0) > 512 * 1024) continue // a stuck phone must not stall the match
      try { c.send(msg) } catch { /* socket went away */ }
    }
  }
  private finish(r: Run) {
    if (r.ended) return
    r.ended = true
    const order = standings(r.sim)
    this.onEnd(r.m, order, r.sim)
    setTimeout(() => {
      for (const c of r.conns.values()) c.close()
      this.runs.delete(r.m.id)
    }, 4000).unref?.()
  }
}

/** Hook the WebSocket endpoint into the HTTP server. Path: /ws/splat?m=<match id>&t=<token> */
export function attachSplat(server: Server, engine: Engine) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 })
  const reject = (sock: Duplex, code: number, why: string) => {
    sock.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`)
    sock.destroy()
  }
  server.on('upgrade', (req: IncomingMessage, sock: Duplex, head: Buffer) => {
    let u: URL
    try { u = new URL(req.url ?? '', 'http://x') } catch { return reject(sock, 400, 'Bad Request') }
    if (u.pathname !== '/ws/splat') return reject(sock, 404, 'Not Found')
    if (wss.clients.size >= MAX_SOCKETS) return reject(sock, 503, 'Busy')
    let addr: string
    try { addr = engine.auth(u.searchParams.get('t') ?? undefined) } catch { return reject(sock, 401, 'Unauthorized') }
    const id = u.searchParams.get('m') ?? ''
    wss.handleUpgrade(req, sock, head, (ws: WebSocket) => {
      const conn: Conn = { send: (s) => ws.send(s), close: () => ws.close(), buffered: () => ws.bufferedAmount }
      engine.ensureSplatRun(id)
      const hit = engine.splat.connect(id, addr, conn)
      if (!hit) { ws.close(1008, 'No such match'); return }
      let tokens = MAX_MSGS_PER_SEC
      let refill = Date.now()
      ws.on('message', (data) => {
        const now = Date.now()
        tokens = Math.min(MAX_MSGS_PER_SEC, tokens + ((now - refill) / 1000) * MAX_MSGS_PER_SEC)
        refill = now
        if (tokens < 1) return
        tokens -= 1
        let msg: any
        try { msg = JSON.parse(String(data)) } catch { return }
        if (msg?.t === 'i') engine.splat.input(id, hit.seat, msg)
      })
      ws.on('close', () => engine.splat.disconnect(id, hit.seat, conn))
      ws.on('error', () => ws.close())
    })
  })
  const timer = setInterval(() => engine.splat.step(Date.now()), TICK_MS)
  timer.unref?.()
  return { wss, close: () => { clearInterval(timer); for (const c of wss.clients) c.terminate(); wss.close() } }
}
