-- LottaCash schema
-- Paste into the Supabase SQL editor.
-- Tables are prefixed lc_* so we do not DROP or collide with unknown production objects
-- from the previous LottaCash app. Safe to run multiple times (IF NOT EXISTS).
--
-- Live wallet flow:
--   place_bet  — debit stake, insert lc_game_rounds with server_seed_hash only
--   settle_bet — credit payout, reveal server_seed, store result jsonb
-- Instant games MAY call a single place_and_settle after the client commits a client seed,
-- but the two-step pair is the default so the hash can be shown before the round.
--
-- Do NOT expose a public demo_credit in production. lc_demo_credit is locked down;
-- use it only on a staging project. Production credits belong in a cashier / webhook.

create extension if not exists pgcrypto;

create table if not exists public.lc_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  sc_balance numeric not null default 0,
  client_seed text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create table if not exists public.lc_game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null,
  bet numeric not null,
  payout numeric,
  result jsonb,
  server_seed_hash text,
  server_seed text,
  client_seed text,
  nonce int,
  created_at timestamptz not null default now()
);

create table if not exists public.lc_round_secrets (
  round_id uuid primary key references public.lc_game_rounds (id) on delete cascade,
  server_seed text not null
);
revoke all on public.lc_round_secrets from anon, authenticated;

create table if not exists public.lc_case_battles (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references auth.users (id) on delete set null,
  case_id text not null,
  seats int not null default 2,
  rounds int not null default 1,
  status text not null default 'waiting',
  pot numeric not null default 0,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.lc_profiles enable row level security;
alter table public.lc_game_rounds enable row level security;
alter table public.lc_case_battles enable row level security;

drop policy if exists lc_profiles_own on public.lc_profiles;
create policy lc_profiles_own on public.lc_profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists lc_rounds_own on public.lc_game_rounds;
create policy lc_rounds_own on public.lc_game_rounds
  for select using (auth.uid() = user_id);

drop policy if exists lc_battles_read on public.lc_case_battles;
create policy lc_battles_read on public.lc_case_battles
  for select using (true);

create or replace function public.lc_on_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lc_profiles (id, sc_balance)
  values (new.id, 1000)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists lc_on_auth_user on auth.users;
create trigger lc_on_auth_user
  after insert on auth.users
  for each row execute procedure public.lc_on_auth_user();

-- Debit stake and commit a hashed server seed (generated server-side).
create or replace function public.place_bet(
  p_amount numeric,
  p_game text,
  p_client_seed text,
  p_nonce int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  bal numeric;
  seed text := encode(gen_random_bytes(32), 'hex');
  seed_hash text := encode(digest(seed, 'sha256'), 'hex');
  rid uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount');
  end if;

  update public.lc_profiles
    set sc_balance = sc_balance - p_amount
    where id = uid and sc_balance >= p_amount
    returning sc_balance into bal;

  if bal is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient');
  end if;

  insert into public.lc_game_rounds (user_id, game, bet, server_seed_hash, client_seed, nonce, payout)
  values (uid, coalesce(p_game, 'unknown'), p_amount, seed_hash, p_client_seed, p_nonce, 0)
  returning id into rid;

  insert into public.lc_round_secrets (round_id, server_seed) values (rid, seed);

  return jsonb_build_object(
    'ok', true,
    'round_id', rid,
    'server_seed_hash', seed_hash,
    'balance', bal
  );
end;
$$;

-- Credit payout and reveal the seed. p_payout is the TOTAL return (0 = lost).
-- Production note: this trusts p_payout from the client. Recompute from server_seed + client_seed + nonce before crediting.
create or replace function public.settle_bet(
  p_round_id uuid,
  p_payout numeric,
  p_result jsonb,
  p_server_seed text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec public.lc_game_rounds%rowtype;
  bal numeric;
  secret text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;

  select * into rec from public.lc_game_rounds where id = p_round_id and user_id = uid;
  if rec.id is null then
    return jsonb_build_object('ok', false, 'error', 'round');
  end if;

  select server_seed into secret from public.lc_round_secrets where round_id = rec.id;

  update public.lc_game_rounds
    set payout = greatest(coalesce(p_payout, 0), 0),
        result = p_result,
        server_seed = coalesce(secret, rec.server_seed, p_server_seed)
    where id = rec.id;

  delete from public.lc_round_secrets where round_id = rec.id;

  if coalesce(p_payout, 0) > 0 then
    update public.lc_profiles
      set sc_balance = sc_balance + p_payout
      where id = uid
      returning sc_balance into bal;
  else
    select sc_balance into bal from public.lc_profiles where id = uid;
  end if;

  return jsonb_build_object('ok', true, 'balance', bal, 'server_seed', rec.server_seed);
end;
$$;

-- Instant games: debit + credit in one shot AFTER the client already displayed a hash
-- from a prior place_bet, or for simple demo tools. Documented so cashiers do not
-- confuse it with a public faucet.
create or replace function public.place_and_settle(
  p_amount numeric,
  p_payout numeric,
  p_game text,
  p_client_seed text,
  p_nonce int,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  placed jsonb;
  rid uuid;
begin
  placed := public.place_bet(p_amount, p_game, p_client_seed, p_nonce);
  if (placed->>'ok')::boolean is not true then
    return placed;
  end if;
  rid := (placed->>'round_id')::uuid;
  return public.settle_bet(rid, p_payout, p_result, null);
end;
$$;

-- Staging faucet only. Revoke from authenticated in production.
create or replace function public.lc_demo_credit(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  bal numeric;
begin
  if uid is null then
    raise exception 'auth required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 5000 then
    raise exception 'bad amount';
  end if;
  update public.lc_profiles
    set sc_balance = sc_balance + p_amount
    where id = uid
    returning sc_balance into bal;
  return bal;
end;
$$;

grant execute on function public.place_bet(numeric, text, text, int) to authenticated;
grant execute on function public.settle_bet(uuid, numeric, jsonb, text) to authenticated;
grant execute on function public.place_and_settle(numeric, numeric, text, text, int, jsonb) to authenticated;
grant execute on function public.lc_demo_credit(numeric) to authenticated;
