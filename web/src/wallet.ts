// Wallet connection. Inside Nimiq Pay we use the official mini-app SDK. Outside it we fall back to a
// local "preview" identity: Play mode works, staking needs Nimiq Pay (except against the mock dev chain).
import { init, getHostNetwork, NimiqProviderError } from '@nimiq/mini-app-sdk'
import { api, type Config } from './api'
import { randomHex } from './lib'
import { retry } from '../../shared/retry'
import {
  parsePayAccounts,
  resolveSpendableLuna,
  isProviderAuthorizedAddress,
} from '../../shared/pay-balance'

export type Net = 'mainnet' | 'testnet'
export type Wallet = {
  kind: 'nimiq-pay' | 'preview'
  /** the address that will really pay, once the server has verified the wallet's signature */
  address: string
  /** everything listAccounts() returned: [wallet, htlc?] per official SDK */
  accounts: string[]
  verified: boolean
  proof?: { nonce: string; publicKey: string; signature: string }
  /** Asks the wallet to sign a brand new server challenge (every session, and every renewal after the token expires) */
  signIn?(onStatus?: (m: string) => void): Promise<NonNullable<Wallet['proof']> | undefined>
  network: Net | 'unknown'
  /** Sends `luna` to `to` with a public memo (max 64 bytes) and returns the tx hash. */
  send(to: string, luna: number, memo: string): Promise<string>
  /**
   * Confirmed spendable NIM in luna for this Pay wallet.
   * Official path: getBalance(active HTLC) from listAccounts; 0 when no HTLC.
   * null = unavailable (not a real zero). Never jar/escrow; never other wallets.
   */
  balance(): Promise<number | null>
  /** Optional: subscribe to Pay HTLC replacement / account list updates. Returns unsubscribe. */
  onAccountsChanged?(cb: (accounts: string[]) => void): () => void
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
  constructor(
    message: string,
    readonly kind: 'denied' | 'unavailable' | 'needs-tap',
    /** still-pending listAccounts after a timeout: resolves if the user approves late */
    readonly late?: Promise<unknown>,
  ) {
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

/** Set after Nimiq Pay shared accounts once. Without it we never auto-request, the user taps Connect wallet. */
const APPROVED_KEY = 'nb:pay-approved'
/** How long we wait for listAccounts before showing Connect wallet again (the request itself stays alive) */
const ACCOUNTS_TIMEOUT_MS = 8000
/** After a tap the user is reading Pay's sheet, so give them a little longer */
const TAP_TIMEOUT_MS = 15000
const hasApproved = () => { try { return localStorage.getItem(APPROVED_KEY) === '1' } catch { return false } }
const setApproved = (on: boolean) => {
  try { on ? localStorage.setItem(APPROVED_KEY, '1') : localStorage.removeItem(APPROVED_KEY) } catch { /* private mode */ }
}

/**
 * Waits until the mini app is really on screen: page loaded, visible, two painted frames and a short settle.
 * A wallet request fired before that can open Nimiq Pay's sheet behind the app on a cold start.
 */
async function appSettled() {
  if (document.readyState !== 'complete') await new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true }))
  if (document.visibilityState !== 'visible') {
    await new Promise<void>((r) => {
      const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); r() } }
      document.addEventListener('visibilitychange', on)
    })
  }
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  await sleep(600)
}

// Only one listAccounts may be in flight. A late answer (after our timeout) is kept for the next connect.
let inflight: Promise<string[]> | null = null
let lateAccounts: string[] | null = null
function requestAccounts(nq: Awaited<ReturnType<typeof init>>): Promise<string[]> {
  if (lateAccounts) {
    const a = lateAccounts
    lateAccounts = null
    return Promise.resolve(a)
  }
  if (!inflight) {
    const p: Promise<string[]> = nq.listAccounts().then((a) => {
      if (!Array.isArray(a) || !a.length) throw new Error('Nimiq Pay shared no account')
      setApproved(true)
      return a
    }, (e) => {
      if (isDenied(e)) setApproved(false)
      throw e
    })
    inflight = p
    p.then(() => {}, () => {}).finally(() => { if (inflight === p) inflight = null })
  }
  return inflight
}

/**
 * Connects to the wallet. Outside Nimiq Pay it returns a preview identity. Inside Nimiq Pay it never drops to
 * preview. First open (no approval remembered) throws ConnectError('needs-tap') so the UI shows a Connect wallet
 * button: the tap starts listAccounts while the app is in front, so Pay's sheet opens on top. Returning users
 * connect automatically once the app is visible and settled. Timeouts and declines come back as ConnectError too.
 */
export async function connect(
  cfg: Config,
  onStatus: (msg: string) => void = () => {},
  opts: { userTap?: boolean } = {},
): Promise<Wallet> {
  const wantPreview = new URLSearchParams(location.search).has('preview')
  const inside = await waitForHost(wantPreview ? 0 : 1500)
  if (inside) return connectNimiqPay(onStatus, !!opts.userTap)
  return previewWallet(cfg)
}

async function connectNimiqPay(onStatus: (msg: string) => void, userTap: boolean): Promise<Wallet> {
  let nq: Awaited<ReturnType<typeof init>>
  try {
    // Retry only the provider injection. listAccounts below is a single request, never one per retry.
    nq = await retry(
      async (attempt) => {
        if (attempt) onStatus(`Connecting to Nimiq Pay, try ${attempt + 1}…`)
        return init({ timeout: 3000 + attempt * 2000 })
      },
      { deadlineMs: 15000 },
    )
  } catch {
    throw new ConnectError('Nimiq Pay did not answer. Keep it open and tap Connect wallet.', 'unavailable')
  }

  if (!userTap && !hasApproved() && !lateAccounts && !inflight) {
    throw new ConnectError('Nimbles uses your Nimiq Pay address to send your winnings to you.', 'needs-tap')
  }
  if (!userTap && !lateAccounts) {
    onStatus('Connecting to Nimiq Pay…')
    await appSettled()
  }

  let accounts: string[]
  onStatus(userTap ? 'Approve sharing your address in Nimiq Pay' : 'Connecting to Nimiq Pay…')
  // One request at a time. A quick error or empty answer (host still waking) is retried after it finished;
  // a request that hangs is never repeated: after ~8s the UI shows Connect wallet and the request stays alive.
  const end = Date.now() + (userTap ? TAP_TIMEOUT_MS : ACCOUNTS_TIMEOUT_MS)
  for (let attempt = 0; ; attempt++) {
    const req = requestAccounts(nq)
    try {
      accounts = await withTimeout(req, Math.max(500, end - Date.now()), 'Nimiq Pay')
      break
    } catch (e) {
      if (isDenied(e)) throw new ConnectError('You declined sharing your address. Nimbles needs it to know where your winnings go.', 'denied')
      if (/timed out/.test(String((e as any)?.message))) {
        // If the user approves now, the next connect picks the answer up without a new request.
        const late = req.then((a) => { lateAccounts = a; return a })
        late.catch(() => {})
        throw new ConnectError('Nimiq Pay did not answer yet. Tap Connect wallet to try again.', 'unavailable', late)
      }
      const wait = Math.min(2000, 400 * 2 ** attempt)
      if (Date.now() + wait >= end) {
        throw new ConnectError('Nimiq Pay did not share your address. Tap Connect wallet to try again.', 'unavailable')
      }
      onStatus(`Connecting to Nimiq Pay, try ${attempt + 2}…`)
      await sleep(wait)
    }
  }
  lateAccounts = null

  // Identity is the basic wallet address (accounts[0]). Sign-in proves that address; HTLC is balance only.
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
  const { wallet: walletAddr } = parsePayAccounts(accounts)
  const address = walletAddr ?? accounts[0]
  const proof = await signIn(onStatus)
  const verified = false

  const accountListeners = new Set<(accounts: string[]) => void>()
  const accountsEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x, i) => sameAddress(x, b[i]))
  /** Update cached accounts. Notify listeners only when the list actually changes (HTLC replace). */
  const applyAccounts = (next: string[], notify = true) => {
    if (!Array.isArray(next) || !next.length) return false
    const sliced = next.slice()
    const changed = !accountsEqual(w.accounts, sliced)
    if (!changed) return false
    w.accounts = sliced
    // Keep signed identity on the basic wallet slot; do not swap address to the HTLC.
    const parsed = parsePayAccounts(sliced)
    if (parsed.wallet && !sameAddress(parsed.wallet, w.address) && !w.verified) {
      w.address = parsed.wallet
    }
    if (notify) {
      for (const cb of accountListeners) {
        try { cb(w.accounts) } catch { /* listener errors must not break Pay */ }
      }
    }
    return true
  }

  // Official: host emits accountsChanged when it replaces the HTLC (age/top-up) without re-approval.
  try {
    if (typeof (nq as any).on === 'function') {
      ;(nq as any).on('accountsChanged', (next: string[]) => applyAccounts(next))
    }
  } catch { /* older host without events */ }

  const readHostHtlc = async (htlc: string): Promise<{ luna: number | null; error: boolean }> => {
    try {
      if (typeof (nq as any).getBalance !== 'function') return { luna: null, error: true }
      const b = await withTimeout(nq.getBalance(htlc), 15000, 'Balance')
      if (typeof b === 'number' && Number.isFinite(b) && b >= 0) return { luna: b, error: false }
      return { luna: null, error: false }
    } catch (e) {
      if (isDenied(e)) return { luna: null, error: true }
      return { luna: null, error: true }
    }
  }

  const readRpcAuthorized = async (addr: string): Promise<number | null> => {
    // Backend fallback only for a provider-authorized address (wallet or its HTLC), never arbitrary.
    if (!isProviderAuthorizedAddress(w.accounts, addr)) return null
    try {
      const r = await api.addressBalance(addr)
      if (typeof r?.luna === 'number' && Number.isFinite(r.luna) && r.luna >= 0) return r.luna
    } catch { /* RPC/auth blip */ }
    return null
  }

  const w: Wallet = {
    kind: 'nimiq-pay',
    address,
    accounts: accounts.slice(),
    verified,
    proof,
    signIn,
    network: getHostNetwork() ?? 'unknown',
    async send(to, luna, memo) {
      const tx = { recipient: to, value: luna }
      return memo ? nq.sendBasicTransactionWithData({ ...tx, data: memo }) : nq.sendBasicTransaction(tx)
    },
    async balance() {
      // Re-bind accounts when possible so a silent HTLC replacement is picked up even before the event.
      try {
        if (typeof (nq as any).listAccounts === 'function') {
          const fresh = await withTimeout(nq.listAccounts(), 15000, 'Accounts')
          // Quiet rebind: do not notify listeners here or refreshBalance would recurse forever.
          if (Array.isArray(fresh) && fresh.length) applyAccounts(fresh, false)
        }
      } catch { /* keep last known accounts */ }

      const { htlc } = parsePayAccounts(w.accounts)
      // Official: no HTLC → spendable is 0. Do not claim basic-address RPC as total wallet funds.
      if (!htlc) {
        return resolveSpendableLuna({ accounts: w.accounts })
      }

      const host = await readHostHtlc(htlc)
      if (typeof host.luna === 'number') {
        return resolveSpendableLuna({ accounts: w.accounts, hostHtlcLuna: host.luna })
      }

      // Host unavailable / denied / missing getBalance: optional RPC on the same authorized HTLC only.
      const rpc = await readRpcAuthorized(htlc)
      return resolveSpendableLuna({
        accounts: w.accounts,
        hostHtlcLuna: host.luna,
        hostError: host.error,
        rpcHtlcLuna: rpc,
      })
    },
    onAccountsChanged(cb) {
      accountListeners.add(cb)
      return () => { accountListeners.delete(cb) }
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
      // Preview has no Pay HTLC. Mock chain: show a play balance. Live preview outside Pay: unavailable.
      return cfg.mock ? 1_000_000 * 100_000 : null
    },
  }
}

export const deepLink = () => `https://nimpay.app/miniapps/open/${location.host}`
export { randomHex }
