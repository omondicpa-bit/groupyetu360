-- plan_guard_2026-10-04.sql
-- Plans, trials and SMS credit can no longer be changed from the browser.
--   * plan, subscription expiry and trial fields: only superadmin, the
--     server (payments confirmed by Safaricom, approvals) or the new
--     start_free_trial() function, which checks the promotion is on, the
--     group has not used its trial and the plan is a real upgrade;
--   * subscription status: the browser may only mark a subscription that has
--     passed its expiry date as expired;
--   * SMS credit: the browser may only use it up (the count goes down after
--     sending); top-ups come from superadmin or a confirmed payment.
-- Safe to run more than once.

create or replace function public.gy360_guard_org_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.gy360_is_client_request() or public.gy360_is_sa()
     or current_setting('gy360.allow_plan_change', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.plan := 'starter'; new.subscription_status := 'active'; new.subscription_expires := null;
    new.trial_used := false; new.trial_start_date := null; new.sms_bundle := 0;
    return new;
  end if;
  new.plan := old.plan;
  new.subscription_expires := old.subscription_expires;
  new.trial_used := old.trial_used;
  new.trial_start_date := old.trial_start_date;
  if new.subscription_status is distinct from old.subscription_status
     and not (new.subscription_status = 'expired' and old.subscription_expires is not null and old.subscription_expires < current_date) then
    new.subscription_status := old.subscription_status;
  end if;
  if coalesce(new.sms_bundle, 0) > coalesce(old.sms_bundle, 0) then
    new.sms_bundle := old.sms_bundle;
  end if;
  return new;
end;
$$;
drop trigger if exists gy360_guard_org_plan on public.organisations;
create trigger gy360_guard_org_plan before insert or update on public.organisations
  for each row execute function public.gy360_guard_org_plan();

-- The one way a group admin starts a free trial
create or replace function public.start_free_trial(p_org uuid, p_plan text)
returns date language plpgsql security definer set search_path = public as $$
declare
  v_org public.organisations%rowtype;
  v_promo boolean; v_days int; v_expires date;
  v_rank jsonb := '{"starter":0,"basic":1,"standard":2,"pro":3}';
begin
  if not public.gy360_is_org_admin(p_org) then raise exception 'Only the group admin can start a free trial.'; end if;
  if p_plan not in ('basic','standard','pro') then raise exception 'Choose a paid plan.'; end if;
  select * into v_org from public.organisations where id = p_org for update;
  if not found then raise exception 'Group not found.'; end if;
  if coalesce(v_org.trial_used, false) then raise exception 'This group has already used its free trial.'; end if;
  select (lower(coalesce(ps.promo_active::text, 'false')) in ('true','t','1')), coalesce(nullif(ps.promo_days::text, '')::int, 60)
    into v_promo, v_days from public.platform_settings ps limit 1;
  if not coalesce(v_promo, false) then raise exception 'Free trials are not available right now.'; end if;
  if coalesce((v_rank ->> p_plan)::int, 0) <= coalesce((v_rank ->> coalesce(v_org.plan, 'starter'))::int, 0)
     and coalesce(v_org.subscription_status, '') <> 'expired' then
    raise exception 'A free trial is for upgrading to a higher plan.';
  end if;
  v_expires := current_date + v_days;
  perform set_config('gy360.allow_plan_change', 'on', true);
  update public.organisations
     set plan = p_plan, subscription_status = 'trial', subscription_expires = v_expires,
         trial_used = true, trial_start_date = current_date
   where id = p_org;
  perform set_config('gy360.allow_plan_change', 'off', true);
  return v_expires;
end;
$$;
revoke all on function public.start_free_trial(uuid, text) from public, anon;
grant execute on function public.start_free_trial(uuid, text) to authenticated;
