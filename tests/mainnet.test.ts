import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NimiqChain, MockChain, makeChain, resolveChainConfig, stateDir } from '../server/chain'
import { Store } from '../server/store'
import { Engine } from '../server/engine'

// Only throwaway keys are used here. The real escrow key is never read by a test.
const KEY = 'ab'.repeat(32)
const tmp = () => mkdtempSync(join(tmpdir(), 'nb-main-'))
const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const old: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
  try { await fn() } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } }
}
const clean = { CHAIN: 'nimiq', NETWORK: 'mainnet', ALLOW_MAINNET: 'yes', ESCROW_PRIVATE_KEY: KEY, ESCROW_KEY_FILE: undefined, EXPECTED_ESCROW_ADDRESS: undefined, PAY_FEE_LUNA: undefined, NIMIQ_RPC_URL: undefined }

test('mainnet needs ALLOW_MAINNET=yes', async () => {
  await withEnv({ ...clean, ALLOW_MAINNET: undefined }, async () => {
    await assert.rejects(makeChain(tmp()), /ALLOW_MAINNET/)
  })
})

test('mainnet never generates a key', async () => {
  await withEnv({ ...clean, ESCROW_PRIVATE_KEY: undefined, EXPECTED_ESCROW_ADDRESS: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' }, async () => {
    const dir = tmp()
    await assert.rejects(makeChain(dir), /No mainnet escrow key/)
    assert.equal(existsSync(join(dir, 'escrow.mainnet.key')), false)
  })
})

test('mainnet refuses to start without EXPECTED_ESCROW_ADDRESS, or with a different one', async () => {
  await withEnv(clean, async () => {
    await assert.rejects(makeChain(tmp()), /EXPECTED_ESCROW_ADDRESS/)
  })
  await withEnv({ ...clean, EXPECTED_ESCROW_ADDRESS: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' }, async () => {
    await assert.rejects(makeChain(tmp()), /Refusing to start/)
  })
})

test('mainnet starts when the key derives the pinned address, and builds mainnet (24) payouts with the configured fee', async () => {
  let addr = ''
  await withEnv(clean, async () => {
    const probe = new NimiqChain(tmp(), 'mainnet')
    await assert.rejects(probe.start(), /EXPECTED_ESCROW_ADDRESS/)
  })
  // learn the derived address from the refusal text, then pin it
  await withEnv({ ...clean, EXPECTED_ESCROW_ADDRESS: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' }, async () => {
    try { await new NimiqChain(tmp(), 'mainnet').start() } catch (e: any) { addr = /derives (NQ[0-9A-Z ]+),/.exec(e.message)![1] }
  })
  assert.match(addr, /^NQ\d\d /)
  await withEnv({ ...clean, EXPECTED_ESCROW_ADDRESS: addr, PAY_FEE_LUNA: '7' }, async () => {
    const c = new NimiqChain(tmp(), 'mainnet')
    await c.start()
    assert.equal(c.escrowAddress, addr)
    const sent: string[] = []
    ;(c as any).rpc = async (m: string, p: unknown[]) => {
      if (m === 'getAccountByAddress') return { type: 'basic', balance: 5_000_000 }
      if (m === 'getBlockNumber') return 66_000_000
      if (m === 'sendRawTransaction') { sent.push(p[0] as string); return 'deadbeef' }
      throw new Error('unexpected rpc ' + m)
    }
    await c.pay('NQ77 0000 0000 0000 0000 0000 0000 0000 0001', 100_000, 'nb:test')
    const N = await import('@nimiq/core')
    const tx = N.Transaction.fromAny(sent[0])
    assert.equal(tx.networkId, 24)
    assert.equal(tx.fee, 7n)
    assert.equal(tx.value, 100_000n)
    assert.equal(tx.sender.toUserFriendlyAddress(), addr)
    // an escrow that cannot cover the payout sends nothing
    ;(c as any).rpc = async (m: string) => (m === 'getAccountByAddress' ? { type: 'basic', balance: 50 } : 66_000_000)
    await assert.rejects(c.pay('NQ77 0000 0000 0000 0000 0000 0000 0000 0001', 100_000, 'nb:x'), /too low/)
  })
})

test('mainnet and testnet keep separate folders, and a database cannot cross networks', () => {
  assert.equal(stateDir('/data', { CHAIN: 'nimiq', NETWORK: 'mainnet' }), join('/data', 'mainnet'))
  assert.equal(stateDir('/data', { CHAIN: 'nimiq', NETWORK: 'testnet' }), '/data')
  assert.equal(stateDir('/data', { CHAIN: 'mock' }), '/data')
  assert.equal(resolveChainConfig({ CHAIN: 'mainnet' }).network, 'mainnet')

  const dir = tmp()
  const t = new Store(dir, true, 'testnet')
  t.db.profiles['NQ07 X'] = { address: 'NQ07 X' } as any
  t.flush()
  assert.throws(() => new Store(dir, true, 'mainnet'), /Refusing to load/) // stamped testnet
  const legacy = tmp()
  writeFileSync(join(legacy, 'db.json'), JSON.stringify({ profiles: { a: {} }, tokens: {}, matches: {}, usedTx: {}, version: 1 }))
  assert.throws(() => new Store(legacy, true, 'mainnet'), /Refusing to load/) // old unstamped testnet data
  assert.doesNotThrow(() => new Store(legacy, true, 'testnet')) // still fine on testnet
  assert.doesNotThrow(() => new Store(tmp(), true, 'mainnet')) // a fresh mainnet folder is fine
  const m = new Store(tmp(), true, 'mainnet')
  assert.equal(m.db.network, 'mainnet')
})

test('liabilities add up jars, pool, live stakes and unsent payouts', () => {
  const store = new Store(tmp(), false, 'mainnet')
  const e = new Engine(store, new MockChain())
  store.db.profiles.a = { address: 'a', name: 'a', jarLuna: 300 } as any
  store.db.profiles.b = { address: 'b', name: 'b', jarLuna: 200 } as any
  store.db.pool = { luna: 50 }
  store.db.matches.m1 = { status: 'funding', players: [{ funded: true, escrowed: 1000 }, { funded: false, escrowed: 1000 }, { funded: true, isBot: true, escrowed: 0 }] } as any
  store.db.matches.m2 = { status: 'settled', players: [], settlement: { payouts: [{ luna: 70 }, { luna: 30, tx: 'x' }] } } as any
  assert.deepEqual(e.liabilities(), { jars: 500, pool: 50, live: 1000, unpaid: 70, total: 1620 })
})
