import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { fmtNim, fmtNimCompact, LUNA } from '../shared/types'
import {
  parsePayAccounts,
  spendableBalanceAddress,
  hasPayHtlc,
  resolveSpendableLuna,
  isProviderAuthorizedAddress,
  normAddr,
} from '../shared/pay-balance'
import { createApp } from '../server/index'
import { MockChain } from '../server/chain'

process.env.CHAIN = 'mock'
process.env.GEMINI_API_KEY = ''

const luna = (nim: number) => Math.round(nim * LUNA)

test('fmtNim floors to 0.01 NIM and never rounds spendable up', () => {
  assert.equal(fmtNim(0), '0')
  assert.equal(fmtNim(luna(1)), '1')
  assert.equal(fmtNim(luna(1.5)), '1.5')
  assert.equal(fmtNim(luna(1.999)), '1.99') // 1.999 NIM = 199900 luna → floor to 1.99
  assert.equal(fmtNim(199999), '1.99') // 1.99999 NIM floored
  assert.equal(fmtNim(luna(19.6)), '19.6')
  assert.equal(fmtNim(luna(122)), '122')
})

test('fmtNimCompact boundaries: under 10k exact, 10k+ as k, 1M+ as M', () => {
  assert.equal(fmtNimCompact(0), '0')
  assert.equal(fmtNimCompact(luna(9_999.99)), '9,999.99')
  assert.equal(fmtNimCompact(luna(10_000)), '10k')
  assert.equal(fmtNimCompact(luna(12_500)), '12k') // floors, does not show 13k
  assert.equal(fmtNimCompact(luna(100_000)), '100k')
  assert.equal(fmtNimCompact(luna(999_999)), '999k')
  assert.equal(fmtNimCompact(luna(1_000_000)), '1M')
  assert.equal(fmtNimCompact(luna(1_200_000)), '1.2M')
  assert.equal(fmtNimCompact(luna(1_299_999)), '1.2M') // floor to one decimal million
  assert.equal(fmtNimCompact(luna(12_000_000)), '12M')
})

test('compact and exact stay separate: large exact is not what the header shows', () => {
  const big = luna(12_345.67)
  assert.equal(fmtNimCompact(big), '12k')
  assert.equal(fmtNim(big), '12,345.67')
})

test('compact boundary for incident-sized HTLC 161.80162 NIM', () => {
  const v = luna(161.80162)
  assert.equal(fmtNim(v), '161.8')
  assert.equal(fmtNimCompact(v), '161.8')
})

// ---- Official Pay listAccounts / HTLC spendable (SDK 0.2.5 shapes) --------------------------------------------

const WALLET = 'NQ20 TEST WALL ET00 0000 0000 0000 0000 NHGR'
const HTLC_OLD = 'NQ80 OLD0 HTLC 0000 0000 0000 0000 0000 0001'
const HTLC_NEW = 'NQ94 NEW0 HTLC 0000 0000 0000 0000 0000 0002'
const OTHER = 'NQ12 OTHR WALL ET00 0000 0000 0000 0000 0003'

test('parsePayAccounts: SDK [wallet, htlc] shape; ignores junk and extras', () => {
  assert.deepEqual(parsePayAccounts([WALLET, HTLC_NEW]), { wallet: WALLET, htlc: HTLC_NEW })
  assert.deepEqual(parsePayAccounts([WALLET]), { wallet: WALLET, htlc: null })
  assert.deepEqual(parsePayAccounts([]), { wallet: null, htlc: null })
  assert.deepEqual(parsePayAccounts(null), { wallet: null, htlc: null })
  assert.deepEqual(parsePayAccounts([WALLET, HTLC_NEW, OTHER]), { wallet: WALLET, htlc: HTLC_NEW })
  assert.deepEqual(parsePayAccounts(['', WALLET]), { wallet: WALLET, htlc: null })
  assert.equal(spendableBalanceAddress([WALLET, HTLC_NEW]), HTLC_NEW)
  assert.equal(spendableBalanceAddress([WALLET]), null)
  assert.equal(hasPayHtlc([WALLET, HTLC_NEW]), true)
  assert.equal(hasPayHtlc([WALLET]), false)
})

test('basic 0 + HTLC 161.80162 → spendable is HTLC, never basic zero as total', () => {
  const accounts = [WALLET, HTLC_NEW]
  const htlcLuna = luna(161.80162)
  // Host getBalance(htlc) succeeds — official path
  assert.equal(resolveSpendableLuna({ accounts, hostHtlcLuna: htlcLuna }), htlcLuna)
  // Basic would be 0; we must not use that when HTLC is present
  assert.notEqual(resolveSpendableLuna({ accounts, hostHtlcLuna: htlcLuna }), 0)
  // No HTLC → documented 0 (not basic RPC)
  assert.equal(resolveSpendableLuna({ accounts: [WALLET], hostHtlcLuna: htlcLuna }), 0)
})

test('HTLC replacement: old reads 0, new funded — follow current accounts list', () => {
  const oldList = [WALLET, HTLC_OLD]
  const newList = [WALLET, HTLC_NEW]
  assert.equal(resolveSpendableLuna({ accounts: oldList, hostHtlcLuna: 0 }), 0)
  assert.equal(resolveSpendableLuna({ accounts: newList, hostHtlcLuna: luna(161.80162) }), luna(161.80162))
  // Stale read of old HTLC must not be applied once accounts point at the new one
  assert.equal(spendableBalanceAddress(oldList), HTLC_OLD)
  assert.equal(spendableBalanceAddress(newList), HTLC_NEW)
  assert.notEqual(normAddr(HTLC_OLD), normAddr(HTLC_NEW))
})

test('permission / host errors: HTLC present but unread → unavailable null, not fake zero', () => {
  const accounts = [WALLET, HTLC_NEW]
  assert.equal(resolveSpendableLuna({ accounts, hostError: true }), null)
  assert.equal(resolveSpendableLuna({ accounts, hostHtlcLuna: null, hostError: true }), null)
  // RPC fallback on the authorized HTLC recovers
  assert.equal(
    resolveSpendableLuna({ accounts, hostError: true, rpcHtlcLuna: luna(161.80162) }),
    luna(161.80162),
  )
  // RPC must not invent funds for a different address — caller gates; resolver only accepts provided rpcHtlcLuna
  assert.equal(resolveSpendableLuna({ accounts, hostError: true, rpcHtlcLuna: null }), null)
})

test('initial unavailable vs actual zero', () => {
  assert.equal(resolveSpendableLuna({ accounts: [WALLET] }), 0) // no HTLC → real zero
  assert.equal(resolveSpendableLuna({ accounts: [WALLET, HTLC_NEW], hostError: true }), null) // unavailable
  assert.equal(resolveSpendableLuna({ accounts: [WALLET, HTLC_NEW], hostHtlcLuna: 0 }), 0) // real empty HTLC
})

test('provider-authorized gate: only wallet + its HTLC, never unrelated wallets', () => {
  const accounts = [WALLET, HTLC_NEW]
  assert.equal(isProviderAuthorizedAddress(accounts, WALLET), true)
  assert.equal(isProviderAuthorizedAddress(accounts, HTLC_NEW), true)
  assert.equal(isProviderAuthorizedAddress(accounts, HTLC_NEW.replace(/ /g, '').toLowerCase()), true)
  assert.equal(isProviderAuthorizedAddress(accounts, OTHER), false)
  assert.equal(isProviderAuthorizedAddress([WALLET], HTLC_NEW), false)
})

test('request race: later generation wins (simulate stale host result discarded by caller)', () => {
  // Caller keeps a gen counter; stale resolve of old HTLC must not overwrite new.
  let shown: number | null | undefined = undefined
  let gen = 0
  const apply = (g: number, v: number | null) => { if (g === gen) shown = v }
  const g1 = ++gen
  const g2 = ++gen
  apply(g1, 0) // stale: old HTLC mid-replacement
  apply(g2, luna(161.80162))
  assert.equal(shown, luna(161.80162))
  apply(g1, 0) // late stale must not clobber
  assert.equal(shown, luna(161.80162))
})

// ---- Server address-balance (confirmed chain read; not Pay spendable semantics) -------------------------------

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, j: (await res.json()) as any }
}

const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5 + 11) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}

test('address-balance returns confirmed wallet luna and never mixes jar credits', async () => {
  const A = addr(3)
  const sess = await call(null, 'POST', '/session', { address: A })
  assert.equal(sess.status, 200)
  const token = sess.j.token

  ;(app.chain as MockChain).balances.set(A, luna(122))

  const key = Object.keys(app.engine.db.profiles).find((k) => k.replace(/\s+/g, '') === A.replace(/\s+/g, '').toUpperCase())!
  const p = app.engine.db.profiles[key]
  p.jarLuna = luna(19.6)
  p.jarUnlockAt = Date.now() + 7 * 864e5

  const me = await call(token, 'GET', '/me')
  assert.equal(me.j.jarLuna, luna(19.6))

  const bal = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(A)}`)
  assert.equal(bal.status, 200, JSON.stringify(bal.j))
  assert.equal(bal.j.luna, luna(122))
  assert.equal(bal.j.confirmed, true)
  assert.equal(bal.j.pendingExcluded, true)
  assert.notEqual(bal.j.luna, me.j.jarLuna, 'wallet balance must not equal jar credits')
  assert.ok(!('jarLuna' in bal.j), 'address-balance must not include jar fields')
})

test('address-balance defaults to the signed-in wallet and rejects junk addresses', async () => {
  const A = addr(4)
  const token = (await call(null, 'POST', '/session', { address: A })).j.token
  ;(app.chain as MockChain).balances.set(A, luna(5))
  const bal = await call(token, 'GET', '/address-balance')
  assert.equal(bal.status, 200)
  assert.equal(bal.j.luna, luna(5))

  const bad = await call(token, 'GET', '/address-balance?address=not-an-address')
  assert.equal(bad.status, 400)
})

test('a missing mock account reads as confirmed zero, not unavailable', async () => {
  const A = addr(5)
  const token = (await call(null, 'POST', '/session', { address: A })).j.token
  const bal = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(A)}`)
  assert.equal(bal.status, 200)
  assert.equal(bal.j.luna, 0)
})

test('genuine zero on the signed-in address is 0, not another account\'s funds and not unavailable', async () => {
  const A = addr(6)
  const B = addr(7)
  const token = (await call(null, 'POST', '/session', { address: A })).j.token
  ;(app.chain as MockChain).balances.set(A, 0)
  ;(app.chain as MockChain).balances.set(B, luna(122))
  const balA = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(A)}`)
  assert.equal(balA.status, 200)
  assert.equal(balA.j.luna, 0, 'empty signed-in account stays a real zero')
  const balB = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(B)}`)
  assert.equal(balB.status, 200)
  assert.equal(balB.j.luna, luna(122))
  assert.notEqual(balA.j.luna, balB.j.luna)
})

test('RPC failure is unavailable (null path), never reported as zero', async () => {
  const A = addr(8)
  const token = (await call(null, 'POST', '/session', { address: A })).j.token
  const chain = app.chain as MockChain
  const orig = chain.accountBalance.bind(chain)
  chain.accountBalance = async () => null
  try {
    const bal = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(A)}`)
    assert.equal(bal.status, 502)
    assert.match(String(bal.j.error || ''), /could not read/i)
  } finally {
    chain.accountBalance = orig
  }
})

test('server can read an HTLC address balance (client may use only when provider-authorized)', async () => {
  const A = addr(9)
  const H = addr(10)
  const token = (await call(null, 'POST', '/session', { address: A })).j.token
  ;(app.chain as MockChain).balances.set(A, 0)
  ;(app.chain as MockChain).balances.set(H, luna(161.80162))
  const balH = await call(token, 'GET', `/address-balance?address=${encodeURIComponent(H)}`)
  assert.equal(balH.status, 200)
  assert.equal(balH.j.luna, luna(161.80162))
  // Client gate: H is only OK when it appears in listAccounts for this wallet
  assert.equal(isProviderAuthorizedAddress([A, H], H), true)
  assert.equal(isProviderAuthorizedAddress([A], H), false)
})
