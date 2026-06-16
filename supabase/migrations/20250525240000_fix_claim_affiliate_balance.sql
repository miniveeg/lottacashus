-- claim_affiliate_earnings must bypass profiles balance guard (same as withdrawals / games).

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
