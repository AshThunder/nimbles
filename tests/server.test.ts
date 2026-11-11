import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
process.env.TRIVIA_PAUSE_MS = '0' // answer the next trivia question at once
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = '' // force the built-in bank so tests are offline
process.env.JAR_LOCK_DAYS = '30'

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const ADA = 'NQ18 8KSY 7HYS 3Y2K 4QQ4 U4U3 8LVM 1CHM X8TD'.replace('NQ18', 'NQ07').slice(0, 44)
const addr = (n: number) => {
  // valid-shaped addresses (the server checks shape, the mock chain doesn't check checksums)
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const A = addr(1), B = addr(2), C = addr(3)

before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j: any = await res.json()
  return { status: res.status, j }
}
const login = async (a: string, name: string) => (await call(null, 'POST', '/session', { address: a, name })).j.token as string
const deposit = (from: string, luna: number, memo: string) => (app.chain as any).register({ from, to: app.chain.escrowAddress, luna, memo })

test('rejects junk addresses and unauthenticated calls', async () => {
  assert.equal((await call(null, 'POST', '/session', { address: 'hello' })).status, 400)
  assert.equal((await call(null, 'GET', '/me')).status, 401)
})

test('save duel: both lock stake, server-scored trivia, winner banks pot in jar', async () => {
  const ta = await login(A, 'Ada')
  const tb = await login(B, 'Bisi')
  const created = (await call(ta, 'POST', '/matches', { game: 'trivia', mode: 'save', stake: 2, opp: 'invite', config: { topic: 'Science', count: 5 } })).j
  assert.equal(created.status, 'lobby')
  assert.match(created.code, /^NMB-[A-Z0-9]{4}$/)
  assert.equal(created.seed, undefined, 'seed hidden before play')
  assert.equal(created.seedCommit.length, 64)
  const joined = (await call(tb, 'POST', '/matches/join', { code: created.code.toLowerCase().replace('-', ' ') })).j
  assert.equal(joined.status, 'funding')
  // wrong memo / wrong amount are refused
  const badTx = deposit(B, 200000, 'nb:other')
  assert.equal((await call(tb, 'POST', `/matches/${created.id}/fund`, { txHash: badTx })).status, 400)
  const lowTx = deposit(B, 100000, created.escrow.memo)
  assert.equal((await call(tb, 'POST', `/matches/${created.id}/fund`, { txHash: lowTx })).status, 400)
  // sender must match the player
  const stolen = deposit(A, 200000, created.escrow.memo)
  assert.equal((await call(tb, 'POST', `/matches/${created.id}/fund`, { txHash: stolen })).status, 400)
  const txB = deposit(B, 200000, created.escrow.memo)
  const f1 = (await call(tb, 'POST', `/matches/${created.id}/fund`, { txHash: txB })).j
  assert.equal(f1.status, 'funding')
  // a tx can't be reused
  assert.equal((await call(ta, 'POST', `/matches/${created.id}/fund`, { txHash: txB })).status, 400)
  const f2 = (await call(ta, 'POST', `/matches/${created.id}/fund`, { txHash: deposit(A, 200000, created.escrow.memo) })).j
  assert.equal(f2.status, 'ready')
  // answers are refused until the countdown ends
  assert.equal((await call(ta, 'POST', `/matches/${created.id}/answer`, { q: 0, choice: 0, ms: 3000 })).status, 400)
  const m = app.engine.db.matches[created.id]
  m.startsAt = Date.now() - 10
  const live = (await call(ta, 'GET', `/matches/${created.id}`)).j
  assert.equal(live.status, 'playing')
  assert.equal(live.seed, undefined, 'a trivia seed stays hidden until the match is settled')
  assert.equal(live.trivia.questions[0].answer, undefined, 'answers stay secret until answered')
  assert.ok(live.trivia.questions[0].q, 'the first question is shown')
  assert.equal(live.trivia.questions[1].q, '', 'later questions are not sent ahead of time')
  // Ada arrives with a 3-day streak, so her XP grows by 10%
  app.engine.db.profiles[A].activeDays = [1, 2, 3].map((n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10))
  // Ada answers all right, Bisi all wrong
  for (let i = 0; i < 5; i++) {
    const right = m.trivia!.questions[i].answer
    const ra = (await call(ta, 'POST', `/matches/${created.id}/answer`, { q: i, choice: right, ms: 4000 })).j
    assert.equal(ra.correct, true)
    const rb = (await call(tb, 'POST', `/matches/${created.id}/answer`, { q: i, choice: (right + 1) % 4, ms: 2000 })).j
    assert.equal(rb.correct, false)
  }
  const end = (await call(ta, 'GET', `/matches/${created.id}`)).j
  assert.equal(end.status, 'settled')
  assert.equal(end.seedCommit, (await import('node:crypto')).createHash('sha256').update(end.seed).digest('hex'), 'the seed is shown once settled, and matches the commitment')
  assert.equal(end.settlement.winner, A)
  assert.equal(end.settlement.jarCredit[A], 392000, "pot minus the 2% saver fee")
  assert.equal(end.settlement.fee, 8000)
  assert.equal(end.settlement.xp[A], 88, '60 win + 20 staked, +10% for a 3-day streak')
  assert.equal(end.settlement.xpBonus[A], 10)
  assert.equal(end.settlement.xp[B], 40, 'no streak, no bonus')
  const pa = (await call(ta, 'GET', '/me')).j
  assert.equal(pa.jarLuna, 392000)
  assert.ok(pa.jarUnlockAt > Date.now() + 29 * 864e5)
  assert.equal(pa.wins, 1)
  assert.equal((await call(ta, 'POST', '/jar/withdraw')).status, 400) // still locked
})

test('draw refunds both stakes through escrow', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const c = (await call(ta, 'POST', '/matches', { game: 'solitaire', mode: 'save', stake: 1, opp: 'invite' })).j
  await call(tb, 'POST', '/matches/join', { code: c.code })
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 100000, c.escrow.memo) })
  await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, 100000, c.escrow.memo) })
  app.engine.db.matches[c.id].startsAt = Date.now() - 1
  await call(ta, 'GET', `/matches/${c.id}`)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 120, time: 90000 })
  const r = (await call(tb, 'POST', `/matches/${c.id}/result`, { score: 120, time: 90000 })).j
  assert.equal(r.status, 'settled')
  assert.equal(r.settlement.draw, true)
  assert.equal(r.settlement.payouts.length, 2)
  await new Promise((r) => setTimeout(r, 50))
  const paid = (app.chain as any).paid.filter((p: any) => p.memo.startsWith('nb:' + c.id))
  assert.deepEqual(paid.map((p: any) => p.luna), [100000, 100000])
})

const paidFor = (id: string) => (app.chain as any).paid.filter((p: any) => p.memo.startsWith('nb:' + id)) as { to: string; luna: number; memo: string }[]
const start = async (t: string, id: string) => {
  app.engine.db.matches[id].startsAt = Date.now() - 1
  await call(t, 'GET', `/matches/${id}`)
}

test('settle: invite only, both must agree before anyone locks, loser pays all to the host', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const mk = { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { bill: 10, loserPct: 100, payee: 'me' } }
  assert.equal((await call(ta, 'POST', '/matches', { ...mk, opp: 'auto' })).status, 400, 'no auto-match for Settle')
  assert.equal((await call(ta, 'POST', '/matches', { ...mk, opp: 'pip' })).status, 400)
  assert.equal((await call(ta, 'POST', '/matches', { ...mk, terms: { ...mk.terms, loserPct: 40 } })).status, 400)
  const c = (await call(ta, 'POST', '/matches', mk)).j
  assert.equal(c.status, 'lobby')
  assert.deepEqual(c.terms.payee, { seat: 0 })
  const joined = (await call(tb, 'POST', '/matches/join', { code: c.code })).j
  assert.equal(joined.status, 'terms')
  assert.equal(joined.terms.lock, 1000000)
  assert.deepEqual(joined.terms.agreed, [A])
  // nobody can lock before both agreed
  assert.equal((await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 1000000, c.escrow.memo) })).status, 400)
  // Bisi counters, which clears Ada's agreement and bumps the revision
  const counter = (await call(tb, 'POST', `/matches/${c.id}/terms`, { action: 'propose', bill: 10, loserPct: 70, payee: 'friend' })).j
  assert.equal(counter.terms.rev, 2)
  assert.deepEqual(counter.terms.agreed, [B])
  assert.equal(counter.stake, 10)
  // agreeing to a stale revision is refused
  assert.equal((await call(ta, 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })).status, 400)
  // Ada pushes back to loser-pays-all, Bisi agrees
  await call(ta, 'POST', `/matches/${c.id}/terms`, { action: 'propose', bill: 10, loserPct: 100, payee: 'me' })
  const both = (await call(tb, 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 3 })).j
  assert.equal(both.status, 'funding')
  assert.equal(both.players[0].escrowed, 1000000)
  assert.equal(both.players[1].escrowed, 1000000)
  // terms are frozen once funding starts
  assert.equal((await call(ta, 'POST', `/matches/${c.id}/terms`, { action: 'propose', bill: 1, loserPct: 50, payee: 'me' })).status, 400)
  await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, 1000000, c.escrow.memo) })
  const ready = (await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 1000000, c.escrow.memo) })).j
  assert.equal(ready.status, 'ready')
  await start(tb, c.id)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 10, time: 1000 })
  const r = (await call(tb, 'POST', `/matches/${c.id}/result`, { score: 30, time: 1000 })).j // Bisi wins, so Ada loses and pays the bill
  assert.equal(r.settlement.winner, B)
  await new Promise((r) => setTimeout(r, 50))
  const paid = paidFor(c.id)
  const total = paid.reduce((s, p) => s + p.luna, 0)
  assert.equal(total, 2000000, 'everything locked is paid out')
  // Ada is the loser AND the payee: she pays her own bill, gets her lock back, and Bisi's winner share (0) is nothing
  assert.equal(paid.filter((p) => p.to === A).reduce((s, p) => s + p.luna, 0), 1000000)
  assert.equal(paid.filter((p) => p.to === B).reduce((s, p) => s + p.luna, 0), 1000000)
})

test('settle: 70/30 to a third-party wallet, draw splits evenly, unused locks come back', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const shop = C
  const c = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { bill: 10, loserPct: 70, payee: shop } })).j
  assert.deepEqual(c.terms.payee, { address: shop })
  await call(tb, 'POST', '/matches/join', { code: c.code })
  const f = (await call(tb, 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })).j
  assert.equal(f.status, 'funding')
  assert.equal(f.players[0].escrowed, 700000)
  await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, 700000, c.escrow.memo) })
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 700000, c.escrow.memo) })
  await start(ta, c.id)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 50, time: 1000 })
  const r = (await call(tb, 'POST', `/matches/${c.id}/result`, { score: 50, time: 1000 })).j
  assert.equal(r.settlement.draw, true)
  assert.deepEqual(r.players.map((p: any) => p.share), [500000, 500000])
  await new Promise((r) => setTimeout(r, 50))
  const paid = paidFor(c.id)
  assert.equal(paid.find((p) => p.to === shop)!.luna, 1000000, 'the payee gets the whole bill')
  assert.equal(paid.find((p) => p.to === A)!.luna, 200000)
  assert.equal(paid.find((p) => p.to === B)!.luna, 200000)
  // a decisive game: winner owes 30%, loser 70%
  const d = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { bill: 10, loserPct: 70, payee: 'friend' } })).j
  await call(tb, 'POST', '/matches/join', { code: d.code })
  await call(tb, 'POST', `/matches/${d.id}/terms`, { action: 'agree', rev: 1 })
  await call(ta, 'POST', `/matches/${d.id}/fund`, { txHash: deposit(A, 700000, d.escrow.memo) })
  await call(tb, 'POST', `/matches/${d.id}/fund`, { txHash: deposit(B, 700000, d.escrow.memo) })
  await start(ta, d.id)
  await call(ta, 'POST', `/matches/${d.id}/result`, { score: 90, time: 1000 })
  await call(tb, 'POST', `/matches/${d.id}/result`, { score: 10, time: 1000 })
  await new Promise((r) => setTimeout(r, 50))
  const p2 = paidFor(d.id)
  // payee 'friend' = Bisi (seat 1), who lost and pays 70%. Ada won and pays 30%
  assert.equal(p2.filter((p) => p.to === B).reduce((s, p) => s + p.luna, 0), 700000 + 300000, 'payee gets own lock back plus the winner share')
  assert.equal(p2.filter((p) => p.to === A).reduce((s, p) => s + p.luna, 0), 400000, 'Ada gets her unused 4 NIM back')
})

test('settle: a contract address cannot be the payee, and an expired terms or funding window refunds everyone', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  ;(app.chain as any).contracts.add(C)
  const terms = { bill: 4, loserPct: 100, payee: C }
  assert.equal((await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms })).status, 400)
  ;(app.chain as any).contracts.clear()
  assert.equal((await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { ...terms, payee: 'NQ00 nope' } })).status, 400)
  // terms never agreed: cancelled, nothing was locked
  const c = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { ...terms, payee: 'me' } })).j
  await call(tb, 'POST', '/matches/join', { code: c.code })
  app.engine.db.matches[c.id].fundBy = Date.now() - 1
  assert.equal((await call(tb, 'GET', `/matches/${c.id}`)).j.status, 'cancelled')
  assert.equal(paidFor(c.id).length, 0)
  // agreed, one locks, the other never does: the one who locked is refunded
  const d = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { ...terms, payee: 'me' } })).j
  await call(tb, 'POST', '/matches/join', { code: d.code })
  await call(tb, 'POST', `/matches/${d.id}/terms`, { action: 'agree', rev: 1 })
  await call(tb, 'POST', `/matches/${d.id}/fund`, { txHash: deposit(B, 400000, d.escrow.memo) })
  app.engine.db.matches[d.id].fundBy = Date.now() - 1
  assert.equal((await call(tb, 'GET', `/matches/${d.id}`)).j.status, 'cancelled')
  await new Promise((r) => setTimeout(r, 50))
  const paid = paidFor(d.id)
  assert.equal(paid.length, 1)
  assert.equal(paid[0].to, B)
  assert.equal(paid[0].luna, 400000)
})

test('settle: a player who never finishes forfeits and pays the loser share', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const c = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'settle', opp: 'invite', terms: { bill: 6, loserPct: 100, payee: C } })).j
  await call(tb, 'POST', '/matches/join', { code: c.code })
  await call(tb, 'POST', `/matches/${c.id}/terms`, { action: 'agree', rev: 1 })
  await call(ta, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(A, 600000, c.escrow.memo) })
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 600000, c.escrow.memo) })
  await start(ta, c.id)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 5, time: 1000 })
  const m = app.engine.db.matches[c.id]
  m.endsAt = Date.now() - 60_000
  await call(ta, 'GET', `/matches/${c.id}`)
  const fin = (await call(ta, 'GET', `/matches/${c.id}`)).j
  assert.equal(fin.status, 'settled')
  assert.equal(fin.settlement.winner, A)
  await new Promise((r) => setTimeout(r, 50))
  const paid = paidFor(c.id)
  assert.equal(paid.find((p) => p.to === C)!.luna, 600000, 'Bisi forfeited, so the bill is paid out of her lock')
  assert.equal(paid.find((p) => p.to === A)!.luna, 600000, 'Ada, the winner, owes nothing and gets her lock back')
})

test('Nimo: play only, free, scores from the shared seed', async () => {
  const ta = await login(A, 'Ada')
  assert.equal((await call(ta, 'POST', '/matches', { game: 'chess', mode: 'save', stake: 2, opp: 'pip' })).status, 400)
  const c = (await call(ta, 'POST', '/matches', { game: 'chess', mode: 'play', opp: 'pip', pipLevel: 'easy' })).j
  assert.equal(c.status, 'ready')
  app.engine.db.matches[c.id].startsAt = Date.now() - 1
  await call(ta, 'GET', `/matches/${c.id}`)
  const r = (await call(ta, 'POST', `/matches/${c.id}/result`, { score: 1, time: 100000 })).j
  assert.equal(r.status, 'settled')
  assert.equal(r.settlement.winner, A)
  assert.equal(r.settlement.payouts.length, 0)
})

test('auto-match pairs two players with the same game and stake', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const a = (await call(ta, 'POST', '/matches', { game: 'bubble', mode: 'play', opp: 'auto' })).j
  assert.equal(a.status, 'lobby')
  const b = (await call(tb, 'POST', '/matches', { game: 'bubble', mode: 'play', opp: 'auto' })).j
  assert.equal(b.id, a.id)
  assert.equal(b.status, 'ready')
})

test('last bite is a normal two-player game in any mode', async () => {
  const ta = await login(A, 'Ada')
  const c = (await call(ta, 'POST', '/matches', { game: 'lastbite', mode: 'play', opp: 'pip' })).j
  assert.equal(c.status, 'ready')
  assert.equal(c.size, 2)
})

test('vault: wrong grid refused, right grid grants XP once', async () => {
  const ta = await login(C, 'Chi')
  assert.equal((await call(ta, 'POST', '/vault/solve', { grid: new Array(16).fill(1) })).status, 400)
  const sol = app.engine.vaultPuzzle().solution
  const ok = (await call(ta, 'POST', '/vault/solve', { grid: sol })).j
  assert.equal(ok.solved, true)
  assert.equal((await call(ta, 'POST', '/vault/solve', { grid: sol })).j.already, true)
  const pub = (await call(ta, 'GET', '/vault/puzzle')).j
  assert.equal(pub.solution, undefined)
  // deposit to the jar with the right memo
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const dep = (await call(ta, 'POST', '/vault/deposit', { txHash: deposit(C, 100000, 'nb:vault:' + day), amount: 1 })).j
  assert.equal(dep.profile.jarLuna, 100000)
})

test('leaderboard lists real players by weekly xp', async () => {
  const ta = await login(A, 'Ada')
  const lb = (await call(ta, 'GET', '/leaderboard')).j
  assert.ok(lb.rows.length >= 2)
  assert.ok(lb.rows[0].weekXp >= lb.rows[1].weekXp)
})
