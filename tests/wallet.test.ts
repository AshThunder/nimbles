import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { createApp } from '../server/index'
import { Challenges, addressFromProof, challengeText, signedForms } from '../server/auth'
import { sameAddr } from '../server/chain'
import { retry, backoff } from '../shared/retry'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5 + 11) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
const deposit = (from: string, luna: number, memo: string) => (app.chain as any).register({ from, to: app.chain.escrowAddress, luna, memo })

// ---- address comparison ----------------------------------------------------------------------------------------
test('address compare ignores spaces and case, and still flags a different address', () => {
  const a = addr(1)
  assert.ok(sameAddr(a, a.replace(/ /g, '')))
  assert.ok(sameAddr(a, a.toLowerCase()))
  assert.ok(sameAddr(a, ' ' + a.replace(/ /g, '  ') + ' '))
  assert.ok(!sameAddr(a, addr(2)))
})

async function twoPlayerMatch() {
  const A = addr(1), B = addr(2)
  const ta = (await call(null, 'POST', '/session', { address: A })).j.token
  const tb = (await call(null, 'POST', '/session', { address: B })).j.token
  const m = (await call(ta, 'POST', '/matches', { game: 'trivia', mode: 'save', stake: 2, opp: 'invite', config: { topic: 'Science', count: 5 } })).j
  await call(tb, 'POST', '/matches/join', { code: m.code })
  return { A, B, ta, tb, m }
}

test('the same wallet in another spacing or case is accepted, nothing is flagged', async () => {
  const { A, ta, m } = await twoPlayerMatch()
  const variants = [A.replace(/ /g, ''), A.toLowerCase()]
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(variants[0], 200000, m.escrow.memo) })
  assert.equal(r.status, 200)
  assert.equal(r.j.players.find((p: any) => p.player.address === A).funded, true)
})

const paidOf = () => (app.chain as any).paid as { to: string; luna: number; memo: string }[]
const seatOf = (j: any, a: string) => j.players.find((p: any) => p.player.address === a)

test('a payment from another wallet is accepted, the seat is bound to the payer, and refunds go to the payer', async () => {
  const { A, ta, m } = await twoPlayerMatch()
  const OTHER = addr(9)
  const before = paidOf().length
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(OTHER, 200000, m.escrow.memo) })
  assert.equal(r.status, 200, JSON.stringify(r.j))
  const seat = seatOf(r.j, A)
  assert.equal(seat.funded, true)
  assert.equal(seat.paidFrom, OTHER, 'the player is told which account paid')
  assert.equal(paidOf().length, before, 'nothing is refunded away, the payment counts')
  // the player is still the same person: the seat is found by the signed-in address
  assert.equal((await call(ta, 'GET', `/matches/${m.id}`)).status, 200)
  // cancelling returns the stake to the account that paid, not to the signed-in address
  assert.equal((await call(ta, 'POST', `/matches/${m.id}/cancel`)).status, 200)
  await new Promise((r) => setTimeout(r, 50))
  const back = paidOf().slice(before)
  assert.equal(back.length, 1)
  assert.equal(back[0].to.replace(/ /g, ''), OTHER.replace(/ /g, '').toUpperCase())
  assert.equal(back[0].luna, 200000)
})

test('a payment out of a contract account goes back to the wallet behind it, never to the contract', async () => {
  const { A, ta, m } = await twoPlayerMatch()
  const HTLC = addr(7)
  const tx = (app.chain as any).register({ from: HTLC, to: app.chain.escrowAddress, luna: 200000, memo: m.escrow.memo, contract: true, owner: A })
  const before = paidOf().length
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: tx })
  assert.equal(r.status, 200, JSON.stringify(r.j))
  assert.equal(seatOf(r.j, A).paidFrom, HTLC)
  assert.equal((await call(ta, 'POST', `/matches/${m.id}/cancel`)).status, 200)
  await new Promise((r) => setTimeout(r, 50))
  const back = paidOf().slice(before)
  assert.equal(back.length, 1)
  assert.equal(back[0].to, A, 'refund goes to the wallet account, not the contract')
})

test('a contract payer we cannot trace to a wallet is not counted', async () => {
  const { ta, m } = await twoPlayerMatch()
  const tx = (app.chain as any).register({ from: addr(7), to: app.chain.escrowAddress, luna: 200000, memo: m.escrow.memo, contract: true })
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: tx })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /Nothing was counted/)
})

test('a payment from the other player\'s wallet in the same match is blocked', async () => {
  const { B, ta, m } = await twoPlayerMatch()
  const before = paidOf().length
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(B, 200000, m.escrow.memo) })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /another player/)
  assert.equal(paidOf().length, before)
})

test('the other player cannot lock in with a payer who already holds a seat', async () => {
  const { A, B, ta, tb, m } = await twoPlayerMatch()
  const P = addr(9)
  assert.equal((await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(P, 200000, m.escrow.memo) })).status, 200)
  const r = await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(P, 200000, m.escrow.memo) })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /another player/)
  assert.ok(A && B)
})

test('the same payment can never be used twice', async () => {
  const { ta, tb, m } = await twoPlayerMatch()
  const tx = deposit(addr(9), 200000, m.escrow.memo)
  assert.equal((await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: tx })).status, 200)
  const r = await call(tb, 'POST', `/matches/${m.id}/fund`, { txHash: tx })
  assert.equal(r.status, 400)
})

test('a wrong memo or amount is still refused, and nothing is paid out', async () => {
  const { ta, m } = await twoPlayerMatch()
  const before = paidOf().length
  const r = await call(ta, 'POST', `/matches/${m.id}/fund`, { txHash: deposit(addr(8), 200000, 'nb:other') })
  assert.equal(r.status, 400)
  assert.match(r.j.error, /Memo/)
  assert.equal(paidOf().length, before)
})

test('a vault deposit from another wallet counts for the signed-in jar, and withdrawals follow the payer', async () => {
  const A = addr(31), P = addr(32)
  const ta = (await call(null, 'POST', '/session', { address: A })).j.token
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  assert.equal((await call(ta, 'POST', '/vault/solve', { grid: app.engine.vaultPuzzle().solution })).status, 200)
  const r = await call(ta, 'POST', '/vault/deposit', { txHash: deposit(P, 50000, 'nb:vault:' + day), amount: 0.5 })
  assert.equal(r.status, 200, JSON.stringify(r.j))
  assert.ok(((await call(ta, 'GET', '/me')).j.jarLuna ?? 0) >= 50000, 'the jar of the signed-in profile was credited')
  assert.equal((app.engine as any).must(A).payAddr, P.toUpperCase())
})

// ---- wallet ownership proof -------------------------------------------------------------------------------------
async function keypair() {
  const N: any = await import('@nimiq/core')
  const kp = N.KeyPair.generate()
  return { kp, address: kp.publicKey.toAddress().toUserFriendlyAddress() as string, N }
}
const sign = (kp: any, data: Uint8Array) => ({ publicKey: kp.publicKey.toHex() as string, signature: kp.sign(data).toHex() as string })

test('signature proof resolves to the signing address in each message format', async () => {
  const { kp, address } = await keypair()
  const msg = challengeText('abc123')
  for (const form of signedForms(msg)) assert.equal(await addressFromProof(sign(kp, form), msg), address)
  // different message, garbage, and a stranger's key all fail
  assert.equal(await addressFromProof(sign(kp, signedForms('other')[0]), msg), null)
  assert.equal(await addressFromProof({ publicKey: 'zz', signature: 'zz' }, msg), null)
  const other = await keypair()
  assert.equal(await addressFromProof({ publicKey: other.kp.publicKey.toHex(), signature: sign(kp, signedForms(msg)[0]).signature }, msg), null)
})

test('challenges are single use and expire', () => {
  const c = new Challenges()
  const t0 = 1_000_000
  const { nonce } = c.issue(t0)
  assert.ok(c.take(nonce, t0 + 1000))
  assert.ok(!c.take(nonce, t0 + 2000))
  const { nonce: n2 } = c.issue(t0)
  assert.ok(!c.take(n2, t0 + 10 * 60_000))
  assert.ok(!c.take('never-issued'))
})

test('session: a valid proof decides the address even when the app claimed another one', async () => {
  const { kp, address } = await keypair()
  const claimed = addr(4)
  const ch = (await call(null, 'GET', '/auth/challenge')).j
  assert.equal(ch.message, challengeText(ch.nonce))
  const bytes = createHash('sha256').update(Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n' + Buffer.byteLength(ch.message)), Buffer.from(ch.message)])).digest()
  const s = (await call(null, 'POST', '/session', { address: claimed, proof: { nonce: ch.nonce, ...sign(kp, bytes) } })).j
  assert.equal(s.verified, true)
  assert.equal(s.profile.address, address)
  // replaying the same challenge does not verify again
  const again = (await call(null, 'POST', '/session', { address: claimed, proof: { nonce: ch.nonce, ...sign(kp, bytes) } })).j
  assert.equal(again.verified, false)
  assert.equal(again.profile.address, claimed)
})

test('session: no proof or a bad proof keeps the claimed address and is reported unverified', async () => {
  const claimed = addr(5)
  assert.equal((await call(null, 'POST', '/session', { address: claimed })).j.verified, false)
  const ch = (await call(null, 'GET', '/auth/challenge')).j
  const bad = (await call(null, 'POST', '/session', { address: claimed, proof: { nonce: ch.nonce, publicKey: 'aa'.repeat(32), signature: 'bb'.repeat(64) } })).j
  assert.equal(bad.verified, false)
  assert.equal(bad.profile.address, claimed)
})

// ---- retry / backoff --------------------------------------------------------------------------------------------
test('retry: connects after the provider fails a few times, with growing waits', async () => {
  const waits: number[] = []
  let calls = 0
  const v = await retry(async () => { if (++calls < 4) throw new Error('provider not ready'); return 'ok' }, { deadlineMs: 45000, sleep: async (ms) => { waits.push(ms) } })
  assert.equal(v, 'ok')
  assert.equal(calls, 4)
  assert.deepEqual(waits, [400, 800, 1600])
  assert.equal(backoff(10), 3000)
})

test('retry: stops at once on a fatal error and gives up at the deadline', async () => {
  let calls = 0
  await assert.rejects(retry(async () => { calls++; throw new Error('denied') }, { deadlineMs: 45000, fatal: (e) => /denied/.test(String(e)), sleep: async () => {} }), /denied/)
  assert.equal(calls, 1)
  let t = 0, n = 0
  await assert.rejects(retry(async () => { n++; throw new Error('down') }, { deadlineMs: 10000, now: () => t, sleep: async (ms) => { t += ms } }), /down/)
  assert.ok(n > 1 && t < 10000)
})
