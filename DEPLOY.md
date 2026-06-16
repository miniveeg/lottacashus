# Deploy LottaCash (Git → Vercel + Supabase)

## 1. Supabase (backend / auth)

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email**: leave enabled.
3. **Authentication → Email**: turn **off** “Confirm email” — signup uses a custom 6-digit code from your SMTP instead of Supabase’s confirmation email.
4. **Project Settings → API**: copy **Project URL** and **anon public** key into `.env` (see below).
5. **SQL Editor**: run `supabase/schema.sql` (profiles + verification codes table).

### Custom signup verification (your email sends the code)

Signup flow:

1. User enters email, password, username → **Send verification code**
2. Edge function emails a random **6-digit code** (expires in **10 minutes**)
3. User enters the code → account is created and they are logged in

#### A. Run the new SQL migration

In **SQL Editor**, also run `supabase/migrations/20250520000000_signup_verification_codes.sql` if you already ran an older `schema.sql` without the verification table.

#### B. Deploy Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), log in, and link your project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Set SMTP secrets so mail is sent **from your domain address** (e.g. `support@lottacash.us`):

```bash
npx supabase secrets set SMTP_USER=support@lottacash.us
npx supabase secrets set SMTP_PASS=your-smtp-password
npx supabase secrets set SMTP_FROM="LottaCash <support@lottacash.us>"
# SMTP_HOST and SMTP_PORT depend on your provider — see below
npx supabase secrets set SMTP_HOST=YOUR_SMTP_HOST
npx supabase secrets set SMTP_PORT=587
```

Deploy both functions (**`--no-verify-jwt` is required** — users are not logged in yet during signup):

```bash
npx supabase functions deploy send-signup-code --no-verify-jwt
npx supabase functions deploy verify-signup-code --no-verify-jwt
```

**Check they work:** open in a browser (replace with your project URL):

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-signup-code`

You should see: `{"ok":true,"function":"send-signup-code"}`. If you get 404, the function is not deployed.

#### C. Namecheap Private Email (`support@lottacash.us` on privateemail.com)

If you sign in at [privateemail.com](https://privateemail.com), use Namecheap’s SMTP:

```bash
npx supabase secrets set SMTP_HOST=mail.privateemail.com
npx supabase secrets set SMTP_PORT=587
npx supabase secrets set SMTP_USER=support@lottacash.us
npx supabase secrets set SMTP_PASS=your-privateemail-mailbox-password
npx supabase secrets set SMTP_FROM="LottaCash <support@lottacash.us>"
```

Use the **same password** you use to log into privateemail.com for `support@lottacash.us` (not your Namecheap account password unless they are the same).

If port `587` fails, try `465` and redeploy functions.

#### D. Other custom domain providers

| If email is hosted by… | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` |
|------------------------|-------------|-------------|-------------|-------------|
| **Google Workspace** | `smtp.gmail.com` | `587` | `support@lottacash.us` | [App password](https://myaccount.google.com/apppasswords) (2FA required) |
| **Microsoft 365** | `smtp.office365.com` | `587` | `support@lottacash.us` | Mailbox password (or app password if enforced) |
| **Zoho Mail** | `smtp.zoho.com` | `587` | `support@lottacash.us` | Zoho mailbox / app password |
| **cPanel / web host** | Often `mail.lottacash.us` or `smtp.lottacash.us` | `587` or `465` | `support@lottacash.us` | From hosting panel → Email → account password |

**Example (Google Workspace for lottacash.us):**

```bash
npx supabase secrets set SMTP_HOST=smtp.gmail.com
npx supabase secrets set SMTP_PORT=587
npx supabase secrets set SMTP_USER=support@lottacash.us
npx supabase secrets set SMTP_PASS=xxxx-xxxx-xxxx-xxxx
npx supabase secrets set SMTP_FROM="LottaCash <support@lottacash.us>"
```

**Example (Microsoft 365):**

```bash
npx supabase secrets set SMTP_HOST=smtp.office365.com
npx supabase secrets set SMTP_PORT=587
npx supabase secrets set SMTP_USER=support@lottacash.us
npx supabase secrets set SMTP_PASS=your-password
npx supabase secrets set SMTP_FROM="LottaCash <support@lottacash.us>"
```

**Finding SMTP on shared hosting:** log into cPanel (or your host) → **Email Accounts** → connect / configure mail client — copy **Outgoing server (SMTP)**, port, and use the full address `support@lottacash.us` plus that mailbox’s password.

**DNS:** for deliverability, your domain should already have **MX** records pointing at your mail host, and ideally **SPF** (and DKIM if the host provides it). That is set at your domain registrar/DNS panel, not in this repo.

**`SMTP_FROM`:** should match a real mailbox you can send from (e.g. `support@lottacash.us`). Recipients will see “From: LottaCash &lt;support@lottacash.us&gt;”.

#### E. Fix “Failed to send a request to the Edge Function”

The browser cannot reach your Edge Function. Usually one of these:

1. **Functions not deployed** — run the deploy commands in section B with `--no-verify-jwt`.
2. **Wrong Supabase project on Vercel** — `VITE_SUPABASE_URL` must match the project where you deployed functions.
3. **Function crashed on boot** — Supabase Dashboard → **Edge Functions** → `send-signup-code` → **Logs**. Redeploy after fixing.

Quick test URL (browser):

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-signup-code`

Expected: `{"ok":true,"function":"send-signup-code"}`

#### F. Fix “Could not save verification code” on signup

That error means the Edge Function cannot write to the database. In **Supabase → SQL Editor**, run the entire file:

`supabase/migrations/20250520100000_fix_verification_codes_permissions.sql`

Then redeploy (if you changed functions):

```bash
npx supabase functions deploy send-signup-code
```

#### G. Personal Gmail (only if you are not using the domain mailbox)

```bash
npx supabase secrets set SMTP_HOST=smtp.gmail.com
npx supabase secrets set SMTP_PORT=587
npx supabase secrets set SMTP_USER=your.email@gmail.com
npx supabase secrets set SMTP_PASS=your-gmail-app-password
npx supabase secrets set SMTP_FROM="LottaCash <your.email@gmail.com>"
```

Use a Gmail **App password**, not your normal Google password.

### Local env

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

```bash
npm run dev
```

Test at `/signup` (send code → check inbox → verify).

---

## 2. GitHub

```bash
git add .
git commit -m "Custom signup verification codes"
git push
```

---

## 3. Vercel (frontend)

1. Import the GitHub repo on [vercel.com](https://vercel.com).
2. Add environment variables:

   | Name | Value |
   |------|--------|
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

3. Deploy.

SMTP secrets stay **only in Supabase** (Edge Functions), not in Vercel.

---

## Live balance

Run in **SQL Editor** (once, in order if you haven't already):

1. `supabase/migrations/20250520200000_profiles_realtime.sql`
2. `supabase/migrations/20250520300000_fix_profiles_balance_live.sql` — **required** (creates missing profiles, `ensure_user_profile`, Realtime fix)

Get your user id: **Authentication → Users** → copy UUID.

Test balance (SQL Editor — runs as admin, not as your logged-in user):

```sql
update public.profiles set balance = 150.50 where email = 'your@email.com';
```

Or by id:

```sql
update public.profiles set balance = 150.50 where id = 'YOUR_USER_UUID';
```

Refresh once after running migration #2 — you should see `$150.50`. Further updates should appear live in the topbar without refresh.

## Routes

| Path | Page |
|------|------|
| `/` | Home |
| `/login` | Log in |
| `/signup` | Sign up (email code verification) |
| `/settings` | Account stats, Discord link, transactions |
| `/forgot-password` | Reset password (email code) |

### Settings (stats, Discord, transactions)

Run SQL: `supabase/migrations/20250520500000_settings_stats_discord_transactions.sql`

**Discord Developer Portal** ([discord.com/developers](https://discord.com/developers/applications)):

1. Create an application → **OAuth2** → add redirect: `https://lottacash.us/settings` (and `http://localhost:5173/settings` for local dev).
2. Copy **Client ID** → `VITE_DISCORD_CLIENT_ID` on Vercel and in `.env`.
3. Copy **Client Secret** → Supabase secret (not Vercel):

```bash
npx supabase secrets set DISCORD_CLIENT_ID=your_client_id
npx supabase secrets set DISCORD_CLIENT_SECRET=your_client_secret
npx supabase functions deploy link-discord
```

(`link-discord` uses JWT — do not pass `--no-verify-jwt`.)

### Password reset Edge Functions

Run SQL: `supabase/migrations/20250520400000_password_reset_codes.sql`

Deploy:

```bash
npx supabase functions deploy send-password-reset-code --no-verify-jwt
npx supabase functions deploy reset-password-with-code --no-verify-jwt
```
