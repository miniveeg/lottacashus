# LottaCash — Next.js 16 Edition

Premium crypto entertainment platform with provably-fair original games
(Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, Case Battles), a 3D
Three.js home page, admin panel, crypto wallet, leaderboard, affiliate system,
and Discord OAuth.

Migrated from Vite + React Router to **Next.js 16 (App Router)** so it runs in
environments that only expose a single Next.js port. All 29 routes resolve
under the single `/` Next.js route via **HashRouter** (e.g. `/#/keno`,
`/#/login`, `/#/admin`).

## Quick start

```bash
# 1. Install deps
bun install   # or: npm install / pnpm install

# 2. Configure env
cp .env.example .env
#   → fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
#   → (leave placeholders to run in "demo / browse-only" mode)

# 3. Run the Supabase setup SQL (one-time)
#   → supabase/lottacash-complete-setup.sql via Supabase SQL editor
#   → deploy the Edge Functions in supabase/functions/

# 4. Start the dev server
bun run dev   # → http://localhost:3000

# 5. Lint
bun run lint
```

## Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 5
- **Routing**: react-router-dom v7 (HashRouter) — all routes under `/`
- **Styling**: Plain CSS + CSS variables (`src/lottacash/styles/`); Tailwind
  CSS 4 + shadcn/ui available from the scaffold for any new components
- **3D**: three.js + @react-three/fiber + @react-three/drei (home page hero)
- **Animation**: framer-motion v12
- **Backend**: Supabase (auth, Postgres, Edge Functions, realtime)
- **State**: React Context (Auth, Profile, PlayMode, Sidebar, Notifications,
  Toast)

## Project structure

```
.
├── src/
│   ├── app/                    # Next.js App Router (layout.tsx, page.tsx)
│   │   ├── layout.tsx          # Root layout — imports LottaCash global CSS
│   │   ├── page.tsx            # Client component → dynamic-imports LottaCash App
│   │   └── globals.css         # Tailwind base (scaffold)
│   ├── lottacash/              # ← The entire LottaCash application lives here
│   │   ├── App.tsx             # HashRouter + providers + routes
│   │   ├── components/         # AppShell, Topbar, Sidebar, Footer, games UI, …
│   │   ├── pages/              # 29 pages (Home, Login, Keno, Mines, Admin, …)
│   │   ├── contexts/           # Auth, Profile, PlayMode, Sidebar, Notifications, Toast
│   │   ├── lib/                # Game logic, Supabase client, format utils, …
│   │   ├── content/            # Static content (FAQ, legal, game catalog)
│   │   ├── types/              # Shared TypeScript types
│   │   └── styles/             # theme.css, global.css, layout.css, …
│   └── components/ui/          # shadcn/ui primitives (scaffold)
├── public/                     # favicon.svg, logo.png
├── prisma/                     # Prisma schema (scaffold; LottaCash uses Supabase)
├── supabase/                   # SQL setup + Edge Functions (from original zip)
├── scripts/                    # Sweep-deposit scripts (from original zip)
├── .env.example
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
└── package.json
```

## Demo mode (Supabase unconfigured)

If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing or
set to placeholders, the app runs in **demo / browse-only mode**:

- ✅ All 29 routes render with full UI (topbar, sidebar, footer, 3D home)
- ✅ All 7 game pages render with disabled "Log in to play" buttons
- ✅ Auth pages show "Supabase is not configured" banner + disabled submit
- ✅ Protected routes (Settings, Profile, Deposit, Withdraw, Admin, etc.)
     redirect to `/login?redirect=…` with the deep link preserved
- ❌ Real auth, wallet, bets, realtime — require real Supabase keys

## Routes (all hash-based)

| Route | Description |
|---|---|
| `/#/` | Home (3D hero) |
| `/#/login`, `/#/signup`, `/#/forgot-password` | Auth |
| `/#/settings`, `/#/profile`, `/#/profile/:username` | Account |
| `/#/deposit`, `/#/withdraw`, `/#/redeem`, `/#/free-entry` | Wallet |
| `/#/keno`, `/#/mines`, `/#/limbo`, `/#/roulette`, `/#/blackjack`, `/#/crash`, `/#/slots` | Games |
| `/#/case-battles`, `/#/case-battles/create`, `/#/case-battles/:battleId` | Case Battles |
| `/#/originals`, `/#/promotions`, `/#/leaderboard` | Content |
| `/#/help`, `/#/privacy`, `/#/sweepstakes` | Legal |
| `/#/admin` | Admin (gated by AdminRoute) |
| `/#/responsible-gaming` | → redirects to `/#/settings` |
| `/#/*` | NotFound |

## Audit & fixes

This build went through a 19-agent audit pass (5 foundation + 11 page + 3
cross-cutting). **230+ bugs fixed**, including:

- Critical: `isSupabaseConfigured` returned `true` for placeholders
- Critical: 3D WebGL context leak on route change
- Critical: Mines auto-cashout froze the game at 24 mines
- Critical: Crash multiplier was FPS-dependent
- Critical: Blackjack insurance silently dropped the `coinType` arg
- Critical: Slots nonce drifted across sessions
- Critical: Redirect-to-self bug on 6 protected routes
- Critical: Legal page headings truncated to "1." instead of "1. Introduction"
- 50+ accessibility fixes (focus traps, ARIA, keyboard nav, skip link)
- 30+ race-condition guards (double-bet, double-cashout, unmount-during-async)
- Print styles, reduced-motion support, 44px touch targets, sticky footer

Full audit trail: `worklog.md` (1,400+ lines).

## License

Proprietary — LottaCash. All rights reserved.
