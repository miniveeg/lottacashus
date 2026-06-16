# Crypto deposits & withdrawals setup

## Overview

- Each user gets **unique** deposit addresses for **SOL**, **LTC**, and **ETH** (derived from one master mnemonic).
- **poll-deposits** (every ~2 min) detects incoming txs, credits USD balance after standard confirmations.
- **sweep-deposits** (every 5 min) moves funds from user addresses to your main wallets.

### Your main wallets (treasury)

Set in Supabase secrets (defaults match your addresses):

| Secret | Your address |
|--------|----------------|
| `MAIN_SOL_WALLET` | `617G2ByNoHDu75oSNVqiwbho5Z3iHpGytTswufiiV42o` |
| `MAIN_LTC_WALLET` | `LTtJVrXcdDPFf9yrNkqJpuyY2aPuiNppn1` |
| `MAIN_ETH_WALLET` | `0x6e1641a2D94F3f3605De0f62AECf677B996006A0` |

### Confirmations before credit

| Chain | Confirmations |
|-------|----------------|
| SOL | 1 |
| LTC | 6 |
| ETH | 12 |

---

## 1. SQL migration

Run in Supabase → SQL Editor:

`supabase/migrations/20250520600000_crypto_deposits_withdrawals.sql`

---

## 2. Generate a master mnemonic (CRITICAL)

Create a **new** 12/24-word BIP39 mnemonic used only for LottaCash deposits.

```bash
# Example: use a trusted tool offline, then:
npx supabase secrets set CRYPTO_MASTER_MNEMONIC="word1 word2 ... word12"
```

**Never commit the mnemonic to git.** Anyone with it controls all deposit addresses.

---

## 3. API keys & secrets

```bash
npx supabase secrets set CRON_SECRET=your-random-long-secret
npx supabase secrets set MAIN_SOL_WALLET=617G2ByNoHDu75oSNVqiwbho5Z3iHpGytTswufiiV42o
npx supabase secrets set MAIN_LTC_WALLET=LTtJVrXcdDPFf9yrNkqJpuyY2aPuiNppn1
npx supabase secrets set MAIN_ETH_WALLET=0x6e1641a2D94F3f3605De0f62AECf677B996006A0
npx supabase secrets set ETHERSCAN_API_KEY=your_etherscan_key
npx supabase secrets set BLOCKCYPHER_TOKEN=your_blockcypher_token
# Optional:
npx supabase secrets set ETH_RPC_URL=https://ethereum.publicnode.com
npx supabase secrets set SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

- **ETHERSCAN_API_KEY** — required to detect ETH deposits ([etherscan.io/apis](https://etherscan.io/apis))
- **BLOCKCYPHER_TOKEN** — strongly recommended for LTC scan + sweep ([blockcypher.com](https://www.blockcypher.com/dev/))

---

## 4. Deploy Edge Functions

```bash
npx supabase functions deploy get-deposit-address
npx supabase functions deploy poll-deposits --no-verify-jwt
npx supabase functions deploy sweep-deposits --no-verify-jwt
```

---

## 5. Schedule cron jobs (cron-job.org)

**Do NOT put `CRON_SECRET` on Vercel.** Vercel only hosts the website. These jobs call **Supabase Edge Functions**, so secrets live in **Supabase** only:

```bash
npx supabase secrets set CRON_SECRET=your-secret-here
```

The value must **exactly match** the `x-cron-secret` header in cron-job.org (no `Token ` prefix).

### Common mistakes (why jobs fail)

| Problem | Fix |
|---------|-----|
| URL has a **space** | Use `poll-deposits` and `sweep-deposits` with a **hyphen**, not `poll deposits` |
| Wrong project ref in URL | Must match your project, e.g. `https://kopdpsszzxwkfjayvcba.supabase.co/...` |
| Missing Supabase auth headers | Add `Authorization` and `apikey` (your **anon** key from Supabase → Settings → API) |
| `CRON_SECRET` only on cron-job.org | Also set the **same** value in Supabase secrets |
| Only `x-cron-secret`, no anon key | Supabase rejects the request before your function runs |

### Poll deposits (every 2 minutes)

**URL** (no spaces):

```
https://kopdpsszzxwkfjayvcba.supabase.co/functions/v1/poll-deposits
```

**Advanced tab on cron-job.org:**

| Setting | Value |
|---------|--------|
| Request method | `POST` or `GET` (both work) |
| Headers | See below |

**Headers** (add all three rows):

| Header name | Header value |
|-------------|----------------|
| `Authorization` | `Bearer YOUR_SUPABASE_ANON_KEY` |
| `apikey` | `YOUR_SUPABASE_ANON_KEY` (same key, no `Bearer`) |
| `x-cron-secret` | Same value as `CRON_SECRET` in Supabase secrets |

`YOUR_SUPABASE_ANON_KEY` = **Project Settings → API → anon public** (same as `VITE_SUPABASE_ANON_KEY` in `.env`).

### Sweep to main wallets (every 5 minutes)

**URL:**

```
https://kopdpsszzxwkfjayvcba.supabase.co/functions/v1/sweep-deposits
```

Same headers as above. Schedule: every **5** minutes, crontab `*/5 * * * *`.

### Manual sweep (when cron did not move funds)

**Option A — remote (recommended)** uses your existing `.env` (same as Vercel) plus `CRON_SECRET`. The sweep runs on Supabase with secrets already there (mnemonic, BlockCypher, etc.).

1. Add to local `.env` only (not Vercel):

```bash
CRON_SECRET=your-cron-secret
```

Same value as `npx supabase secrets` / cron-job.org `x-cron-secret` header.

2. Run:

```bash
npm run sweep:remote:health   # optional check
npm run sweep:remote          # runs sweep-deposits on Supabase
```

**Option B — local** needs mnemonic + service role on your machine (`scripts/sweep.env` or `.env`). Use for dry-run previews:

1. Add `SUPABASE_SERVICE_ROLE_KEY`, `CRYPTO_MASTER_MNEMONIC`, `BLOCKCYPHER_TOKEN`, etc.
2. `npm run sweep:dry` then `npm run sweep:manual`

Vercel env vars (`VITE_SUPABASE_*`) are not enough for local sweep — never put the mnemonic or service role on Vercel.

Useful flags:

```bash
node scripts/manual-sweep-deposits.mjs --dry-run --chain ltc
node scripts/manual-sweep-deposits.mjs --yes --address LTxxxxxxxx
node scripts/manual-sweep-deposits.mjs --yes --index 3 --chain ltc
```

Run `npm install` once so sweep crypto dependencies are available.

**Never commit `scripts/sweep.env`** — it contains your mnemonic.

### Test in browser or curl

After deploy, this should return JSON (not 401), with the same headers cron-job sends:

```bash
curl -X POST "https://kopdpsszzxwkfjayvcba.supabase.co/functions/v1/poll-deposits" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

Success looks like: `{"success":true,"detected":0,"credited":0}`

Check **cron-job.org → job history** for the HTTP status code: **200** = good, **401** = wrong secret/anon key, **404** = wrong URL.

**Verify from your machine** (add `CRON_SECRET` to `.env`, same value as Supabase + cron-job.org):

```bash
npm run sweep:remote:health
npm run sweep:remote
```

The sweep response includes `extraResults` with each one-off key’s **derived address**, **on-chain balance**, and why it did or did not sweep.

### Fix "permission denied for table user_deposit_addresses"

Run in **SQL Editor**:

`supabase/migrations/20250520610000_grant_crypto_tables_service_role.sql`

Then redeploy `poll-deposits` (no code change required if only SQL was missing). Cron should return `{"success":true,...}`.

### Troubleshooting HTTP 500

A **500** means auth worked but the function crashed. **Open the job in cron-job.org → History → Response body** — it now includes a `detail` field.

**Quick health check** (browser or cron GET):

```
https://kopdpsszzxwkfjayvcba.supabase.co/functions/v1/poll-deposits?health=1
```

Add the same three headers (`Authorization`, `apikey`, `x-cron-secret`). You should see JSON like:

```json
{
  "ok": true,
  "checks": {
    "table_user_deposit_addresses": "ok",
    "table_crypto_deposits": "ok",
    "cryptoMnemonic": true,
    ...
  }
}
```

| `checks` value | Fix |
|----------------|-----|
| `table_*` = MISSING or error | Run `20250520600000_crypto_deposits_withdrawals.sql` |
| `cryptoMnemonic`: false | `npx supabase secrets set CRYPTO_MASTER_MNEMONIC="your 12 words"` (required for **sweep**, not poll) |
| `serviceRoleKey`: false | Redeploy functions: `npx supabase link` then `npx supabase functions deploy poll-deposits --no-verify-jwt` |

After code fixes, redeploy:

```bash
npx supabase functions deploy poll-deposits --no-verify-jwt
npx supabase functions deploy sweep-deposits --no-verify-jwt
```

---

## 6. Withdrawals

Users submit withdrawal requests from `/withdraw`. Balance is deducted immediately; status stays `pending` until you send crypto from treasury wallets (manual or future auto-payout function).

---

## Pages

| Route | Purpose |
|-------|---------|
| `/deposit` | Unique SOL/LTC/ETH address + deposit history |
| `/withdraw` | Request payout to external address |
