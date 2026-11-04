// Wallet ownership proof. Nimiq Pay picks the signing account itself and `listAccounts()` says nothing about which
// one that is, so the app asks the wallet to sign a one-time challenge and takes the address from the signature.
import { createHash, randomBytes } from 'node:crypto'

export const challengeText = (nonce: string) => `Nimbles sign-in ${nonce}`
const PREFIX = '\x16Nimiq Signed Message:\n'
const TTL = 5 * 60_000

export class Challenges {
  private open = new Map<string, number>()
  issue(now = Date.now()): { nonce: string; message: string } {
    for (const [n, t] of this.open) if (now - t > TTL) this.open.delete(n)
    if (this.open.size > 5000) this.open.clear()
    const nonce = randomBytes(12).toString('hex')
    this.open.set(nonce, now)
    return { nonce, message: challengeText(nonce) }
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
