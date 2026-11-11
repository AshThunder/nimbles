// Who is calling, for abuse checks only. The real client IP comes from Fly's proxy header (fly-client-ip), never the
// socket (that is the proxy). IPs and device fingerprints are stored as keyed hashes, server-side only: they are used
// to group linked wallets at payout review and to cap sign-ups per IP. They are never sent to players.
import { createHmac } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export function clientIp(req: IncomingMessage): string {
  const fly = req.headers['fly-client-ip']
  if (typeof fly === 'string' && fly.trim()) return fly.trim()
  const xff = req.headers['x-forwarded-for']
  const first = (Array.isArray(xff) ? xff[0] : xff ?? '').split(',')[0].trim()
  if (first) return first
  return req.socket.remoteAddress ?? '?'
}

/** The fingerprint the web app sends (a hash it builds from a stored random id and stable device traits). */
export function clientDevice(req: IncomingMessage): string {
  const v = req.headers['x-nb-device']
  return typeof v === 'string' ? v.slice(0, 80).replace(/[^\w-]/g, '') : ''
}

export type SignalRec = { ips: string[]; devs: string[]; firstAt: number; lastAt: number }
export type SignalDB = { by: Record<string, SignalRec>; newByIpDay: Record<string, number> }

export class Signals {
  constructor(private db: { signals?: SignalDB }, private secret: () => string, private save: () => void) {}
  private get st(): SignalDB {
    return (this.db.signals ??= { by: {}, newByIpDay: {} })
  }
  hash(kind: 'ip' | 'dev', v: string) {
    return kind[0] + createHmac('sha256', this.secret()).update(kind + ':' + v).digest('hex').slice(0, 20)
  }
  /** Remembers which (hashed) IPs and devices an address used. At most 20 of each, newest kept. */
  note(address: string, ip: string, dev: string, now = Date.now()) {
    const r = (this.st.by[address] ??= { ips: [], devs: [], firstAt: now, lastAt: now })
    const add = (list: string[], v: string) => { if (!v) return; const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); list.push(v); if (list.length > 20) list.shift() }
    const before = r.ips.length + r.devs.length + r.lastAt
    add(r.ips, ip && ip !== '?' ? this.hash('ip', ip) : '')
    add(r.devs, dev ? this.hash('dev', dev) : '')
    if (now - r.lastAt > 60_000) r.lastAt = now
    if (r.ips.length + r.devs.length + r.lastAt !== before) this.save()
  }
  of(address: string): SignalRec | undefined {
    return this.st.by[address]
  }
  /** New profiles per real IP per day. Returns false when this IP has made too many today. */
  allowNewProfile(ip: string, max: number, day: string) {
    if (!ip || ip === '?') return true
    const k = day + ':' + this.hash('ip', ip)
    const n = this.st.newByIpDay[k] ?? 0
    if (n >= max) return false
    this.st.newByIpDay[k] = n + 1
    for (const key of Object.keys(this.st.newByIpDay)) if (!key.startsWith(day)) delete this.st.newByIpDay[key]
    this.save()
    return true
  }
}
