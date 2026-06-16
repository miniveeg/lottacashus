-- Discord link: ensure columns + service_role access + RPC for Edge Function

alter table public.profiles
  add column if not exists discord_id text unique,
  add column if not exists discord_username text,
  add column if not exists discord_avatar text,
  add column if not exists discord_linked_at timestamptz;

grant all on table public.profiles to service_role;

create or replace function public.link_discord_profile(
  p_user_id uuid,
  p_discord_id text,
  p_discord_username text,
  p_discord_avatar text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, balance)
  values (p_user_id, 0)
  on conflict (id) do nothing;

  update public.profiles
  set
    discord_id = p_discord_id,
    discord_username = p_discord_username,
    discord_avatar = p_discord_avatar,
    discord_linked_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile row missing for user %', p_user_id;
  end if;
end;
$$;

revoke all on function public.link_discord_profile(uuid, text, text, text) from public;
grant execute on function public.link_discord_profile(uuid, text, text, text) to service_role;
