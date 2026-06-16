-- Fix: Edge Functions (service_role) need table access for poll/sweep

grant usage on schema public to service_role;

grant all on table public.user_deposit_addresses to service_role;
grant all on table public.crypto_deposits to service_role;
grant all on table public.crypto_withdrawals to service_role;

grant usage, select on sequence public.deposit_derivation_index_seq to service_role;

grant execute on function public.assign_deposit_derivation_index(uuid) to service_role;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;
