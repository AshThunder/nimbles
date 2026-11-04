// Retry with exponential backoff. Used for wallet start-up, where the host may inject its provider late or
// answer the first request with an error while it is still waking up.
export type RetryOpts = {
  /** give up once this much time has passed (ms) */
  deadlineMs: number
  baseMs?: number
  maxDelayMs?: number
  /** errors that should stop immediately, for example the user declining */
  fatal?: (e: unknown) => boolean
  onRetry?: (attempt: number, e: unknown, waitMs: number) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export const backoff = (attempt: number, baseMs = 400, maxMs = 3000) => Math.min(maxMs, baseMs * 2 ** attempt)

export async function retry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts): Promise<T> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = o.now ?? Date.now
  const start = now()
  let last: unknown
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      last = e
      if (o.fatal?.(e)) throw e
      const wait = backoff(attempt, o.baseMs, o.maxDelayMs)
      if (now() - start + wait >= o.deadlineMs) throw last
      o.onRetry?.(attempt, e, wait)
      await sleep(wait)
    }
  }
}
