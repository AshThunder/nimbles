import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Challenges, Sessions, challengeText } from '../server/auth'
import { createApp } from '../server/index'
import { Engine } from '../server/engine'
import type { AddressInfo } from 'node:net'

const addrA = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const addrB = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0002'

test('sessions: a token is bound to its address and tamper-proof', () => {
  const s = new Sessions('secret-1', 60_000)
  const t0 = 1_000_000
  const { token, expiresAt } = s.issue(addrA, true, t0)
  assert.equal(expiresAt, t0 + 60_000)
  assert.deepEqual(s.check(token, t0 + 1), { address: addrA, verified: true })
  // changing the address inside the token breaks the signature
  const parts = token.split('.')
  parts[1] = addrB.replace(/ /g, '_')
  assert.equal(s.check(parts.join('.'), t0 + 1), null)
  // flipping unverified to verified breaks it too
  const u = s.issue(addrA, false, t0).token
  assert.equal(s.check(u.replace(/\.u\./, '.v.'), t0 + 1), null)
  assert.equal(s.check(u, t0 + 1)?.verified, false)
  // a different server secret does not accept it
  assert.equal(new Sessions('secret-2', 60_000).check(token, t0 + 1), null)
  for (const junk of ['', 'abc', 'nbs1.x.y.z.w', undefined, 'a'.repeat(500)]) assert.equal(s.check(junk as any, t0 + 1), null)
})

test('sessions: a token stops working at its expiry', () => {
  const s = new Sessions('k', 60_000)
  const { token } = s.issue(addrA, true, 0)
  assert.ok(s.check(token, 59_999))
  assert.equal(s.check(token, 60_000), null)
})

test('challenges: single use, short expiry, and a mainnet challenge says mainnet', () => {
  const c = new Challenges('mainnet')
  const { nonce, message, expiresAt } = c.issue(0)
  assert.equal(message, challengeText(nonce, 'mainnet'))
  assert.match(message, /mainnet/)
  assert.ok(expiresAt <= 2 * 60_000)
  assert.ok(!c.take(nonce, 2 * 60_000 + 1))
  const n2 = c.issue(0).nonce
  assert.ok(c.take(n2, 1000))
  assert.ok(!c.take(n2, 1001))
  assert.notEqual(challengeText('x', 'mainnet'), challengeText('x', 'testnet'))
})

const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
  const old: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k] }
  try { await fn() } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } }
}
const serve = async () => {
  const app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
  const call = async (tok: string | null, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any }
  }
  return { app, call }
}
const proofFor = (kp: any, message: string, nonce: string) => {
  const bytes = createHash('sha256').update(Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n' + Buffer.byteLength(message)), Buffer.from(message)])).digest()
  return { nonce, publicKey: kp.publicKey.toHex(), signature: kp.sign(bytes).toHex() }
}

test('server: an expired token is refused with 401 and a fresh session works again', async () => {
  await withEnv({ SESSION_TTL_MIN: '1' }, async () => {
    const { app, call } = await serve()
    try {
      const s = (await call(null, 'POST', '/session', { address: addrA })).j
      assert.ok(s.token && s.expiresAt > Date.now())
      assert.equal((await call(s.token, 'GET', '/me')).status, 200)
      const forged = s.token.replace(addrA.replace(/ /g, '_'), addrB.replace(/ /g, '_'))
      assert.equal((await call(forged, 'GET', '/me')).status, 401)
      assert.equal((await call('a'.repeat(32), 'GET', '/me')).status, 401)
      const real = Date.now
      Date.now = () => real() + 2 * 60_000
      try { assert.equal((await call(s.token, 'GET', '/me')).status, 401) } finally { Date.now = real }
      assert.equal((await call(s.token, 'GET', '/me')).status, 200)
    } finally { app.close() }
  })
})

test('mainnet: no address-only sessions, a signed challenge is required, each is single use', async () => {
  await withEnv({ MOCK_NETWORK: 'mainnet', CHAIN: 'mock' }, async () => {
    const { app, call } = await serve()
    try {
      const { KeyPair } = await import('@nimiq/core')
      const kp = KeyPair.generate()
      const address = kp.publicKey.toAddress().toUserFriendlyAddress()
      // no proof: refused, even though the address is valid
      assert.equal((await call(null, 'POST', '/session', { address })).status, 401)
      // the mainnet challenge names mainnet
      const ch = (await call(null, 'GET', '/auth/challenge')).j
      assert.equal(ch.message, challengeText(ch.nonce, 'mainnet'))
      // a signature over the testnet wording of the same nonce is not accepted
      const wrong = await call(null, 'POST', '/session', { address, proof: proofFor(kp, challengeText(ch.nonce, 'testnet'), ch.nonce) })
      assert.equal(wrong.status, 401)
      // the nonce was spent by the failed attempt, so a new challenge is needed
      const ch2 = (await call(null, 'GET', '/auth/challenge')).j
      const proof = proofFor(kp, ch2.message, ch2.nonce)
      // someone else's key cannot claim this address: the address always comes from the key
      const other = KeyPair.generate()
      const ch3 = (await call(null, 'GET', '/auth/challenge')).j
      const s3 = (await call(null, 'POST', '/session', { address, proof: proofFor(other, ch3.message, ch3.nonce) })).j
      assert.equal(s3.verified, true)
      assert.notEqual(s3.profile.address, address)
      const ok = await call(null, 'POST', '/session', { address: addrA, proof })
      assert.equal(ok.status, 200)
      assert.equal(ok.j.verified, true)
      assert.equal(ok.j.profile.address, address)
      assert.equal((await call(ok.j.token, 'GET', '/me')).j.address, address)
      // a replay of the same signed challenge is refused
      assert.equal((await call(null, 'POST', '/session', { address, proof })).status, 401)
      // an unsigned token (which cannot be issued on mainnet) would not work either
      const unsigned = app.engine.sessions.issue(addrA, false).token
      assert.equal((await call(unsigned, 'GET', '/me')).status, 401)
    } finally { app.close() }
  })
})

test('engine: mainnet needs signed sessions, testnet does not', () => {
  const mk = (kind: string, network: string) => Object.assign(Object.create(Engine.prototype), { chain: { kind, network } })
  assert.equal(mk('nimiq', 'mainnet').requireSigned, true)
  assert.equal(mk('nimiq', 'testnet').requireSigned, false)
  assert.equal(mk('mock', 'testnet').requireSigned, false)
})
