-- Migration 015 — restore service_role DML on game tables
-- Live: blackjack-game got "permission denied for table blackjack_hands"
-- because service_role ACL was stripped to Dxtm (no SELECT/INSERT/UPDATE).

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'blackjack_hands',
    'crash_bets',
    'mines_games',
    'keno_bets',
    'limbo_bets',
    'roulette_bets',
    'slots_spins',
    'slots_bets'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        t
      );
    end if;
  end loop;
end $$;

grant select on public.crash_bets_safe to authenticated;
grant execute on function public.crash_settle_expired_bets() to service_role;

notify pgrst, 'reload schema';

commit;
