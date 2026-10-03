-- rls_phase3_2026-10-04.sql
-- Phase 3 of the access-rules fix: who can SEE what.
--   * Members see their OWN member record, payments, payment requests, fines
--     and loans. Officials (admin, treasurer, officer) and superadmin see the
--     whole group, as before.
--   * Group expenses are for officials.
--   * Members still see group-level information: meetings, welfare funds,
--     contribution types, projects, notices, merry-go-round and table banking
--     pools.
--   * For "pay for another member", members get names only, through
--     group_directory() (no phones, ID numbers or balances).
--   * Profiles (names, emails, phones) are visible only to yourself, people
--     who share a group with you, and superadmin; group admins also see the
--     profiles that point at their group (e.g. people awaiting approval).
-- Run AFTER phases 1 and 2. One transaction. Safe to run twice.

begin;

create or replace function public.gy360_is_my_member(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_member is not null and exists (select 1 from public.members where id = p_member and user_id = auth.uid());
$$;
grant execute on function public.gy360_is_my_member(uuid) to authenticated;

-- Names only, for members choosing someone to pay for
create or replace function public.group_directory(p_org uuid)
returns table (id uuid, full_name text, status text)
language sql stable security definer set search_path = public as $$
  select m.id, m.full_name, m.status from public.members m
  where m.org_id = p_org and public.gy360_is_member(p_org)
    and coalesce(m.status, 'active') in ('active', 'arrears')
  order by m.full_name;
$$;
revoke all on function public.group_directory(uuid) from public, anon;
grant execute on function public.group_directory(uuid) to authenticated;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select
  using (public.gy360_is_official(org_id) or user_id = auth.uid());

drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions for select
  using (public.gy360_is_official(org_id) or public.gy360_is_my_member(member_id));

drop policy if exists fines_read on public.fines;
create policy fines_read on public.fines for select
  using (public.gy360_is_official(org_id) or public.gy360_is_my_member(member_id));

drop policy if exists table_banking_loans_read on public.table_banking_loans;
create policy table_banking_loans_read on public.table_banking_loans for select
  using (public.gy360_is_official(org_id) or public.gy360_is_my_member(member_id));

drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select using (public.gy360_is_official(org_id));

drop policy if exists payment_requests_read on public.payment_requests;
create policy payment_requests_read on public.payment_requests for select
  using (public.gy360_is_official(org_id) or public.gy360_is_my_member(member_id) or user_id = auth.uid());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.gy360_is_sa() or public.gy360_shares_org(id)
         or (profiles.org_id is not null and public.gy360_is_org_admin(profiles.org_id)));

commit;
