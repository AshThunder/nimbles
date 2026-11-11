// How a failed Nimiq Pay payment is read: cancelled by the player, failed before it was broadcast, or timed out (may
// still have gone out). Shared so the rules are tested without a browser.

/** Nimiq Pay's own 30 s limit ("Operation timed out after 30000 milliseconds"), our wrapper, or a network drop. The
 *  transaction may still have gone out, so the caller checks the chain before offering to pay again. */
export function isSendTimeout(e: unknown) {
  return /time(d)?\s*out|timeout|network|consensus|offline|connect/i.test(String((e as any)?.message ?? e ?? ''))
}
/** Nimiq Pay failed after approval, before broadcasting: its wallet sync broke ("Something went wrong syncing your
 *  account"), usually because NIM had just arrived and Pay was moving the wallet into a fresh HTLC. Safe to try again. */
export function isSendNotSent(e: unknown) {
  const m = String((e as any)?.message ?? e ?? '')
  const t = String((e as any)?.type ?? '')
  return /sync|went wrong|bad request|invalid transaction/i.test(m) || t === 'INVALID_TRANSACTION' || t === 'INTERNAL_ERROR'
}
export const isSendDenied = (e: unknown) => /reject|denied|cancel|declin/i.test(String((e as any)?.message ?? e ?? ''))
