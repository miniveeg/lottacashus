# Security & GitHub publishing

Use this checklist before pushing to GitHub (including a **private** repo).

## Safe to commit

| Item | Notes |
|------|--------|
| `VITE_SUPABASE_URL` | Public project URL |
| `VITE_SUPABASE_ANON_KEY` | **Designed** to ship in the frontend; protected by RLS |
| `VITE_DISCORD_CLIENT_ID` | Public OAuth client id |
| `.env.example` | Placeholders only |

## Never commit

| Item | Where it belongs |
|------|------------------|
| `.env`, `.env.local` | Local only (listed in `.gitignore`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets only |
| `CRYPTO_MASTER_MNEMONIC` | Supabase secrets only |
| `CRON_SECRET` | Supabase secrets + cron-job.org header |
| `DISCORD_CLIENT_SECRET` | Supabase Edge Function secrets |
| SMTP / email passwords | Supabase secrets |
| `ETHERSCAN_API_KEY`, `BLOCKCYPHER_TOKEN`, etc. | Supabase secrets |

Private repos can still leak via collaborators, accidental public flip, or CI logs. Treat secrets as **hosting config**, not source code.

## Architecture (why the anon key in the browser is OK)

- **Balance, bets, withdrawals, and battle payouts** run through **Postgres RLS** and **security definer RPCs** / Edge Functions using the **service role** on the server.
- Users **cannot** update `profiles.balance` directly; a trigger blocks client-side balance changes unless an internal RPC sets a one-transaction bypass flag.
- **Admin** UI checks `is_admin` on the profile; sensitive admin RPCs call `require_admin()` server-side.

After pulling this repo, run migrations so `bypass_profile_balance_guard()` is **not** executable by `authenticated` clients (see `20250523100000_revoke_balance_bypass_from_users.sql`).

## Edge Functions

- User actions: require `Authorization: Bearer <user JWT>` and validate with `auth.getUser()`.
- Cron / sweeps: require `x-cron-secret` matching `CRON_SECRET` in Supabase secrets (see `CRYPTO_SETUP.md`).
- CORS is `*` for functions; auth is the gate, not origin blocking.

## Recommended before production

1. Run `npm run build` and fix any TypeScript errors.
2. Apply all files in `supabase/migrations/` to your project.
3. Deploy Edge Functions with secrets set in Supabase Dashboard → Edge Functions → Secrets.
4. Enable **RLS** on every public table (migrations assume this).
5. Rotate secrets if you ever committed them by mistake (`git filter-repo` + rotate keys in Supabase).
6. Restrict Supabase **service role** to server/cron only; never add it to Vite env vars.

## Chat levels RPC

`get_user_wager_levels(uuid[])` exposes only `user_id` + `total_wagered` for level badges—not balance or email. Apply `20250523000000_chat_user_levels.sql`.

## Reporting issues

If you find a vulnerability, avoid opening a public issue with exploit details; fix or disclose privately first.
