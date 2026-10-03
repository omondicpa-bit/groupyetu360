-- features_more_2026-10-04.sql
-- Adds three switchable features: Instant M-Pesa collections, Member
-- withdrawals and Bulk SMS / messages. Only teaches the database how to tell
-- whether each is "in use" (so admins cannot switch them off once they hold
-- records). Run after features_2026-10-04.sql. Safe to run more than once.
create or replace function public.gy360_feature_usage(p_org uuid, p_key text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare n integer := 0;
begin
  if not exists (select 1 from public.user_orgs where user_id = auth.uid() and org_id = p_org)
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin') then
    return 0;
  end if;
  begin
    case p_key
      when 'welfare'        then select count(*) into n from public.welfare_events where org_id = p_org;
      when 'households'     then select count(*) into n from public.members where org_id = p_org and household_principal_id is not null;
      when 'mgr'            then select count(*) into n from public.savings_rounds where org_id = p_org;
      when 'table_banking'  then select (select count(*) from public.table_banking_pools where org_id = p_org) + (select count(*) from public.table_banking_loans where org_id = p_org) into n;
      when 'fines'          then select count(*) into n from public.fines where org_id = p_org;
      when 'meetings'       then select count(*) into n from public.meetings where org_id = p_org;
      when 'projects'       then select count(*) into n from public.projects where org_id = p_org;
      when 'contribution_rules' then select case when (select features from public.organisations where id = p_org) ? 'contribution_rules_config' then 1 else 0 end into n;
      when 'instant_mpesa'  then select count(*) into n from public.payment_requests where org_id = p_org and provider = 'daraja' and status = 'approved';
      when 'withdrawals'    then select count(*) into n from public.withdrawal_requests where org_id = p_org;
      when 'messages'       then select count(*) into n from public.messages_log where org_id = p_org;
      else n := 0;
    end case;
  exception when others then n := 0;  -- a missing table never blocks the Features page
  end;
  return coalesce(n, 0);
end;
$$;
