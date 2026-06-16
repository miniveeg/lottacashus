-- Referral codes: store and match as uppercase (input case-insensitive).

create or replace function public.normalize_affiliate_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Existing codes → uppercase
update public.profiles
set affiliate_code = public.normalize_affiliate_code(affiliate_code)
where affiliate_code is not null
  and affiliate_code <> ''
  and affiliate_code <> public.normalize_affiliate_code(affiliate_code);

create or replace function public.generate_unique_affiliate_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  i int;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.profiles p where p.affiliate_code = code
    );
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'Could not generate affiliate code';
    end if;
  end loop;
  return code;
end;
$$;

create or replace function public.ensure_user_affiliate_code(p_user_id uuid default auth.uid())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.normalize_affiliate_code(p.affiliate_code) into code
  from public.profiles p
  where p.id = p_user_id;

  if code is not null and code <> '' then
    if code <> (select affiliate_code from public.profiles where id = p_user_id) then
      update public.profiles
      set affiliate_code = code, updated_at = now()
      where id = p_user_id;
    end if;
    return code;
  end if;

  code := public.generate_unique_affiliate_code();

  update public.profiles
  set affiliate_code = code, updated_at = now()
  where id = p_user_id and (affiliate_code is null or affiliate_code = '');

  return code;
end;
$$;

create or replace function public.apply_affiliate_referral(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  normalized text;
begin
  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return;
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> p_user_id;

  if aff_id is null then
    return;
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = p_user_id
    and referred_by is null;
end;
$$;

create or replace function public.submit_affiliate_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  normalized text;
  aff_id uuid;
  current_referred_by uuid;
  my_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return jsonb_build_object('success', false, 'error', 'Enter a valid referral code.');
  end if;

  select p.referred_by, public.normalize_affiliate_code(p.affiliate_code)
  into current_referred_by, my_code
  from public.profiles p
  where p.id = uid;

  if current_referred_by is not null then
    return jsonb_build_object('success', false, 'error', 'You already have a referral code on your account.');
  end if;

  if my_code is not null and my_code = normalized then
    return jsonb_build_object('success', false, 'error', 'You cannot use your own referral code.');
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> uid;

  if aff_id is null then
    return jsonb_build_object('success', false, 'error', 'That referral code was not found.');
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = uid
    and referred_by is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Could not apply referral code. Try again.');
  end if;

  return jsonb_build_object(
    'success', true,
    'referrer_code', normalized
  );
end;
$$;
