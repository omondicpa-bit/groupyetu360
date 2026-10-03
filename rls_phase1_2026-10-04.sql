-- rls_phase1_2026-10-04.sql
-- Closes the critical holes found in the 4 Oct audit of the access rules:
--   1. Many rules trusted profiles.org_id, which every user can change on
--      their own profile. Anyone could point it at another group and read or
--      write that group's members, transactions, meetings, welfare, etc.
--   2. The fines rule was "true": every signed-in user could read and change
--      every group's fines.
--   3. A user could add themselves to any group's user_orgs as admin, or
--      promote their own row.
--   4. A group admin could set any profile in their group (including their
--      own) to superadmin; a new account could create its profile as
--      superadmin.
-- Group membership now comes only from user_orgs, read through small
-- security-definer helpers (so no rule ever reads user_orgs from inside a
-- user_orgs rule, which would recurse). What each member may do inside their
-- own group is UNCHANGED in this phase; officials-only writes are phase 2.
-- One transaction. Safe to run more than once.

begin;

-- 0. Nobody loses access: give every legacy profile.org_id link a
--    user_orgs row (same role mapping the app uses) before rules switch over.
insert into public.user_orgs (user_id, org_id, role)
select p.id, p.org_id,
       case when p.role in ('admin','officer','treasurer','member') then p.role
            when p.role = 'superadmin' then 'admin' else 'member' end
from public.profiles p
where p.org_id is not null
  and p.role not in ('pending','declined')
  and exists (select 1 from public.organisations o where o.id = p.org_id)
  and not exists (select 1 from public.user_orgs uo where uo.user_id = p.id and uo.org_id = p.org_id);

-- 1. Helpers (definer: they read user_orgs/profiles without RLS)
create or replace function public.gy360_is_sa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin');
$$;
create or replace function public.gy360_org_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_orgs where user_id = auth.uid() and org_id = p_org limit 1;
$$;
create or replace function public.gy360_is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.gy360_is_sa() or public.gy360_org_role(p_org) is not null;
$$;
create or replace function public.gy360_is_official(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.gy360_is_sa() or coalesce(public.gy360_org_role(p_org), '') in ('admin','treasurer','officer');
$$;
create or replace function public.gy360_is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.gy360_is_sa() or coalesce(public.gy360_org_role(p_org), '') = 'admin';
$$;
create or replace function public.gy360_shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_orgs a join public.user_orgs b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and b.user_id = p_user);
$$;
grant execute on function public.gy360_is_sa(), public.gy360_org_role(uuid), public.gy360_is_member(uuid),
  public.gy360_is_official(uuid), public.gy360_is_org_admin(uuid), public.gy360_shares_org(uuid) to authenticated;

-- 2. Group tables: membership from user_orgs (behaviour inside a group unchanged)
drop policy if exists members_org on public.members;
create policy members_org on public.members for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists transactions_org on public.transactions;
create policy transactions_org on public.transactions for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists expenses_org on public.expenses;
create policy expenses_org on public.expenses for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists contrib_types_org on public.contribution_types;
create policy contrib_types_org on public.contribution_types for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists meetings_org on public.meetings;
create policy meetings_org on public.meetings for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists messages_org on public.messages_log;
create policy messages_org on public.messages_log for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists projects_org on public.projects;
create policy projects_org on public.projects for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists welfare_org on public.welfare_events;
create policy welfare_org on public.welfare_events for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists org_savings_rounds on public.savings_rounds;
create policy org_savings_rounds on public.savings_rounds for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists fines_org_isolation on public.fines;
create policy fines_org_isolation on public.fines for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));
drop policy if exists org_payment_requests on public.payment_requests;
create policy org_payment_requests on public.payment_requests for all using (public.gy360_is_member(org_id)) with check (public.gy360_is_member(org_id));

-- 3. Organisations: only members read; only that group's admins update; only
--    superadmin inserts directly (groups are created via create_organisation)
drop policy if exists orgs_read on public.organisations;
create policy orgs_read on public.organisations for select using (public.gy360_is_member(id));
drop policy if exists orgs_update on public.organisations;
create policy orgs_update on public.organisations for update using (public.gy360_is_org_admin(id)) with check (public.gy360_is_org_admin(id));
drop policy if exists orgs_insert on public.organisations;
create policy orgs_insert on public.organisations for insert with check (public.gy360_is_sa());

-- 4. Activity log: read by the group's officials and superadmin; writes only
--    for groups you belong to
drop policy if exists activity_log_read on public.activity_log;
create policy activity_log_read on public.activity_log for select using (public.gy360_is_official(org_id));
drop policy if exists activity_log_insert on public.activity_log;
create policy activity_log_insert on public.activity_log for insert with check (auth.uid() is not null and (org_id is null or public.gy360_is_member(org_id)));

-- 5. user_orgs: admins manage their own group's rows (via helper, no recursion)
drop policy if exists admins_manage_org_user_orgs on public.user_orgs;
create policy admins_manage_org_user_orgs on public.user_orgs for all using (public.gy360_is_org_admin(org_id)) with check (public.gy360_is_org_admin(org_id));

create or replace function public.gy360_guard_user_orgs()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin boolean;
begin
  if not public.gy360_is_client_request() or public.gy360_is_sa()
     or current_setting('gy360.allow_admin_link', true) = 'on' then
    return new;
  end if;
  select exists (select 1 from public.user_orgs where user_id = auth.uid() and org_id = new.org_id and role = 'admin') into v_admin;
  if tg_op = 'INSERT' then
    if new.user_id = auth.uid() and not v_admin then
      -- You can only attach yourself to a group that already has a member
      -- record for you (an invitation or an approved join). Join requests
      -- otherwise go through pending_members and the admin's approval.
      if not exists (select 1 from public.members m where m.org_id = new.org_id
                      and (m.user_id = auth.uid()
                           or (coalesce(m.portal_email, '') <> '' and lower(m.portal_email) = lower(coalesce(auth.jwt() ->> 'email', ''))))) then
        raise exception 'Ask the group admin to add or approve you first.';
      end if;
      new.role := 'member';            -- joining yourself is always as a member
    elsif new.user_id <> auth.uid() and not v_admin then
      raise exception 'Only the group admin can add people to a group.';
    end if;
  else
    new.org_id := old.org_id;          -- a row can never be moved to another group
    new.user_id := old.user_id;
    if new.role is distinct from old.role and not v_admin then
      new.role := old.role;            -- only the group admin changes roles
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists gy360_guard_user_orgs on public.user_orgs;
create trigger gy360_guard_user_orgs before insert or update on public.user_orgs
  for each row execute function public.gy360_guard_user_orgs();

-- create_organisation is the one place a user may make themselves admin
create or replace function public.create_organisation(p_name text, p_sms_label text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_code text; v_tries int := 0;
begin
  if v_uid is null then raise exception 'Please sign in again.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter a group name.'; end if;
  if (select count(*) from public.user_orgs uo join public.organisations o on o.id = uo.org_id
      where uo.user_id = v_uid and uo.role = 'admin' and o.created_at > now() - interval '30 seconds') > 0 then
    raise exception 'You just created a group. Please wait a moment before creating another.';
  end if;
  loop
    v_code := 'GY' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.organisations where org_code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'Could not generate a group code. Please try again.'; end if;
  end loop;
  insert into public.organisations (name, plan, status, org_code, subscription_status, sms_bundle, sms_label)
  values (trim(p_name), 'starter', 'active', v_code, 'active', 0, nullif(trim(coalesce(p_sms_label, '')), ''))
  returning id into v_org;
  perform set_config('gy360.allow_admin_link', 'on', true);
  update public.user_orgs set role = 'admin' where user_id = v_uid and org_id = v_org;
  if not found then insert into public.user_orgs (user_id, org_id, role) values (v_uid, v_org, 'admin'); end if;
  perform set_config('gy360.allow_admin_link', 'off', true);
  return v_org;
end;
$$;

-- 6. Profiles: nobody but superadmin grants or removes superadmin, and a new
--    account cannot create itself as superadmin. Group admins may only edit
--    profiles of people in their group.
create or replace function public.gy360_guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.gy360_is_client_request() or public.gy360_is_sa() then return new; end if;
  if tg_op = 'INSERT' then
    if new.role = 'superadmin' then new.role := 'member'; end if;
  elsif new.role is distinct from old.role and (new.role = 'superadmin' or old.role = 'superadmin') then
    new.role := old.role;
  end if;
  return new;
end;
$$;
drop trigger if exists gy360_guard_profile_role on public.profiles;
create trigger gy360_guard_profile_role before insert or update on public.profiles
  for each row execute function public.gy360_guard_profile_role();

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
  using (public.gy360_is_sa() or (profiles.org_id is not null and public.gy360_is_org_admin(profiles.org_id)))
  with check (public.gy360_is_sa() or (profiles.org_id is not null and public.gy360_is_org_admin(profiles.org_id)));

commit;
