# Nimbles

Skill-only duels for friends, built as a [Nimiq Pay mini app](https://nimiq.dev/mini-apps). Play for XP, Save (winner's pot goes into a locked savings jar) or Spend (split a real bill by how you rank). No luck, no house edge.

Games: AI Trivia Duel, Solitaire Duel, Last Bite, Streak Vault, Sudoku, Word Rush, Bubble Shooter (all with a shared seed), Chess Blitz and 8-Ball Pool (play Pip only for now).

MIT licensed. Asset credits: [CREDITS.md](CREDITS.md), also shown in the app under Me, then Credits.

## Run it

```bash
npm install
cp .env.example .env     # optional, see below
npm run build
npm start                # http://localhost:8787 (PORT to change)
```

Dev with hot reload: `npm run dev` (Vite on 5173 proxying the API).

Outside Nimiq Pay the app opens in preview mode (free play, no wallet). Inside Nimiq Pay it connects through `@nimiq/mini-app-sdk` (`init`, then `listAccounts`).

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port |
| `GEMINI_API_KEY` | Pip trivia and receipt reading. Server side only. Without it a built-in 36-question bank is used |
| `GEMINI_MODEL` | Pin a model. Default tries a fallback chain of current Flash models |
| `CHAIN` | `mock` (default, in-memory, for tests) or `testnet` |
| `ESCROW_PRIVATE_KEY` | Testnet escrow wallet key. If empty, one is generated into `data/escrow.key` (git-ignored) |
| `NIMIQ_RPC_URL` | Testnet JSON-RPC endpoint (default `https://rpc.testnet.nimiqwatch.com/`) |
| `MIN_CONFIRMATIONS` | Confirmations before a deposit counts (default 2) |
| `JAR_LOCK_DAYS` | Jar lock length (default 30) |
| `ALLOW_MAINNET` | Guard for `CHAIN=mainnet` (`yes`). The mainnet adapter is not implemented yet, by design |

Secrets live in `.env` and `data/`, both git-ignored. Nothing secret is committed.

## Test it

```bash
npm run typecheck
npm test            # server rules, settlement, puzzles, chess AI, pool engine, Word Rush scoring
npm run e2e         # Playwright, mobile viewport, mocked Nimiq Pay provider, screenshots in tests/e2e/out
```

The e2e run drives the real SDK against a mock `window.nimiq`, then plays trivia, a two-player Save duel, a three-player Last Bite, solitaire, sudoku, Word Rush, Bubble Shooter, chess, pool, the vault and the credits screen, and fails on any page error or 5xx.

`scripts/testnet-roundtrip.ts` proves a real testnet deposit and payout.

### In Nimiq Pay

1. `npm run dev` (Vite listens on the LAN).
2. In Nimiq Pay, Mini Apps, Custom URL: `http://<your-LAN-IP>:5173`.
3. For testnet, long-press the settings button for 10 seconds and choose Testnet. Use "Get free NIM" for test funds.

## How it works, and what is simplified

- **Same seed.** The server publishes `sha256(seed)` when a match is made and reveals the seed at the start, so both players get the same deal and can check it.
- **Escrow is custodial in this prototype.** Players pay a server wallet with memo `nb:<matchId>`; the server verifies the transaction on chain, then pays the winner or refunds. A production version should use an HTLC or a contract-style escrow.
- **Auth is light.** A session token per address, no signed challenge yet.
- **Scoring trust.** Trivia, Word Rush and the sudoku grids are verified by the server. Solitaire and Bubble Shooter scores are client reported and need replay verification before real money. Chess and pool are against Pip only, because live head-to-head needs a move relay.
- **Testnet from the dev box.** Direct P2P to the testnet is blocked on the build machine, so the server uses JSON-RPC for chain reads and `@nimiq/core` offline to build and sign payouts.
- **Competition.** Submissions need a mainnet deployment and a public MIT repo (deadline 11 Nov 2026). A testnet-only app cannot be submitted.
