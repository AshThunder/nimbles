# Going mainnet

Mainnet is the same code behind a config switch. Nothing here runs until you deploy `fly.mainnet.toml`. The testnet app (`fly.toml`, `nimbles-nimiq`) stays as it is.

## The switch

| Setting | Testnet | Mainnet |
| --- | --- | --- |
| `CHAIN` / `NETWORK` | `nimiq` / `testnet` | `nimiq` / `mainnet` |
| `ALLOW_MAINNET` | not needed | `yes`, or the server refuses to start |
| `EXPECTED_ESCROW_ADDRESS` | optional | required. The key must derive to it, or the server refuses to start |
| Escrow key | auto-generated throwaway | must already exist (`ESCROW_PRIVATE_KEY` secret or `ESCROW_KEY_FILE`). Never generated |
| Nimiq network id | 5 | 24 |
| RPC | `rpc.testnet.nimiqwatch.com` | `rpc.nimiqwatch.com`. `NIMIQ_RPC_URL` overrides it, comma separate several for failover |
| Data | `DATA_DIR/db.json` | `DATA_DIR/mainnet/db.json`, stamped `mainnet`, on its own Fly volume |
| Stake cap | 1000 | `MAX_STAKE_NIM` (25 default, 10 in `fly.mainnet.toml`) |
| Payout fee | 0 | 0. `PAY_FEE_LUNA` sets a fee if validators ever stop including free txs |

Guards: a mainnet server will not load a database stamped testnet or an unstamped (older testnet or mock) one. The escrow refuses a payout it cannot cover. Payouts that fail are retried six times, then every 5 minutes for about 4 hours. The server logs escrow balance against what it owes every 5 minutes and logs `SHORTFALL` if it holds less.

The badge in the app follows Nimiq Pay's network, and falls back to the server's network. A payment from a wallet on a different network is stopped before it is sent (matches and vault deposits).

## Sign-in on mainnet
Every session starts with a fresh challenge the wallet signs (`GET /api/auth/challenge`, then `POST /api/session` with the proof). The nonce works once and expires in 2 minutes, the message says "mainnet", the address comes from the public key and never from the request, and an address-only session is refused with 401. Tokens are HMAC-signed, bound to the address, and expire after `SESSION_TTL_MIN` minutes (default 60 on mainnet). The app re-signs when one expires. That means mainnet only works inside Nimiq Pay (a version with `sign`), not in a plain browser.

## Money model (why the float is small)

Every payout comes out of stakes players deposited. Bots (Nimo) never hold a stake. Winnings, refunds, jar withdrawals and the saver pool all move NIM that is already in escrow. The pool is fed by a 2% fee on Save pots (max 1 NIM per pot) and by early-unlock fees, and pays at most 5% of itself a day (max 2 NIM). It never needs outside money. So the escrow balance should always be at least `jars + pool + live stakes + unsent payouts`. The only outside cost is a network fee, and it is 0.

## Deploy steps (run only on approval)

```bash
fly apps create nimbles-mainnet
fly volumes create nimbles_mainnet_data --size 1 --region ams -a nimbles-mainnet
# key goes from the file straight into the secret store, it is never printed
fly secrets set ESCROW_PRIVATE_KEY="$(cat ~/.nimbles/secrets/mainnet-escrow.key)" -a nimbles-mainnet
fly secrets set GEMINI_API_KEY=...        # optional, Nimo falls back to the question bank
fly deploy -c fly.mainnet.toml
fly logs -a nimbles-mainnet               # expect: [chain] mainnet escrow NQ87 51PJ ..., then [escrow] balance 0.00 NIM
```

Then send the float to `NQ87 51PJ 4Q0P RRQV DVCY L28T N3FK YUK6 P8DR` from your own wallet, wait for the next `[escrow]` log line to show it, and smoke test: in Nimiq Pay open `https://nimbles-mainnet.fly.dev`, solve the vault puzzle, deposit 0.5 NIM, and withdraw it early. That proves deposit verification and payouts on mainnet with one wallet.

Back up `~/.nimbles/secrets/mainnet-escrow.key` somewhere safe before funding. Whoever holds it holds the escrow.
