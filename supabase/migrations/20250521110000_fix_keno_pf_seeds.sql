-- Fix Keno seed RPCs: pgcrypto lives in extensions schema on Supabase

grant usage on schema extensions to service_role;
grant all on table public.game_pf_seeds to service_role;

create or replace function public.ensure_game_pf_seeds(p_user_id uuid)
returns public.game_pf_seeds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if found then
    return row;
  end if;

  new_seed := encode(gen_random_bytes(32), 'hex');
  insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
  values (
    p_user_id,
    new_seed,
    encode(digest(new_seed, 'sha256'), 'hex'),
    'default',
    0
  )
  returning * into row;

  return row;
end;
$$;

revoke all on function public.ensure_game_pf_seeds(uuid) from public;
grant execute on function public.ensure_game_pf_seeds(uuid) to service_role;

create or replace function public.get_keno_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  row public.game_pf_seeds;
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into row from public.game_pf_seeds where user_id = uid;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  return query
  select row.server_seed_hash, row.client_seed, row.next_nonce;
end;
$$;

grant execute on function public.get_keno_pf_state() to authenticated;

create or replace function public.set_keno_client_seed(p_client_seed text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_client_seed, ''))) = 0 then
    raise exception 'Client seed cannot be empty';
  end if;

  if length(p_client_seed) > 64 then
    raise exception 'Client seed too long (max 64 characters)';
  end if;

  if not exists (select 1 from public.game_pf_seeds where user_id = uid) then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      trim(p_client_seed),
      0
    );
    return;
  end if;

  update public.game_pf_seeds
  set client_seed = trim(p_client_seed), updated_at = now()
  where user_id = uid;
end;
$$;

grant execute on function public.set_keno_client_seed(text) to authenticated;

create or replace function public.consume_keno_nonce(p_user_id uuid)
returns table (
  server_seed text,
  client_seed text,
  nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      p_user_id,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  return query
  select row.server_seed, row.client_seed, row.next_nonce;
end;
$$;

revoke all on function public.consume_keno_nonce(uuid) from public;
grant execute on function public.consume_keno_nonce(uuid) to service_role;
