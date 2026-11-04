// Manual check against the real Nimiq testnet: fund a throwaway player + escrow from the faucet, deposit, verify, pay out.
// Run: npx tsx scripts/testnet-roundtrip.ts
import { TestnetChain } from '../server/chain'
import * as N from '@nimiq/core'
const chain = new TestnetChain('data/probe'); await chain.start()
const faucet = async (a: string, amt: number) => { const r = await fetch('https://faucet.pos.nimiq-testnet.com/tapit',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:`address=${encodeURIComponent(a)}&amount=${amt}`}); console.log('faucet', r.status, (await r.text()).slice(0,100)) }
const player = N.KeyPair.generate(); const pa = player.toAddress().toUserFriendlyAddress()
await faucet(pa, 20); await faucet(chain.escrowAddress, 20)
const rpc = async (m: string, p: unknown[]) => (await (await fetch('https://rpc.testnet.nimiqwatch.com/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:m,params:p,id:1})})).json() as any)
for (let i=0;i<30;i++){ const a = await rpc('getAccountByAddress',[pa]); const e = await rpc('getAccountByAddress',[chain.escrowAddress]); console.log('bal', a.result?.data?.balance, e.result?.data?.balance); if (a.result?.data?.balance>0 && e.result?.data?.balance>0) break; await new Promise(r=>setTimeout(r,3000)) }
// player deposits
const h = (await rpc('getBlockNumber',[])).result.data
const tx = N.TransactionBuilder.newBasicWithData(player.toAddress(), N.Address.fromUserFriendlyAddress(chain.escrowAddress), new TextEncoder().encode('nb:probe123'), 200000n, 0n, h, 5)
tx.sign(player)
const sent = await rpc('sendRawTransaction',[Buffer.from(tx.serialize()).toString('hex')]); console.log('deposit sent', JSON.stringify(sent))
const hash = tx.hash()
for (let i=0;i<40;i++){ const v = await chain.verifyDeposit(hash,{from:pa,luna:200000,memo:'nb:probe123'}); console.log('verify', JSON.stringify(v)); if (v.ok || !(v as any).pending) break; await new Promise(r=>setTimeout(r,3000)) }
const out = await chain.pay(pa, 150000, 'nb:probe123:prize'); console.log('payout', out)
for (let i=0;i<20;i++){ const t = await rpc('getTransactionByHash',[out]); console.log('payout tx', JSON.stringify(t.result?.data?.confirmations ?? t.error)); if (t.result?.data?.confirmations>=2) break; await new Promise(r=>setTimeout(r,3000)) }
process.exit(0)
