#!/usr/bin/env bash
# Deploy all production Edge Functions for LottaCash.
# Prerequisites: `npx supabase login` and `npx supabase link --project-ref <ref>`
# Usage (from repo root):
#   bash scripts/deploy-edge-functions.sh

set -euo pipefail
cd "$(dirname "$0")/.."

FUNCTIONS=(
  send-signup-code
  verify-signup-code
  send-password-reset-code
  reset-password-with-code
  link-discord
  get-deposit-address
  poll-deposits
  sweep-deposits
  place-keno-bet
  mines-game
  place-limbo-bet
  place-roulette-bet
  place-slots-bet
  place-crash-bet
  cash-out-crash
  crash-settle-expired
  blackjack-game
  case-battle-v2
)

echo "Deploying ${#FUNCTIONS[@]} edge functions..."
for fn in "${FUNCTIONS[@]}"; do
  echo "→ $fn"
  npx supabase functions deploy "$fn"
done

echo ""
echo "Done. Do NOT deploy legacy case-battle (V1) — use case-battle-v2 only."
echo "Set secrets: ALLOWED_ORIGINS, CRON_SECRET, CRYPTO_MASTER_MNEMONIC, SMTP_*, wallets."
