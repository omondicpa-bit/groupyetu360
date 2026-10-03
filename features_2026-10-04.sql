-- features_2026-10-04.sql
-- Per-group feature switches. A feature that is off is hidden from the app;
-- nothing is deleted. Group admins may switch features on, and off while the
-- feature holds no records. Once a feature has records, only superadmin can
-- switch it off. Plan limits are separate and unchanged.
-- Safe to run more than once.

-- null / missing key = the default for that feature (see the app's FEATURES list)
alter table public.organisations add column if not exists features jsonb;

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  feature text not null,
  requested_by uuid,
  status text not null default 'pending',   -- pending | done | dismissed
  note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.feature_requests enable row level security;
drop policy if exists feature_requests_admin_rw on public.feature_requests;
create policy feature_requests_admin_rw on public.feature_requests for all
  using (exists (select 1 from public.user_orgs uo where uo.user_id = auth.uid() and uo.org_id = feature_requests.org_id and uo.role = 'admin')
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin'))
  with check (exists (select 1 from public.user_orgs uo where uo.user_id = auth.uid() and uo.org_id = feature_requests.org_id and uo.role = 'admin')
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin'));

-- How many records a feature holds for a group (0 = never used)
create or replace function public.gy360_feature_usage(p_org uuid, p_key text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare n integer := 0;
begin
  -- only for people in that group, or superadmin
  if not exists (select 1 from public.user_orgs where user_id = auth.uid() and org_id = p_org)
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin') then
    return 0;
  end if;
  case p_key
    when 'welfare'        then select count(*) into n from public.welfare_events where org_id = p_org;
    when 'households'     then select count(*) into n from public.members where org_id = p_org and household_principal_id is not null;
    when 'mgr'            then select count(*) into n from public.savings_rounds where org_id = p_org;
    when 'table_banking'  then select (select count(*) from public.table_banking_pools where org_id = p_org) + (select count(*) from public.table_banking_loans where org_id = p_org) into n;
    when 'fines'          then select count(*) into n from public.fines where org_id = p_org;
    when 'meetings'       then select count(*) into n from public.meetings where org_id = p_org;
    when 'projects'       then select count(*) into n from public.projects where org_id = p_org;
    when 'contribution_rules' then select case when (select features from public.organisations where id = p_org) ? 'contribution_rules_config' then 1 else 0 end into n;
    else n := 0;
  end case;
  return coalesce(n, 0);
end;
$$;

-- The only way the app changes a switch
create or replace function public.set_org_feature(p_org uuid, p_key text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sa boolean := exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin');
  v_admin boolean := exists (select 1 from public.user_orgs where user_id = auth.uid() and org_id = p_org and role = 'admin');
  v_used integer;
  v_features jsonb;
begin
  if not (v_sa or v_admin) then
    raise exception 'Only the group admin or GroupYetu360 can change features.';
  end if;
  if p_key !~ '^[a-z_]{2,40}$' then raise exception 'Unknown feature.'; end if;
  if not p_on and not v_sa then
    v_used := public.gy360_feature_usage(p_org, p_key);
    if v_used > 0 then
      raise exception 'IN_USE:%', v_used;
    end if;
  end if;
  update public.organisations
     set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(p_key, p_on)
   where id = p_org
  returning features into v_features;
  begin
    insert into public.activity_log (org_id, user_id, user_name, user_role, action, details, target_type, created_at)
    select p_org, auth.uid(), coalesce(pr.full_name, 'User'), case when v_sa then 'superadmin' else 'admin' end,
           case when p_on then 'FEATURE ON' else 'FEATURE OFF' end, 'Feature "' || p_key || '" switched ' || case when p_on then 'on' else 'off' end,
           'feature', now()
    from public.profiles pr where pr.id = auth.uid();
  exception when others then null;  -- logging must never block the switch
  end;
  if v_sa and not p_on then
    update public.feature_requests set status = 'done', reviewed_at = now() where org_id = p_org and feature = p_key and status = 'pending';
  end if;
  return v_features;
end;
$$;

revoke all on function public.set_org_feature(uuid, text, boolean) from public, anon;
grant execute on function public.set_org_feature(uuid, text, boolean) to authenticated;
revoke all on function public.gy360_feature_usage(uuid, text) from public, anon;
grant execute on function public.gy360_feature_usage(uuid, text) to authenticated;

-- Groups already using households keep them switched on
update public.organisations o
   set features = coalesce(o.features, '{}'::jsonb) || '{"households": true}'::jsonb
 where exists (select 1 from public.members m where m.org_id = o.id and m.household_principal_id is not null)
   and not (coalesce(o.features, '{}'::jsonb) ? 'households');
