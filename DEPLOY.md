# LottaCash — Production Deploy Guide

This document is the single source of truth for deploying **schema**, **Edge Functions**,
and the **Vite frontend** (GitHub → Vercel auto-deploy).

Repo: `https://github.com/miniveeg/lottacashus.git`  
Stack: Vite + React 19 → Vercel · Supabase (Auth, Postgres, Edge Functions, Realtime)

---

## 0. What you need

| Account | Purpose |
|---------|---------|
| **GitHub** | Source of truth; Vercel deploys from `main` |
| **Vercel** | Frontend hosting + CDN + security headers |
| **Supabase** | Auth, DB, Edge Functions, Realtime, storage of secrets |
| **SMTP** (Resend / SES / etc.) | Signup + password-reset codes |
| **Discord app** (optional) | OAuth link in Settings |
| **Crypto wallets** | Main SOL / LTC / ETH deposit sweep destinations |

Local tools:

```bash
node -v          # 20+
npm -v
npx supabase -v  # CLI (or install: npm i -g supabase)
```

---

## 1. Supabase project + full schema

### 1.1 Create project

1. [supabase.com](https://supabase.com) → **New project**
2. Save:
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public** key
   - **service_role** key (server only — never in Vite)
   - **Project ref** (Settings → General)

### 1.2 Run the full schema (fresh project)

In **Supabase Dashboard → SQL Editor → New query**:

1. Open `supabase/lottacash-complete-setup.sql` from this repo.
2. Paste the **entire** file.
3. Run once. It creates tables, RLS, RPCs, views, indexes, and production
   audit fixes (including case-battle payouts, mines coin lock, deposit limits).

That file is the **canonical full schema** for a greenfield install. It already
includes phases 001–004 at the end (idempotent `CREATE OR REPLACE` / `IF NOT EXISTS`).

### 1.3 Existing project (already has schema)

Run migrations **in order** in the SQL Editor (or via CLI):

```text
supabase/migrations/001_audit_fixes.sql
supabase/migrations/002_case_battles_audit_fixes.sql
supabase/migrations/003_mines_deposit_security.sql
supabase/migrations/004_case_battle_payouts_and_blackjack_coin.sql
… through …
supabase/migrations/016_supabase_cleanup_missing_rpcs.sql
```

Or with CLI after `supabase link`:

```bash
npx supabase db push
```

### 1.4 Case Battles tables only (if missing)

Case Battles V2 tables are included in `supabase/lottacash-complete-setup.sql`.
If you have an older database that is missing them, apply the ordered migrations
starting from `002` (see `supabase/schema.sql` for the canonical sequence).
Do **not** run files from `supabase/archive/` — they are historical only.

### 1.5 Auth settings (Dashboard)

**Authentication → Providers → Email**

- Enable Email
- Disable “Confirm email” if you use the **signup code** edge flow (recommended)

**Authentication → URL configuration**

- Site URL: `https://your-production-domain.com`
- Redirect URLs:  
  `https://your-production-domain.com/**`  
  `http://localhost:5173/**` (dev)

**Authentication → Rate limits** — leave defaults (or tighten for production).

---

## 2. Supabase Edge Functions

### 2.1 Link the CLI

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

### 2.2 Set secrets (Dashboard → Edge Functions → Secrets, or CLI)

```bash
npx supabase secrets set \
  ALLOWED_ORIGINS="https://your-production-domain.com,https://www.your-production-domain.com" \
  CRON_SECRET="long-random-string" \
  SMTP_HOST="smtp.example.com" \
  SMTP_PORT="587" \
  SMTP_USER="apikey" \
  SMTP_PASS="your-smtp-password" \
  SMTP_FROM="LottaCash <noreply@your-domain.com>" \
  CRYPTO_MASTER_MNEMONIC="your twelve or twenty four word mnemonic" \
  MAIN_SOL_WALLET="your-sol-treasury-address" \
  MAIN_LTC_WALLET="your-ltc-treasury-address" \
  MAIN_ETH_WALLET="0xYourEthTreasury" \
  DISCORD_CLIENT_ID="optional" \
  DISCORD_CLIENT_SECRET="optional"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically by the platform — do not put them in Vite.

| Secret | Required | Notes |
|--------|----------|--------|
| `ALLOWED_ORIGINS` | **Yes (prod)** | Comma-separated frontend origins. Without this, CORS is fail-closed. |
| `CRON_SECRET` | **Yes** | Shared secret for `poll-deposits`, `sweep-deposits`, `crash-settle-expired` |
| `SMTP_*` | **Yes** for email codes | Signup + password reset |
| `CRYPTO_MASTER_MNEMONIC` | **Yes** for deposits | HD wallet derivation — treat as root key |
| `MAIN_*_WALLET` | **Yes** for sweeps | Destination addresses |
| `DISCORD_*` | Optional | Settings → Link Discord |
| `BLOCKCYPHER_TOKEN` / `ETHERSCAN_API_KEY` | Optional | Faster chain scans |

### 2.3 Deploy functions

**Windows (PowerShell):**

```powershell
pwsh scripts/deploy-edge-functions.ps1
```

**macOS / Linux:**

```bash
bash scripts/deploy-edge-functions.sh
```

**Manual list** (same as the script — **do not deploy** legacy `case-battle`):

```text
send-signup-code
verify-signup-code
send-password-reset-code
reset-password-with-code
link-discord
get-deposit-address
poll-deposits
sweep-deposits
place-keno-bet
mines-game
place-limbo-bet
place-roulette-bet
place-slots-bet
place-crash-bet
cash-out-crash
crash-settle-expired
crash-settle-loop
blackjack-game
case-battle-v2
```

`verify_jwt` is controlled by `supabase/config.toml`.


### Canonical deploy notes (2026-09)

- Apply **migration 016** (`016_supabase_cleanup_missing_rpcs`) via MCP `apply_migration` (or SQL Editor). Do **not** re-`db push` 001–015 on live.
- **Required** edge: `crash-settle-loop` (verify_jwt=false; auth via `CRON_SECRET`). Schedule external invoke ~every 60s.
- **Never deploy** legacy `case-battle` (V1). Quarantine/delete it; product path is **`case-battle-v2` only** with `verify_jwt=true`.
- **`case-battle-v2` catalog**: Edge uses gzip+base64 `caseCatalog.generated.ts` (small MCP/API payloads). Readable catalog lives under `src/lib/games/case-battles/`. Regenerate both via `node scripts/generate-case-catalog.mjs`.
- Partial CLI deploy: `bash scripts/deploy-edge-functions.sh case-battle-v2`
- **Legacy `case-battle` (V1)** may still exist ACTIVE on the project with `verify_jwt=true`. Delete when CLI is authed: `npx supabase functions delete case-battle --project-ref <ref>`. UI must not call V1.
- **MCP large-payload workaround**: if `deploy_edge_function` fails on `case-battle-v2` (~300KB with expanded catalog), deploy a one-line entrypoint that re-exports the repo function from jsDelivr at a pinned commit (`import "https://cdn.jsdelivr.net/gh/miniveeg/lottacashus@<sha>/supabase/functions/case-battle-v2/index.ts"`). Prefer CLI `functions deploy` when `SUPABASE_ACCESS_TOKEN` is available.
- Games + other product functions are listed above / in `scripts/deploy-edge-functions.*`.


### 2.4 Cron schedules (Dashboard → Edge Functions → Schedules, or external cron)

Call with header `x-cron-secret: <CRON_SECRET>` (or your project’s auth pattern).

| Function | Suggested schedule | Purpose |
|----------|-------------------|---------|
| `poll-deposits` | every 1–2 min | Detect + credit on-chain deposits |
| `sweep-deposits` | every 5–15 min | Sweep user deposits to main wallets |
| `crash-settle-expired` | every 1 min | Auto-settle abandoned Crash bets |
| `crash-settle-loop` | every 60s | Sub-second settle via `crash_settle_due_bets` |

Example (curl):

```bash
curl -X POST "https://YOUR_REF.supabase.co/functions/v1/poll-deposits" \
  -H "Authorization: Bearer YOUR_ANON_OR_SERVICE_KEY" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d "{}"
```

---

## 3. GitHub → Vercel auto-deploy (frontend)

### 3.1 Push code to GitHub

```bash
cd /path/to/lottacashus
git status
git add -A
# Do NOT commit .env, scripts/sweep.env, or private keys
git commit -m "Production-ready schema, edge fixes, and deploy docs"
git push origin main
```

Repo should be: `https://github.com/miniveeg/lottacashus.git` (or your fork).

### 3.2 Import project on Vercel

1. [vercel.com](https://vercel.com) → **Add New… → Project**
2. Import **miniveeg/lottacashus** (or your fork)
3. Framework preset: **Vite** (auto-detected)
4. Build settings (defaults are correct):

| Setting | Value |
|---------|--------|
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Node version | 20.x |

`vercel.json` already provides:

- SPA rewrite → `index.html`
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Long-cache for `/assets/*`

### 3.3 Vercel environment variables

**Project → Settings → Environment Variables**  
Add for **Production** (and Preview if you want preview envs):

| Name | Value | Environments |
|------|--------|--------------|
| `VITE_SUPABASE_URL` | `https://YOUR_REF.supabase.co` | Production (+ Preview) |
| `VITE_SUPABASE_ANON_KEY` | Supabase **anon** key | Production (+ Preview) |
| `VITE_DISCORD_CLIENT_ID` | Discord app client id (optional) | Production |

**Never** set `service_role`, mnemonics, SMTP passwords, or `CRON_SECRET` in Vercel —
those are Supabase Edge secrets only.

Redeploy after changing env vars (**Deployments → … → Redeploy**).

### 3.4 Custom domain

1. Vercel → Project → **Settings → Domains** → add `your-domain.com` + `www`
2. Point DNS as Vercel instructs (A / CNAME)
3. Update Supabase **Site URL** + **Redirect URLs**
4. Update Edge secret `ALLOWED_ORIGINS` to include both hosts
5. Redeploy functions after CORS secret change is **not** required (secrets hot-reload),
   but hard-refresh the browser

### 3.5 Auto-deploy behavior

- Push to `main` → Vercel **Production** deploy  
- PR / other branches → **Preview** deploy (if Preview env vars set)  
- Roll back: Vercel → Deployments → promote previous deployment  

---

## 4. Local development

```bash
npm install
cp .env.example .env
# Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or leave placeholders for guest mode)

npm run dev          # http://localhost:5173
npm run typecheck
npm run build
npm run preview
```

Guest / unconfigured mode uses local-play wallets in `localStorage` — not production money.

---

## 5. Post-deploy checklist

- [ ] Open production URL — home loads, no console errors (aside from intentional warnings)
- [ ] `/signup` → verification code email arrives
- [ ] `/login` works
- [ ] Topbar GC/SC toggle works when logged in
- [ ] Place a **Limbo** or **Slots** bet (GC) — balance updates
- [ ] `/case-battles` create → start → claim path works after full resolve
- [ ] Deposit page shows an address when Supabase + `get-deposit-address` are live
- [ ] `/admin` only for `profiles.is_admin = true`
- [ ] Mobile drawer: open menu, scroll locked on main, Escape closes
- [ ] Security headers present: `curl -I https://your-domain.com`

---

## 6. Admin bootstrap

After your user exists:

```sql
update public.profiles
set is_admin = true
where email = 'you@example.com';
```

Then open `/admin`.

---

## 7. Schema map (what the full SQL creates)

| Area | Contents |
|------|----------|
| Core | `profiles`, `transactions`, `game_pf_seeds`, chat, notifications |
| Games | keno, limbo, crash, roulette, mines, slots, blackjack tables + settle RPCs |
| Case Battles v2 | `case_battles`, `case_battle_players` (+ `payout_amount`), `case_battle_drops`, `case_battles_safe` |
| Wallet | crypto deposit addresses, deposits, withdrawals, redemptions |
| RG | self-exclusion, deposit limits (USD-enforced in `credit_crypto_deposit`) |
| Admin | credit user, process redemption, audit log |
| Security | RLS, column grants (no pre-resolve `crash_point` / seeds), balance-guard trigger |

Migrations on top of older DBs:

| File | Purpose |
|------|---------|
| `001_audit_fixes.sql` | Bypass guards, crash safe view, RG, indexes |
| `002_case_battles_audit_fixes.sql` | 2-arg claim + bot creator-only |
| `003_mines_deposit_security.sql` | Mines coin lock + USD deposit limits |
| `004_case_battle_payouts_and_blackjack_coin.sql` | Stored CB payouts + BJ `coin_type` |

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| CORS errors from games | Set `ALLOWED_ORIGINS` to exact Vercel domain(s), no trailing slash mismatch |
| “Supabase is not configured” | Missing `VITE_*` on Vercel → set + redeploy |
| Claim fails “No payout” | Redeploy `case-battle-v2` + run migration **004`; old battles need re-resolve or manual payout |
| Signup email never arrives | Check `SMTP_*` secrets + Edge Function logs |
| Deposits not crediting | Cron for `poll-deposits` + `CRON_SECRET` + chain API keys |
| Crash stuck “running” | Deploy + schedule `crash-settle-expired` |
| Build OK but blank page | Check browser console; CSP must allow Supabase + fonts (see `vercel.json`) |

Function logs: **Supabase → Edge Functions → [name] → Logs**.

---

## 9. One-page command summary

```bash
# --- Schema (fresh) ---
# Paste supabase/lottacash-complete-setup.sql in SQL Editor → Run

# --- Edge ---
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase secrets set ALLOWED_ORIGINS="https://your.domain" CRON_SECRET="..." # + SMTP + wallets
pwsh scripts/deploy-edge-functions.ps1   # or bash scripts/deploy-edge-functions.sh

# --- Frontend ---
git push origin main
# Vercel auto-deploys from GitHub; set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in Vercel
```

You are production-ready when schema, secrets, all 18 functions, cron, and Vercel env are in place and the checklist in §5 passes.
