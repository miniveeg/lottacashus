#!/usr/bin/env bash
# Deploy all production Edge Functions for LottaCash.
# Prerequisites: `npx supabase login` and `npx supabase link --project-ref <ref>`
# Usage (from repo root):
#   bash scripts/deploy-edge-functions.sh
#   bash scripts/deploy-edge-functions.sh case-battle-v2

set -euo pipefail
cd "$(dirname "$0")/.."

ALL_FUNCTIONS=(
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
  crash-settle-loop
  blackjack-game
  case-battle-v2
)

# Optional: bash scripts/deploy-edge-functions.sh case-battle-v2 place-limbo-bet
if [[ $# -gt 0 ]]; then
  FUNCTIONS=("$@")
else
  FUNCTIONS=("${ALL_FUNCTIONS[@]}")
fi

echo "Deploying ${#FUNCTIONS[@]} edge functions..."
for fn in "${FUNCTIONS[@]}"; do
  echo "→ $fn"
  if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
    npx supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF"
  else
    npx supabase functions deploy "$fn"
  fi
done

echo ""
echo "Done. Do NOT deploy legacy case-battle (V1) — quarantine/delete V1; UI uses case-battle-v2 only (verify_jwt=true). Require crash-settle-loop + migration 016."
echo "Set secrets: ALLOWED_ORIGINS, CRON_SECRET, CRYPTO_MASTER_MNEMONIC, SMTP_*, wallets."
