# LottaCash — Complete Setup Guide

This guide walks you through setting up the entire LottaCash casino platform from scratch. Follow the steps in order. At the end, you'll have a fully functional site with dual currency (GC + SC), crypto deposits/withdrawals, 7 games, and an admin panel.

---

## What you need

| Item | Where to get it | Cost |
|------|----------------|------|
| **Supabase project** | [supabase.com](https://supabase.com) → New Project | Free tier works |
| **Vercel account** (for hosting) | [vercel.com](https://vercel.com) | Free tier works |
| **SMTP credentials** (for email) | Any email service: Resend, SendGrid, Mailgun, or Gmail SMTP | Free tiers available |
| **Crypto wallet** (optional, for deposits) | Phantom (SOL), Exodus (LTC/ETH) | Free |
| **BIP39 mnemonic** (for deposit addresses) | Generate with `npx bip39` or any wallet | Free |
| **Discord app** (optional, for Discord linking) | [discord.com/developers](https://discord.com/developers/applications) | Free |
| **Block explorer API keys** (for deposit scanning) | [Etherscan](https://etherscan.io/myapikey), [BlockCypher](https://accounts.blockcypher.com/tokens) | Free |

---

## Step 1: Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Fill in:
   - **Name**: `lottacash` (or whatever you want)
   - **Database Password**: Generate a strong password and **save it somewhere safe** — you'll need it.
   - **Region**: Choose the closest to your users.
   - **Plan**: Free tier is fine to start.
4. Click **Create new project** and wait ~2 minutes for it to provision.

---

## Step 2: Run the database migration

This is the most important step. The file `supabase/lottacash-complete-setup.sql` contains the entire database schema — all 24 tables, 88 functions, 29 RLS policies, 6 triggers, and the dual-currency starting balances (10,000 GC + 100 SC per new user).

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar.
2. Click **+ New query**.
3. Open the file `supabase/lottacash-complete-setup.sql` from this project in any text editor.
4. **Select all** (Ctrl+A / Cmd+A) and **copy** (Ctrl+C / Cmd+C).
5. **Paste** it into the Supabase SQL Editor.
6. Click **Run** (or press Ctrl+Enter).
7. Wait for it to complete — it takes 5–15 seconds. You should see "Success. No rows returned."
8. **Verify** it worked: click **Table Editor** in the left sidebar — you should see 24 tables including `profiles`, `transactions`, `keno_bets`, `case_battles`, etc.

> **Note**: This script is idempotent — you can run it again safely. It drops everything first, then recreates it. If you already have data, **it will be deleted**. Only run it on a fresh database or if you're OK losing data.

---

## Step 3: Get your Supabase API keys

1. In your Supabase dashboard, click **Project Settings** (gear icon, bottom left).
2. Click **API**.
3. You need these two values:
   - **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOi...` (a long JWT string)
4. Copy both — you'll need them in Step 6.

---

## Step 4: Set up Edge Function secrets

The Edge Functions (game logic, email, crypto) need secret keys. Set these in the Supabase dashboard.

1. Go to **Project Settings** → **Edge Functions**.
2. Under **Secrets**, click **Add secret** for each of the following:

### Required for all deployments

| Secret name | Value | Notes |
|-------------|-------|-------|
| `SUPABASE_URL` | `https://xxxxxxxxxxxx.supabase.co` | Your project URL |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Your anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Find in Project Settings → API → `service_role` | **Keep secret!** Never put in frontend |

### Required for email (signup verification, password reset)

| Secret name | Example value | Notes |
|-------------|---------------|-------|
| `SMTP_HOST` | `smtp.resend.com` | Use Resend, SendGrid, Mailgun, or Gmail |
| `SMTP_PORT` | `465` (SSL) or `587` (TLS) | Match your provider |
| `SMTP_USER` | `resend` or your email | Check provider docs |
| `SMTP_PASS` | `re_xxxxxxxxxxxx` | Your SMTP API key |
| `SMTP_FROM` | `LottaCash <noreply@yourdomain.com>` | The From address |

**Quick free option**: [Resend](https://resend.com) gives 3,000 free emails/month. Sign up, get your API key, and use:
- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=465`
- `SMTP_USER=resend`
- `SMTP_PASS=re_your_api_key`
- `SMTP_FROM=LottaCash <noreply@yourdomain.com>`

### Required for crypto deposits/withdrawals

| Secret name | Value | Notes |
|-------------|-------|-------|
| `CRYPTO_MASTER_MNEMONIC` | A 12 or 24-word BIP39 phrase | **Generate one and never share it.** Used to derive deposit addresses. |
| `MAIN_SOL_WALLET` | Your Solana treasury wallet address | Where swept SOL deposits go |
| `MAIN_LTC_WALLET` | Your Litecoin treasury address | Where swept LTC deposits go |
| `MAIN_ETH_WALLET` | Your Ethereum treasury address | Where swept ETH deposits go |

**Generate a mnemonic** (run in terminal):
```bash
npx bip39
```
Or use any wallet app to create a new wallet and copy the seed phrase.

### Required for cron jobs (deposit sweeping)

| Secret name | Value | Notes |
|-------------|-------|-------|
| `CRON_SECRET` | Any random string, e.g. `my-secret-cron-key-123` | Used to authenticate cron requests. Make it long and random. |

**Generate one**:
```bash
openssl rand -hex 32
```

### For block explorer APIs (deposit scanning)

| Secret name | Where to get it |
|-------------|----------------|
| `ETHERSCAN_API_KEY` | [etherscan.io/myapikey](https://etherscan.io/myapikey) |
| `BLOCKCYPHER_TOKEN` | [accounts.blockcypher.com/tokens](https://accounts.blockcypher.com/tokens) |
| `ETH_RPC_URL` | Use [Alchemy](https://alchemy.com) or [Infura](https://infura.io) free tier |
| `SOLANA_RPC_URL` | Use [Helius](https://helius.dev) or [QuickNode](https://quicknode.com) free tier |

### For CORS lockdown (production)

| Secret name | Value |
|-------------|-------|
| `ALLOWED_ORIGINS` | `https://yourdomain.com,https://www.yourdomain.com` |

If you skip this, CORS is open to any origin (OK for dev, not for production).

### Optional: Discord linking

| Secret name | Value |
|-------------|-------|
| `DISCORD_CLIENT_ID` | From [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_CLIENT_SECRET` | Same place |

### Optional: Extra sweep targets

| Secret name | Value |
|-------------|-------|
| `SWEEP_EXTRA` | Comma-separated list of `chain_privatekeyhex` for one-off sweeps |
| `SWEEP_FIND_LTC` | An LTC address to scan the mnemonic for |

---

## Step 5: Deploy Edge Functions

The site uses 17 Edge Functions for game logic, auth, and crypto. Deploy them all.

### Install the Supabase CLI

```bash
npm install -g supabase
```

### Log in and link your project

```bash
cd lottacash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Find your project ref in the Supabase dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`.

### Deploy all functions

Run this from the project root:

```bash
supabase functions deploy send-signup-code --no-verify-jwt
supabase functions deploy verify-signup-code --no-verify-jwt
supabase functions deploy send-password-reset-code --no-verify-jwt
supabase functions deploy reset-password-with-code --no-verify-jwt
supabase functions deploy link-discord --no-verify-jwt
supabase functions deploy get-deposit-address --no-verify-jwt
supabase functions deploy poll-deposits --no-verify-jwt
supabase functions deploy sweep-deposits --no-verify-jwt
supabase functions deploy place-keno-bet --no-verify-jwt
supabase functions deploy place-limbo-bet --no-verify-jwt
supabase functions deploy place-roulette-bet --no-verify-jwt
supabase functions deploy place-slots-bet --no-verify-jwt
supabase functions deploy place-crash-bet --no-verify-jwt
supabase functions deploy cash-out-crash --no-verify-jwt
supabase functions deploy mines-game --no-verify-jwt
supabase functions deploy blackjack-game --no-verify-jwt
supabase functions deploy case-battle --no-verify-jwt
```

> **Note**: We use `--no-verify-jwt` because the functions verify the JWT themselves via `auth.getUser()`. This is the intended design.

### Verify deployment

Go to your Supabase dashboard → **Edge Functions**. You should see all 17 functions listed with a green "Deployed" status.

---

## Step 6: Set up the frontend

### Create a `.env` file

In the project root (`lottacash/`), create a file named `.env`:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_DISCORD_CLIENT_ID=your_discord_app_client_id
```

> Use the values from Step 3. The `VITE_DISCORD_CLIENT_ID` is optional — only needed if you set up Discord linking.

### Install dependencies and test locally

```bash
cd lottacash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. You should see the LottaCash homepage.

### Test signup

1. Click **Sign up**.
2. Enter an email, username, and password.
3. You should receive a verification code email (if SMTP is configured).
4. Enter the code to complete signup.
5. Log in — your balance should show **10,000.00 GC** and **100.00 SC**.

---

## Step 7: Set up the auth trigger (auto-creates profile on signup)

The migration already creates this trigger, but verify it's working:

1. Go to **Supabase Dashboard → Authentication → Users**.
2. Sign up a test user via your site.
3. Go to **Table Editor → profiles** — you should see a new row with:
   - `balance = 10000.00` (Gold Coins)
   - `sweeps_coins = 100.00` (Sweeps Coins)
   - `is_admin = false`

If the profile row doesn't appear, run this in SQL Editor to recreate the trigger:

```sql
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## Step 8: Make yourself an admin

To access the `/admin` page, you need `is_admin = true` on your profile.

1. Sign up and log in to your site.
2. Go to **Supabase Dashboard → Table Editor → profiles**.
3. Find your row, click the pencil icon to edit.
4. Set `is_admin` to `true`.
5. Save.
6. Refresh your site — you should now see **Admin** in the sidebar.

---

## Step 9: Set up deposit address generation (crypto)

The `get-deposit-address` Edge Function derives a unique deposit address for each user from your `CRYPTO_MASTER_MNEMONIC`. It's already deployed — test it:

1. Log in to your site.
2. Click **Deposit** in the sidebar.
3. Pick a chain (SOL, LTC, or ETH).
4. You should see a deposit address generated for your account.

If it fails, check:
- `CRYPTO_MASTER_MNEMONIC` is set in Edge Function secrets.
- The `get-deposit-address` function is deployed.
- Browser console for errors.

---

## Step 10: Set up the deposit sweep cron job

Deposits need to be scanned and credited automatically. The `sweep-deposits` function does this.

### Option A: Use Supabase's scheduled functions (recommended)

1. Go to **Supabase Dashboard → Edge Functions → sweep-deposits**.
2. Click **Create Schedule** (or "Cron").
3. Set the schedule to run every 2 minutes: `*/2 * * * *`.
4. Add a header: `x-cron-secret: YOUR_CRON_SECRET` (the value you set in Step 4).
5. Save.

### Option B: Use cron-job.org (free)

1. Go to [cron-job.org](https://cron-job.org) and create an account.
2. Create a new cron job:
   - **URL**: `https://xxxxxxxxxxxx.supabase.co/functions/v1/sweep-deposits`
   - **Method**: POST
   - **Headers**: `x-cron-secret: YOUR_CRON_SECRET`, `Authorization: Bearer YOUR_ANON_KEY`
   - **Schedule**: Every 2 minutes
3. Save.

---

## Step 11: Deploy to Vercel

1. Push your project to GitHub.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo.
3. **Framework preset**: Vite
4. **Build command**: `npm run build`
5. **Output directory**: `dist`
6. **Environment Variables** — add these (same as your `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_DISCORD_CLIENT_ID` (if using Discord)
7. Click **Deploy**.
8. Once deployed, add your Vercel domain to Supabase:
   - Go to **Supabase Dashboard → Authentication → URL Configuration**.
   - Add your Vercel URL to **Site URL** and **Redirect URLs**.
9. Set `ALLOWED_ORIGINS` in your Edge Function secrets to your Vercel domain:
   - `https://your-project.vercel.app` (or your custom domain)

---

## Step 12: Configure Discord OAuth (optional)

If you want users to link their Discord accounts:

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it `LottaCash`.
3. Go to **OAuth2**:
   - **Redirects**: Add `https://yourdomain.com/settings`
   - Copy the **Client ID** and **Client Secret**.
4. Set Edge Function secrets:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
5. Set frontend env var:
   - `VITE_DISCORD_CLIENT_ID`
6. Redeploy the frontend.

---

## Quick reference: Currency system

| Currency | Symbol | Value | Starting balance | Usage |
|----------|--------|-------|------------------|-------|
| **Gold Coins** | GC | 100 GC = $1 USD (display only, no real value) | 10,000 GC | Gameplay |
| **Sweeps Coins** | SC | 100 SC = $1 USD (redeemable for cash) | 100 SC | Gameplay + redemption |

- **Deposits**: $10 USD → 1,000 GC + 10 bonus SC
- **Withdrawals**: Only SC can be withdrawn (min 10 SC = $0.10)
- **Redemptions**: Only SC can be redeemed (min 100 SC = $1.00)
- **GC is play money** — it has no cash value and cannot be withdrawn

---

## Quick reference: Game RTPs

| Game | RTP |
|------|-----|
| Keno | ~94% |
| Mines | 94.5% |
| Limbo | 99% |
| Roulette | 97.3% (European) |
| Blackjack | ~99.5% |
| Crash | 99% |
| Slots | ~95% |

---

## Troubleshooting

### "Supabase keys are missing" warning on the site
→ Your `.env` file is missing or has incorrect values. See Step 6.

### Signup doesn't send a verification email
→ Check SMTP secrets are set correctly (Step 4). Check Edge Function logs in Supabase Dashboard → Edge Functions → `send-signup-code` → Logs.

### New users don't get 10,000 GC + 100 SC
→ The auth trigger is missing. Run the SQL in Step 7 to recreate it.

### Deposit address doesn't generate
→ Check `CRYPTO_MASTER_MNEMONIC` is set. Check `get-deposit-address` function logs.

### Deposits aren't credited
→ The sweep cron job isn't running. Set it up in Step 10. Check `sweep-deposits` function logs. Ensure `CRON_SECRET` matches.

### Can't access /admin
→ Your profile's `is_admin` isn't `true`. See Step 8.

### "Edge Function not found (404)"
→ The function isn't deployed. Run Step 5 again.

### CORS errors in browser console
→ Set `ALLOWED_ORIGINS` in Edge Function secrets to your domain (Step 4, "For CORS lockdown").

### Build fails with TypeScript errors
→ Run `npx tsc --noEmit` to see the errors. If you modified code, fix the type errors. If you didn't modify anything, make sure you have the latest code.

---

## File structure reference

```
lottacash/
├── .env                          ← Your local env vars (Step 6)
├── index.html
├── package.json
├── vite.config.ts
├── src/                          ← Frontend React app
│   ├── App.tsx                   ← Routes
│   ├── main.tsx                  ← Entry point
│   ├── contexts/                 ← React contexts (Auth, Profile, PlayMode, etc.)
│   ├── lib/                      ← Utilities (supabase, format, games, etc.)
│   ├── components/               ← Reusable UI components
│   └── pages/                    ← Page components (Home, Keno, Mines, etc.)
├── supabase/
│   ├── lottacash-complete-setup.sql  ← ★ THE ONE FILE TO RUN (Step 2)
│   ├── config.toml
│   ├── functions/                ← 17 Edge Functions to deploy (Step 5)
│   │   ├── _shared/              ← Shared helpers
│   │   ├── send-signup-code/
│   │   ├── verify-signup-code/
│   │   ├── place-keno-bet/
│   │   └── ... (14 more)
│   └── migrations/               ← Individual migrations (already consolidated into the setup file)
├── scripts/                      ← Manual sweep scripts
└── public/                       ← Static assets
```

---

## You're done! 🎉

Your LottaCash casino is now live with:
- ✅ Dual currency (10,000 GC + 100 SC welcome bonus)
- ✅ 7 provably-fair games (Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots)
- ✅ Case Battles with multiple modes
- ✅ Crypto deposits (SOL, LTC, ETH) with auto-sweeping
- ✅ SC withdrawals and redemptions
- ✅ Affiliate/referral system
- ✅ Admin panel
- ✅ Responsible gaming (deposit limits, self-exclusion)
- ✅ Live chat
- ✅ Leaderboards
- ✅ Discord linking
- ✅ Mobile-responsive design
