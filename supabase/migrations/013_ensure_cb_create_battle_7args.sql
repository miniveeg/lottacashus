-- ══════════════════════════════════════════════════════════════════════════════
-- Case Battles — force 7-arg cb_create_battle (PostgREST schema cache)
--
-- Live error:
--   Could not find the function public.cb_create_battle(p_borrow_percent,
--   p_case_ids, p_coin_type, p_crazy, p_entry_cost, p_gamemode, p_player_mode)
--   in the schema cache
--
-- The V2 client (caseBattlesApi.ts) calls exactly those named args.
-- p_borrow_percent MUST be int. Drop every overload, recreate the 001
-- signature, and ping PostgREST to reload the cache.
-- Idempotent. Does not invent a new game.
-- ══════════════════════════════════════════════════════════════════════════════

do $$
declare v_rec record;
begin
  for v_rec in
    select pg_get_function_identity_arguments(p.oid) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'cb_create_battle'
  loop
    execute 'drop function if exists public.cb_create_battle(' || v_rec.sig || ') cascade';
  end loop;
end $$;

create or replace function public.cb_create_battle(
  p_gamemode text,
  p_crazy boolean,
  p_player_mode text,
  p_case_ids text[],
  p_entry_cost numeric,
  p_coin_type text,
  p_borrow_percent int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rounds int := array_length(p_case_ids, 1);
  v_uid uuid := auth.uid();
  v_username text;
  v_coin text := coalesce(p_coin_type, 'balance');
  v_charge numeric;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Input validation (CRITICAL: previously negative entry_cost → infinite money).
  if p_entry_cost is null or p_entry_cost < 0 then
    raise exception 'Entry cost must be non-negative';
  end if;
  if p_entry_cost > 100000 then
    raise exception 'Entry cost exceeds maximum (100,000)';
  end if;
  if p_borrow_percent is null or p_borrow_percent < 0 or p_borrow_percent > 80 then
    raise exception 'Borrow percent must be between 0 and 80';
  end if;
  if p_gamemode not in ('standard','group','terminal','jackpot') then
    raise exception 'Invalid gamemode';
  end if;
  if p_player_mode not in ('1v1','1v1v1','1v1v1v1','2v2','2v2v2','3v3','2p','3p','4p') then
    raise exception 'Invalid player mode';
  end if;
  if v_rounds is null or v_rounds < 1 or v_rounds > 50 then
    raise exception 'Must select 1–50 cases';
  end if;
  if p_gamemode = 'group' and p_crazy then
    raise exception 'Crazy mode is not available for Group battles';
  end if;
  if v_coin not in ('balance','sweeps_coins') then
    raise exception 'Invalid coin type';
  end if;

  v_charge := round(p_entry_cost * (100 - p_borrow_percent) / 100.0, 2);

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null then raise exception 'Profile not found'; end if;
    if v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set sweeps_coins = sweeps_coins - v_charge, updated_at = now() where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null then raise exception 'Profile not found'; end if;
    if v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set balance = balance - v_charge, updated_at = now() where id = v_uid;
  end if;

  select username into v_username from public.profiles where id = v_uid;
  if v_username is null then v_username := 'Player'; end if;

  insert into public.case_battles (creator_id, gamemode, crazy, player_mode, max_players, case_ids, rounds, entry_cost, coin_type, borrow_percent, pot_total)
  values (v_uid, p_gamemode, p_crazy, p_player_mode,
    case p_player_mode
      when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4
      when '2v2' then 4 when '2v2v2' then 6 when '3v3' then 6
      when '2p' then 2 when '3p' then 3 when '4p' then 4
      else 2 end,
    p_case_ids, v_rounds, p_entry_cost, v_coin, p_borrow_percent, v_charge)
  returning id into v_id;

  insert into public.case_battle_players (battle_id, user_id, slot, username)
  values (v_id, v_uid, 0, v_username);

  return v_id;
end;
$$;
revoke all on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) from public;
grant execute on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) to authenticated;

do $$
begin
  begin
    perform pg_notify('pgrst', 'reload schema');
  exception when insufficient_privilege then
    raise notice 'Could not pg_notify (insufficient privilege). PostgREST cache will refresh automatically within ~30s.';
  end;
end $$;
