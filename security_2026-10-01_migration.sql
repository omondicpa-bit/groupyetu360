-- security_2026-10-01_migration.sql
-- Database guards for Safaricom Direct collection and payout.
-- See SECURITY_AUDIT_2026-10-01.md (C1, C2, C3, H1).
--
-- How "client" is detected: requests from the app arrive through PostgREST
-- with a JWT whose role claim is 'authenticated' or 'anon'. Edge Functions
-- use the service key ('service_role'). The SQL editor has no JWT at all.
-- Only the first group is restricted, so Edge Functions and manual fixes in
-- the SQL editor keep working.
--
-- Safe to run more than once.

create or replace function public.gy360_is_client_request()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) in ('authenticated', 'anon');
$$;

-- ── 1. payment_requests: Safaricom Direct rows belong to the system ──────
-- Closes C1 (editing amount/allocations after creation) and C2 (resetting
-- a finished row, or inserting a copy that reuses an old checkout id).

create or replace function public.gy360_guard_daraja_payment_requests()
returns trigger
language plpgsql
as $$
begin
  if not public.gy360_is_client_request() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and new.provider = 'daraja' then
    raise exception 'Safaricom Direct payments can only be created by the system.';
  elsif tg_op = 'UPDATE' and (old.provider = 'daraja' or new.provider = 'daraja') then
    raise exception 'Safaricom Direct payments can only be changed by the system.';
  elsif tg_op = 'DELETE' and old.provider = 'daraja' then
    raise exception 'Safaricom Direct payments can only be removed by the system.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists gy360_guard_daraja_payment_requests on public.payment_requests;
create trigger gy360_guard_daraja_payment_requests
  before insert or update or delete on public.payment_requests
  for each row execute function public.gy360_guard_daraja_payment_requests();

-- One Safaricom checkout can only ever be one payment.
create unique index if not exists payment_requests_daraja_checkout_unique
  on public.payment_requests (paystack_ref)
  where provider = 'daraja';

-- ── 2. payment_settlements: one payment, one settlement per fund ─────────

create unique index if not exists payment_settlements_one_per_fund
  on public.payment_settlements (payment_request_id, fund_type);

-- A payout whose outcome Safaricom never confirmed (timeout, or a network
-- error after sending). Retry is blocked until SA confirms it did not go out.
alter table public.payment_settlements
  add column if not exists outcome_uncertain boolean not null default false;

-- ── 3. organisations: destination changes need SA verification ───────────
-- Closes C3. Payouts only go to a destination SA has verified. Any change
-- made by a non-superadmin resets the flag, and a non-superadmin can never
-- set it to true.

alter table public.organisations
  add column if not exists disbursement_verified boolean not null default false;

-- Destinations already configured today were set up and checked by SA, so
-- they start as verified and nothing stops working. Review them with the
-- read-only query at the bottom of this file.
update public.organisations
set disbursement_verified = true
where (disbursement_method is not null or welfare_disbursement_method is not null)
  and disbursement_verified = false;

create or replace function public.gy360_guard_org_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_sa boolean;
begin
  if not public.gy360_is_client_request() then
    return new;
  end if;

  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'superadmin'
  ) into v_is_sa;

  if v_is_sa then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.disbursement_verified := false;
    return new;
  end if;

  if row(new.disbursement_method, new.disbursement_mpesa_number,
         new.disbursement_bank_name, new.disbursement_bank_paybill,
         new.disbursement_bank_account_number, new.disbursement_bank_account_name,
         new.welfare_disbursement_method, new.welfare_disbursement_mpesa_number,
         new.welfare_disbursement_bank_name, new.welfare_disbursement_bank_paybill,
         new.welfare_disbursement_bank_account_number)
     is distinct from
     row(old.disbursement_method, old.disbursement_mpesa_number,
         old.disbursement_bank_name, old.disbursement_bank_paybill,
         old.disbursement_bank_account_number, old.disbursement_bank_account_name,
         old.welfare_disbursement_method, old.welfare_disbursement_mpesa_number,
         old.welfare_disbursement_bank_name, old.welfare_disbursement_bank_paybill,
         old.welfare_disbursement_bank_account_number)
  then
    new.disbursement_verified := false;
  else
    new.disbursement_verified := old.disbursement_verified;
  end if;

  return new;
end;
$$;

drop trigger if exists gy360_guard_org_destination on public.organisations;
create trigger gy360_guard_org_destination
  before insert or update on public.organisations
  for each row execute function public.gy360_guard_org_destination();
