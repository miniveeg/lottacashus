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

notify pgrst, 'reload schema';

commit;
