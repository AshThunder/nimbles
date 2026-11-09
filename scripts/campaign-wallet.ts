// Creates the campaign payout wallet key once, into a chmod 600 file, and prints ONLY the public address.
// This wallet is separate from the game escrow: it only ever holds the campaign rewards.
// The key is never printed, logged or committed. Refuses to overwrite an existing key.
//   npm run wallet:campaign                        -> ~/.nimbles/secrets/campaign-wallet.key
//   CAMPAIGN_KEY_FILE=/path/key npm run wallet:campaign
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const N = await import('@nimiq/core')
const file = process.env.CAMPAIGN_KEY_FILE || join(homedir(), '.nimbles', 'secrets', 'campaign-wallet.key')
const addr = (hex: string) => N.KeyPair.derive(N.PrivateKey.fromHex(hex)).toAddress().toUserFriendlyAddress()

if (existsSync(file)) {
  console.log('Key file already exists, left untouched:', file)
} else {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
  chmodSync(file, 0o600)
  console.log('Key written (mode 600):', file)
}
console.log('Campaign wallet address:', addr(readFileSync(file, 'utf8').trim()))
console.log('Nothing was sent. Fund this address yourself when you are ready.')
