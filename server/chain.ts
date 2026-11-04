import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A good deposit says who paid (`from`) and which ordinary wallet address that payer stands for (`owner`).
 *  Nimiq Pay can pay out of a contract account (an HTLC funded by the user's wallet). Money can't be sent back to a
 *  contract, so `owner` is the wallet behind it. `related` lists every address the tx touches. */
export type DepositCheck = { ok: true; from: string; owner: string | null; related: string[] } | { ok: false; reason: string; pending?: boolean }

export interface Chain {
  readonly kind: 'mock' | 'nimiq'
  readonly network: 'testnet' | 'mainnet'
  readonly escrowAddress: string
  /** Look the tx up on chain and check sender, recipient, value, memo, execution result and finality. */
  verifyDeposit(tx: string, expect: { luna: number; memo: string }): Promise<DepositCheck>
  /** Pay out of escrow. Returns the tx hash. */
  pay(to: string, luna: number, memo: string): Promise<string>
  balance(): Promise<number>
  /** True when the address is an ordinary wallet that can receive a plain transfer (not an HTLC, vesting or other contract). */
  isWallet(address: string): Promise<boolean>
}

const norm = (a: string) => a.replace(/\s+/g, '').toUpperCase()
export const sameAddr = (a: string, b: string) => norm(a) === norm(b)
export const isNimiqAddress = (a: string) => /^NQ\d{2}( ?[0-9A-HJ-NP-Z]{4}){8}$/i.test(a.trim())

// ---------------- mock chain (tests, offline dev) ----------------

/** `contract` + `owner` mimic Nimiq Pay paying out of an HTLC that a wallet account funded */
type MockTx = { from: string; to: string; luna: number; memo: string; contract?: boolean; owner?: string }

export class MockChain implements Chain {
  readonly kind = 'mock' as const
  readonly network = 'testnet' as const
  readonly escrowAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
  txs = new Map<string, MockTx>()
  paid: { to: string; luna: number; memo: string; tx: string }[] = []
  /** Test hook: addresses that behave like contracts */
  contracts = new Set<string>()

  async isWallet(address: string) {
    return ![...this.contracts].some((c) => sameAddr(c, address))
  }

  /** Dev-only: the mocked Nimiq Pay provider registers the tx it "sent". */
  register(tx: MockTx): string {
    const hash = 'mock:' + randomBytes(16).toString('hex')
    this.txs.set(hash, tx)
    return hash
  }

  async verifyDeposit(tx: string, e: { luna: number; memo: string }): Promise<DepositCheck> {
    const t = this.txs.get(tx)
    if (!t) return { ok: false, reason: 'Transaction not found' }
    if (!sameAddr(t.to, this.escrowAddress)) return { ok: false, reason: 'Not sent to the escrow address' }
    if (t.luna < e.luna) return { ok: false, reason: 'Amount is too low' }
    if (t.memo !== e.memo) return { ok: false, reason: 'Memo does not match this match' }
    const owner = t.contract ? t.owner ?? null : t.from
    return { ok: true, from: t.from, owner, related: [t.from, ...(owner ? [owner] : [])] }
  }

  async pay(to: string, luna: number, memo: string): Promise<string> {
    const tx = 'mock:payout:' + randomBytes(8).toString('hex')
    this.paid.push({ to, luna, memo, tx })
    return tx
  }

  async balance() {
    return 1e12
  }
}

// ---------------- Nimiq chain (testnet or mainnet over JSON-RPC, txs built and signed offline with @nimiq/core) ----------------

export type Network = 'testnet' | 'mainnet'
const NETWORK_ID: Record<Network, number> = { testnet: 5, mainnet: 24 } // TestAlbatross / Albatross, as reported by transactions
const DEFAULT_RPC: Record<Network, string> = { testnet: 'https://rpc.testnet.nimiqwatch.com/', mainnet: 'https://rpc.nimiqwatch.com/' }

/** Escrow key sources, in order: ESCROW_PRIVATE_KEY (hex), ESCROW_KEY_FILE, data/escrow.<network>.key.
 *  Testnet may generate a throwaway key. Mainnet never does: the key must already exist, or the server refuses to start. */
export function loadEscrowKey(network: Network, dataDir: string): { hex: string; source: string } | null {
  const env = (process.env.ESCROW_PRIVATE_KEY || '').trim()
  if (env) return { hex: env, source: 'env' }
  const files = [process.env.ESCROW_KEY_FILE, join(dataDir, `escrow.${network}.key`), ...(network === 'testnet' ? [join(dataDir, 'escrow.key')] : [])].filter(Boolean) as string[]
  for (const f of files) if (existsSync(f)) return { hex: readFileSync(f, 'utf8').trim(), source: f }
  return null
}

export class NimiqChain implements Chain {
  readonly kind = 'nimiq' as const
  escrowAddress = ''
  private Nimiq: any
  private key: any
  private rpcUrl: string
  private minConfirmations = Number(process.env.MIN_CONFIRMATIONS ?? 2)
  private sendQueue: Promise<unknown> = Promise.resolve()

  constructor(private dataDir: string, readonly network: Network = 'testnet') {
    this.rpcUrl = process.env.NIMIQ_RPC_URL || DEFAULT_RPC[network]
  }

  async start() {
    const N = (this.Nimiq = await import('@nimiq/core'))
    let found = loadEscrowKey(this.network, this.dataDir)
    if (!found) {
      if (this.network === 'mainnet') throw new Error('No mainnet escrow key. Set ESCROW_PRIVATE_KEY or ESCROW_KEY_FILE (run `npm run wallet:mainnet` to create one). Mainnet never auto-generates a key.')
      mkdirSync(this.dataDir, { recursive: true })
      const hex = randomBytes(32).toString('hex')
      writeFileSync(join(this.dataDir, `escrow.${this.network}.key`), hex, { mode: 0o600 })
      found = { hex, source: 'generated' }
    }
    this.key = N.KeyPair.derive(N.PrivateKey.fromHex(found.hex))
    this.escrowAddress = this.key.toAddress().toUserFriendlyAddress()
    console.log(`[chain] ${this.network} escrow ${this.escrowAddress} (key from ${found.source === 'env' ? 'env' : found.source === 'generated' ? 'new file' : 'file'}), rpc ${this.rpcUrl}`)
  }

  private async rpc(method: string, params: unknown[]): Promise<any> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(15000),
    })
    const j: any = await res.json()
    if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.data || j.error.message)
    return j.result?.data
  }

  async verifyDeposit(txHash: string, e: { luna: number; memo: string }): Promise<DepositCheck> {
    if (!/^[0-9a-f]{64}$/i.test(txHash)) return { ok: false, reason: 'Bad transaction hash' }
    let t: any
    try {
      t = await this.rpc('getTransactionByHash', [txHash])
    } catch {
      return { ok: false, reason: 'Transaction not found yet', pending: true }
    }
    if (!t || t.blockNumber == null) return { ok: false, reason: 'Waiting for the block', pending: true }
    if (t.executionResult === false) return { ok: false, reason: 'Transaction failed on chain' }
    if (t.networkId !== NETWORK_ID[this.network]) return { ok: false, reason: 'Wrong network' }
    if (!sameAddr(t.to, this.escrowAddress)) return { ok: false, reason: 'Not sent to the escrow address' }
    if (Number(t.value) < e.luna) return { ok: false, reason: 'Amount is too low' }
    const memo = Buffer.from(String(t.recipientData || ''), 'hex').toString('utf8')
    if (memo !== e.memo) return { ok: false, reason: 'Memo does not match this match' }
    if ((t.confirmations ?? 0) < this.minConfirmations) return { ok: false, reason: 'Waiting for confirmations', pending: true }
    const from = String(t.from)
    const related: string[] = Array.isArray(t.relatedAddresses) ? t.relatedAddresses.map(String) : []
    return { ok: true, from, owner: await this.ownerOf(from, t.fromType), related }
  }

  /** The ordinary wallet address behind a payer. A basic account is its own owner. For an HTLC it is the account that
   *  funded it, for a vesting contract the owner. Anything else is unknown (null). */
  private async ownerOf(from: string, fromType: unknown): Promise<string | null> {
    if (fromType === 0 || fromType === undefined) return from
    try {
      const a = await this.rpc('getAccountByAddress', [from])
      if (a?.type === 'basic') return from
      if (a?.type === 'htlc' && isNimiqAddress(String(a.sender))) return String(a.sender)
      if (a?.type === 'vesting' && isNimiqAddress(String(a.owner))) return String(a.owner)
    } catch { /* unknown */ }
    return null
  }

  async isWallet(address: string): Promise<boolean> {
    const a = await this.rpc('getAccountByAddress', [address]).catch(() => null)
    return !a || !a.type || a.type === 'basic'
  }

  pay(to: string, luna: number, memo: string): Promise<string> {
    const run = async () => {
      const N = this.Nimiq
      // a contract account (HTLC, vesting) rejects plain transfers: the tx would confirm but fail, and the NIM stays in escrow
      const dest = await this.rpc('getAccountByAddress', [to]).catch(() => null)
      if (dest && dest.type && dest.type !== 'basic') throw new Error(`Cannot pay ${to}: it is a ${dest.type} contract, not a wallet`)
      const height: number = await this.rpc('getBlockNumber', [])
      const tx = N.TransactionBuilder.newBasicWithData(
        this.key.toAddress(),
        N.Address.fromUserFriendlyAddress(to),
        new TextEncoder().encode(memo.slice(0, 64)),
        BigInt(luna),
        0n,
        height,
        NETWORK_ID[this.network],
      )
      tx.sign(this.key)
      const hex = Buffer.from(tx.serialize()).toString('hex')
      const hash: string = await this.rpc('sendRawTransaction', [hex])
      return hash || (tx.hash() as string)
    }
    // serialise sends so two payouts never race for the same validity window
    const p = this.sendQueue.then(run, run) as Promise<string>
    this.sendQueue = p.catch(() => undefined)
    return p
  }

  async balance() {
    const a = await this.rpc('getAccountByAddress', [this.escrowAddress])
    return Number(a?.balance ?? 0)
  }
}

/** Kept for the testnet scripts. */
export class TestnetChain extends NimiqChain {
  constructor(dataDir: string) {
    super(dataDir, 'testnet')
  }
}

/** CHAIN=mock (default) | nimiq, with NETWORK=testnet (default) | mainnet. `CHAIN=testnet|mainnet` still works as shorthand. */
export function resolveChainConfig(env: NodeJS.ProcessEnv = process.env): { kind: 'mock' | 'nimiq'; network: Network } {
  const raw = (env.CHAIN || 'mock').toLowerCase()
  const net = (env.NETWORK || '').toLowerCase()
  if (net && net !== 'testnet' && net !== 'mainnet') throw new Error('NETWORK must be testnet or mainnet')
  if (raw === 'mock') return { kind: 'mock', network: 'testnet' }
  if (raw === 'testnet' || raw === 'mainnet') {
    if (net && net !== raw) throw new Error(`CHAIN=${raw} conflicts with NETWORK=${net}`)
    return { kind: 'nimiq', network: raw }
  }
  if (raw === 'nimiq') return { kind: 'nimiq', network: (net || 'testnet') as Network }
  throw new Error('CHAIN must be mock or nimiq')
}

export async function makeChain(dataDir: string): Promise<Chain> {
  const { kind, network } = resolveChainConfig()
  if (kind === 'mock') return new MockChain()
  if (network === 'mainnet' && process.env.ALLOW_MAINNET !== 'yes') {
    throw new Error('Mainnet moves real NIM. Set ALLOW_MAINNET=yes to start it deliberately.')
  }
  const c = new NimiqChain(dataDir, network)
  await c.start()
  return c
}
