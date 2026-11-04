// Wallet connection. Inside Nimiq Pay we use the official mini-app SDK. Outside it we fall back to a
// local "preview" identity: Play mode works, staking needs Nimiq Pay (except against the mock dev chain).
import { init, getHostNetwork } from '@nimiq/mini-app-sdk'
import { api, type Config } from './api'
import { randomHex } from './lib'

export type Net = 'mainnet' | 'testnet'
export type Wallet = {
  kind: 'nimiq-pay' | 'preview'
  address: string
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

export async function connect(cfg: Config): Promise<Wallet> {
  const wantPreview = new URLSearchParams(location.search).has('preview') || (cfg.mock && !isInsideNimiqPay())
  if (!wantPreview || isInsideNimiqPay()) {
    try {
      const nq = await init({ timeout: isInsideNimiqPay() ? 10000 : 1500 })
      const accounts = await nq.listAccounts()
      if (accounts.length) {
        const address = accounts[0]
        const network = getHostNetwork() ?? 'unknown'
        return {
          kind: 'nimiq-pay',
          address,
          network,
          async send(to, luna, memo) {
            const tx = { recipient: to, value: luna }
            return memo ? nq.sendBasicTransactionWithData({ ...tx, data: memo }) : nq.sendBasicTransaction(tx)
          },
          async balance() {
            try {
              return await nq.getBalance(address)
            } catch {
              return null
            }
          },
        }
      }
    } catch {
      /* not inside Nimiq Pay, fall through to preview */
    }
  }
  // preview identity
  const address = previewAddress()
  return {
    kind: 'preview',
    address,
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
