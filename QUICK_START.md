# LottaCash — Quick Start Checklist

Print this page. Check off each step. Total time: ~45 minutes.

---

## ☐ Step 1: Supabase project (5 min)
- [ ] Go to [supabase.com](https://supabase.com) → New Project
- [ ] Name it `lottacash`, pick a region, save the DB password
- [ ] Wait for provisioning (~2 min)

## ☐ Step 2: Database (5 min)
- [ ] Open **SQL Editor** in Supabase dashboard
- [ ] Paste the entire contents of `supabase/lottacash-complete-setup.sql`
- [ ] Click **Run** → should say "Success"
- [ ] Verify: **Table Editor** shows 24 tables

## ☐ Step 3: Get API keys (2 min)
- [ ] Go to **Project Settings → API**
- [ ] Copy **Project URL** (e.g. `https://abcd.supabase.co`)
- [ ] Copy **anon public** key
- [ ] Copy **service_role** key (keep secret!)

## ☐ Step 4: Edge Function secrets (10 min)
Go to **Project Settings → Edge Functions → Secrets** and add:

**Required:**
- [ ] `SUPABASE_URL` = your project URL
- [ ] `SUPABASE_ANON_KEY` = anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` = service_role key

**Email (for signup/password reset):**
- [ ] `SMTP_HOST` (e.g. `smtp.resend.com`)
- [ ] `SMTP_PORT` (e.g. `465`)
- [ ] `SMTP_USER` (e.g. `resend`)
- [ ] `SMTP_PASS` (e.g. `re_xxxxxxxx`)
- [ ] `SMTP_FROM` (e.g. `LottaCash <noreply@you.com>)`)

**Crypto (for deposits):**
- [ ] `CRYPTO_MASTER_MNEMONIC` = 12/24-word seed phrase (generate with `npx bip39`)
- [ ] `MAIN_SOL_WALLET` = your Solana treasury address
- [ ] `MAIN_LTC_WALLET` = your Litecoin treasury address
- [ ] `MAIN_ETH_WALLET` = your Ethereum treasury address

**Cron (for deposit sweeping):**
- [ ] `CRON_SECRET` = random string (generate with `openssl rand -hex 32`)

**Block explorers (for scanning deposits):**
- [ ] `ETHERSCAN_API_KEY`
- [ ] `BLOCKCYPHER_TOKEN`
- [ ] `ETH_RPC_URL` (Alchemy/Infura free tier)
- [ ] `SOLANA_RPC_URL` (Helius/QuickNode free tier)

**Production CORS:**
- [ ] `ALLOWED_ORIGINS` = `https://yourdomain.com` (skip for dev)

## ☐ Step 5: Deploy Edge Functions (10 min)
```bash
npm install -g supabase
cd lottacash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
Then deploy all 17 functions:
```bash
for fn in send-signup-code verify-signup-code send-password-reset-code reset-password-with-code link-discord get-deposit-address poll-deposits sweep-deposits place-keno-bet place-limbo-bet place-roulette-bet place-slots-bet place-crash-bet cash-out-crash mines-game blackjack-game case-battle; do
  supabase functions deploy $fn --no-verify-jwt
done
```
- [ ] Verify in dashboard → **Edge Functions** → 17 functions deployed

## ☐ Step 6: Frontend .env (2 min)
Create `lottacash/.env`:
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_DISCORD_CLIENT_ID=optional
```
- [ ] Run `npm install && npm run dev`
- [ ] Open [localhost:5173](http://localhost:5173) → site loads

## ☐ Step 7: Test signup (3 min)
- [ ] Click **Sign up**, enter email/username/password
- [ ] Check email for 6-digit code, enter it
- [ ] Log in → balance shows **10,000.00 GC** and **100.00 SC**

## ☐ Step 8: Make yourself admin (1 min)
- [ ] Go to **Table Editor → profiles**, find your row
- [ ] Set `is_admin = true`, save
- [ ] Refresh site → **Admin** appears in sidebar

## ☐ Step 9: Set up deposit sweep cron (5 min)
**Option A — Supabase Dashboard:**
- [ ] Go to **Edge Functions → sweep-deposits → Create Schedule**
- [ ] Schedule: `*/2 * * * *` (every 2 min)
- [ ] Header: `x-cron-secret: YOUR_CRON_SECRET`

**Option B — cron-job.org:**
- [ ] Create job → URL: `https://xxxx.supabase.co/functions/v1/sweep-deposits`
- [ ] Method: POST, Headers: `x-cron-secret` + `Authorization: Bearer ANON_KEY`
- [ ] Every 2 minutes

## ☐ Step 10: Deploy to Vercel (5 min)
- [ ] Push to GitHub
- [ ] Vercel → New Project → import repo
- [ ] Framework: Vite, Build: `npm run build`, Output: `dist`
- [ ] Add env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DISCORD_CLIENT_ID`
- [ ] Deploy
- [ ] Add Vercel URL to **Supabase → Authentication → URL Configuration → Site URL**
- [ ] Set `ALLOWED_ORIGINS` to your Vercel domain

---

## ✅ Done! Test these:
- [ ] Sign up → get 10,000 GC + 100 SC
- [ ] Play Keno/Mines/Limbo/Roulette/Blackjack/Crash/Slots
- [ ] Toggle GC/SC in topbar
- [ ] Deposit page generates an address
- [ ] Withdraw page (SC only, min 10 SC)
- [ ] Redeem page (SC only, min 100 SC = $1)
- [ ] Admin page works
- [ ] Leaderboard shows players
- [ ] Live chat works
- [ ] Mobile responsive at all sizes

---

## Need help?
- **Full guide**: See `SETUP_GUIDE.md`
- **Troubleshooting**: See `SETUP_GUIDE.md` → Troubleshooting section
- **SQL file to run**: `supabase/lottacash-complete-setup.sql`
