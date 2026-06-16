-- Affiliates: referral codes, 5% deposit commission, $1 per $100 wagered (proportional)

alter table public.profiles
  add column if not exists affiliate_code text,
  add column if not exists referred_by uuid references public.profiles (id) on delete set null;

create unique index if not exists profiles_affiliate_code_key
  on public.profiles (affiliate_code)
  where affiliate_code is not null;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by)
  where referred_by is not null;

alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('deposit', 'withdrawal', 'wager', 'win', 'loss', 'affiliate'));

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'wager')),
  base_amount numeric(12, 2) not null,
  commission_amount numeric(12, 2) not null,
  source_transaction_id uuid unique references public.transactions (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_commissions_affiliate_created_idx
  on public.affiliate_commissions (affiliate_id, created_at desc);

alter table public.affiliate_commissions
  add column if not exists claimed_at timestamptz;

alter table public.affiliate_commissions enable row level security;

drop policy if exists "Affiliates read own commissions" on public.affiliate_commissions;

create policy "Affiliates read own commissions"
  on public.affiliate_commissions for select
  using (auth.uid() = affiliate_id);

grant select on public.affiliate_commissions to authenticated;

-- Normalize referral codes to uppercase (case-insensitive input)
create or replace function public.normalize_affiliate_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Unique referral code (8 chars, A-Z0-9)
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
    return code;
  end if;

  code := public.generate_unique_affiliate_code();

  update public.profiles
  set affiliate_code = code, updated_at = now()
  where id = p_user_id and (affiliate_code is null or affiliate_code = '');

  return code;
end;
$$;

revoke all on function public.ensure_user_affiliate_code(uuid) from public;
grant execute on function public.ensure_user_affiliate_code(uuid) to authenticated;
grant execute on function public.ensure_user_affiliate_code(uuid) to service_role;

-- Backfill codes for existing profiles
do $$
declare
  r record;
begin
  for r in
    select id from public.profiles where affiliate_code is null or affiliate_code = ''
  loop
    perform public.ensure_user_affiliate_code(r.id);
  end loop;
end $$;

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

revoke all on function public.apply_affiliate_referral(uuid, text) from public;
grant execute on function public.apply_affiliate_referral(uuid, text) to service_role;

-- Credit affiliate when a referred user deposits or wagers (trigger on transactions)
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

drop trigger if exists affiliate_commission_on_transaction on public.transactions;

create trigger affiliate_commission_on_transaction
  after insert on public.transactions
  for each row
  execute function public.trg_affiliate_commission_on_transaction();

-- Claim pending affiliate earnings to main balance
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

-- Stats for Promotions page
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

revoke all on function public.get_affiliate_stats() from public;
grant execute on function public.get_affiliate_stats() to authenticated;

-- Transaction history: include affiliate type in sort order
create or replace function public.get_user_transactions(
  p_page int default 0,
  p_page_size int default 10
)
returns table (
  id uuid,
  type text,
  amount numeric,
  balance_after numeric,
  description text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim int := greatest(1, least(coalesce(p_page_size, 10), 50));
  off int := greatest(0, coalesce(p_page, 0)) * lim;
  cnt bigint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::bigint into cnt
  from public.transactions t
  where t.user_id = uid;

  return query
  select
    t.id,
    t.type,
    t.amount,
    t.balance_after,
    t.description,
    t.created_at,
    cnt
  from public.transactions t
  where t.user_id = uid
  order by
    t.created_at desc,
    case t.type
      when 'wager' then 0
      when 'loss' then 1
      when 'win' then 2
      when 'affiliate' then 3
      when 'deposit' then 4
      when 'withdrawal' then 5
      else 6
    end asc,
    t.id asc
  limit lim
  offset off;
end;
$$;

grant execute on function public.get_user_transactions(int, int) to authenticated;
