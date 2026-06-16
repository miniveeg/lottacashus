-- Username max 16 characters

alter table public.profiles
  drop constraint if exists profiles_username_max_length;

alter table public.profiles
  add constraint profiles_username_max_length
  check (username is null or char_length(username) <= 16);

update public.profiles
set username = left(username, 16)
where username is not null and char_length(username) > 16;
