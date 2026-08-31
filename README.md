# LottaCash

Premium crypto casino at [lottacash.us](https://lottacash.us). Dark obsidian floor, gold accents, one **SC** (site credit) wallet, eight live games. This tree replaces the old Vite+React LottaCash app — it is a new build, not a clone.

## Games

| Route | Game |
| --- | --- |
| `/` | Lobby |
| `/mines` | Mines (3x3 / 5x5, 1-10 mines, cash out) |
| `/tower` | Tower (easy/medium/hard, 8 floors) |
| `/limbo` | Limbo (target multiplier, 0.99 / float) |
| `/roulette` | European roulette 0-36 |
| `/blackjack` | Six-deck shoe, 3:2 blackjack, double |
| `/upgrader` | Hit-zone spinner, chance = 0.97 / multi |
| `/cases` | Six crates, weighted reel |
| `/battles`, `/battles/:id` | Case battles vs bots |
| `/wallet` | SC balance, demo deposit, SOL/LTC/ETH + redeem note |
| `/login` | Supabase auth (or demo badge) |
| `/responsible` `/privacy` `/terms` | House pages |

## Demo vs live

- **Demo** (no env): localStorage key `lc_demo_balance` starts at **1000 SC**. Every game is playable. Provably fair HMAC-SHA256 rolls in the browser. Client seed is editable.
- **Live**: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Auth via `/login`. Wallet tries RPCs `place_bet` / `settle_bet`, then falls back to demo storage if the RPC is missing. Optional deposit addresses: `VITE_SOL_ADDRESS`, `VITE_LTC_ADDRESS`, `VITE_ETH_ADDRESS`.

Never put wallet mnemonics or private keys in env or source.

## Local run

```bash
npm install
npm run dev
```

Scripts: `dev`, `typecheck` (tsc --noEmit), `build`, `preview`.

## Vercel

SPA rewrite lives in `vercel.json` (`/(.*) -> /index.html`) plus security headers. CSP allows `https://*.supabase.co`, `wss://*.supabase.co`, Google Fonts.

Push `main`. Keep the existing Vercel env names: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## SQL

Paste `supabase/schema.sql` into the Supabase SQL editor. Tables are prefixed `lc_*` (`lc_profiles`, `lc_game_rounds`, `lc_case_battles`) so older production tables are not dropped. RPCs: `place_bet`, `settle_bet`, `place_and_settle`. `lc_demo_credit` is a staging faucet — revoke it in production.

## Fairness

`src/lib/fair.ts`: `resultFloat(serverSeed, clientSeed, nonce)` = first 52 bits of HMAC-SHA256(server, `client:nonce`) / 2^52, mapped to `[0, 1)`. Server seed hash is shown before the round; the seed is revealed after.
