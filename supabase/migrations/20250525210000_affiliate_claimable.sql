-- Affiliate earnings accrue as unclaimed; user claims on Promotions page.

alter table public.affiliate_commissions
  add column if not exists claimed_at timestamptz;

-- Already auto-credited before this change: mark claimed so balance is not claimable twice.
update public.affiliate_commissions c
set claimed_at = c.created_at
where c.claimed_at is null
  and exists (
    select 1
    from public.transactions t
    where t.user_id = c.affiliate_id
      and t.type = 'affiliate'
      and t.amount = c.commission_amount
      and t.created_at >= c.created_at - interval '2 seconds'
      and t.created_at <= c.created_at + interval '2 seconds'
  );

create or replace function public.trg_affiliate_commission_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  rate numeric;
  commission numeric(12, 2);
  base_amt numeric(12, 2);
begin
  if NEW.type = 'deposit' then
    base_amt := NEW.amount;
    rate := 0.05;
  elsif NEW.type = 'wager' then
    base_amt := abs(NEW.amount);
    rate := 0.01;
  else
    return NEW;
  end if;

  if base_amt <= 0 then
    return NEW;
  end if;

  select p.referred_by into aff_id
  from public.profiles p
  where p.id = NEW.user_id;

  if aff_id is null then
    return NEW;
  end if;

  commission := round(base_amt * rate, 2);
  if commission <= 0 then
    return NEW;
  end if;

  if exists (
    select 1
    from public.affiliate_commissions c
    where c.source_transaction_id = NEW.id
  ) then
    return NEW;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    referred_user_id,
    kind,
    base_amount,
    commission_amount,
    source_transaction_id
  )
  values (
    aff_id,
    NEW.user_id,
    case when NEW.type = 'deposit' then 'deposit' else 'wager' end,
    base_amt,
    commission,
    NEW.id
  );

  return NEW;
end;
$$;

create or replace function public.claim_affiliate_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim_amt numeric(12, 2);
  new_bal numeric(12, 2);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(sum(c.commission_amount), 0)::numeric(12, 2)
  into claim_amt
  from public.affiliate_commissions c
  where c.affiliate_id = uid
    and c.claimed_at is null;

  if claim_amt <= 0 then
    select p.balance into new_bal from public.profiles p where p.id = uid;
    return jsonb_build_object('claimed_amount', 0, 'claimable_balance', 0, 'balance', coalesce(new_bal, 0));
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into new_bal
  from public.profiles p
  where p.id = uid
  for update;

  new_bal := coalesce(new_bal, 0) + claim_amt;

  update public.profiles p
  set balance = new_bal, updated_at = now()
  where p.id = uid;

  update public.affiliate_commissions c
  set claimed_at = now()
  where c.affiliate_id = uid
    and c.claimed_at is null;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (uid, 'affiliate', claim_amt, new_bal, 'Affiliate earnings claimed');

  select p.balance into new_bal from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'claimed_amount', claim_amt,
    'claimable_balance', 0,
    'balance', coalesce(new_bal, 0)
  );
end;
$$;

revoke all on function public.claim_affiliate_earnings() from public;
grant execute on function public.claim_affiliate_earnings() to authenticated;

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
