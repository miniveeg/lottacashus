-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 014 — public leaderboard RPCs + crash_bets_safe invoker fix
--
-- Leaderboard: profiles + transactions are RLS-locked to the current user, so
-- the client query of those tables always looks empty despite real wager
-- volume. Security-definer RPCs return only public rank stats (username +
-- amount / wagered / win rate). No balances, ids, or emails.
--
-- Crash: crash_bets SELECT is revoked from authenticated. On Postgres 15+
-- views default to security_invoker, so crash_bets_safe silently returns
-- zero rows and the client chart never learns the server already crashed.
-- Recreate the view as invoker=false, filtered to auth.uid().
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ─── crash_bets_safe: owner view so the client can poll own settled bets ───
drop view if exists public.crash_bets_safe;
create view public.crash_bets_safe
  with (security_barrier = true, security_invoker = false)
as
  select
    id, user_id, wager, coin_type, nonce, won, payout, cashed_at,
    case when completed_at is not null then crash_point else null end as crash_point,
    created_at, completed_at
  from public.crash_bets
  where user_id = auth.uid();

grant select on public.crash_bets_safe to authenticated;
revoke select on public.crash_bets from authenticated;

-- ─── Biggest single wins (public usernames only) ───────────────────────────
create or replace function public.get_leaderboard_wins(p_limit int default 50)
returns table (
  rank int,
  username text,
  value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (row_number() over (order by t.amount desc, t.created_at desc))::int as rank,
    coalesce(nullif(p.username, ''), 'Player') as username,
    t.amount as value
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  where t.type = 'win'
    and t.amount > 0
    and p.username is not null
    and p.username <> ''
  order by t.amount desc, t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.get_leaderboard_wins(int) from public;
grant execute on function public.get_leaderboard_wins(int) to anon, authenticated;

-- ─── Most wagered (public usernames only) ──────────────────────────────────
create or replace function public.get_leaderboard_wagered(p_limit int default 50)
returns table (
  rank int,
  username text,
  value numeric,
  secondary numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (row_number() over (order by coalesce(p.total_wagered, 0) desc, p.created_at asc))::int as rank,
    coalesce(nullif(p.username, ''), 'Player') as username,
    coalesce(p.total_wagered, 0) as value,
    case
      when coalesce(p.total_wins, 0) + coalesce(p.total_losses, 0) > 0
        then round(
          (coalesce(p.total_wins, 0)::numeric
            / (coalesce(p.total_wins, 0) + coalesce(p.total_losses, 0))) * 100,
          1
        )
      else 0
    end as secondary
  from public.profiles p
  where coalesce(p.total_wagered, 0) > 0
    and p.username is not null
    and p.username <> ''
  order by coalesce(p.total_wagered, 0) desc, p.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.get_leaderboard_wagered(int) from public;
grant execute on function public.get_leaderboard_wagered(int) to anon, authenticated;


-- ─── case_battles_safe: owner view so lobby is not empty on PG15+ ──────────
-- Authenticated SELECT is revoked on case_battles; PG15+ views default to
-- security_invoker, so the safe view silently returns zero rows.
drop view if exists public.case_battles_safe;
create view public.case_battles_safe
  with (security_barrier = true, security_invoker = false)
as
  select
    id, creator_id, gamemode, crazy, player_mode, max_players, case_ids,
    rounds, entry_cost, coin_type, borrow_percent, pot_total, status,
    seed_hash,
    eos_block_target,
    case when status = 'completed' then eos_block_id else null end as eos_block_id,
    case when status = 'completed' then battle_seed else null end as battle_seed,
    created_at, started_at, completed_at
  from public.case_battles;

grant select on public.case_battles_safe to authenticated, anon;
revoke select on public.case_battles from authenticated;

-- ─── Ensure public.cb_add_bot(uuid, text, int) exists ──────────────────────
do $$
declare v_rec record;
begin
  for v_rec in
    select pg_get_function_identity_arguments(p.oid) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'cb_add_bot'
  loop
    execute 'drop function if exists public.cb_add_bot(' || v_rec.sig || ') cascade';
  end loop;
end $$;

create or replace function public.cb_add_bot(
  p_battle_id     uuid,
  p_bot_name      text    default null,
  p_slot_index    int     default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle  public.case_battles%rowtype;
  v_max     int;
  v_count   int;
  v_target  int;
  v_uid     uuid := auth.uid();
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then
    raise exception 'Battle not found';
  end if;
  if v_battle.creator_id <> v_uid then
    raise exception 'Only the creator can add bots';
  end if;
  if v_battle.status <> 'waiting' then
    raise exception 'Battle already started';
  end if;

  v_max := v_battle.max_players;
  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_max then
    raise exception 'Battle is full';
  end if;

  v_target := -1;
  if p_slot_index is not null and p_slot_index >= 0 and p_slot_index < v_max then
    if not exists (
      select 1 from public.case_battle_players
      where battle_id = p_battle_id and slot = p_slot_index
    ) then
      v_target := p_slot_index;
    end if;
  end if;
  if v_target = -1 then
    for i in 0..(v_max - 1) loop
      if not exists (
        select 1 from public.case_battle_players
        where battle_id = p_battle_id and slot = i
      ) then
        v_target := i;
        exit;
      end if;
    end loop;
  end if;
  if v_target < 0 then
    raise exception 'No empty slots';
  end if;

  v_name := coalesce(
    p_bot_name,
    'Bot_' || (array['CryptoKing','LuckyAce','RollDeep','HighRoller','TheWhale','JackpotJoe','AllIn','SpinMaster'])[v_target + 1]
  );

  insert into public.case_battle_players (battle_id, slot, is_bot, username, avatar_seed)
  values (p_battle_id, v_target, true, v_name, 'bot-' || v_target);
end;
$$;

revoke all on function public.cb_add_bot(uuid, text, int) from public;
grant execute on function public.cb_add_bot(uuid, text, int) to authenticated;

drop trigger if exists case_battle_players_bot_pot_t on public.case_battle_players;
drop function if exists public.cb_add_bot_adjust_pot() cascade;

create or replace function public.cb_add_bot_adjust_pot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry numeric;
begin
  select entry_cost into v_entry from public.case_battles where id = new.battle_id;
  if v_entry is null then
    return new;
  end if;
  update public.case_battles
    set pot_total = round(pot_total + v_entry, 2)
    where id = new.battle_id;
  return new;
end;
$$;

create trigger case_battle_players_bot_pot_t
  after insert on public.case_battle_players
  for each row
  when (new.is_bot = true)
  execute function public.cb_add_bot_adjust_pot();



notify pgrst, 'reload schema';

commit;
