import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
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
  assert.ok(live.seed)
  assert.equal(live.seedCommit, (await import('node:crypto')).createHash('sha256').update(live.seed).digest('hex'))
  assert.equal(live.trivia.questions[0].answer, undefined, 'answers stay secret until answered')
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
  assert.equal(end.settlement.winner, A)
  assert.equal(end.settlement.jarCredit[A], 400000)
  const pa = (await call(ta, 'GET', '/me')).j
  assert.equal(pa.jarLuna, 400000)
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

test('spend duel: loser pays the larger share to the payer, the rest is refunded', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi')
  const c = (await call(ta, 'POST', '/matches', { game: 'sudoku', mode: 'spend', stake: 10, opp: 'invite' })).j
  await call(tb, 'POST', '/matches/join', { code: c.code })
  const joined = (await call(ta, 'GET', `/matches/${c.id}`)).j
  assert.equal(joined.players[0].escrowed, 0, 'payer locks nothing')
  assert.equal(joined.players[1].escrowed, 600000, 'opponent locks the biggest share')
  const ready = (await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, 600000, c.escrow.memo) })).j
  assert.equal(ready.status, 'ready')
  app.engine.db.matches[c.id].startsAt = Date.now() - 1
  await call(tb, 'GET', `/matches/${c.id}`)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 10, time: 1000 })
  const r = (await call(tb, 'POST', `/matches/${c.id}/result`, { score: 30, time: 1000 })).j // B wins, pays 40%
  assert.equal(r.settlement.winner, B)
  await new Promise((r) => setTimeout(r, 50))
  const paid = (app.chain as any).paid.filter((p: any) => p.memo.startsWith('nb:' + c.id))
  const toA = paid.find((p: any) => p.to === A)
  const toB = paid.find((p: any) => p.to === B)
  assert.equal(toA.luna, 400000)
  assert.equal(toB.luna, 200000)
})

test('Pip: play only, free, scores from the shared seed', async () => {
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

test('last bite: three friends, shares add up to the bill', async () => {
  const ta = await login(A, 'Ada'), tb = await login(B, 'Bisi'), tc = await login(C, 'Chi')
  const c = (await call(ta, 'POST', '/matches', { game: 'lastbite', mode: 'spend', stake: 12.96, opp: 'invite', size: 3 })).j
  await call(tb, 'POST', '/matches/join', { code: c.code })
  const j = (await call(tc, 'POST', '/matches/join', { code: c.code })).j
  assert.equal(j.status, 'funding')
  const need = (id: string) => j.players.find((p: any) => p.player.address === id).escrowed
  await call(tb, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(B, need(B), c.escrow.memo) })
  await call(tc, 'POST', `/matches/${c.id}/fund`, { txHash: deposit(C, need(C), c.escrow.memo) })
  app.engine.db.matches[c.id].startsAt = Date.now() - 1
  await call(ta, 'GET', `/matches/${c.id}`)
  await call(ta, 'POST', `/matches/${c.id}/result`, { score: 5, time: 5 })
  await call(tb, 'POST', `/matches/${c.id}/result`, { score: 20, time: 5 })
  const r = (await call(tc, 'POST', `/matches/${c.id}/result`, { score: 10, time: 5 })).j
  assert.equal(r.status, 'settled')
  const final = (await call(ta, 'GET', `/matches/${c.id}`)).j
  const shares = final.players.map((p: any) => p.share)
  assert.equal(shares.reduce((s: number, x: number) => s + x, 0), 1296000)
  const byAddr = Object.fromEntries(final.players.map((p: any) => [p.player.address, p.share]))
  assert.ok(byAddr[B] < byAddr[C] && byAddr[C] < byAddr[A], 'best player pays least')
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
