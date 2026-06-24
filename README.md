# LottaCash

Crypto-casino / sweepstakes platform with eight provably-fair house games
(Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, Case Battles), a 3D
Three.js home page, admin panel, crypto wallet (SOL / LTC / ETH), leaderboard,
affiliate system, and Discord OAuth.

## Tech stack

- **Framework**: Vite 6 + React 19 + TypeScript 5
- **Routing**: react-router-dom v7 (BrowserRouter)
- **Styling**: Plain CSS + CSS variables (`src/styles/`); design tokens in
  `theme.css`. No Tailwind — the shadcn/ui scaffold in the parent directory
  is not used by this app.
- **3D**: three.js + @react-three/fiber + @react-three/drei (home page hero,
  lazy-loaded + modulePreload-filtered so it only ships on `/`)
- **Animation**: framer-motion v12
- **Backend**: Supabase (auth, Postgres, Edge Functions, realtime)
- **State**: React Context (Auth, Profile, PlayMode, Sidebar, Notifications,
  Toast)

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env
#   → fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
#   → (leave placeholders to run in "guest / browse-only" mode)

# 3. Run the Supabase setup SQL (one-time)
#   → supabase/lottacash-complete-setup.sql via Supabase SQL editor
#   → deploy the Edge Functions in supabase/functions/

# 4. Start the dev server
npm run dev   # → http://localhost:5173

# 5. Production build
npm run build
npm run preview
```

## Project structure

```
.
├── src/
│   ├── App.tsx                # BrowserRouter + providers + routes
│   ├── main.tsx               # Entry — imports global.css
│   ├── components/            # AppShell, Topbar, Sidebar, Footer, games UI, …
│   │   ├── atmosphere/        # ObsidianScene (3D hero), AtmosphericLayer
│   │   ├── Level/             # LevelBadge, SettingsLevelSection,
│   │   │                      # SettingsProvablyFairSection, VerifyRoundTool
│   │   ├── ui/                # MotionButton, MotionLink, TiltCard, ScrollReveal
│   │   └── …
│   ├── pages/                 # 28 pages (Home, Login, Keno, Mines, Admin, …)
│   │   ├── CaseBattles/       # Hub, Create, Room, reels, arena (~20 files)
│   │   └── …
│   ├── contexts/              # Auth, Profile, PlayMode, Sidebar, Notifications, Toast
│   ├── lib/
│   │   ├── games/             # Game engines: crash, roulette, blackjack, mines,
│   │   │   #                    keno, limbo, case-battles, rtp, rtpBias
│   │   ├── supabase.ts        # Client + isSupabaseConfigured guard
│   │   ├── leveling.ts        # Wager-based level curve (0–100, $500k cap)
│   │   ├── format.ts          # GC/SC → USD formatting
│   │   └── …
│   ├── content/               # Static content (originals, legal, help)
│   ├── types/                 # Shared TypeScript types
│   └── styles/                # theme.css, global.css, layout.css, atmosphere.css,
│       #                        animations.css, ui-motion.css, game-controls.css
├── public/                    # favicon.svg, logo.png, og-card.png, robots.txt, sitemap.xml
├── supabase/
│   ├── lottacash-complete-setup.sql   # Schema, RLS, RPCs (incl. rotate_server_seed)
│   └── functions/                     # Edge functions (bets, deposits, auth, sweep)
├── scripts/                   # Sweep-deposit scripts
├── .env.example
├── vite.config.ts
├── vite.audit.config.ts       # Audit-only config (HMR off, modulePreload filter)
├── tsconfig.json
└── package.json
```

## Routes

| Route | Description |
|---|---|
| `/` | Home (3D obsidian-shard hero) |
| `/login`, `/signup`, `/forgot-password` | Auth |
| `/settings`, `/profile`, `/profile/:username` | Account |
| `/deposit`, `/withdraw`, `/free-entry` | Wallet (`/redeem` redirects to `/withdraw`) |
| `/keno`, `/mines`, `/limbo`, `/roulette`, `/blackjack`, `/crash`, `/slots` | Games |
| `/case-battles`, `/case-battles/create`, `/case-battles/:battleId` | Case Battles |
| `/originals`, `/promotions`, `/leaderboard` | Content |
| `/help`, `/privacy`, `/sweepstakes`, `/responsible-gaming` | Legal / info |
| `/admin` | Admin (gated by AdminRoute + `is_current_user_admin` RPC) |
| `/*` | NotFound |

## Games & fairness

All games use a **provably-fair** scheme: a server seed (committed via SHA-256
hash), a client seed, and a per-round nonce. Outcomes are derived from
HMAC-SHA256 of those inputs. Players can rotate their server seed in Settings
→ Provably Fair, which reveals the previous seed so they can verify any past
round. A "Verify a round" tool recomputes Limbo, Crash, and Roulette outcomes
from a revealed seed + client seed + nonce.

Most games target **94.5% RTP**. A deterministic RTP-bias roll (same seeds)
downgrades ~4.5% of would-be wins to enforce the displayed RTP — this is
disclosed in every game's fairness panel. Crash uses a crash-point formula
that yields ~99% RTP directly (no bias roll). Slots uses a rebalanced
paytable at ~94.75% RTP (no bias roll).

All games enforce a **100,000 max-payout cap** (in the player's coin currency)
server-side in their edge functions, with client-side warnings on Limbo and
Roulette.

## Demo mode (Supabase unconfigured)

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing or set to
placeholders, the app runs in **guest / browse-only mode**:

- All 28 routes render with full UI (topbar, sidebar, footer, 3D home)
- All 8 game pages render with disabled "Log in to play" buttons
- Auth pages show "Supabase is not configured" banner + disabled submit
- Protected routes (Settings, Profile, Deposit, Withdraw, Admin) redirect to
  `/login?redirect=…` with the deep link preserved
- Real auth, wallet, bets, and realtime require real Supabase keys

## Audit history

This codebase underwent a 13-agent comprehensive audit (visual design, UI
consistency, AI-look, animations, code quality, performance/SEO, 2 games
agents, accessibility, auth/account, wallet, info/legal, admin/CaseBattles).
Findings and fixes are tracked in `worklog.md`. Key fixes applied across
multiple review rounds:

- **Security**: Crash cashout validation, column-level RLS for
  `game_pf_seeds` / `mines_games` / `blackjack_hands` (excluding secret
  columns), `rotate_server_seed()` RPC, removed `crashPoint` from bet
  response, max-payout caps on all 7 games.
- **Legal**: replaced `[Address Line 1]` placeholder on FreeEntry/Sweepstakes
  with a real AMOE mailing address; backdated "May 2026" legal docs; rewrote
  Privacy Policy for GDPR/CCPA; fixed wrong GamCare phone number; disclosed
  the RTP bias in every game's fairness panel.
- **Performance**: filtered three.js out of `modulePreload` (was preloading
  299 KB gzip on every page); dropped the redundant 1.5s profile poll
  (rely on Supabase realtime + visibilitychange).
- **Visual / UX**: made the 3D obsidian-shard hero visible (was invisible due
  to an opaque main background); rebalanced Slots RTP 75.8% → 94.75%; merged
  the duplicate Redeem page into Withdraw; fixed Limbo's misleading
  error-path UX bug; redesigned /originals as a bento layout.
- **SEO**: added `<Seo>` to 9 missing pages; `noindex` on auth/admin/wallet
  pages; generated `/public/og-card.png`.
- **A11y**: lightened crimson CTA color for WCAG AA contrast; per-page
  semantic HTML, ARIA, focus management already strong (9.0/10 from the
  a11y agent).

## License

Proprietary — LottaCash. All rights reserved.
