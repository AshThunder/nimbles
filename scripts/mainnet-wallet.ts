// Creates the MAINNET escrow key once, into a chmod 600 file, and prints ONLY the public address.
// The key is never printed, logged or committed. Refuses to overwrite an existing key.
//   npm run wallet:mainnet                       -> ~/.nimbles/secrets/mainnet-escrow.key
//   ESCROW_KEY_FILE=/path/key npm run wallet:mainnet
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const N = await import('@nimiq/core')
const file = process.env.ESCROW_KEY_FILE || join(homedir(), '.nimbles', 'secrets', 'mainnet-escrow.key')
const addr = (hex: string) => N.KeyPair.derive(N.PrivateKey.fromHex(hex)).toAddress().toUserFriendlyAddress()

if (existsSync(file)) {
  console.log('Key file already exists, left untouched:', file)
  console.log('Mainnet escrow address:', addr(readFileSync(file, 'utf8').trim()))
} else {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
  chmodSync(file, 0o600)
  console.log('Key written (mode 600):', file)
  console.log('Mainnet escrow address:', addr(readFileSync(file, 'utf8').trim()))
}
console.log('Nothing was sent. Fund this address yourself when you are ready.')
