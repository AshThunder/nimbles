// App stats for the admin page, counted from our own server data only. No third-party tracking.
// Players are shown as shortened addresses.
import type { DB } from './store'
import { GAMES, levelFor } from '../shared/types'

export const shortAddr = (a: string) => {
  const s = a.replace(/\s+/g, '')
  return s.slice(0, 4) + '…' + s.slice(-4)
}
const dayOf = (t: number) => new Date(t + 36e5).toISOString().slice(0, 10) // WAT days

export function appStats(db: DB, now = Date.now(), days = 14) {
  const profiles = Object.values(db.profiles)
  const matches = Object.values(db.matches)
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayOf(now - i * 864e5))
  const newPer: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  for (const p of profiles) { const d = dayOf(p.createdAt); if (d in newPer) newPer[d]++ }
  // DAU: anyone who finished or joined a match that day, plus anyone who called the API that day (lastSeen)
  const active: Record<string, Set<string>> = Object.fromEntries(keys.map((k) => [k, new Set<string>()]))
  for (const m of matches) {
    const d = dayOf(m.createdAt)
    if (!(d in active)) continue
    for (const p of m.players) if (!p.isBot && db.profiles[p.player.address]) active[d].add(p.player.address)
  }
  for (const p of profiles) if (p.lastSeen) { const d = dayOf(p.lastSeen); if (d in active) active[d].add(p.address) }

  const byGame: Record<string, Record<string, number>> = {}
  let stakedLuna = 0
  let settled = 0
  let staked = 0
  for (const m of matches) {
    if (m.status !== 'settled') continue
    settled++
    const g = (byGame[m.game] ??= { play: 0, win: 0, save: 0, settle: 0, total: 0 })
    g[m.mode] = (g[m.mode] ?? 0) + 1
    g.total++
    const locked = m.players.reduce((s, p) => s + (p.funded && !p.isBot ? p.escrowed : 0), 0)
    if (locked > 0) { staked++; stakedLuna += locked }
  }
  const games = Object.entries(byGame).map(([id, c]) => ({ id, name: GAMES[id as keyof typeof GAMES]?.name ?? id, play: c.play ?? 0, win: c.win ?? 0, save: c.save ?? 0, settle: c.settle ?? 0, total: c.total ?? 0 })).sort((a, b) => b.total - a.total)
  const friendLinks = profiles.reduce((s, p) => s + (p.friendList?.length ?? 0), 0) / 2
  const invited = profiles.filter((p) => p.invitedBy).length
  const jars = profiles.reduce((s, p) => s + (p.jarLuna > 0 ? 1 : 0), 0)
  const jarLuna = profiles.reduce((s, p) => s + Math.max(0, p.jarLuna), 0)
  const cjarLuna = profiles.reduce((s, p) => s + Math.max(0, p.cjar?.luna ?? 0), 0)
  const top = [...profiles].sort((a, b) => b.wins - a.wins || b.xp - a.xp).slice(0, 10).map((p, i) => ({ rank: i + 1, addr: shortAddr(p.address), wins: p.wins, played: p.played, level: levelFor(p.xp).level }))
  return {
    users: { total: profiles.length, active7: profiles.filter((p) => (p.lastSeen ?? p.createdAt) > now - 7 * 864e5).length, newPerDay: keys.map((k) => ({ day: k, n: newPer[k] })) },
    dau: keys.map((k) => ({ day: k, n: active[k].size })),
    matches: { settled, staked, stakedLuna, byGame: games },
    social: { friendLinks: Math.round(friendLinks), invited },
    jars: { count: jars, luna: jarLuna, showdownLocked: cjarLuna, pool: db.pool?.luna ?? 0 },
    top,
    serverNow: now,
  }
}
