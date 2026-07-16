# Deploy all production Edge Functions for LottaCash.
# Prerequisites: `npx supabase login` and `npx supabase link --project-ref <ref>`
# Usage (from repo root):
#   pwsh scripts/deploy-edge-functions.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$functions = @(
  "send-signup-code",
  "verify-signup-code",
  "send-password-reset-code",
  "reset-password-with-code",
  "link-discord",
  "get-deposit-address",
  "poll-deposits",
  "sweep-deposits",
  "place-keno-bet",
  "mines-game",
  "place-limbo-bet",
  "place-roulette-bet",
  "place-slots-bet",
  "place-crash-bet",
  "cash-out-crash",
  "crash-settle-expired",
  "blackjack-game",
  "case-battle-v2"
)

Write-Host "Deploying $($functions.Count) edge functions..." -ForegroundColor Cyan
foreach ($fn in $functions) {
  Write-Host "→ $fn" -ForegroundColor Yellow
  npx supabase functions deploy $fn
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to deploy $fn"
    exit 1
  }
}

Write-Host ""
Write-Host "Done. Do NOT deploy legacy case-battle (V1) — use case-battle-v2 only." -ForegroundColor Green
Write-Host "Set secrets: ALLOWED_ORIGINS, CRON_SECRET, CRYPTO_MASTER_MNEMONIC, SMTP_*, wallets." -ForegroundColor Green
