// Wallet connection. Inside Nimiq Pay we use the official mini-app SDK. Outside it we fall back to a
// local "preview" identity: Play mode works, staking needs Nimiq Pay (except against the mock dev chain).
import { init, getHostNetwork, NimiqProviderError } from '@nimiq/mini-app-sdk'
import { api, type Config } from './api'
import { randomHex } from './lib'
import { retry } from '../../shared/retry'

export type Net = 'mainnet' | 'testnet'
export type Wallet = {
  kind: 'nimiq-pay' | 'preview'
  /** the address that will really pay, once the server has verified the wallet's signature */
  address: string
  /** everything listAccounts() returned (the signer is not necessarily the first) */
  accounts: string[]
  verified: boolean
  proof?: { nonce: string; publicKey: string; signature: string }
  /** Asks the wallet to sign a brand new server challenge (every session, and every renewal after the token expires) */
  signIn?(onStatus?: (m: string) => void): Promise<NonNullable<Wallet['proof']> | undefined>
  network: Net | 'unknown'
  /** Sends `luna` to `to` with a public memo (max 64 bytes) and returns the tx hash. */
  send(to: string, luna: number, memo: string): Promise<string>
  balance(): Promise<number | null>
}

const B32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
function previewAddress(): string {
  const saved = localStorage.getItem('nb:preview-address')
  if (saved) return saved
  const body = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => B32[b % 32]).join('')
  const a = 'NQ00 ' + body.match(/.{4}/g)!.join(' ')
  localStorage.setItem('nb:preview-address', a)
  return a
}

export const isInsideNimiqPay = () => typeof window !== 'undefined' && (!!window.nimiqPay || !!window.nimiq)

export function friendlyWalletError(e: unknown): string {
  const m = String((e as any)?.message ?? e ?? '')
  if (/reject|denied|cancel|declin/i.test(m)) return 'You cancelled the payment in Nimiq Pay'
  if (/insufficient|balance|funds/i.test(m)) return 'Not enough NIM in your wallet for that stake plus the network fee'
  if (/timeout/i.test(m)) return 'Nimiq Pay did not answer in time. Try again'
  return m || 'Nimiq Pay could not send that payment'
}

/** Lower-case-insensitive, spacing-insensitive address compare */
export const sameAddress = (a: string, b: string) => a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase()

export class ConnectError extends Error {
  constructor(message: string, readonly kind: 'denied' | 'unavailable') {
    super(message)
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} timed out`)), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
  })

/** Nimiq Pay injects its provider a moment after the page starts. Wait for it before deciding we are outside. */
async function waitForHost(ms: number) {
  const end = Date.now() + ms
  while (!isInsideNimiqPay() && Date.now() < end) await sleep(50)
  return isInsideNimiqPay()
}

const isDenied = (e: unknown) => {
  try { return NimiqProviderError.is(e) && (e as any).type === 'PERMISSION_DENIED' } catch { return false }
}


/**
 * Connects to the wallet. Outside Nimiq Pay it returns a preview identity. Inside Nimiq Pay it never drops to
 * preview: it keeps retrying (provider not injected yet, host still waking, empty first answer) and only gives
 * up with a ConnectError the UI turns into a Try again button, so no manual page reload is needed.
 */
export async function connect(cfg: Config, onStatus: (msg: string) => void = () => {}): Promise<Wallet> {
  const wantPreview = new URLSearchParams(location.search).has('preview')
  const inside = await waitForHost(wantPreview ? 0 : 1500)
  if (inside) return connectNimiqPay(onStatus)
  return previewWallet(cfg)
}

async function connectNimiqPay(onStatus: (msg: string) => void): Promise<Wallet> {
  let nq: Awaited<ReturnType<typeof init>>
  let accounts: string[]
  try {
    ;({ nq, accounts } = await retry(
      async (attempt) => {
        onStatus(attempt ? `Connecting to Nimiq Pay, try ${attempt + 1}…` : 'Connecting to Nimiq Pay…')
        const nq = await init({ timeout: 5000 + attempt * 2500 })
        onStatus('Approve sharing your address in Nimiq Pay')
        const accounts = await withTimeout(nq.listAccounts(), 25000, 'Nimiq Pay')
        if (!Array.isArray(accounts) || !accounts.length) throw new Error('Nimiq Pay shared no account')
        return { nq, accounts }
      },
      { deadlineMs: 45000, fatal: isDenied },
    ))
  } catch (e) {
    if (isDenied(e)) throw new ConnectError('You declined sharing your address. Nimbles needs it to know where your winnings go.', 'denied')
    throw new ConnectError('Nimiq Pay did not answer. Keep it open and try again.', 'unavailable')
  }

  // Nimiq Pay picks the signing account itself and the order of listAccounts() means nothing, so ask the wallet to
  // sign a one-time challenge: the signature tells the server which address will really pay.
  const signIn: Wallet['signIn'] = async (status = onStatus) => {
    if (typeof (nq as any).sign !== 'function') return undefined
    try {
      status('Confirm it is you in Nimiq Pay')
      const c = await api.challenge()
      const sig = await withTimeout((nq as any).sign(c.message) as Promise<{ publicKey: string; signature: string }>, 25000, 'Signing')
      if (sig?.publicKey && sig?.signature) return { nonce: c.nonce, publicKey: sig.publicKey, signature: sig.signature }
    } catch {
      /* declined or unsupported: the server decides (mainnet refuses, testnet keeps an unverified session) */
    }
    return undefined
  }
  const address = accounts[0]
  const proof = await signIn(onStatus)
  const verified = false

  const w: Wallet = {
    kind: 'nimiq-pay',
    address,
    accounts,
    verified,
    proof,
    signIn,
    network: getHostNetwork() ?? 'unknown',
    async send(to, luna, memo) {
      const tx = { recipient: to, value: luna }
      return memo ? nq.sendBasicTransactionWithData({ ...tx, data: memo }) : nq.sendBasicTransaction(tx)
    },
    async balance() {
      try {
        return await nq.getBalance(w.address)
      } catch {
        return null
      }
    },
  }
  return w
}

/** Called once the server has checked the proof: the address it derived from the signature wins */
export function adoptVerified(w: Wallet, address: string, verified: boolean) {
  w.address = address
  w.verified = verified
}

function previewWallet(cfg: Config): Wallet {
  const address = previewAddress()
  return {
    kind: 'preview',
    address,
    accounts: [address],
    verified: false,
    network: cfg.network,
    async send(to, luna, memo) {
      if (!cfg.mock) throw new Error('Open Nimbles inside Nimiq Pay to stake real NIM')
      return (await api.mockTx({ from: address, to, luna, memo })).hash
    },
    async balance() {
      return cfg.mock ? 1_000_000 * 100_000 : null
    },
  }
}

export const deepLink = () => `https://nimpay.app/miniapps/open/${location.host}`
export { randomHex }
