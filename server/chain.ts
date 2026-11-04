import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type DepositCheck = { ok: true } | { ok: false; reason: string; pending?: boolean }

export interface Chain {
  readonly kind: 'mock' | 'testnet'
  readonly network: 'testnet' | 'mainnet'
  readonly escrowAddress: string
  /** Look the tx up on chain and check sender, recipient, value, memo, execution result and finality. */
  verifyDeposit(tx: string, expect: { from: string; luna: number; memo: string }): Promise<DepositCheck>
  /** Pay out of escrow. Returns the tx hash. */
  pay(to: string, luna: number, memo: string): Promise<string>
  balance(): Promise<number>
}

const norm = (a: string) => a.replace(/\s+/g, '').toUpperCase()
export const sameAddr = (a: string, b: string) => norm(a) === norm(b)
export const isNimiqAddress = (a: string) => /^NQ\d{2}( ?[0-9A-HJ-NP-Z]{4}){8}$/i.test(a.trim())

// ---------------- mock chain (tests, offline dev) ----------------

type MockTx = { from: string; to: string; luna: number; memo: string }

export class MockChain implements Chain {
  readonly kind = 'mock' as const
  readonly network = 'testnet' as const
  readonly escrowAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
  txs = new Map<string, MockTx>()
  paid: { to: string; luna: number; memo: string; tx: string }[] = []

  /** Dev-only: the mocked Nimiq Pay provider registers the tx it "sent". */
  register(tx: MockTx): string {
    const hash = 'mock:' + randomBytes(16).toString('hex')
    this.txs.set(hash, tx)
    return hash
  }

  async verifyDeposit(tx: string, e: { from: string; luna: number; memo: string }): Promise<DepositCheck> {
    const t = this.txs.get(tx)
    if (!t) return { ok: false, reason: 'Transaction not found' }
    if (!sameAddr(t.from, e.from)) return { ok: false, reason: 'Sent from a different wallet' }
    if (!sameAddr(t.to, this.escrowAddress)) return { ok: false, reason: 'Not sent to the escrow address' }
    if (t.luna < e.luna) return { ok: false, reason: 'Amount is too low' }
    if (t.memo !== e.memo) return { ok: false, reason: 'Memo does not match this match' }
    return { ok: true }
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

// ---------------- testnet chain (Nimiq TestAlbatross over JSON-RPC, tx built offline with @nimiq/core) ----------------

const TEST_ALBATROSS = 5 // networkId reported by testnet transactions

export class TestnetChain implements Chain {
  readonly kind = 'testnet' as const
  readonly network = 'testnet' as const
  escrowAddress = ''
  private Nimiq: any
  private key: any
  private rpcUrl = process.env.NIMIQ_RPC_URL || 'https://rpc.testnet.nimiqwatch.com/'
  private minConfirmations = Number(process.env.MIN_CONFIRMATIONS ?? 2)
  private sendQueue: Promise<unknown> = Promise.resolve()

  constructor(private dataDir: string) {}

  async start() {
    const N = (this.Nimiq = await import('@nimiq/core'))
    // Escrow key: env first, then data/escrow.key (git-ignored), otherwise generate a fresh testnet-only key.
    let hex = (process.env.ESCROW_PRIVATE_KEY || '').trim()
    const file = join(this.dataDir, 'escrow.key')
    if (!hex && existsSync(file)) hex = readFileSync(file, 'utf8').trim()
    if (!hex) {
      mkdirSync(this.dataDir, { recursive: true })
      hex = randomBytes(32).toString('hex')
      writeFileSync(file, hex, { mode: 0o600 })
    }
    this.key = N.KeyPair.derive(N.PrivateKey.fromHex(hex))
    this.escrowAddress = this.key.toAddress().toUserFriendlyAddress()
    console.log('[chain] testnet escrow', this.escrowAddress, 'rpc', this.rpcUrl)
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

  async verifyDeposit(txHash: string, e: { from: string; luna: number; memo: string }): Promise<DepositCheck> {
    if (!/^[0-9a-f]{64}$/i.test(txHash)) return { ok: false, reason: 'Bad transaction hash' }
    let t: any
    try {
      t = await this.rpc('getTransactionByHash', [txHash])
    } catch {
      return { ok: false, reason: 'Transaction not found yet', pending: true }
    }
    if (!t || t.blockNumber == null) return { ok: false, reason: 'Waiting for the block', pending: true }
    if (t.executionResult === false) return { ok: false, reason: 'Transaction failed on chain' }
    if (t.networkId !== TEST_ALBATROSS) return { ok: false, reason: 'Wrong network' }
    if (!sameAddr(t.from, e.from)) return { ok: false, reason: 'Sent from a different wallet' }
    if (!sameAddr(t.to, this.escrowAddress)) return { ok: false, reason: 'Not sent to the escrow address' }
    if (Number(t.value) < e.luna) return { ok: false, reason: 'Amount is too low' }
    const memo = Buffer.from(String(t.recipientData || ''), 'hex').toString('utf8')
    if (memo !== e.memo) return { ok: false, reason: 'Memo does not match this match' }
    if ((t.confirmations ?? 0) < this.minConfirmations) return { ok: false, reason: 'Waiting for confirmations', pending: true }
    return { ok: true }
  }

  pay(to: string, luna: number, memo: string): Promise<string> {
    const run = async () => {
      const N = this.Nimiq
      const height: number = await this.rpc('getBlockNumber', [])
      const tx = N.TransactionBuilder.newBasicWithData(
        this.key.toAddress(),
        N.Address.fromUserFriendlyAddress(to),
        new TextEncoder().encode(memo.slice(0, 64)),
        BigInt(luna),
        0n,
        height,
        TEST_ALBATROSS,
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

export async function makeChain(dataDir: string): Promise<Chain> {
  const kind = (process.env.CHAIN || 'mock').toLowerCase()
  if (kind === 'mainnet') {
    if (process.env.ALLOW_MAINNET !== 'yes') throw new Error('CHAIN=mainnet is blocked. Nimbles only runs on testnet until it is deliberately enabled.')
    throw new Error('Mainnet chain adapter is not implemented yet.')
  }
  if (kind === 'testnet') {
    const c = new TestnetChain(dataDir)
    await c.start()
    return c
  }
  return new MockChain()
}
