# LottaCash — Vite + React (Audited & Fixed Edition)

Premium crypto entertainment platform with provably-fair original games
(Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, Case Battles), a 3D
Three.js home page, admin panel, crypto wallet, leaderboard, affiliate system,
and Discord OAuth.

**This is your original Vite + React Router + Supabase project**, with 230+ bug
fixes applied from a 19-agent audit pass. The framework, build tooling, and
project structure are unchanged — only bugs were fixed.

## Quick start

```bash
# 1. Install deps
npm install        # or: bun install / pnpm install

# 2. Configure env
cp .env.example .env
#   → fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
#   → (leave placeholders to run in "demo / browse-only" mode)

# 3. Run the Supabase setup SQL (one-time)
#   → supabase/lottacash-complete-setup.sql via Supabase SQL editor
#   → deploy the Edge Functions in supabase/functions/

# 4. Start the dev server
npm run dev        # → http://localhost:5173

# 5. Build for production
npm run build      # → dist/
npm run preview    # preview the production build

# 6. Sweep scripts (optional — for crypto deposit processing)
npm run sweep:dry        # dry-run
npm run sweep:manual     # manual sweep
npm run sweep:remote     # invoke remote edge function
```

## Tech stack (UNCHANGED from your original)

- **Framework**: Vite 6 + React 19
- **Routing**: react-router-dom v7 (BrowserRouter)
- **Language**: TypeScript 5
- **Styling**: Plain CSS + CSS variables (`src/styles/`)
- **3D**: three.js + @react-three/fiber + @react-three/drei (home page hero)
- **Animation**: framer-motion v12, lenis (smooth scroll)
- **Backend**: Supabase (auth, Postgres, Edge Functions, realtime)
- **State**: React Context (Auth, Profile, PlayMode, Sidebar, Notifications, Toast)
- **Crypto**: @solana/web3.js, ethers, bitcoinjs-lib, bip39 (devDeps for sweep scripts)

## Project structure (UNCHANGED from your original)

```
.
├── src/
│   ├── App.tsx                 # BrowserRouter + providers + routes
│   ├── main.tsx                # Vite entry
│   ├── components/             # AppShell, Topbar, Sidebar, Footer, games UI, …
│   ├── pages/                  # 29 pages (Home, Login, Keno, Mines, Admin, …)
│   ├── contexts/               # Auth, Profile, PlayMode, Sidebar, Notifications, Toast
│   ├── lib/                    # Game logic, Supabase client, format utils, …
│   ├── content/                # Static content (FAQ, legal, game catalog)
│   ├── types/                  # Shared TypeScript types
│   └── styles/                 # theme.css, global.css, layout.css, …
├── public/                     # favicon.svg, logo.png
├── supabase/                   # SQL setup + 18 Edge Functions
├── scripts/                    # Sweep-deposit scripts
├── .env.example
├── vite.config.ts
├── tsconfig.json + tsconfig.app.json
├── vercel.json
└── package.json
```

## What was fixed (230+ bugs across 19 audit agents)

### Critical fixes
- **`isSupabaseConfigured` returned `true` for placeholder values** — caused real network calls against `placeholder.supabase.co`. Now correctly detects placeholders and treats them as unconfigured.
- **3D WebGL context leak on route change** — `THREE.WebGLRenderer: Context Lost` warnings on every non-home page. Fixed with explicit `gl.dispose()` + `forceContextLoss()` in ObsidianScene cleanup, plus a console-noise filter for known Three.js deprecation messages.
- **Mines auto-cashout froze the game at 24 mines** — `handleCashout`'s `gemsRevealed < 1` guard read stale state. Fixed by passing `data.gemsRevealed` explicitly.
- **Crash multiplier was FPS-dependent** — hardcoded `1/60` per frame meant half-speed on 30Hz, 2× on 120Hz. Fixed with `performance.now()` wall-clock timing.
- **Crash cashout error "rewound" animation to 1×** — now transitions directly to `crashed` phase.
- **Blackjack insurance silently dropped the `coinType` arg** — would debit GC instead of SC in Sweeps-Coins mode. Fixed lambda to pass `coinType`.
- **Slots nonce drifted across sessions** — `setPfNonce((prev) => prev + 1)` was wrong; the server returns the USED nonce, so next is `data.nonce + 1`.
- **CaseBattlesHub double-fetched lobby on mount** — both `useEffect` and `useCaseBattlesLobbyPoll` fired `loadLobby()`. Removed the redundant effect.
- **Redirect-to-self bug on 6 protected routes** — `?redirect=%2Fsettings` was clobbered to `?redirect=%2Flogin` because `useLocation().pathname` re-evaluated post-`<Navigate>`. Fixed by hardcoding the path.
- **Legal page headings truncated** — Privacy/SweepstakesRules/Help ToS showed "1." instead of "1. Introduction". Fixed `indexOf(" ")` → `indexOf("\n")`.
- **FreeEntry welcome bonus understated 100×** — said "1 SC" instead of the actual "100 SC" bonus.
- **SC rate in FAQ/legal content overstated 10×** — claimed `1 SC = $0.10` instead of the actual `1 SC = $0.01`.

### Accessibility (50+ fixes)
- Mobile sidebar drawer: added `aria-expanded`, `aria-controls`, `role="dialog"`, `aria-modal`, focus trap, focus restore, Esc-to-close, `inert` when closed
- Notifications panel: focus management, Tab trap, click-outside, Esc, items as clickable buttons with navigation
- Toasts: correct `role="alert"` for errors, `role="status"` for info; `aria-live` region
- Skip-to-main-content link added to AppShell
- LcSelect: `role="combobox"` on trigger for `aria-activedescendant` support
- Keyboard nav, ARIA labels, focus management across all game pages and forms

### Race-condition guards (30+ fixes)
- Double-bet guards (`busyRef`/`rollingRef`/`spinningRef`) on all 7 games
- Double-cashout guard on Crash
- Unmount-during-async guards (`cancelledRef`) on all pages with async fetches
- Stale-state guards (`multiplierRef`, `gemsRevealed` param) on game cashouts
- Timer cleanup on unmount (toasts, Keno reveal animations, Crash rAF)

### CSS / responsive (15+ fixes)
- Sticky footer verified on short AND long pages
- `@media print` styles added for legal pages
- `@media (prefers-reduced-motion: reduce)` blocks across all animated components
- Touch targets ≥44px on mobile
- Footer breakpoint aligned with sidebar (768px → 900px)
- Z-index stacking documented with CSS variables
- No horizontal scroll on mobile (375×667)

### Other
- Supabase GoTrueClient singleton (prevents HMR multi-instance warnings)
- ProfileContext initial `profileLoading=true` (closes flash-of-wrong-redirect gap)
- Print styles, reduced-motion support, 44px touch targets
- Defensive array parsing (`asNumberArray`, `asCaseBattlePlayers`) replacing unsafe `as` casts
- `isSupabaseConfigured` guards on all lib functions that call Supabase RPCs
- Explicit return types on all exported lib functions
- `refreshProfile()` on all game error paths (balance no longer stale if server debited before failing)

Full audit trail: `worklog.md` (1,400+ lines, documents every agent's findings).

## Demo mode (Supabase unconfigured)

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing or set to
placeholders, the app runs in **demo / browse-only mode**:

- ✅ All 29 routes render with full UI (topbar, sidebar, footer, 3D home)
- ✅ All 7 game pages render with disabled "Log in to play" buttons
- ✅ Auth pages show "Supabase is not configured" banner + disabled submit
- ✅ Protected routes (Settings, Profile, Deposit, Withdraw, Admin, etc.)
     redirect to `/login?redirect=…` with the deep link preserved
- ❌ Real auth, wallet, bets, realtime — require real Supabase keys

## Routes (BrowserRouter — real URL paths)

| Route | Description |
|---|---|
| `/` | Home (3D hero) |
| `/login`, `/signup`, `/forgot-password` | Auth |
| `/settings`, `/profile`, `/profile/:username` | Account |
| `/deposit`, `/withdraw`, `/redeem`, `/free-entry` | Wallet |
| `/keno`, `/mines`, `/limbo`, `/roulette`, `/blackjack`, `/crash`, `/slots` | Games |
| `/case-battles`, `/case-battles/create`, `/case-battles/:battleId` | Case Battles |
| `/originals`, `/promotions`, `/leaderboard` | Content |
| `/help`, `/privacy`, `/sweepstakes` | Legal |
| `/admin` | Admin (gated by AdminRoute) |
| `/responsible-gaming` | → redirects to `/settings` |
| `*` | NotFound |

## Verification

- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 TypeScript errors
- ✅ `npm run build` — builds successfully, all 29 routes code-split cleanly
- ✅ Agent Browser tested all 29 routes — 0 page errors, 0 console errors
- ✅ Mobile responsive (375×667) — no horizontal scroll
- ✅ Sticky footer verified on short and long pages
- ✅ 3D context leak fixed (no "Context Lost" warnings on non-home pages)

## License

Proprietary — LottaCash. All rights reserved.
