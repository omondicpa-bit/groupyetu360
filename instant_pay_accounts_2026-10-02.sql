-- instant_pay_accounts_2026-10-02.sql
-- Groups request their instant-pay (M-Pesa) account; superadmin verifies it.
-- Adds Buy Goods (till) as a destination. Safe to run more than once.

-- 1. Buy Goods till numbers on the group record
alter table public.organisations add column if not exists disbursement_till_number text;
alter table public.organisations add column if not exists welfare_disbursement_till_number text;

-- 2. The request carries the proposed details, so a group's change never
--    touches live payouts until superadmin approves it.
alter table public.collection_activation_requests add column if not exists method text;            -- 'mpesa' (send money) | 'bank' (paybill) | 'till' (buy goods)
alter table public.collection_activation_requests add column if not exists mpesa_number text;
alter table public.collection_activation_requests add column if not exists paybill text;
alter table public.collection_activation_requests add column if not exists account_number text;
alter table public.collection_activation_requests add column if not exists till_number text;
alter table public.collection_activation_requests add column if not exists account_name text;      -- name registered on the paybill / till / line, for SA to check
alter table public.collection_activation_requests add column if not exists welfare_mpesa_number text;

-- 3. Re-create the destination guard so till numbers are covered too:
--    any non-superadmin change to a destination column un-verifies it.
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
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin') into v_is_sa;
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
         new.disbursement_till_number,
         new.welfare_disbursement_method, new.welfare_disbursement_mpesa_number,
         new.welfare_disbursement_bank_name, new.welfare_disbursement_bank_paybill,
         new.welfare_disbursement_bank_account_number, new.welfare_disbursement_till_number)
     is distinct from
     row(old.disbursement_method, old.disbursement_mpesa_number,
         old.disbursement_bank_name, old.disbursement_bank_paybill,
         old.disbursement_bank_account_number, old.disbursement_bank_account_name,
         old.disbursement_till_number,
         old.welfare_disbursement_method, old.welfare_disbursement_mpesa_number,
         old.welfare_disbursement_bank_name, old.welfare_disbursement_bank_paybill,
         old.welfare_disbursement_bank_account_number, old.welfare_disbursement_till_number)
  then
    new.disbursement_verified := false;
  else
    new.disbursement_verified := old.disbursement_verified;
  end if;
  return new;
end;
$$;
