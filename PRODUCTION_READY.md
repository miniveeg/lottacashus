# LottaCash — Production-Ready Build

## What's in this package

This is the fully audited, fixed, and optimized version of your LottaCash
casino platform. All 40+ CRITICAL/HIGH findings from the 6-agent audit have
been addressed, plus all game UI/UX and animation issues.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   → fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
#   → (leave placeholders to run in "guest / browse-only" mode)

# 3. Run the Supabase migrations
#   → Run supabase/lottacash-complete-setup.sql in Supabase SQL Editor
#   → Run supabase/case-battles-v2-setup.sql
#   → Run supabase/migrations/001_audit_fixes.sql (CRITICAL — contains all security fixes)
#   → Deploy the Edge Functions in supabase/functions/

# 4. Start the dev server
npm run dev   # → http://localhost:5173

# 5. Production build
npm run build
npm run preview
```

## Critical deployment steps

1. **Run the SQL migration** — `supabase/migrations/001_audit_fixes.sql` contains
   all the security fixes (trigger-bypass patches, provably-fair leak fixes,
   crash binary-search exploit, Case Battles v2 gamemode logic, RLS hardening,
   etc.). It is idempotent and safe to run on existing databases.

2. **Deploy the new edge function** — `supabase/functions/crash-settle-expired/`
   is a new cron endpoint that settles abandoned Crash bets. Deploy it:
   ```bash
   supabase functions deploy crash-settle-expired
   ```

3. **Set environment secrets** — add these to Supabase → Edge Functions → Secrets:
   - `CRON_SECRET` — required for the crash-settle-expired cron endpoint
   - `DISCORD_REDIRECT_URI` — required for Discord OAuth (link-discord now validates this server-side)
   - `CRYPTO_MASTER_MNEMONIC`, `MAIN_SOL_WALLET`, `MAIN_LTC_WALLET`, `MAIN_ETH_WALLET`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `ALLOWED_ORIGINS` — production CORS lockdown

4. **Schedule the crash-settle cron** — Supabase → Scheduled Functions:
   ```json
   {
     "name": "crash-settle-expired",
     "schedule": "* * * * *",
     "verify_jwt": false
   }
   ```

5. **Verify AUDIT_BYPASS is OFF** — the `.env` should NOT contain
   `VITE_AUDIT_BYPASS=1`. The AuthContext now hard-throws if this is set in
   a production build, but verify before deploying.

## What was fixed (summary)

### SQL / Backend (supabase/migrations/001_audit_fixes.sql — 550+ lines)
- **Trigger-bypass bug class**: Added `bypass_profile_balance_guard()` to 5 RPCs
  (request_sc_redemption, admin_credit_user, self_exclude, set_deposit_limits,
  submit_affiliate_referral_code) — was silently reverting all balance/RG writes
- **Crash binary-search exploit**: `cash_out_crash` now settles as loss on over-cap
  cashout (was leaving bets open → attacker could binary-search crash_point)
- **Provably-fair leaks**: Removed `crash_point` from crash_bets column grant,
  `dealer_cards` from blackjack_hands column grant
- **Case Battles v2**: Added entry_cost CHECK >= 0 (was negative → infinite money),
  fixed cb_leave_battle to verify caller is a player, implemented all 4 gamemodes
  in cb_claim_payout (standard/terminal/jackpot with crazy flip, group with
  proportional split)
- **Race conditions**: Added FOR UPDATE lock to consume_keno_nonce; added
  blackjack_lock_completed_hands trigger for idempotency
- **Legacy RPC dropped**: `request_crypto_withdrawal` treated GC as USD 1:1 →
  infinite money exploit
- **RLS hardening**: Enabled RLS on verification code tables, restricted profiles
  UPDATE to username/avatar_seed only, added chat rate-limit trigger
- **Admin**: admin_process_redemption now refunds SC on status='failed';
  admin_credit_user caps amounts at ±1,000,000

### Edge Functions (8 files patched + 1 new)
- `cash-out-crash` — handles new SQL return type (success/crash_point/already_settled)
- `crash-settle-expired` (NEW) — cron endpoint to settle abandoned bets
- `send-signup-code` — no longer leaks account existence (email enumeration)
- `reset-password-with-code` — invalidates all sessions after password reset + atomic attempts
- `link-discord` — OAuth state CSRF validation + server-known redirect URI
- `sweep-deposits` — verifies deposits are credited before sweeping
- `verify-signup-code` + `reset-password-with-code` — atomic attempt increment (TOCTOU fix)

### Client-side (15+ files)
- **Crash.tsx**: rewrote animation — client no longer knows crashPoint during round;
  added settlement polling; visibility-change rAF pause
- **AuthContext**: guest users now have `role: "guest"` (not "authenticated");
  AUDIT_BYPASS hard-guarded in production
- **ToastContext**: memoized context value (cascading re-render fix)
- **ProfileContext**: removed admin-flag stickiness
- **Deposit**: toastRef pattern breaks the toast→refetch loop
- **Login**: client-side rate limiting (5/60s)
- **admin.ts**: fixed processAdminRedemption param mismatch (was sending p_action/p_notes,
  SQL expects p_status/p_tx_hash)

### Performance (16 files)
- Dropped redundant `refreshProfile()` after successful bets (6 game files)
- Filtered CaseBattles lobby subscription
- Replaced `select("*")` with explicit columns (also closes internal_seed leak)
- Paused rAF on hidden tab (ObsidianScene, Crash, Slots, BattleReel)
- Lazy-imported qrcode (main bundle: 219 KB → 197 KB)
- Optimized getCaseById with Map (O(n) → O(1))
- Added SQL indexes for leaderboard + admin + crash cron

### UI/UX + Animations (all 8 games)
- **Keno**: Skip ⏭ button + reduced-motion respect (stagger→0)
- **Crash**: distinct amber "Cash out failed" banner (vs red "Crashed")
- **CaseBattles Room**: recursive setTimeout + exponential backoff + hidden-tab pause
- **Sidebar**: infinite glow pulse → single entrance animation
- **PageTransition**: faster durations (0.32s→0.2s major, 0.22s→0.14s minor)
- **All games**: button press-feedback animations (scale-down on click)
- **Limbo**: history chip entrance animation (matches Roulette)
- **CaseBattles Create**: aria-labels on all tool buttons
- **Mobile**: 44px touch targets on all wager controls + toast close + sidebar collapse

## Build verification

- TypeScript: `tsc --noEmit` → PASSES (clean)
- Production build: `npm run build` → PASSES (~7s)
- Main bundle: 197 KB / 57 KB gzip
- 1.07 MB three.js chunk lazy-loaded only on home page (expected)
- Dev server: starts in ~200ms

## Production readiness: 8.5 / 10

**Deductions**: (1) three.js chunk is lazy but large; (2) some MEDIUM/LOW audit
items deferred (local-play TOCTOU, V1 dead code removal); (3) requires running
the SQL migration + deploying the new cron function before going live.

## File structure

```
.
├── src/                          # Frontend (Vite + React 19 + TS 5)
│   ├── pages/                    # 50 page components (8 games + admin + wallet + etc.)
│   ├── components/               # Shared UI (Sidebar, Topbar, Toast, GameFeedback, etc.)
│   ├── contexts/                 # Auth, Profile, PlayMode, Toast, Notifications, Sidebar
│   ├── lib/                      # Game logic, supabase client, edge function invoker
│   ├── styles/                   # Global CSS + theme tokens + shared game-controls
│   └── types/                    # TypeScript types
├── supabase/
│   ├── migrations/
│   │   └── 001_audit_fixes.sql   # ← RUN THIS (all security fixes)
│   ├── functions/                # 23 Edge Functions (Deno)
│   │   └── crash-settle-expired/ # ← NEW (cron endpoint)
│   ├── lottacash-complete-setup.sql  # Base schema (also patched in place)
│   ├── case-battles-v2-setup.sql     # Case Battles v2 schema
│   └── config.toml               # Edge function config (verify_jwt settings)
├── scripts/                      # Sweep deposit invocation scripts
├── public/                       # Static assets
├── package.json
├── vite.config.ts
├── tsconfig.json
├── vercel.json                   # CSP + security headers + SPA rewrites
└── README.md                     # Original project README
```

## Audit reports

The 6 detailed audit reports (3,969 lines total) are not included in this zip
to keep the size down, but they documented:
1. Game logic (24 findings, 7 CRITICAL)
2. Security & economy (30 findings, 10 CRITICAL)
3. UI/UX (42 findings, 6 CRITICAL)
4. Backend/Edge Functions (34 findings, 9 CRITICAL)
5. Performance (22 findings, 2 CRITICAL)
6. QA/exploit (26 findings, 6 CRITICAL)

All CRITICAL and HIGH findings have been addressed.
