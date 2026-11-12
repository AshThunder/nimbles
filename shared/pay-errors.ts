// How a failed Nimiq Pay payment is read: cancelled by the player, failed before it was broadcast, or timed out (may
// still have gone out). Shared so the rules are tested without a browser.

const msgOf = (e: unknown) => String((e as any)?.message ?? e ?? '')
const typeOf = (e: unknown) => String((e as any)?.type ?? (e as any)?.data?.type ?? '')

/** The JSON-RPC style code Nimiq Pay attaches (-32000 NETWORK_ERROR, -32603 internal), from the error or its message. */
export function payErrorCode(e: unknown): number | undefined {
  for (const c of [(e as any)?.code, (e as any)?.data?.code, (e as any)?.error?.code]) {
    const n = typeof c === 'string' ? Number(c) : c
    if (typeof n === 'number' && Number.isFinite(n) && n !== 0) return n
  }
  const m = msgOf(e).match(/-32\d{3}/)
  return m ? Number(m[0]) : undefined
}

/** Codes Nimiq Pay returns while it is still syncing the wallet or holding a transaction it thinks is pending. */
const TIMEOUT_TEXT = /time(d)?\s*out|timeout/i
const BUSY_CODES = new Set([-32000, -32603])
const BUSY_TYPES = new Set(['NETWORK_ERROR', 'INTERNAL_ERROR', 'INVALID_TRANSACTION', 'CONSENSUS_NOT_ESTABLISHED'])
const BUSY_TEXT = /not ready|getting balance|syncing|sync|still updating|updating your wallet|still pending|transaction is pending|went wrong|consensus|invalid transaction|bad request/i

/** Nimiq Pay is busy (syncing after NIM arrived, or stuck on a transaction it thinks is pending). The confirm sheet never
 *  opened, so nothing was sent. Seen: "Nimiq network is not ready", "Error getting balance" (-32000), "Something went
 *  wrong syncing your account", "still updating your wallet", "-32603 ... A transaction is still pending". */
export function isPayBusy(e: unknown) {
  // a timeout may have been broadcast ("Failed to send payment transaction: Operation timed out"): never read it as busy
  if (isSendDenied(e) || TIMEOUT_TEXT.test(msgOf(e))) return false
  const code = payErrorCode(e)
  return (code !== undefined && BUSY_CODES.has(code)) || BUSY_TYPES.has(typeOf(e)) || BUSY_TEXT.test(msgOf(e))
}

export type PayErrorKind = 'denied' | 'busy' | 'funds' | 'timeout' | 'other'
/** One reading of any Nimiq Pay failure. Order matters: "Nimiq network is not ready" is busy, not a timeout, and
 *  "Error getting balance" is busy, not "not enough funds". */
export function classifyPayError(e: unknown): PayErrorKind {
  if (isSendDenied(e)) return 'denied'
  if (isPayBusy(e)) return 'busy'
  if (/insufficient|not enough|exceeds (the )?balance/i.test(msgOf(e))) return 'funds'
  if (isSendTimeout(e)) return 'timeout'
  return 'other'
}

/** A short line for the console and the server log. Never shown to the player. */
export function payErrorLog(e: unknown) {
  const code = payErrorCode(e)
  const t = typeOf(e)
  return [code !== undefined ? String(code) : '', t, msgOf(e).replace(/\s+/g, ' ').slice(0, 160)].filter(Boolean).join(' ')
}

/** Nimiq Pay's own 30 s limit ("Operation timed out after 30000 milliseconds"), our wrapper, or a network drop. The
 *  transaction may still have gone out, so the caller checks the chain before offering to pay again. A busy error
 *  ("Nimiq network is not ready") is not a timeout: the confirm sheet never opened. */
export function isSendTimeout(e: unknown) {
  if (isPayBusyText(e)) return false
  return /time(d)?\s*out|timeout|network|offline|connect/i.test(msgOf(e))
}
const isPayBusyText = (e: unknown) => !TIMEOUT_TEXT.test(msgOf(e)) && (BUSY_TEXT.test(msgOf(e)) || BUSY_CODES.has(payErrorCode(e) as number))
/** Nimiq Pay failed before broadcasting (busy or its wallet sync broke). Safe to try again. */
export function isSendNotSent(e: unknown) {
  return isPayBusy(e)
}
export const isSendDenied = (e: unknown) => /reject|denied|cancel|declin/i.test(msgOf(e))
