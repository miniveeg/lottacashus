-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Add transactions.balance_after (live schema drift fix)
-- Live public.transactions lacked balance_after while cb_claim_payout and other
-- game RPCs insert it → claim 400 / claimed_at stayed null. Additive only.
-- ══════════════════════════════════════════════════════════════════════════════

alter table public.transactions
  add column if not exists balance_after numeric(12, 2);

comment on column public.transactions.balance_after is
  'Wallet balance after this ledger row (optional; written by game/claim RPCs).';

notify pgrst, 'reload schema';
