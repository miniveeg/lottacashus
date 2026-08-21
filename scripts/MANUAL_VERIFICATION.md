# Manual verification scripts — real-money paths

These are **manual** checks (not automated unit tests). Run them against a
staging Supabase project with a real signed-in user that has a non-zero
sweeps_coins balance. Guests must be rejected at every step.

## 1. cash_out_crash — success path

1. Sign in as a real user (not guest).
2. Open `/crash`, place a small wager (e.g. 0.10 SC).
3. While the multiplier is climbing and **before** the server settles, click
   **Cash Out**.
4. Expect:
   - UI shows the cashed-out multiplier and a win amount.
   - `profiles.sweeps_coins` increases by `wager * multiplier` (minus any
     already-debited wager if the debit happened at place time).
   - A row in `crash_bets` (or equivalent) has `status = 'cashed_out'` and a
     non-null `cashout_multiplier`.
5. Late cash-out (loss path): wait until the round is settled by the
   `crash-settle-expired` cron / loop, then attempt cash-out.
   - Expect error (or no-op) and no balance credit.
   - Bet status remains `lost` / `settled`.

## 2. Deposit credit → sweep ordering

1. Obtain a deposit address via the Wallet / Deposit UI (or
   `get-deposit-address` edge function).
2. Send a small on-chain amount to that address (testnet or a tiny mainnet
   amount if staging is live).
3. Trigger `poll-deposits` (or wait for the scheduled run).
4. Expect:
   - A `deposits` (or equivalent) row is created with status `confirmed` /
     `credited` **before** any sweep attempt.
   - `profiles.sweeps_coins` (or `balance`) is credited.
5. Trigger `sweep-deposits`.
6. Expect:
   - Funds move from the deposit address to the hot/cold wallet.
   - Deposit row status advances to `swept` only after the credit step.
   - No double-credit.

## 3. Basic balance update after a bet

1. Note `profiles.sweeps_coins` for a signed-in user.
2. Place a losing bet on any game (Keno, Limbo, Roulette, Blackjack, Mines,
   Slots, Crash).
3. Expect:
   - Balance decreases by exactly the wager (or wager minus any immediate
     return for blackjack pushes, etc.).
   - ProfileContext realtime (or a subsequent `refreshProfile`) reflects the
     new balance without a full page reload.
4. Repeat with a winning bet and confirm the credit amount matches the
   game’s payout formula (see unit tests under `src/lib/games/__tests__/`).

## Guest rejection (spot-check)

While signed out / in guest mode with Supabase configured:

- Every Bet / Deal / Spin / Create Battle / Join Battle button should either
  be disabled or, if clicked, show “Sign in to place real bets.” / “Log in
  to play” and must **not** call the place-*-bet edge functions.

Automated unit coverage for pure math lives in:

```bash
npm test
```

(28 tests: crash point formula, limbo, mines multipliers, RTP bias.)
