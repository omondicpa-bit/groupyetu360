-- create_organisation_2026-10-03.sql
-- "Create group" failed with: new row violates row-level security policy for
-- table "organisations". The browser inserted the group and immediately read
-- it back, but the person is not yet linked to the new group at that moment,
-- so the database refused. This function does the whole start-up in one step,
-- on the server: create the group, make the caller its admin. It only ever
-- acts for the signed-in person (auth.uid()) and only creates Starter groups;
-- trials and upgrades still go through the normal checks afterwards.
-- Safe to run more than once.

create or replace function public.create_organisation(p_name text, p_sms_label text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_code text;
  v_tries int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter a group name.';
  end if;
  -- One person creating many groups in a burst is almost always a double tap
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

  -- (written without ON CONFLICT so it works whatever unique keys user_orgs has)
  update public.user_orgs set role = 'admin' where user_id = v_uid and org_id = v_org;
  if not found then
    insert into public.user_orgs (user_id, org_id, role) values (v_uid, v_org, 'admin');
  end if;

  return v_org;
end;
$$;

revoke all on function public.create_organisation(text, text) from public, anon;
grant execute on function public.create_organisation(text, text) to authenticated;
