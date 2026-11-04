# Nimbles

Skill-only duels for friends, built as a [Nimiq Pay mini app](https://nimiq.dev/mini-apps). Pick a game, pick a mode, beat a friend. No luck, no house edge: the better player wins.

**Modes**

- **Play**: free, for XP and rank. Practice against Nimo, the built-in AI, or a friend.
- **Save**: both players stake NIM. The winner's pot goes into a locked savings jar.
- **Settle**: invite a friend, agree the terms first (bill, who gets paid, loser pays all, 70/30 or custom), both lock their share, the game decides who pays what, and the payee is paid on-chain. A draw splits it evenly.

**Games**

| Game | How it is played | Result is decided by |
| --- | --- | --- |
| AI Trivia Duel | Same 5 questions, speed and accuracy | Server (answers never leave it early) |
| Solitaire Duel | Same deal from a shared seed | Server replay of your move log |
| Last Bite | Same sudoku for 2 to 4 friends, pays the bill | Server checks the solved grid |
| Streak Vault | Daily puzzle, deposits to your jar | Server |
| Sudoku | Same grid, first to solve | Server checks the grid |
| Word Rush | Same letters, find words | Server recomputes the score |
| Bubble Shooter | Same board and bubble queue | Server replay of your shot log |
| Chess Blitz | 3:00 per side, live | Server-run board and clocks |
| 8-Ball Pool | Live turns, 60 s shot clock | Server-run physics |
| Splat Royale | 2 to 6 players, one arena, last one standing. Twin-stick on a phone | Server-run simulation at 30 ticks a second, own blob predicted on the phone |

Splat Royale is a live battle royale. The phones only send stick and dash input; the server runs the whole match with no random numbers, so the same inputs always give the same result. Save mode pays the winner (or 60 / 30 / 10 to the top three), and if a match cannot finish every stake is refunded. Settle works for 2 to 6 players: the host sets the bill and who is paid, the split is by finishing place (last pays most, a draw splits evenly), everyone agrees before anything is locked, and each player locks only their own largest possible share. Practice matches fill empty seats with Nimos.

Chess and pool against a friend are fully server-authoritative: the phones only send a move or a shot, and the server runs the rules and the clocks. Against Nimo they are Play mode only.

## Fairness and trust

- **Same seed.** The server publishes `sha256(seed)` when a match is made and reveals the seed at the start. Both players get the same deal and can check it.
- **Replay verification.** Solitaire and Bubble Shooter clients upload their move log; the server replays it on the shared seed and computes the score itself. An invalid log scores 0.
- **Live relay.** For Chess and Pool vs a human the server holds the game state. A client cannot report a result for these matches (the result endpoint refuses). Pool physics run only on the server, so different phones cannot disagree; the ball paths are sent once per viewer and animated locally.
- **Escrow.** Players pay a server wallet with memo `nb:<matchId>`. The server verifies the transaction on chain (2 confirmations by default), then pays out or refunds. The escrow is custodial in this version.
- **Known limits.** Sessions are a token per address without a signed challenge. A production version should add a signed login and an HTLC or contract-style escrow. Stakes are capped on mainnet (25 NIM by default).

## Nimiq integration

- `@nimiq/mini-app-sdk`: `init`, `listAccounts`, `sendBasicTransactionWithData` for deposits (memo `nb:<matchId>`, 1 NIM = 100,000 luna).
- Server chain adapter (`server/chain.ts`) talks to Nimiq JSON-RPC (testnet `rpc.testnet.nimiqwatch.com`, mainnet `rpc.nimiqwatch.com`), verifies deposits, and builds and signs payouts offline with `@nimiq/core`. Payouts are serialized through one queue.
- One flag switches networks (`CHAIN=nimiq NETWORK=testnet|mainnet`). Mainnet also needs `ALLOW_MAINNET=yes` and a pre-existing escrow key, and it never auto-generates one.
- The public RPC is rate limited. Set `NIMIQ_RPC_URL` to your own node or provider for real traffic.

## Run it

```bash
npm install
cp .env.example .env     # optional
npm run build
npm start                # http://localhost:8787 (PORT to change)
```

Dev with hot reload: `npm run dev` (Vite on 5173 proxying the API). Outside Nimiq Pay the app opens in preview mode (free play, no wallet).

### Try it in Nimiq Pay

Testnet build: https://nimbles-nimiq.fly.dev (testnet only, play money).

1. Open Nimiq Pay, then Mini Apps, then Custom URL, and enter your deployed URL (or `http://<LAN-IP>:5173` from `npm run dev`).
2. For testnet, long-press the settings button for 10 seconds and choose Testnet. Use "Get free NIM" for test funds.

### Deploy

A `Dockerfile` and `fly.toml` are included (one machine and a small volume mounted at `/data`).

```bash
fly launch --no-deploy --copy-config
fly volumes create nimbles_data --size 1
fly secrets set GEMINI_API_KEY=...            # optional
fly deploy                                    # testnet by default (fly.toml)
```

For mainnet: `npm run wallet:mainnet` (writes a chmod 600 key file and prints only the public address), set the key as a platform secret (`ESCROW_PRIVATE_KEY`), then set `CHAIN=nimiq`, `NETWORK=mainnet`, `ALLOW_MAINNET=yes`. Fund the escrow address with a small amount first.

## Environment

See [.env.example](.env.example). Highlights:

| Variable | Purpose |
| --- | --- |
| `PORT`, `DATA_DIR` | Server port, and where state and the generated testnet key live |
| `CHAIN`, `NETWORK` | `mock` (default) or `nimiq`, plus `testnet` or `mainnet` |
| `ALLOW_MAINNET` | Must be `yes` for mainnet |
| `ESCROW_PRIVATE_KEY`, `ESCROW_KEY_FILE` | Escrow wallet key. Mainnet needs one of them |
| `MAX_STAKE_NIM` | Stake cap per player (default 25 on mainnet) |
| `MIN_CONFIRMATIONS`, `NIMIQ_RPC_URL` | Deposit confirmations, RPC override |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Nimo trivia and receipt reading. Without a key a built-in bank is used |
| `JAR_LOCK_DAYS` | Jar lock length (default 30) |

Secrets live in `.env`, `data/` and key files, all git-ignored. Nothing secret is committed.

## Test it

```bash
npm run typecheck
npm test     # settlement, puzzles, replay verification, live chess and pool, chain adapter rules
npm run e2e  # Playwright on a phone viewport with a mocked Nimiq Pay provider; screenshots in tests/e2e/out
```

The e2e run drives the real SDK against a mock `window.nimiq`, then plays every game including a staked live chess duel and a live pool duel between two browsers, and fails on any page error or 5xx. `scripts/testnet-roundtrip.ts` proves a real testnet deposit and payout.

## Roadmap

Shipped recently: Nimo (the built-in rival), the savings plan with its daily interest pool, chests and rewards, Splat Royale, Win mode, and Settle for Splat Royale with up to six players.

Games not in yet: Spider Solitaire, 21 Blitz, Dominoes, Block Puzzle, Darts, Bowling, Carrom, Speed Math and Code Sprint, Ghost Race. Settle for more than two players in live chess and pool is also still to do.

Also planned: signed wallet login, an HTLC or contract escrow, reconnect and spectate for live games.

## Credits

Built for the Nimiq mini app competition. Art, sound and font credits are in [CREDITS.md](CREDITS.md) and in the app under Me, then Credits. Chess logic by [chess.js](https://github.com/jhlywa/chess.js), chain access by [@nimiq/core](https://github.com/nimiq/core-rs-albatross).

## License

MIT, see [LICENSE](LICENSE).
