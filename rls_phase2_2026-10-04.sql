-- rls_phase2_2026-10-04.sql
-- Phase 2 of the access-rules fix: inside a group, only officials (admin,
-- treasurer, officer) and superadmin may add, change or delete group records.
-- Members keep everything they genuinely do in the app:
--   * read their group's records (as today),
--   * report a payment (a PENDING payment request, which officials approve),
--   * link their own member record to their account on sign-in, through
--     claim_my_member_records() below (matched by the email on the record).
-- Run AFTER rls_phase1_2026-10-04.sql. One transaction. Safe to run twice.

begin;

-- 1. Members link their own record (replaces the app's direct update, which
--    members may no longer do). Matches the member record's portal email to
--    the signed-in account's email; links only records not yet linked; adds
--    the person to that group as a member.
create or replace function public.claim_my_member_records()
returns table (org_id uuid, member_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_uid is null or v_email = '' then return; end if;
  update public.members m set user_id = v_uid
   where m.user_id is null and coalesce(m.portal_email, '') <> '' and lower(m.portal_email) = v_email;
  insert into public.user_orgs (user_id, org_id, role)
  select distinct v_uid, m.org_id, 'member' from public.members m
   where m.user_id = v_uid
     and not exists (select 1 from public.user_orgs uo where uo.user_id = v_uid and uo.org_id = m.org_id);
  return query select m.org_id, m.id from public.members m where m.user_id = v_uid;
end;
$$;
revoke all on function public.claim_my_member_records() from public, anon;
grant execute on function public.claim_my_member_records() to authenticated;

-- 2. Group tables: everyone in the group reads; officials write.
do $$
declare t text; p text;
begin
  foreach t in array array['members','transactions','expenses','contribution_types','meetings','messages_log',
                           'projects','welfare_events','savings_rounds','fines','table_banking_pools','table_banking_loans'] loop
    -- drop every existing policy on the table (names differ from table to table)
    for p in select polname from pg_policy where polrelid = ('public.' || t)::regclass loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
    execute format('create policy %I on public.%I for select using (public.gy360_is_member(org_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (public.gy360_is_official(org_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.gy360_is_official(org_id)) with check (public.gy360_is_official(org_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.gy360_is_official(org_id))', t || '_delete', t);
  end loop;
end $$;

-- 3. Payment requests: members may only create PENDING requests for their
--    group; officials approve, edit and delete. (Safaricom rows are guarded
--    separately by gy360_guard_daraja_payment_requests.)
do $$
declare p text;
begin
  for p in select polname from pg_policy where polrelid = 'public.payment_requests'::regclass loop
    execute format('drop policy %I on public.payment_requests', p);
  end loop;
end $$;
create policy payment_requests_read on public.payment_requests for select using (public.gy360_is_member(org_id));
create policy payment_requests_insert on public.payment_requests for insert
  with check (public.gy360_is_official(org_id) or (public.gy360_is_member(org_id) and status = 'pending'));
create policy payment_requests_update on public.payment_requests for update
  using (public.gy360_is_official(org_id)) with check (public.gy360_is_official(org_id));
create policy payment_requests_delete on public.payment_requests for delete using (public.gy360_is_official(org_id));

commit;
