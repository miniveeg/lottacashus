-- Let logged-in users apply a referral code once (Promotions page).

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

revoke all on function public.submit_affiliate_referral_code(text) from public;
grant execute on function public.submit_affiliate_referral_code(text) to authenticated;

create or replace function public.get_affiliate_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  code := public.ensure_user_affiliate_code(uid);

  select jsonb_build_object(
    'affiliate_code', code,
    'has_referrer', (
      select p.referred_by is not null
      from public.profiles p
      where p.id = uid
    ),
    'referrer_code', (
      select r.affiliate_code
      from public.profiles p
      join public.profiles r on r.id = p.referred_by
      where p.id = uid
    ),
    'referred_count', (
      select count(*)::int
      from public.profiles p
      where p.referred_by = uid
    ),
    'claimable_balance', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is null
    ), 0),
    'total_claimed', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is not null
    ), 0),
    'total_earned', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid
    ), 0),
    'earned_from_deposits', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'deposit' and c.claimed_at is null
    ), 0),
    'earned_from_wagers', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'wager' and c.claimed_at is null
    ), 0),
    'recent_commissions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          c.id,
          c.kind,
          c.base_amount,
          c.commission_amount,
          c.created_at
        from public.affiliate_commissions c
        where c.affiliate_id = uid and c.claimed_at is null
        order by c.created_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;
