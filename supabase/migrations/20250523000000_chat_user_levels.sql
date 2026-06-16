-- Expose wager totals for chat level badges (no balance or other profile fields).

create or replace function public.get_user_wager_levels(user_ids uuid[])
returns table(user_id uuid, total_wagered numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.total_wagered, 0)
  from public.profiles p
  where p.id = any(user_ids);
$$;

revoke all on function public.get_user_wager_levels(uuid[]) from public;
grant execute on function public.get_user_wager_levels(uuid[]) to authenticated;
