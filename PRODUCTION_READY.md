# LottaCash — Production Ready Checklist

> Last updated with schema consolidation and guest-safety audit.

## Quick start (new environment)

```bash
# 1. Clone
git clone https://github.com/miniveeg/lottacashus.git
cd lottacashus
npm install

# 2. Configure environment
cp .env.example .env
#   → fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
#   → (leave placeholders to run in "guest / browse-only" mode)

# 3. Run the Supabase migrations (see supabase/schema.sql for the canonical path)
#   → Run supabase/lottacash-complete-setup.sql in Supabase SQL Editor (greenfield)
#   → Then apply migrations/002 … migrations/012 in order
#   → Deploy the Edge Functions in supabase/functions/
#   → NEVER run files from supabase/archive/

# 4. Start the dev server
npm run dev   # → http://localhost:5173

# 5. Production build
npm run build
npm run preview
```

## Critical deployment steps

See **DEPLOY.md** for the full production sequence. Summary:

1. **Schema** — follow `supabase/schema.sql` (canonical entrypoint).
2. **Edge secrets** — ALLOWED_ORIGINS, CRON_SECRET, SMTP_*, CRYPTO_MASTER_MNEMONIC, MAIN_*_WALLET.
3. **Cron** — schedule `poll-deposits`, `sweep-deposits`, `crash-settle-expired`.
4. **Frontend env** — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY only (never service_role).
5. **Never set** `VITE_AUDIT_BYPASS=1` in production.

## Repository layout (relevant paths)

```
├── src/
│   ├── pages/                    # Route-level pages (games, wallet, auth)
│   ├── components/               # Shared UI
│   ├── contexts/                 # Auth, Profile, PlayMode, …
│   ├── lib/
│   │   ├── assertCanPlay.ts      # realMoneyBetError() — guest guard for bets
│   │   ├── canPlay.ts            # useCanPlay() hook
│   │   └── games/__tests__/      # Vitest pure-engine unit tests
│   └── styles/
├── supabase/
│   ├── migrations/
│   │   └── 001…012               # Ordered migration chain
│   ├── functions/                # Edge Functions (Deno)
│   │   └── crash-settle-expired/ # cron endpoint
│   ├── schema.sql                    # Canonical entrypoint (read this first)
│   ├── lottacash-complete-setup.sql  # Bootstrap schema for greenfield projects
│   ├── archive/                      # Historical SQL only — do not run
│   └── config.toml               # Edge function config (verify_jwt settings)
├── scripts/                      # Sweep deposit + MANUAL_VERIFICATION.md
├── public/                       # Static assets
├── package.json
├── vite.config.ts
├── tsconfig.json
├── vercel.json                   # CSP + security headers + SPA rewrites
└── README.md
```

## Guest safety

Every real-money mutation must reject guests when Supabase is configured:

- `realMoneyBetError(user, isGuest)` in Crash, Keno, Limbo, Roulette, Blackjack, Mines
- `useCanPlay()` (Boolean(user) && !isGuest && !loading) in Slots and Case Battles
- `ProfileContext.updateUsername` rejects `isGuest || user.id === "guest"`
- Deposit / Withdraw / Settings / Profile routes redirect guests

## Tests

```bash
npm test          # 28 unit tests (crash / limbo / mines / rtp)
npm run test:watch
```

Manual integration checks: `scripts/MANUAL_VERIFICATION.md`.

## Production env hygiene

| Item | Rule |
|------|------|
| `VITE_AUDIT_BYPASS` | Must be unset / not `1` in production |
| Edge secrets | All required secrets present (see DEPLOY.md §2.2) |
| Crash settle cron | `crash-settle-expired` scheduled (every 1 min) |
| Deposit poll/sweep | Scheduled |

## Audit reports

The 6 detailed audit reports (3,969 lines total) are not included in this zip.
