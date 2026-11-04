// Wallet ownership proof. Nimiq Pay picks the signing account itself and `listAccounts()` says nothing about which
// one that is, so the app asks the wallet to sign a one-time challenge and takes the address from the signature.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Mainnet challenges say so, so a signature made for one network can never stand for the other */
export const challengeText = (nonce: string, network: 'testnet' | 'mainnet' = 'testnet') => (network === 'mainnet' ? `Nimbles mainnet sign-in ${nonce}` : `Nimbles sign-in ${nonce}`)
const PREFIX = '\x16Nimiq Signed Message:\n'
/** A challenge must be signed within two minutes and works once. */
const TTL = 2 * 60_000

export class Challenges {
  private open = new Map<string, number>()
  constructor(private network: 'testnet' | 'mainnet' = 'testnet') {}
  issue(now = Date.now()): { nonce: string; message: string; expiresAt: number } {
    for (const [n, t] of this.open) if (now - t > TTL) this.open.delete(n)
    if (this.open.size > 5000) this.open.clear()
    const nonce = randomBytes(12).toString('hex')
    this.open.set(nonce, now)
    return { nonce, message: challengeText(nonce, this.network), expiresAt: now + TTL }
  }
  /** Single use: returns true once for a fresh nonce */
  take(nonce: string, now = Date.now()): boolean {
    const t = this.open.get(nonce)
    this.open.delete(nonce)
    return t !== undefined && now - t <= TTL
  }
}

/** Candidate byte strings a wallet may have signed for a text message (raw, or the Nimiq signed-message hash) */
export function signedForms(message: string): Uint8Array[] {
  const raw = Buffer.from(message, 'utf8')
  const wrapped = Buffer.concat([Buffer.from(PREFIX + raw.length, 'utf8'), raw])
  return [raw, createHash('sha256').update(wrapped).digest(), wrapped]
}

/** Returns the user-friendly address that signed `message`, or null if the signature does not check out */
export async function addressFromProof(p: { publicKey?: unknown; signature?: unknown }, message: string): Promise<string | null> {
  try {
    if (typeof p.publicKey !== 'string' || typeof p.signature !== 'string') return null
    if (!/^[0-9a-f]{64}$/i.test(p.publicKey) || !/^[0-9a-f]{128}$/i.test(p.signature)) return null
    const N: any = await import('@nimiq/core')
    const pk = N.PublicKey.fromHex(p.publicKey)
    const sig = N.Signature.fromHex(p.signature)
    for (const data of signedForms(message)) if (pk.verify(sig, data)) return pk.toAddress().toUserFriendlyAddress()
  } catch {
    /* malformed key or signature */
  }
  return null
}

/** Short-lived session tokens, stateless: `nbs1.<address>.<expiry>.<flag>.<hmac>`. Each one is bound to the address that
 *  signed a fresh challenge, and stops working at its expiry, after which the app signs a new challenge. The HMAC key
 *  is a server secret, so a token can neither be forged nor moved to another address. */
export class Sessions {
  constructor(private secret: string, readonly ttlMs: number) {}
  private mac(body: string) {
    return createHmac('sha256', this.secret).update(body).digest('hex')
  }
  /** `verified` is true when a signed challenge backs the session. Unsigned sessions exist only on testnet and the mock. */
  issue(address: string, verified: boolean, now = Date.now()): { token: string; expiresAt: number } {
    const expiresAt = now + this.ttlMs
    const body = `nbs1.${address.trim().replace(/\s+/g, '_')}.${expiresAt}.${verified ? 'v' : 'u'}`
    return { token: `${body}.${this.mac(body)}`, expiresAt }
  }
  /** The address and whether it was verified, or null for a forged, tampered or expired token */
  check(token: string | undefined, now = Date.now()): { address: string; verified: boolean } | null {
    if (!token || token.length > 200) return null
    const i = token.lastIndexOf('.')
    if (i < 0) return null
    const body = token.slice(0, i)
    const want = Buffer.from(this.mac(body))
    const got = Buffer.from(token.slice(i + 1))
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
    const [v, addr, exp, flag] = body.split('.')
    if (v !== 'nbs1' || !addr || !(Number(exp) > now)) return null
    return { address: addr.replace(/_/g, ' '), verified: flag === 'v' }
  }
}
