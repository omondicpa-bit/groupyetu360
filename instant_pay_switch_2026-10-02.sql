-- instant_pay_switch_2026-10-02.sql
-- A per-group on/off switch for instant M-Pesa payments, controlled by
-- superadmin only. Safaricom Direct is the only live provider.
-- Run AFTER instant_pay_accounts_2026-10-02.sql. Safe to run more than once.

alter table public.organisations add column if not exists instant_pay_enabled boolean not null default false;

-- Groups already live on Safaricom Direct with a verified account stay on.
-- Everyone else (including groups still pointing at SasaPay or Paystack)
-- starts off until superadmin switches them on.
update public.organisations
set instant_pay_enabled = true
where active_payment_provider = 'daraja' and disbursement_verified = true and instant_pay_enabled = false;

-- Only superadmin (or Edge Functions / the SQL editor) may change the switch.
create or replace function public.gy360_guard_instant_pay_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.gy360_is_client_request() then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.instant_pay_enabled := false;
  else
    new.instant_pay_enabled := old.instant_pay_enabled;
  end if;
  return new;
end;
$$;

drop trigger if exists gy360_guard_instant_pay_switch on public.organisations;
create trigger gy360_guard_instant_pay_switch
  before insert or update on public.organisations
  for each row execute function public.gy360_guard_instant_pay_switch();
