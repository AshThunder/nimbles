// Friends: add by code or link, or ask a recent opponent. A friend is accepted on both sides.
// A brand new player who adds a code before their first finished match counts as invited by its owner.
import { randomBytes } from 'node:crypto'
import { ApiError, type Engine } from './engine'
import type { ProfileRec } from './store'
import { levelFor } from '../shared/types'

const bad = (m: string, s = 400) => new ApiError(s, m)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ONLINE_MS = 2 * 60_000
const MAX_FRIENDS = 200

export class Social {
  constructor(private engine: Engine) {}
  get db() { return this.engine.db }
  private must(a: string) {
    const p = this.db.profiles[a]
    if (!p) throw bad('Unknown player', 401)
    return p
  }

  codeOf(p: ProfileRec) {
    if (!p.friendCode) {
      const taken = new Set(Object.values(this.db.profiles).map((x) => x.friendCode))
      let c = ''
      do c = Array.from({ length: 6 }, () => CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length]).join('')
      while (taken.has(c))
      p.friendCode = c
      this.engine.store.save()
    }
    return p.friendCode
  }

  private link(a: ProfileRec, b: ProfileRec) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      x.friendList ??= []
      if (!x.friendList.includes(y.address)) x.friendList.push(y.address)
      x.friendIn = (x.friendIn ?? []).filter((z) => z !== y.address)
      x.friendOut = (x.friendOut ?? []).filter((z) => z !== y.address)
    }
  }

  /** Adding someone's code is accepting their invite: both become friends at once. */
  addByCode(a: string, codeIn: string) {
    const me = this.must(a)
    const code = String(codeIn || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NF/, '')
    const them = Object.values(this.db.profiles).find((p) => p.friendCode === code)
    if (!them) throw bad('No player with that invite code', 404)
    if (them.address === a) throw bad('That is your own code')
    if ((me.friendList ?? []).length >= MAX_FRIENDS) throw bad('Your friends list is full')
    // a brand new player who arrived through a friend's code is that friend's invite. Set once, never changed
    if (!me.invitedBy && me.played === 0 && Date.now() - me.createdAt < 7 * 864e5 && them.invitedBy !== a) me.invitedBy = them.address
    this.link(me, them)
    this.engine.store.save()
    return this.list(a)
  }

  /** Ask a recent opponent. If they already asked you, this accepts. */
  request(a: string, to: string) {
    const me = this.must(a)
    const them = this.db.profiles[to]
    if (!them || them.address === a) throw bad('Unknown player', 404)
    if (!me.friends.includes(to)) throw bad('You can ask players you have played. Or share your invite code')
    if ((me.friendIn ?? []).includes(to)) return this.accept(a, to)
    if ((me.friendList ?? []).includes(to)) return this.list(a)
    me.friendOut = [...new Set([...(me.friendOut ?? []), to])].slice(-50)
    them.friendIn = [...new Set([...(them.friendIn ?? []), a])].slice(-50)
    this.engine.store.save()
    return this.list(a)
  }

  accept(a: string, from: string) {
    const me = this.must(a)
    if (!(me.friendIn ?? []).includes(from)) throw bad('No request from that player')
    const them = this.must(from)
    this.link(me, them)
    this.engine.store.save()
    return this.list(a)
  }

  decline(a: string, from: string) {
    const me = this.must(a)
    me.friendIn = (me.friendIn ?? []).filter((x) => x !== from)
    const them = this.db.profiles[from]
    if (them) them.friendOut = (them.friendOut ?? []).filter((x) => x !== a)
    this.engine.store.save()
    return this.list(a)
  }

  remove(a: string, other: string) {
    const me = this.must(a)
    me.friendList = (me.friendList ?? []).filter((x) => x !== other)
    me.friendOut = (me.friendOut ?? []).filter((x) => x !== other)
    const them = this.db.profiles[other]
    if (them) them.friendList = (them.friendList ?? []).filter((x) => x !== a)
    this.engine.store.save()
    return this.list(a)
  }

  private card(addr: string, now: number) {
    const p = this.db.profiles[addr]
    return { address: addr, name: p?.name ?? 'Player', avatar: p?.avatar ?? 'me', frame: p?.frame ?? '', level: p ? levelFor(p.xp).level : 1, online: !!p?.lastSeen && now - p.lastSeen < ONLINE_MS }
  }

  list(a: string) {
    const me = this.must(a)
    const now = Date.now()
    const accepted = new Set(me.friendList ?? [])
    const friends = [...accepted].map((x) => this.card(x, now)).sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name))
    const inc = new Set(me.friendIn ?? [])
    const recent = [...me.friends].reverse().filter((x) => !accepted.has(x) && !inc.has(x) && this.db.profiles[x]).slice(0, 10)
      .map((x) => ({ ...this.card(x, now), asked: (me.friendOut ?? []).includes(x) }))
    const incoming = (me.friendIn ?? []).filter((x) => this.db.profiles[x]).map((x) => this.card(x, now))
    const challenges = Object.values(this.db.matches)
      .filter((m) => m.challengeTo === a && m.status === 'lobby' && now - m.createdAt < 15 * 60_000)
      .map((m) => ({ code: m.code, game: m.game, mode: m.mode, stake: m.stake, from: this.card(m.host, now) }))
    return { code: this.codeOf(me), friends, recent, incoming, challenges, serverNow: now }
  }
}
