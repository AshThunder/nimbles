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
