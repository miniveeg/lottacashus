# Sweepstakes Crypto Casino — Build Roadmap

---

## Phase 1: Foundation & Setup

### Step 1 — Set up your dev environment
Install the tools you'll need before writing a single line of casino code.

- Install **Node.js** (v20+) from nodejs.org — this runs your entire backend and build tools
- Install **VS Code** as your editor — free and the most popular choice for JS/React
- Create a **GitHub account** at github.com — you'll store your code here and deploy from it
- Install **Git** on your machine and run `git config --global user.email 'you@email.com'`
- Run `node -v` and `npm -v` in your terminal to confirm everything works

---

### Step 2 — Scaffold your Next.js project
Next.js gives you both frontend and backend in one project — perfect for a casino app.

- Run `npx create-next-app@latest my-casino` in your terminal
- Choose: TypeScript = No (simpler for now), Tailwind = Yes, App Router = Yes
- Open the folder in VS Code: `cd my-casino && code .`
- Run `npm run dev` — your site is now live at `localhost:3000`
- Your folder structure: `/app` (pages), `/components` (UI pieces), `/api` (backend logic)

---

### Step 3 — Set up your database (Supabase)
You need a database to store users, balances, and game history. Supabase is free and easy.

- Create a free account at **supabase.com** — their free tier is more than enough to start
- Create a new project and copy your `Project URL` and `anon public key`
- Create a `.env.local` file in your project root and add:
  - `NEXT_PUBLIC_SUPABASE_URL=...`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`
- Run `npm install @supabase/supabase-js`
- Create these tables in Supabase:
  - `users` (id, email, gold_coins, sweeps_coins, created_at)
  - `transactions` (id, user_id, type, amount, crypto, tx_hash, created_at)
  - `game_history` (id, user_id, game, bet, result, payout, created_at)

---

### Step 4 — Set up authentication
Users need accounts to play. Supabase Auth handles this with zero extra cost.

- In Supabase dashboard → Authentication → enable Email auth
- Install: `npm install @supabase/auth-helpers-nextjs`
- Create `/app/login/page.js` with a simple email + password form
- Create `/app/register/page.js` — on signup, auto-create a user row with 1000 Gold Coins and 10 Sweeps Coins as a welcome bonus
- Add auth middleware in `/middleware.js` to protect game routes — redirect to login if not authenticated

---

### Step 5 — Buy a domain & deploy to Vercel (~$10)
Get your site online. Vercel's free tier is perfect for this stage.

- Buy a domain at **Namecheap** (~$10/yr) — pick something short and brandable
- Create a free account at **vercel.com** and connect your GitHub repo
- In Vercel dashboard: add your `.env.local` variables as Environment Variables
- Every time you push to GitHub, Vercel auto-deploys — zero manual work
- Add your custom domain in Vercel → Domains → follow their DNS instructions at Namecheap

---

## Phase 2: Core Backend

### Step 6 — Implement the dual-currency coin system
The heart of your sweepstakes model — Gold Coins (fun play) and Sweeps Coins (redeemable).

- **Gold Coins (GC)**: purchased with crypto, used for play only, no redemption value
- **Sweeps Coins (SC)**: given FREE with every GC purchase (e.g. 1 SC per 100 GC bought), also obtainable free via mail-in request — this is what makes it legal
- Build a `/api/coins/update` route that atomically updates both balances using Supabase transactions — never let a balance go negative
- Create a `CoinDisplay` component showing both balances in the nav bar with a toggle between GC and SC mode
- Implement a `PlayMode` context that tracks which currency the user is currently playing with — all game bets deduct from the active mode

---

### Step 7 — Integrate crypto payments (NOWPayments)
Accept BTC, ETH, SOL, USDT, LTC and more with zero monthly fees.

- Sign up free at **nowpayments.io** — they support 300+ coins including all yours
- Get your API key and add to `.env.local` as `NOWPAYMENTS_API_KEY=...`
- Create `/api/payment/create` that calls NOWPayments API to generate a payment address
- Create `/api/payment/webhook` — NOWPayments will POST here when payment confirms. Credit GC + bonus SC to the user's account
- Implement a `DepositModal` component showing the generated address with a QR code (use `qrcode.react` library) and a countdown timer

---

### Step 8 — Build the sweepstakes mail-in entry system
Required by law — users must be able to get Sweeps Coins without paying anything.

- Add a page `/free-entry` explaining how to request free Sweeps Coins by mail
- Users mail a handwritten request with their username and return address to your registered address
- You manually credit 5–10 SC to their account via a simple admin panel you build
- Create an `/admin` route (password protected) where you can search users and credit coins
- Include your mailing address prominently in your Terms and on the free entry page — this is a legal requirement

---

### Step 9 — Build the redemption system
Let SC winners cash out via crypto wallet — this is the prize fulfillment.

- Minimum redemption: 100 SC = $10 equivalent (set your own rate, be consistent in your Terms)
- Create `/redeem` page where user enters their crypto wallet address and amount
- Create `/api/redeem/request` that logs the request to a `redemptions` table with status `pending`
- Initially, process redemptions manually via your admin panel — send crypto from your hot wallet
- Send a confirmation email using **Resend.com** (free tier: 3,000 emails/mo) when redemption is processed

---

## Phase 3: Games

### Step 10 — Build Blackjack
Start here — it's the simplest to implement with clear, provably fair rules.

- Create `/components/games/Blackjack.js` — all game logic lives client-side in React state
- Implement a standard 6-deck shoe. Shuffle using Fisher-Yates algorithm at game start
- States to track: `deck`, `playerHand`, `dealerHand`, `gamePhase` (betting/playing/dealer/result), `bet`
- Actions: Hit, Stand, Double Down, Split (optional for v1). Dealer must hit on soft 16, stand on 17+
- On game end, call `/api/game/settle` to update the user's coin balance and log to game_history — **never trust client-side for balance updates, always settle server-side**

---

### Step 11 — Build Roulette
European roulette (single zero) is fairer and simpler than American. Build this second.

- Create `/components/games/Roulette.js` with a betting table UI (numbers 0–36, red/black, odd/even, columns, dozens)
- Use a CSS animated spinning wheel — search for "CSS roulette wheel codepen" for a starting point you can adapt
- On spin: generate a random number 0–36 **server-side** in `/api/game/spin-roulette` — never client-side
- Calculate all winning bets based on the result (straight up = 35:1, red/black = 1:1, etc.)
- Animate the ball landing on the result, then settle all bets and update balances

---

### Step 12 — Build the Crash game
Crash is the most engaging and modern game — players cash out before the multiplier crashes.

- The crash point is generated server-side before the round starts using a provably fair algorithm: `crashPoint = Math.max(1, 1 / Math.random())` (simplified — look up "provably fair crash algorithm" for the full HMAC version)
- Create a game loop: multiplier starts at 1x and increases every 100ms. Broadcast via Supabase Realtime so all players see the same multiplier
- Players place bets before round starts, click "Cash Out" anytime during the round to lock in the current multiplier
- If they don't cash out before the crash, they lose their bet
- Animate the multiplier with a rising curve chart using a canvas element — this is the core visual of the game

---

### Step 13 — Build Simple Slots
A basic 3-reel slot to round out your game library. Keep it simple for v1.

- 3 reels, 5–7 symbols (use emoji or simple SVG icons: 🍒 🔔 ⭐ 💎 7 BAR)
- On spin: generate 3 random symbols **server-side** in `/api/game/spin-slots`
- Paytable: three of a kind (big win), two of a kind (small win), no match (loss). Define your own multipliers
- Animate the reels spinning with a CSS slot animation — each reel stops sequentially left to right for suspense
- Add win lines, particle effects on big wins, and auto-spin as stretch goals after v1 is working

---

## Phase 4: Legal & Launch

### Step 14 — Draft your legal documents
You need these before any real users. Self-draft first, get reviewed when you have revenue.

- **Terms & Conditions**: must include sweepstakes rules, no purchase necessary alternative, eligible states (exclude WA, ID, and check others), prize descriptions, odds of winning
- **Privacy Policy**: what data you collect, how it's used, CCPA compliance if serving CA users
- **Sweepstakes Rules**: start/end dates, eligible participants, how to enter free, prize values, odds, claim process
- Use **termly.io** or **privacypolicies.com** for free template generators as a starting point
- Add a footer link to all three documents on every page — legally required and builds trust

---

### Step 15 — Add responsible gaming & compliance features
These protect you legally and show good faith operation.

- **Age verification gate**: require users to confirm 18+ on signup (checkbox + birthdate field)
- **Self-exclusion**: let users ban themselves from the platform for 30/90/180 days
- **Deposit limits**: let users set daily/weekly GC purchase limits
- **Session time reminders**: notify users who have been playing for 1+ hours
- Add links to **ncpgambling.org** (National Council on Problem Gambling) in your footer

---

### Step 16 — Pre-launch checklist & go live
Final checks before opening to real users.

- Test every game 50+ times — verify balances update correctly every single time, never lose coins to bugs
- Test the full deposit flow with a real $1 crypto transaction
- Test the full redemption flow end to end
- Set up **Google Analytics** (free) to track users and retention from day one
- Form your **Wyoming LLC** ($100) before announcing publicly — then you're protected when real users arrive

---

## Cost Summary

| Item | Cost |
|---|---|
| Domain (Namecheap) | ~$10/yr |
| Hosting (Vercel) | Free |
| Database (Supabase) | Free |
| Crypto payments (NOWPayments) | Free |
| Email (Resend.com) | Free |
| Wyoming LLC | $100 (do before launch) |
| **Total to launch** | **~$10** |
