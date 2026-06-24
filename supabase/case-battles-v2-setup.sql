-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Case Battles v2 (full rebuild)
-- Replaces the original case_battles tables. Drop the old ones first.
-- ══════════════════════════════════════════════════════════════════════════════

-- Drop old tables + functions (cascade handles dependencies)
drop table if exists public.case_battle_drops cascade;
drop table if exists public.case_battle_players cascade;
drop table if exists public.case_battles cascade;
drop function if exists public.cb_create_battle() cascade;
drop function if exists public.cb_join_battle() cascade;
drop function if exists public.cb_add_bot() cascade;
drop function if exists public.cb_leave_battle() cascade;
drop function if exists public.cb_claim_payout() cascade;

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table public.case_battles (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references auth.users(id) on delete cascade,

  -- Configuration (immutable after creation)
  gamemode        text not null check (gamemode in ('standard','group','terminal','jackpot')),
  crazy           boolean not null default false, -- toggle: flips standard/terminal/jackpot logic. Not allowed with group.
  player_mode     text not null,                  -- '1v1','1v1v1','1v1v1v1','2v2','2v2v2','3v3','2p','3p','4p'
  max_players     int not null check (max_players between 2 and 6),
  case_ids        text[] not null,               -- ordered list of case IDs (one per round)
  rounds          int not null check (rounds between 1 and 50),
  entry_cost      numeric(12,2) not null,
  coin_type       text not null default 'balance' check (coin_type in ('balance','sweeps_coins')),
  borrow_percent  int not null default 0 check (borrow_percent between 0 and 80),

  -- Live state
  pot_total       numeric(12,2) not null default 0,
  status          text not null default 'waiting'
                  check (status in ('waiting','committing','running','completed','cancelled')),

  -- Provably fair (EOS commitment)
  internal_seed      text,                       -- generated on start, revealed on completion
  seed_hash          text,                       -- SHA-256(internal_seed) — shown before start
  eos_block_target   bigint,                     -- target block height = head + 2
  eos_block_id       text,                       -- actual block ID when mined
  battle_seed        text,                       -- SHA-256(internal_seed:eos_block_id)

  -- Metadata
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz
);

create index case_battles_status_idx on public.case_battles (status, created_at desc);
create index case_battles_creator_idx on public.case_battles (creator_id);

create table public.case_battle_players (
  id          uuid primary key default gen_random_uuid(),
  battle_id   uuid not null references public.case_battles(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,  -- null for bots
  slot        int not null check (slot between 0 and 5),
  is_bot      boolean not null default false,
  username    text not null,
  avatar_seed text,                               -- for bot avatar generation
  joined_at   timestamptz not null default now(),
  unique(battle_id, slot)
);

create index case_battle_players_battle_idx on public.case_battle_players (battle_id);

create table public.case_battle_drops (
  id          uuid primary key default gen_random_uuid(),
  battle_id   uuid not null references public.case_battles(id) on delete cascade,
  slot        int not null,
  round       int not null,                       -- 0-based round index
  case_id     text not null,
  item_id     text not null,
  item_name   text not null,
  item_value  numeric(12,2) not null,
  item_rarity text not null,
  created_at  timestamptz not null default now(),
  unique(battle_id, slot, round)
);

create index case_battle_drops_battle_idx on public.case_battle_drops (battle_id, round);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.case_battles enable row level security;
alter table public.case_battle_players enable row level security;
alter table public.case_battle_drops enable row level security;

-- Battles: anyone can read (lobby), only creator can insert
create policy "Anyone can read case battles" on public.case_battles for select using (true);
create policy "Creator creates battle" on public.case_battles for insert with check (auth.uid() = creator_id);
create policy "Anyone can read battle players" on public.case_battle_players for select using (true);
create policy "Anyone can read battle drops" on public.case_battle_drops for select using (true);

-- ─── Grants ──────────────────────────────────────────────────────────────────

grant select on public.case_battles to authenticated;
grant select on public.case_battle_players to authenticated;
grant select on public.case_battle_drops to authenticated;
grant all on public.case_battles to service_role;
grant all on public.case_battle_players to service_role;
grant all on public.case_battle_drops to service_role;

-- Realtime: add tables to the publication so the frontend can subscribe
alter publication supabase_realtime add table public.case_battles;
alter publication supabase_realtime add table public.case_battle_players;
alter publication supabase_realtime add table public.case_battle_drops;

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- cb_create_battle: creates a battle + joins the creator as slot 0
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if v_rounds is null or v_rounds < 1 or v_rounds > 50 then
    raise exception 'Must select 1–50 cases';
  end if;
  -- Crazy toggle is not allowed with group gamemode
  if p_gamemode = 'group' and p_crazy then
    raise exception 'Crazy mode is not available for Group battles';
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
    p_case_ids, v_rounds, p_entry_cost, coalesce(p_coin_type, 'balance'), p_borrow_percent, p_entry_cost)
  returning id into v_id;

  insert into public.case_battle_players (battle_id, user_id, slot, username)
  values (v_id, v_uid, 0, v_username);

  return v_id;
end;
$$;
revoke all on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) from public;
grant execute on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) to authenticated;

-- cb_join_battle: joins an open battle as the next available slot
create or replace function public.cb_join_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.case_battles%rowtype;
  v_count int;
  v_slot int;
  v_uid uuid := auth.uid();
  v_username text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'waiting' then raise exception 'Battle is not open'; end if;

  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_battle.max_players then raise exception 'Battle is full'; end if;

  -- Already joined?
  if exists (select 1 from public.case_battle_players where battle_id = p_battle_id and user_id = v_uid) then
    return;
  end if;

  select max(slot) into v_slot from public.case_battle_players where battle_id = p_battle_id;
  v_slot := coalesce(v_slot, -1) + 1;

  select username into v_username from public.profiles where id = v_uid;
  if v_username is null then v_username := 'Player'; end if;

  insert into public.case_battle_players (battle_id, user_id, slot, username)
  values (p_battle_id, v_uid, v_slot, v_username);

  update public.case_battles set pot_total = pot_total + v_battle.entry_cost where id = p_battle_id;
end;
$$;
revoke all on function public.cb_join_battle(uuid) from public;
grant execute on function public.cb_join_battle(uuid) to authenticated;

-- cb_add_bot: adds a bot to fill a slot (called by creator or auto-fill)
create or replace function public.cb_add_bot(p_battle_id uuid, p_bot_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.case_battles%rowtype;
  v_count int;
  v_slot int;
  v_name text;
  v_names text[] := ARRAY['CryptoKing','LuckyAce','ShadowFox','NeonViper','GhostByte','TurboTap','BlazeWolf','PixelPunk'];
begin
  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'waiting' then raise exception 'Battle is not open'; end if;

  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_battle.max_players then raise exception 'Battle is full'; end if;

  select max(slot) into v_slot from public.case_battle_players where battle_id = p_battle_id;
  v_slot := coalesce(v_slot, -1) + 1;
  v_name := coalesce(p_bot_name, v_names[(v_slot % array_length(v_names,1)) + 1]);

  insert into public.case_battle_players (battle_id, slot, is_bot, username, avatar_seed)
  values (p_battle_id, v_slot, true, v_name, md5(v_name || p_battle_id::text));

  update public.case_battles set pot_total = pot_total + v_battle.entry_cost where id = p_battle_id;
end;
$$;
revoke all on function public.cb_add_bot(uuid,text) from public;
grant execute on function public.cb_add_bot(uuid,text) to authenticated;

-- cb_leave_battle: creator can cancel; players can leave a waiting battle
create or replace function public.cb_leave_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_players int;
begin
  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then return; end if;
  if v_battle.status != 'waiting' then raise exception 'Cannot leave a started battle'; end if;

  delete from public.case_battle_players where battle_id = p_battle_id and user_id = v_uid;
  update public.case_battles set pot_total = pot_total - v_battle.entry_cost where id = p_battle_id;

  -- If the creator leaves, cancel the battle
  select count(*) into v_players from public.case_battle_players where battle_id = p_battle_id;
  if v_players = 0 or v_battle.creator_id = v_uid then
    update public.case_battles set status = 'cancelled' where id = p_battle_id;
  end if;
end;
$$;
revoke all on function public.cb_leave_battle(uuid) from public;
grant execute on function public.cb_leave_battle(uuid) to authenticated;

-- cb_claim_payout: credits the winner's balance
create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int,
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_player public.case_battle_players%rowtype;
  v_balance numeric;
begin
  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'completed' then raise exception 'Battle not completed'; end if;

  select * into v_player from public.case_battle_players where battle_id = p_battle_id and slot = p_slot;
  if not found then raise exception 'Player not found'; end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;

  select balance into v_balance from public.profiles where id = v_uid for update;
  v_balance := v_balance + p_amount;
  update public.profiles set balance = v_balance, total_wins = total_wins + p_amount, updated_at = now() where id = v_uid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (v_uid, 'win', p_amount, v_balance, 'Case Battle payout', now());

  return v_balance;
end;
$$;
revoke all on function public.cb_claim_payout(uuid,int,numeric) from public;
grant execute on function public.cb_claim_payout(uuid,int,numeric) to authenticated;
