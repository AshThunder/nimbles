/**
 * Nimiq Pay spendable balance helpers.
 *
 * Official @nimiq/mini-app-sdk (0.2.5+) "Wallet balance":
 * - Spendable NIM lives in an HTLC shared with the Pay cosigner.
 * - listAccounts() → [walletAddress, htlcAddress?]
 * - balance = htlcAddress ? getBalance(htlcAddress) : 0
 * - accountsChanged fires on HTLC replacement; re-read then.
 * - During replacement the old HTLC can read 0 briefly while funds still exist.
 *
 * Wallet identity / auth stays the signed basic address (accounts[0]).
 * Never sum unrelated wallets; never treat basic-address 0 as "total funds"
 * when an HTLC slot is present.
 */

/** Normalize a Nimiq user-friendly address for equality checks. */
export const normAddr = (a: string) => a.replace(/\s+/g, '').toUpperCase()

export type PayAccountPair = {
  /** Basic wallet address (identity / auth). Always accounts[0] when present. */
  wallet: string | null
  /** Active Pay HTLC address when listAccounts shared one. */
  htlc: string | null
}

/**
 * Parse provider listAccounts() shape: wallet first, optional active HTLC second.
 * Ignores extra entries (never sum them). Drops empty/non-string slots.
 */
export function parsePayAccounts(accounts: unknown): PayAccountPair {
  if (!Array.isArray(accounts)) return { wallet: null, htlc: null }
  const clean = accounts.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
  return {
    wallet: clean[0] ?? null,
    htlc: clean[1] ?? null,
  }
}

/**
 * Address whose getBalance() is the official spendable read.
 * null → no HTLC → documented spendable is 0 (do not fall back to basic RPC as total).
 */
export function spendableBalanceAddress(accounts: unknown): string | null {
  return parsePayAccounts(accounts).htlc
}

/** True when listAccounts includes an active HTLC slot (even if that HTLC currently reads 0). */
export function hasPayHtlc(accounts: unknown): boolean {
  return parsePayAccounts(accounts).htlc != null
}

/**
 * Decide what a balance() call should return given host/RPC outcomes.
 *
 * - Prefer host getBalance on the active HTLC (official).
 * - No HTLC → 0 (official), not basic-address RPC.
 * - Host missing / permission / network failure → null (unavailable), never fake 0 when HTLC exists but unread.
 * - Optional RPC fallback only for the same provider-authorized spendable address.
 */
export function resolveSpendableLuna(opts: {
  accounts: unknown
  /** Host getBalance(htlc) result when HTLC present; ignored when no HTLC. */
  hostHtlcLuna?: number | null | undefined
  /** Host threw / method missing / denied. */
  hostError?: boolean
  /** RPC read of the same HTLC address only (never an arbitrary address). */
  rpcHtlcLuna?: number | null | undefined
}): number | null {
  const { htlc } = parsePayAccounts(opts.accounts)
  if (!htlc) return 0

  const host = opts.hostHtlcLuna
  if (typeof host === 'number' && Number.isFinite(host) && host >= 0) return host

  if (!opts.hostError) {
    // Host returned a non-number without throwing — treat as unavailable.
    if (host !== undefined && host !== null) return null
  }

  const rpc = opts.rpcHtlcLuna
  if (typeof rpc === 'number' && Number.isFinite(rpc) && rpc >= 0) return rpc

  return null
}

/**
 * Whether `address` is one of the provider-authorized accounts (wallet or its HTLC).
 * Used to gate any backend RPC fallback so we never query arbitrary addresses as "the wallet".
 */
export function isProviderAuthorizedAddress(accounts: unknown, address: string): boolean {
  const { wallet, htlc } = parsePayAccounts(accounts)
  const n = normAddr(address)
  if (wallet && normAddr(wallet) === n) return true
  if (htlc && normAddr(htlc) === n) return true
  return false
}

/**
 * What the header shows after one balance read.
 *
 * When NIM arrives, Nimiq Pay moves the spendable funds into a new HTLC. For a few seconds (sometimes until the payout
 * confirms) listAccounts() can come back without an HTLC, or the old HTLC reads 0, while the money is all still there.
 * A read that fails (null) never replaces what is shown, and a sudden 0 is only believed once it has held for
 * `zeroHoldMs`, read again a few times. A payout we know is on its way is shown as "incoming" until a read includes it.
 */
export type ShownBalance = {
  shown: number | null | undefined // luna; undefined = never read, null = never read successfully
  zeroSince?: number
  incoming?: { luna: number; base: number; until: number }
}
export const BALANCE_ZERO_HOLD_MS = 20_000
export const BALANCE_RETRY_MS = 5_000
export const INCOMING_MAX_MS = 5 * 60_000

export function nextShownBalance(s: ShownBalance, read: number | null, now = Date.now(), zeroHoldMs = BALANCE_ZERO_HOLD_MS): { state: ShownBalance; retryMs?: number } {
  const st: ShownBalance = { ...s }
  if (st.incoming && now > st.incoming.until) delete st.incoming
  if (read === null || !Number.isFinite(read) || read < 0) {
    // keep the last good number; the first read ever failing shows "unavailable"
    if (st.shown === undefined) st.shown = null
    return { state: st, retryMs: BALANCE_RETRY_MS * 2 }
  }
  if (read === 0 && typeof st.shown === 'number' && st.shown > 0) {
    st.zeroSince ??= now
    if (now - st.zeroSince < zeroHoldMs) return { state: st, retryMs: BALANCE_RETRY_MS }
  }
  delete st.zeroSince
  st.shown = read
  if (st.incoming && read >= st.incoming.base + st.incoming.luna * 0.99) delete st.incoming
  return { state: st, retryMs: st.incoming ? BALANCE_RETRY_MS * 2 : undefined }
}

/** A payout is on its way to this wallet: show it as incoming on top of the balance it lands on. */
export function expectIncoming(s: ShownBalance, luna: number, now = Date.now()): ShownBalance {
  if (!(luna > 0)) return s
  const base = typeof s.shown === 'number' ? s.shown : 0
  const prev = s.incoming && now <= s.incoming.until ? s.incoming : null
  return { ...s, incoming: { luna: (prev?.luna ?? 0) + luna, base: prev?.base ?? base, until: now + INCOMING_MAX_MS } }
}
