-- staging_setup.sql
-- Builds the GroupYetu360 STAGING database: the live structure (tables, access
-- rules, functions, triggers; copied from live on 10 Oct 2026, no member data),
-- the sign-up trigger and realtime settings that live outside the public
-- schema, and a set of TEST groups, members and payments.
--
-- Run ONCE, in the STAGING project's SQL editor (groupyetu360-staging,
-- zrjctzauufromazxrpvb). It refuses to run on a database that already has
-- GroupYetu360 tables, so it can never touch live.

DO $guard$
BEGIN
  IF to_regclass('public.organisations') IS NOT NULL THEN
    RAISE EXCEPTION 'STOPPED: this database already has GroupYetu360 tables. staging_setup.sql only runs on the empty staging project.';
  END IF;
END
$guard$;

BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: claim_my_member_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_my_member_records() RETURNS TABLE(org_id uuid, member_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: create_organisation(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_organisation(p_name text, p_sms_label text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_user_completely(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user_completely(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  -- Preserve every financial/audit record — null the "who did this"
  -- reference rather than deleting the record or letting the FK block us.
  UPDATE transactions               SET recorded_by  = NULL WHERE recorded_by  = p_user_id;
  UPDATE expenses                   SET recorded_by  = NULL WHERE recorded_by  = p_user_id;
  UPDATE messages_log                SET sent_by      = NULL WHERE sent_by      = p_user_id;
  UPDATE pending_members             SET reviewed_by  = NULL WHERE reviewed_by  = p_user_id;
  UPDATE balance_adjustments         SET recorded_by  = NULL WHERE recorded_by  = p_user_id;
  UPDATE savings_rounds              SET created_by   = NULL WHERE created_by   = p_user_id;
  UPDATE round_contributions         SET recorded_by  = NULL WHERE recorded_by  = p_user_id;
  UPDATE round_disbursements         SET disbursed_by = NULL WHERE disbursed_by = p_user_id;
  UPDATE payment_requests            SET approved_by  = NULL WHERE approved_by  = p_user_id;
  UPDATE table_banking_pools         SET created_by   = NULL WHERE created_by   = p_user_id;
  UPDATE table_banking_contributions SET recorded_by  = NULL WHERE recorded_by  = p_user_id;
  UPDATE table_banking_loans         SET issued_by    = NULL WHERE issued_by    = p_user_id;
  UPDATE table_banking_repayments    SET recorded_by  = NULL WHERE recorded_by  = p_user_id;

  -- pending_members.user_id is NOT NULL — a join request tied to this login
  -- can't be preserved without an owner, so delete it outright. (reviewed_by
  -- above is a different semantic — acting on someone ELSE's request — and
  -- correctly persists.)
  DELETE FROM pending_members WHERE user_id = p_user_id;

  -- Actor-scoped rows — these belong to the LOGIN, not the member roster
  -- entry, so deleting them is correct, not data loss.
  DELETE FROM activity_log WHERE user_id = p_user_id;
  DELETE FROM user_orgs    WHERE user_id = p_user_id;
  DELETE FROM profiles     WHERE id      = p_user_id;

  -- Member roster data stays fully intact — only unlink it from the login
  -- being deleted. Name, balance, contribution history, attendance, member
  -- number: all untouched. This also self-heals correctly if this same
  -- person ever registers a new login later (existing phone/email match
  -- logic re-links it automatically, same as any never-logged-in member).
  UPDATE members SET user_id = NULL WHERE user_id = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;


--
-- Name: get_platform_settings_safe(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_platform_settings_safe() RETURNS TABLE(support_phone text, support_email text, bank_name text, bank_account text, bank_account_name text, paybill text, whatsapp text, celcom_partner_id text, celcom_shortcode text, celcom_api_key_set boolean, payment_mode text, promo_days text, promo_active boolean, manual_enabled boolean, paystack_enabled boolean, paystack_public_key text, paystack_secret_key_set boolean, platform_fee_percent numeric, paystack_fee_percent numeric, fingo_fee_multiplier numeric, fingo_api_key_set boolean, fingo_webhook_secret_set boolean, vapid_public_key text, vapid_private_key_set boolean, sasapay_merchant_code text, sasapay_base_url text, sasapay_client_id_set boolean, sasapay_client_secret_set boolean, sasapay_fee_percent numeric, sasapay_platform_fee_percent numeric, subscription_payment_provider text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    ps.support_phone, ps.support_email,
    ps.bank_name, ps.bank_account, ps.bank_account_name,
    ps.paybill, ps.whatsapp,
    ps.celcom_partner_id, ps.celcom_shortcode, (ps.celcom_api_key IS NOT NULL),
    ps.payment_mode, ps.promo_days, ps.promo_active,
    ps.manual_enabled, ps.paystack_enabled,
    ps.paystack_public_key, (ps.paystack_secret_key IS NOT NULL),
    ps.platform_fee_percent, ps.paystack_fee_percent,
    ps.fingo_fee_multiplier, (ps.fingo_api_key IS NOT NULL), (ps.fingo_webhook_secret IS NOT NULL),
    ps.vapid_public_key, (ps.vapid_private_key IS NOT NULL),
    ps.sasapay_merchant_code, ps.sasapay_base_url,
    (ps.sasapay_client_id IS NOT NULL), (ps.sasapay_client_secret IS NOT NULL),
    ps.sasapay_fee_percent, ps.sasapay_platform_fee_percent,
    ps.subscription_payment_provider
  FROM platform_settings ps
  LIMIT 1;
END;
$$;


--
-- Name: gy360_check_household_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_check_household_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.household_principal_id is null then return new; end if;
  if new.household_principal_id = new.id then
    raise exception 'A member cannot contribute through themselves.';
  end if;
  if not exists (select 1 from public.members p where p.id = new.household_principal_id and p.org_id = new.org_id) then
    raise exception 'The household member must belong to the same group.';
  end if;
  if exists (select 1 from public.members p where p.id = new.household_principal_id and p.household_principal_id is not null) then
    raise exception 'That member already contributes through someone else. Link to the person who pays.';
  end if;
  return new;
end;
$$;


--
-- Name: gy360_close_join_request_on_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_close_join_request_on_membership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.pending_members p
     set status = 'approved',
         linked_member_id = coalesce(p.linked_member_id,
           (select m.id from public.members m where m.org_id = new.org_id and m.user_id = new.user_id limit 1)),
         reviewed_at = now(),
         notes = trim(both ' ' from coalesce(p.notes, '') || ' Closed automatically: already a member.')
   where p.org_id = new.org_id and p.user_id = new.user_id and p.status = 'pending';
  return new;
end;
$$;


--
-- Name: gy360_feature_usage(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_feature_usage(p_org uuid, p_key text) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_guard_daraja_payment_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_daraja_payment_requests() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: gy360_guard_instant_pay_switch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_instant_pay_switch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_guard_join_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_join_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.status = 'pending' and new.user_id is not null
     and exists (select 1 from public.user_orgs where user_id = new.user_id and org_id = new.org_id) then
    raise exception 'ALREADY_MEMBER: You are already a member of this group.';
  end if;
  return new;
end;
$$;


--
-- Name: gy360_guard_org_destination(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_org_destination() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_guard_org_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_org_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_guard_profile_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_profile_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_guard_user_orgs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_guard_user_orgs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gy360_is_client_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_is_client_request() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) in ('authenticated', 'anon');
$$;


--
-- Name: gy360_is_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_is_member(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.gy360_is_sa() or public.gy360_org_role(p_org) is not null;
$$;


--
-- Name: gy360_is_official(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_is_official(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.gy360_is_sa() or coalesce(public.gy360_org_role(p_org), '') in ('admin','treasurer','officer');
$$;


--
-- Name: gy360_is_org_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_is_org_admin(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.gy360_is_sa() or coalesce(public.gy360_org_role(p_org), '') = 'admin';
$$;


--
-- Name: gy360_is_sa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_is_sa() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin');
$$;


--
-- Name: gy360_org_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_org_role(p_org uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from public.user_orgs where user_id = auth.uid() and org_id = p_org limit 1;
$$;


--
-- Name: gy360_shares_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gy360_shares_org(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.user_orgs a join public.user_orgs b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and b.user_id = p_user);
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meta               jsonb := NEW.raw_user_meta_data;
  v_full_name        text  := COALESCE(meta->>'full_name', split_part(NEW.email, '@', 1));
  v_phone            text  := meta->>'phone';
  v_join_org_id      uuid  := NULLIF(meta->>'join_org_id', '')::uuid;
  v_invite_org_id    uuid  := NULLIF(meta->>'invite_org_id', '')::uuid;
  v_invite_role      text  := COALESCE(meta->>'invite_role', 'member');
  v_invite_member_id uuid  := NULLIF(meta->>'invite_member_id', '')::uuid;
  v_admin_org_id     uuid  := NULLIF(meta->>'admin_invite_org_id', '')::uuid;
  v_admin_role       text  := meta->>'admin_invite_role';
BEGIN
  IF v_admin_org_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, phone, email, role, org_id)
    VALUES (NEW.id, v_full_name, v_phone, NEW.email, COALESCE(v_admin_role, 'admin'), v_admin_org_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_orgs (user_id, org_id, role)
    VALUES (NEW.id, v_admin_org_id, COALESCE(v_admin_role, 'admin'))
    ON CONFLICT DO NOTHING;

  ELSIF v_invite_org_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, phone, email, role, org_id)
    VALUES (NEW.id, v_full_name, v_phone, NEW.email, v_invite_role, v_invite_org_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_orgs (user_id, org_id, role)
    VALUES (NEW.id, v_invite_org_id, v_invite_role)
    ON CONFLICT DO NOTHING;

    IF v_invite_member_id IS NOT NULL THEN
      UPDATE public.members SET user_id = NEW.id WHERE id = v_invite_member_id;
    END IF;

  ELSIF v_join_org_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, phone, email, role, org_id)
    VALUES (NEW.id, v_full_name, v_phone, NEW.email, 'pending', v_join_org_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_orgs (user_id, org_id, role)
    VALUES (NEW.id, v_join_org_id, 'pending')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.pending_members (org_id, user_id, full_name, phone, email, status)
    VALUES (v_join_org_id, NEW.id, v_full_name, v_phone, NEW.email, 'pending')
    ON CONFLICT DO NOTHING;

  ELSE
    INSERT INTO public.profiles (id, full_name, phone, email, role)
    VALUES (NEW.id, v_full_name, v_phone, NEW.email, 'member')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: increment_taya_usage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_taya_usage(p_org_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO taya_usage_log (org_id, usage_date, request_count)
  VALUES (p_org_id, CURRENT_DATE, 1)
  ON CONFLICT (org_id, usage_date)
  DO UPDATE SET request_count = taya_usage_log.request_count + 1
  RETURNING request_count INTO new_count;
  RETURN new_count;
END;
$$;


--
-- Name: insert_founder_member(uuid, uuid, text, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_founder_member(p_org_id uuid, p_user_id uuid, p_full_name text, p_phone text, p_email text, p_join_date date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO members (
    org_id, user_id, full_name, phone, portal_email,
    member_number, internal_number, is_founder,
    status, registration_paid, join_date
  ) VALUES (
    p_org_id, p_user_id, p_full_name, p_phone, p_email,
    '001', 1, true, 'active', true, p_join_date
  )
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;


--
-- Name: link_member_to_org(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_member_to_org(p_user_id uuid, p_org_id uuid, p_role text DEFAULT 'member'::text, p_full_name text DEFAULT ''::text, p_phone text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  caller_role text;
  is_org_admin boolean;
  matched_member_id uuid;
begin
  select role into caller_role from profiles where id = auth.uid();
  select exists (
    select 1 from user_orgs
    where user_id = auth.uid() and org_id = p_org_id and role in ('admin','treasurer')
  ) into is_org_admin;

  if caller_role != 'superadmin' and not is_org_admin then
    return jsonb_build_object('success', false, 'error', 'Not authorised');
  end if;

  insert into user_orgs (user_id, org_id, role)
  values (p_user_id, p_org_id, coalesce(p_role, 'member'))
  on conflict (user_id, org_id) do update set role = excluded.role;

  select id into matched_member_id
  from members
  where org_id = p_org_id
    and (
      (p_phone is not null and p_phone != '' and phone = p_phone)
      or (p_full_name is not null and p_full_name != '' and full_name = p_full_name)
    )
  limit 1;

  if matched_member_id is not null then
    update members set user_id = p_user_id where id = matched_member_id;
  end if;

  return jsonb_build_object('success', true, 'member_id', matched_member_id);
end;
$$;


--
-- Name: sa_user_last_seen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sa_user_last_seen() RETURNS TABLE(id uuid, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin') then
    return;  -- not superadmin: return no rows
  end if;
  return query
    select u.id, u.last_sign_in_at, u.email_confirmed_at
    from auth.users u;
end;
$$;


--
-- Name: set_org_feature(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_org_feature(p_org uuid, p_key text, p_on boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: start_free_trial(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_free_trial(p_org uuid, p_plan text) RETURNS date
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: update_bank_balance(uuid, numeric, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_bank_balance(p_org_id uuid, p_amount numeric, p_direction text, p_date date) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE organisations
  SET
    bank_balance = GREATEST(0, COALESCE(bank_balance, 0) +
      CASE WHEN p_direction = 'credit' THEN p_amount ELSE -p_amount END),
    bank_balance_updated = p_date
  WHERE id = p_org_id
  RETURNING bank_balance INTO v_new_balance;
  RETURN v_new_balance;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    user_id uuid,
    user_name text,
    user_role text,
    action text NOT NULL,
    details text,
    target_type text,
    target_id text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    member_id uuid NOT NULL,
    status text DEFAULT 'absent'::text
);


--
-- Name: balance_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    member_id uuid NOT NULL,
    adjustment_type text NOT NULL,
    direction text NOT NULL,
    amount numeric NOT NULL,
    reason text NOT NULL,
    recorded_by uuid,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: broadcast_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sent_by uuid,
    title text NOT NULL,
    body text NOT NULL,
    target_type text NOT NULL,
    target_ids jsonb,
    recipient_count integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT broadcast_log_target_type_check CHECK ((target_type = ANY (ARRAY['all'::text, 'orgs'::text, 'members'::text])))
);


--
-- Name: collection_activation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_activation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid,
    requested_at timestamp with time zone DEFAULT now(),
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    notes text,
    method text,
    mpesa_number text,
    paybill text,
    account_number text,
    till_number text,
    account_name text,
    welfare_mpesa_number text,
    CONSTRAINT collection_activation_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))
);


--
-- Name: contribution_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contribution_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    amount numeric,
    frequency text,
    is_variable boolean DEFAULT false,
    is_member_income boolean DEFAULT true,
    notes text,
    income_type text DEFAULT 'admin_income'::text,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: disbursement_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disbursement_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    method text,
    reference text,
    disbursed_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT disbursement_records_method_check CHECK ((method = ANY (ARRAY['bank'::text, 'mpesa'::text])))
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    category text,
    description text,
    amount numeric NOT NULL,
    mpesa_ref text,
    expense_date date,
    project text,
    recorded_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    entry_type text DEFAULT 'expense'::text,
    notes text,
    welfare_event_id uuid
);


--
-- Name: feature_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    feature text NOT NULL,
    requested_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone
);


--
-- Name: fines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    member_id uuid,
    reason text NOT NULL,
    amount numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text,
    recovery_method text,
    notes text,
    issued_date date DEFAULT CURRENT_DATE,
    paid_date date,
    issued_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    meeting_date date NOT NULL,
    meeting_time time without time zone,
    venue text,
    agenda text,
    minutes text,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    member_number text,
    full_name text NOT NULL,
    phone text,
    id_number text,
    join_date date,
    savings_tier integer DEFAULT 500,
    registration_paid boolean DEFAULT false,
    status text DEFAULT 'active'::text,
    created_at timestamp without time zone DEFAULT now(),
    opening_shares numeric DEFAULT 0,
    opening_savings numeric DEFAULT 0,
    shares_balance numeric DEFAULT 0,
    savings_balance numeric DEFAULT 0,
    portal_email text,
    registration_date date,
    registration_renewal date,
    internal_number integer,
    display_number text,
    is_founder boolean DEFAULT false NOT NULL,
    user_id uuid,
    household_principal_id uuid
);


--
-- Name: merry_go_round_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merry_go_round_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    recipient_type text,
    body text,
    recipient_count integer,
    sent_by uuid,
    sent_at timestamp without time zone DEFAULT now()
);


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    url text,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_payment_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_payment_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    provider text NOT NULL,
    provider_account_ref text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT org_payment_providers_provider_check CHECK ((provider = ANY (ARRAY['paystack'::text, 'fingo'::text])))
);


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    reg_number text,
    paybill text,
    account_format text,
    plan text DEFAULT 'starter'::text,
    status text DEFAULT 'active'::text,
    date_founded date,
    created_at timestamp without time zone DEFAULT now(),
    bank_balance numeric DEFAULT 0,
    bank_balance_updated date,
    welfare_rate_member numeric DEFAULT 1000,
    welfare_rate_spouse numeric DEFAULT 750,
    welfare_rate_child numeric DEFAULT 500,
    at_api_key text,
    at_username text,
    at_sender_id text,
    sms_balance integer DEFAULT 0,
    subscription_status text DEFAULT 'active'::text,
    subscription_expires date,
    subscription_paid_date date,
    payment_reference text,
    payment_amount numeric DEFAULT 0,
    sms_bundle integer DEFAULT 50,
    sms_used integer DEFAULT 0,
    sms_rate numeric DEFAULT 1.5,
    support_phone text,
    support_email text,
    two_fa_enabled boolean DEFAULT false,
    org_code text,
    bank_balance_locked boolean DEFAULT false,
    withdraw_enabled boolean DEFAULT false,
    show_balance_to_members boolean DEFAULT false,
    payment_methods jsonb DEFAULT '{}'::jsonb,
    daraja_consumer_key text,
    daraja_consumer_secret text,
    daraja_shortcode text,
    daraja_passkey text,
    daraja_env text DEFAULT 'sandbox'::text,
    daraja_enabled boolean DEFAULT false,
    email text,
    sms_enabled boolean DEFAULT true,
    trial_used boolean DEFAULT false,
    trial_start_date date,
    paystack_subaccount_code text,
    max_contribution_amount numeric(15,2),
    active_payment_provider text DEFAULT 'paystack'::text,
    disbursement_method text,
    disbursement_bank_name text,
    disbursement_bank_account_number text,
    disbursement_bank_account_name text,
    disbursement_mpesa_number text,
    sms_label text,
    disbursement_bank_paybill text,
    welfare_disbursement_method text,
    welfare_disbursement_bank_name text,
    welfare_disbursement_bank_paybill text,
    welfare_disbursement_bank_account_number text,
    welfare_disbursement_bank_account_name text,
    welfare_disbursement_mpesa_number text,
    mpesa_account_label text,
    disbursement_verified boolean DEFAULT false NOT NULL,
    disbursement_till_number text,
    welfare_disbursement_till_number text,
    instant_pay_enabled boolean DEFAULT false NOT NULL,
    features jsonb,
    CONSTRAINT organisations_active_payment_provider_check CHECK ((active_payment_provider = ANY (ARRAY['paystack'::text, 'sasapay'::text, 'daraja'::text]))),
    CONSTRAINT organisations_disbursement_method_check CHECK ((disbursement_method = ANY (ARRAY['bank'::text, 'mpesa'::text]))),
    CONSTRAINT organisations_mpesa_account_label_check CHECK (((mpesa_account_label IS NULL) OR (mpesa_account_label ~ '^[A-Za-z0-9]{1,12}$'::text))),
    CONSTRAINT organisations_plan_check CHECK ((plan = ANY (ARRAY['starter'::text, 'basic'::text, 'standard'::text, 'pro'::text]))),
    CONSTRAINT organisations_welfare_disbursement_method_check CHECK ((welfare_disbursement_method = ANY (ARRAY['bank'::text, 'mpesa'::text])))
);


--
-- Name: organisations_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.organisations_public AS
 SELECT id,
    name,
    org_code
   FROM public.organisations;


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL
);


--
-- Name: payment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    member_id uuid,
    amount numeric DEFAULT 0,
    mpesa_ref text,
    payment_date date DEFAULT CURRENT_DATE,
    allocations jsonb,
    status text DEFAULT 'pending'::text,
    requested_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    reference text,
    payment_type text,
    paystack_ref text,
    paystack_status text,
    provider text DEFAULT 'paystack'::text,
    CONSTRAINT payment_requests_provider_check CHECK ((provider = ANY (ARRAY['paystack'::text, 'fingo'::text, 'sasapay'::text, 'daraja'::text])))
);


--
-- Name: payment_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid,
    org_id uuid NOT NULL,
    fund_type text NOT NULL,
    amount numeric NOT NULL,
    settlement_fee numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    method text,
    checkout_id text,
    provider_reference text,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    outcome_uncertain boolean DEFAULT false NOT NULL,
    CONSTRAINT payment_settlements_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payment_settlements_fund_type_check CHECK ((fund_type = ANY (ARRAY['regular'::text, 'welfare'::text]))),
    CONSTRAINT payment_settlements_method_check CHECK ((method = ANY (ARRAY['b2c'::text, 'b2b'::text, 'manual'::text]))),
    CONSTRAINT payment_settlements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'settled'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: pending_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    status text DEFAULT 'pending'::text,
    requested_at timestamp without time zone DEFAULT now(),
    reviewed_by uuid,
    reviewed_at timestamp without time zone,
    linked_member_id uuid,
    notes text
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id integer DEFAULT 1 NOT NULL,
    support_phone text DEFAULT '0792385970'::text,
    support_email text DEFAULT 'support@groupyetu360.com'::text,
    bank_name text DEFAULT 'Equity Bank'::text,
    bank_account text,
    bank_account_name text DEFAULT 'EPH Technologies'::text,
    paybill text,
    updated_at timestamp without time zone DEFAULT now(),
    whatsapp text,
    at_api_key text,
    at_username text,
    at_sender_id text,
    daraja_consumer_key text,
    daraja_consumer_secret text,
    daraja_shortcode text,
    daraja_passkey text,
    daraja_env text DEFAULT 'sandbox'::text,
    daraja_enabled boolean DEFAULT false,
    promo_active boolean DEFAULT true,
    payment_mode text DEFAULT 'manual'::text,
    promo_days text DEFAULT '60'::text,
    sms_provider text DEFAULT 'leopard'::text,
    sms_leopard_access_token text,
    sms_leopard_sender_id text DEFAULT 'SMS_Leopard'::text,
    sms_leopard_api_key text,
    sms_leopard_api_secret text,
    celcom_api_key text,
    celcom_partner_id text,
    celcom_shortcode text,
    paystack_secret_key text,
    paystack_public_key text,
    paystack_enabled boolean DEFAULT false,
    manual_enabled boolean DEFAULT true,
    platform_fee_percent numeric(5,3) DEFAULT 0.5,
    paystack_fee_percent numeric(5,3) DEFAULT 1.5,
    fingo_fee_multiplier numeric(4,2) DEFAULT 2.0,
    fingo_api_key text,
    fingo_webhook_secret text,
    vapid_public_key text,
    vapid_private_key text,
    vapid_subject text DEFAULT 'mailto:info@groupyetu.org'::text,
    sasapay_client_id text,
    sasapay_client_secret text,
    sasapay_merchant_code text,
    sasapay_base_url text DEFAULT 'https://sandbox.sasapay.app'::text,
    subscription_payment_provider text DEFAULT 'paystack'::text,
    sasapay_fee_percent numeric(5,3) DEFAULT 0.2,
    sasapay_platform_fee_percent numeric(5,3) DEFAULT 1.3,
    daraja_autopilot_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT platform_settings_id_check CHECK ((id = 1)),
    CONSTRAINT platform_settings_sms_provider_check CHECK ((sms_provider = ANY (ARRAY['leopard'::text, 'celcom'::text, 'at'::text]))),
    CONSTRAINT platform_settings_subscription_payment_provider_check CHECK ((subscription_payment_provider = ANY (ARRAY['paystack'::text, 'sasapay'::text, 'daraja'::text])))
);


--
-- Name: platform_settings_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.platform_settings_public AS
 SELECT support_phone,
    support_email,
    whatsapp,
    bank_name,
    bank_account,
    bank_account_name,
    paybill,
    sms_provider,
    payment_mode,
    manual_enabled,
    paystack_enabled,
    paystack_public_key,
    promo_active,
    promo_days,
    daraja_env,
    daraja_enabled,
    updated_at,
    platform_fee_percent,
    paystack_fee_percent,
    fingo_fee_multiplier,
    vapid_public_key,
    subscription_payment_provider,
    sasapay_fee_percent,
    sasapay_platform_fee_percent
   FROM public.platform_settings;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    org_id uuid,
    role text DEFAULT 'member'::text NOT NULL,
    full_name text,
    phone text,
    id_number text,
    created_at timestamp without time zone DEFAULT now(),
    two_fa_enabled boolean DEFAULT false,
    email text
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    location text,
    acquisition_cost numeric DEFAULT 0,
    status text DEFAULT 'active'::text,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth_key text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: round_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_id uuid,
    slot_id uuid,
    org_id uuid,
    contributor_member_id uuid,
    amount numeric DEFAULT 0,
    payment_date date DEFAULT CURRENT_DATE,
    mpesa_ref text,
    method text DEFAULT 'cash'::text,
    status text DEFAULT 'paid'::text,
    recorded_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    provider text,
    CONSTRAINT round_contributions_provider_check CHECK ((provider = ANY (ARRAY['sasapay'::text, 'fingo'::text])))
);


--
-- Name: round_disbursements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_disbursements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_id uuid,
    slot_id uuid,
    org_id uuid,
    receiving_member_id uuid,
    amount numeric DEFAULT 0,
    disbursement_date date DEFAULT CURRENT_DATE,
    mpesa_ref text,
    method text DEFAULT 'mpesa'::text,
    disbursed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: round_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_id uuid,
    org_id uuid,
    member_id uuid,
    slot_number integer NOT NULL,
    scheduled_date date,
    received boolean DEFAULT false,
    received_date date,
    amount_received numeric DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: savings_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    name text NOT NULL,
    amount_per_member numeric DEFAULT 0,
    frequency text DEFAULT 'monthly'::text,
    collection_method text DEFAULT 'treasurer'::text,
    status text DEFAULT 'active'::text,
    start_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    pool_members jsonb,
    default_fine_amount numeric(10,2),
    CONSTRAINT savings_rounds_collection_method_check CHECK ((collection_method = ANY (ARRAY['treasurer'::text, 'direct'::text, 'group_account'::text])))
);


--
-- Name: settlement_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    provider text NOT NULL,
    settlement_date date NOT NULL,
    line_type text NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payout_method text,
    payout_reference text,
    notes text,
    paid_at timestamp with time zone,
    paid_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    welfare_event_id uuid,
    requested_at timestamp with time zone,
    requested_by uuid,
    payout_destination_type text DEFAULT 'group_platform'::text,
    payout_destination_snapshot jsonb,
    round_slot_id uuid,
    auto_settled boolean DEFAULT false NOT NULL,
    CONSTRAINT settlement_batches_line_type_check CHECK ((line_type = ANY (ARRAY['regular'::text, 'welfare'::text, 'table_banking'::text, 'mgr'::text]))),
    CONSTRAINT settlement_batches_payout_destination_type_check CHECK ((payout_destination_type = ANY (ARRAY['group_platform'::text, 'direct'::text]))),
    CONSTRAINT settlement_batches_payout_method_check CHECK ((payout_method = ANY (ARRAY['bank'::text, 'mpesa'::text]))),
    CONSTRAINT settlement_batches_provider_check CHECK ((provider = ANY (ARRAY['sasapay'::text, 'fingo'::text, 'paystack'::text]))),
    CONSTRAINT settlement_batches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text])))
);


--
-- Name: sms_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    messages_sent integer DEFAULT 0,
    cost_to_platform numeric DEFAULT 0,
    charged_to_org numeric DEFAULT 0,
    month text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: table_banking_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_banking_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_id uuid,
    org_id uuid,
    member_id uuid,
    amount numeric DEFAULT 0,
    payment_date date DEFAULT CURRENT_DATE,
    mpesa_ref text,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    provider text,
    CONSTRAINT table_banking_contributions_provider_check CHECK ((provider = ANY (ARRAY['sasapay'::text, 'fingo'::text])))
);


--
-- Name: table_banking_loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_banking_loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_id uuid,
    org_id uuid,
    member_id uuid,
    principal numeric DEFAULT 0,
    interest_rate numeric DEFAULT 10,
    disbursed_date date DEFAULT CURRENT_DATE,
    due_date date,
    status text DEFAULT 'active'::text,
    total_repaid numeric DEFAULT 0,
    notes text,
    issued_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: table_banking_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_banking_pools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    name text DEFAULT 'Table Banking Pool'::text NOT NULL,
    cycle_name text,
    status text DEFAULT 'active'::text,
    interest_rate numeric DEFAULT 10,
    start_date date DEFAULT CURRENT_DATE,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    pool_members jsonb,
    max_loan_per_member numeric(10,2),
    default_fine_amount numeric(10,2)
);


--
-- Name: table_banking_repayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_banking_repayments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid,
    org_id uuid,
    member_id uuid,
    amount numeric DEFAULT 0,
    principal_paid numeric DEFAULT 0,
    interest_paid numeric DEFAULT 0,
    payment_date date DEFAULT CURRENT_DATE,
    mpesa_ref text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: taya_faq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taya_faq (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    triggers text[] NOT NULL,
    answer text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: taya_question_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taya_question_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    user_id uuid,
    question text NOT NULL,
    handled_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: taya_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taya_usage_log (
    org_id uuid NOT NULL,
    usage_date date DEFAULT CURRENT_DATE NOT NULL,
    request_count integer DEFAULT 0 NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    member_id uuid,
    type_id uuid,
    amount numeric NOT NULL,
    mpesa_ref text,
    transaction_date date,
    notes text,
    recorded_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    welfare_event_id uuid
);


--
-- Name: user_orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_orgs (
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    role text DEFAULT 'member'::text,
    joined_at timestamp with time zone DEFAULT now()
);


--
-- Name: welfare_event_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.welfare_event_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    default_amount numeric(10,2) DEFAULT 0 NOT NULL,
    category text DEFAULT 'bereavement'::text,
    scope text DEFAULT 'member_specific'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: welfare_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.welfare_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    affected_member_id uuid,
    event_type text,
    contribution_per_member numeric,
    event_date date,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    welfare_type_id uuid,
    paid_count integer DEFAULT 0,
    closed_by uuid,
    closed_at timestamp with time zone,
    payout_type text DEFAULT 'group_platform'::text,
    recipient_name text,
    recipient_phone text,
    recipient_bank_name text,
    recipient_bank_account text,
    CONSTRAINT welfare_events_payout_type_check CHECK ((payout_type = ANY (ARRAY['group_platform'::text, 'direct'::text])))
);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_meeting_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_meeting_id_member_id_key UNIQUE (meeting_id, member_id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: balance_adjustments balance_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_pkey PRIMARY KEY (id);


--
-- Name: broadcast_log broadcast_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_log
    ADD CONSTRAINT broadcast_log_pkey PRIMARY KEY (id);


--
-- Name: collection_activation_requests collection_activation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_activation_requests
    ADD CONSTRAINT collection_activation_requests_pkey PRIMARY KEY (id);


--
-- Name: contribution_types contribution_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_types
    ADD CONSTRAINT contribution_types_pkey PRIMARY KEY (id);


--
-- Name: disbursement_records disbursement_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disbursement_records
    ADD CONSTRAINT disbursement_records_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: feature_requests feature_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_requests
    ADD CONSTRAINT feature_requests_pkey PRIMARY KEY (id);


--
-- Name: fines fines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: merry_go_round_cycles merry_go_round_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merry_go_round_cycles
    ADD CONSTRAINT merry_go_round_cycles_pkey PRIMARY KEY (id);


--
-- Name: messages_log messages_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_pkey PRIMARY KEY (id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


--
-- Name: org_payment_providers org_payment_providers_org_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_payment_providers
    ADD CONSTRAINT org_payment_providers_org_id_provider_key UNIQUE (org_id, provider);


--
-- Name: org_payment_providers org_payment_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_payment_providers
    ADD CONSTRAINT org_payment_providers_pkey PRIMARY KEY (id);


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: payment_requests payment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_pkey PRIMARY KEY (id);


--
-- Name: payment_settlements payment_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_settlements
    ADD CONSTRAINT payment_settlements_pkey PRIMARY KEY (id);


--
-- Name: pending_members pending_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_members
    ADD CONSTRAINT pending_members_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: round_contributions round_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_pkey PRIMARY KEY (id);


--
-- Name: round_disbursements round_disbursements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_pkey PRIMARY KEY (id);


--
-- Name: round_slots round_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_slots
    ADD CONSTRAINT round_slots_pkey PRIMARY KEY (id);


--
-- Name: round_slots round_slots_round_id_slot_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_slots
    ADD CONSTRAINT round_slots_round_id_slot_number_key UNIQUE (round_id, slot_number);


--
-- Name: savings_rounds savings_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_rounds
    ADD CONSTRAINT savings_rounds_pkey PRIMARY KEY (id);


--
-- Name: settlement_batches settlement_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_batches
    ADD CONSTRAINT settlement_batches_pkey PRIMARY KEY (id);


--
-- Name: sms_usage sms_usage_org_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_usage
    ADD CONSTRAINT sms_usage_org_id_month_key UNIQUE (org_id, month);


--
-- Name: sms_usage sms_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_usage
    ADD CONSTRAINT sms_usage_pkey PRIMARY KEY (id);


--
-- Name: table_banking_contributions table_banking_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_contributions
    ADD CONSTRAINT table_banking_contributions_pkey PRIMARY KEY (id);


--
-- Name: table_banking_loans table_banking_loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_loans
    ADD CONSTRAINT table_banking_loans_pkey PRIMARY KEY (id);


--
-- Name: table_banking_pools table_banking_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_pools
    ADD CONSTRAINT table_banking_pools_pkey PRIMARY KEY (id);


--
-- Name: table_banking_repayments table_banking_repayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_repayments
    ADD CONSTRAINT table_banking_repayments_pkey PRIMARY KEY (id);


--
-- Name: taya_faq taya_faq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taya_faq
    ADD CONSTRAINT taya_faq_pkey PRIMARY KEY (id);


--
-- Name: taya_question_log taya_question_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taya_question_log
    ADD CONSTRAINT taya_question_log_pkey PRIMARY KEY (id);


--
-- Name: taya_usage_log taya_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taya_usage_log
    ADD CONSTRAINT taya_usage_log_pkey PRIMARY KEY (org_id, usage_date);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_orgs user_orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_orgs
    ADD CONSTRAINT user_orgs_pkey PRIMARY KEY (user_id, org_id);


--
-- Name: welfare_event_types welfare_event_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_event_types
    ADD CONSTRAINT welfare_event_types_pkey PRIMARY KEY (id);


--
-- Name: welfare_events welfare_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_events
    ADD CONSTRAINT welfare_events_pkey PRIMARY KEY (id);


--
-- Name: idx_activity_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_created ON public.activity_log USING btree (created_at DESC);


--
-- Name: idx_activity_log_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_org ON public.activity_log USING btree (org_id);


--
-- Name: idx_fines_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fines_member_id ON public.fines USING btree (member_id);


--
-- Name: idx_fines_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fines_org_id ON public.fines USING btree (org_id);


--
-- Name: idx_fines_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fines_status ON public.fines USING btree (org_id, status);


--
-- Name: idx_members_internal_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_internal_number ON public.members USING btree (org_id, internal_number);


--
-- Name: idx_members_is_founder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_is_founder ON public.members USING btree (org_id, is_founder);


--
-- Name: idx_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_user_id ON public.members USING btree (user_id);


--
-- Name: idx_notification_log_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_log_user_created ON public.notification_log USING btree (user_id, created_at DESC);


--
-- Name: idx_org_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_org_code ON public.organisations USING btree (org_code);


--
-- Name: idx_payment_requests_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_requests_member ON public.payment_requests USING btree (member_id);


--
-- Name: idx_payment_requests_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_requests_org_status ON public.payment_requests USING btree (org_id, status);


--
-- Name: idx_payment_settlements_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_settlements_checkout ON public.payment_settlements USING btree (checkout_id);


--
-- Name: idx_payment_settlements_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_settlements_org ON public.payment_settlements USING btree (org_id);


--
-- Name: idx_payment_settlements_pr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_settlements_pr ON public.payment_settlements USING btree (payment_request_id);


--
-- Name: idx_payment_settlements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_settlements_status ON public.payment_settlements USING btree (status);


--
-- Name: idx_round_contrib_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_round_contrib_member ON public.round_contributions USING btree (contributor_member_id);


--
-- Name: idx_round_contrib_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_round_contrib_slot ON public.round_contributions USING btree (slot_id);


--
-- Name: idx_round_slots_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_round_slots_round ON public.round_slots USING btree (round_id);


--
-- Name: idx_savings_rounds_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_savings_rounds_org ON public.savings_rounds USING btree (org_id);


--
-- Name: idx_settlement_batches_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_batches_org_date ON public.settlement_batches USING btree (org_id, settlement_date DESC);


--
-- Name: idx_settlement_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_batches_status ON public.settlement_batches USING btree (status);


--
-- Name: idx_settlement_mgr_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_settlement_mgr_unique ON public.settlement_batches USING btree (org_id, provider, round_slot_id) WHERE (round_slot_id IS NOT NULL);


--
-- Name: idx_settlement_regular_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_settlement_regular_unique ON public.settlement_batches USING btree (org_id, provider, settlement_date) WHERE (line_type = 'regular'::text);


--
-- Name: idx_settlement_welfare_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_settlement_welfare_unique ON public.settlement_batches USING btree (org_id, provider, welfare_event_id) WHERE (line_type = 'welfare'::text);


--
-- Name: idx_tb_contribs_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tb_contribs_pool ON public.table_banking_contributions USING btree (pool_id);


--
-- Name: idx_tb_loans_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tb_loans_member ON public.table_banking_loans USING btree (member_id);


--
-- Name: idx_tb_loans_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tb_loans_pool ON public.table_banking_loans USING btree (pool_id);


--
-- Name: idx_tb_pools_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tb_pools_org ON public.table_banking_pools USING btree (org_id);


--
-- Name: idx_tb_repayments_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tb_repayments_loan ON public.table_banking_repayments USING btree (loan_id);


--
-- Name: idx_user_orgs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_orgs_org ON public.user_orgs USING btree (org_id);


--
-- Name: idx_user_orgs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_orgs_user ON public.user_orgs USING btree (user_id);


--
-- Name: idx_welfare_event_types_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_welfare_event_types_org ON public.welfare_event_types USING btree (org_id);


--
-- Name: idx_welfare_events_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_welfare_events_is_active ON public.welfare_events USING btree (org_id, is_active);


--
-- Name: members_household_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_household_principal_idx ON public.members USING btree (household_principal_id);


--
-- Name: otp_codes_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_codes_email_idx ON public.otp_codes USING btree (email);


--
-- Name: payment_requests_daraja_checkout_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_requests_daraja_checkout_unique ON public.payment_requests USING btree (paystack_ref) WHERE (provider = 'daraja'::text);


--
-- Name: payment_settlements_one_per_fund; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_settlements_one_per_fund ON public.payment_settlements USING btree (payment_request_id, fund_type);


--
-- Name: pending_members_one_per_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pending_members_one_per_email ON public.pending_members USING btree (org_id, lower(TRIM(BOTH FROM email))) WHERE ((status = 'pending'::text) AND (email IS NOT NULL) AND (TRIM(BOTH FROM email) <> ''::text));


--
-- Name: pending_members_one_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pending_members_one_per_user ON public.pending_members USING btree (org_id, user_id) WHERE ((status = 'pending'::text) AND (user_id IS NOT NULL));


--
-- Name: members gy360_check_household_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_check_household_link BEFORE INSERT OR UPDATE OF household_principal_id ON public.members FOR EACH ROW EXECUTE FUNCTION public.gy360_check_household_link();


--
-- Name: user_orgs gy360_close_join_request_on_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_close_join_request_on_membership AFTER INSERT ON public.user_orgs FOR EACH ROW EXECUTE FUNCTION public.gy360_close_join_request_on_membership();


--
-- Name: payment_requests gy360_guard_daraja_payment_requests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_daraja_payment_requests BEFORE INSERT OR DELETE OR UPDATE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_daraja_payment_requests();


--
-- Name: organisations gy360_guard_instant_pay_switch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_instant_pay_switch BEFORE INSERT OR UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_instant_pay_switch();


--
-- Name: pending_members gy360_guard_join_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_join_request BEFORE INSERT ON public.pending_members FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_join_request();


--
-- Name: organisations gy360_guard_org_destination; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_org_destination BEFORE INSERT OR UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_org_destination();


--
-- Name: organisations gy360_guard_org_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_org_plan BEFORE INSERT OR UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_org_plan();


--
-- Name: profiles gy360_guard_profile_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_profile_role BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_profile_role();


--
-- Name: user_orgs gy360_guard_user_orgs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gy360_guard_user_orgs BEFORE INSERT OR UPDATE ON public.user_orgs FOR EACH ROW EXECUTE FUNCTION public.gy360_guard_user_orgs();


--
-- Name: activity_log activity_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: activity_log activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: attendance attendance_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id);


--
-- Name: attendance attendance_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: balance_adjustments balance_adjustments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: balance_adjustments balance_adjustments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id);


--
-- Name: balance_adjustments balance_adjustments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: collection_activation_requests collection_activation_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_activation_requests
    ADD CONSTRAINT collection_activation_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: contribution_types contribution_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_types
    ADD CONSTRAINT contribution_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: disbursement_records disbursement_records_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disbursement_records
    ADD CONSTRAINT disbursement_records_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: expenses expenses_welfare_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_welfare_event_id_fkey FOREIGN KEY (welfare_event_id) REFERENCES public.welfare_events(id);


--
-- Name: feature_requests feature_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_requests
    ADD CONSTRAINT feature_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: fines fines_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: fines fines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: members members_household_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_household_principal_id_fkey FOREIGN KEY (household_principal_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: members members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: members members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: merry_go_round_cycles merry_go_round_cycles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merry_go_round_cycles
    ADD CONSTRAINT merry_go_round_cycles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: messages_log messages_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: messages_log messages_log_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.profiles(id);


--
-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: org_payment_providers org_payment_providers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_payment_providers
    ADD CONSTRAINT org_payment_providers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: payment_requests payment_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: payment_requests payment_requests_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: payment_requests payment_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: payment_settlements payment_settlements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_settlements
    ADD CONSTRAINT payment_settlements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id);


--
-- Name: payment_settlements payment_settlements_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_settlements
    ADD CONSTRAINT payment_settlements_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id);


--
-- Name: pending_members pending_members_linked_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_members
    ADD CONSTRAINT pending_members_linked_member_id_fkey FOREIGN KEY (linked_member_id) REFERENCES public.members(id);


--
-- Name: pending_members pending_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_members
    ADD CONSTRAINT pending_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: pending_members pending_members_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_members
    ADD CONSTRAINT pending_members_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: pending_members pending_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_members
    ADD CONSTRAINT pending_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);


--
-- Name: profiles profiles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: projects projects_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: round_contributions round_contributions_contributor_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_contributor_member_id_fkey FOREIGN KEY (contributor_member_id) REFERENCES public.members(id);


--
-- Name: round_contributions round_contributions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: round_contributions round_contributions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: round_contributions round_contributions_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.savings_rounds(id) ON DELETE CASCADE;


--
-- Name: round_contributions round_contributions_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_contributions
    ADD CONSTRAINT round_contributions_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.round_slots(id) ON DELETE CASCADE;


--
-- Name: round_disbursements round_disbursements_disbursed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_disbursed_by_fkey FOREIGN KEY (disbursed_by) REFERENCES public.profiles(id);


--
-- Name: round_disbursements round_disbursements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: round_disbursements round_disbursements_receiving_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_receiving_member_id_fkey FOREIGN KEY (receiving_member_id) REFERENCES public.members(id);


--
-- Name: round_disbursements round_disbursements_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.savings_rounds(id) ON DELETE CASCADE;


--
-- Name: round_disbursements round_disbursements_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_disbursements
    ADD CONSTRAINT round_disbursements_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.round_slots(id) ON DELETE CASCADE;


--
-- Name: round_slots round_slots_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_slots
    ADD CONSTRAINT round_slots_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: round_slots round_slots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_slots
    ADD CONSTRAINT round_slots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: round_slots round_slots_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_slots
    ADD CONSTRAINT round_slots_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.savings_rounds(id) ON DELETE CASCADE;


--
-- Name: savings_rounds savings_rounds_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_rounds
    ADD CONSTRAINT savings_rounds_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: savings_rounds savings_rounds_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_rounds
    ADD CONSTRAINT savings_rounds_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: settlement_batches settlement_batches_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_batches
    ADD CONSTRAINT settlement_batches_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: settlement_batches settlement_batches_round_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_batches
    ADD CONSTRAINT settlement_batches_round_slot_id_fkey FOREIGN KEY (round_slot_id) REFERENCES public.round_slots(id) ON DELETE SET NULL;


--
-- Name: settlement_batches settlement_batches_welfare_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_batches
    ADD CONSTRAINT settlement_batches_welfare_event_id_fkey FOREIGN KEY (welfare_event_id) REFERENCES public.welfare_events(id) ON DELETE SET NULL;


--
-- Name: sms_usage sms_usage_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_usage
    ADD CONSTRAINT sms_usage_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: table_banking_contributions table_banking_contributions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_contributions
    ADD CONSTRAINT table_banking_contributions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: table_banking_contributions table_banking_contributions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_contributions
    ADD CONSTRAINT table_banking_contributions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: table_banking_contributions table_banking_contributions_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_contributions
    ADD CONSTRAINT table_banking_contributions_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.table_banking_pools(id) ON DELETE CASCADE;


--
-- Name: table_banking_contributions table_banking_contributions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_contributions
    ADD CONSTRAINT table_banking_contributions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: table_banking_loans table_banking_loans_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_loans
    ADD CONSTRAINT table_banking_loans_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.profiles(id);


--
-- Name: table_banking_loans table_banking_loans_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_loans
    ADD CONSTRAINT table_banking_loans_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: table_banking_loans table_banking_loans_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_loans
    ADD CONSTRAINT table_banking_loans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: table_banking_loans table_banking_loans_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_loans
    ADD CONSTRAINT table_banking_loans_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.table_banking_pools(id) ON DELETE CASCADE;


--
-- Name: table_banking_pools table_banking_pools_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_pools
    ADD CONSTRAINT table_banking_pools_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: table_banking_pools table_banking_pools_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_pools
    ADD CONSTRAINT table_banking_pools_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: table_banking_repayments table_banking_repayments_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_repayments
    ADD CONSTRAINT table_banking_repayments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.table_banking_loans(id) ON DELETE CASCADE;


--
-- Name: table_banking_repayments table_banking_repayments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_repayments
    ADD CONSTRAINT table_banking_repayments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: table_banking_repayments table_banking_repayments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_repayments
    ADD CONSTRAINT table_banking_repayments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: table_banking_repayments table_banking_repayments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_banking_repayments
    ADD CONSTRAINT table_banking_repayments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: transactions transactions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.contribution_types(id);


--
-- Name: transactions transactions_welfare_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_welfare_event_id_fkey FOREIGN KEY (welfare_event_id) REFERENCES public.welfare_events(id) ON DELETE SET NULL;


--
-- Name: user_orgs user_orgs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_orgs
    ADD CONSTRAINT user_orgs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: user_orgs user_orgs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_orgs
    ADD CONSTRAINT user_orgs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: welfare_event_types welfare_event_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_event_types
    ADD CONSTRAINT welfare_event_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: welfare_events welfare_events_affected_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_events
    ADD CONSTRAINT welfare_events_affected_member_id_fkey FOREIGN KEY (affected_member_id) REFERENCES public.members(id);


--
-- Name: welfare_events welfare_events_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_events
    ADD CONSTRAINT welfare_events_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id);


--
-- Name: welfare_events welfare_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_events
    ADD CONSTRAINT welfare_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: welfare_events welfare_events_welfare_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.welfare_events
    ADD CONSTRAINT welfare_events_welfare_type_id_fkey FOREIGN KEY (welfare_type_id) REFERENCES public.welfare_event_types(id) ON DELETE SET NULL;


--
-- Name: welfare_event_types Admins can manage welfare types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage welfare types" ON public.welfare_event_types USING (true);


--
-- Name: welfare_event_types Org members can view welfare types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can view welfare types" ON public.welfare_event_types FOR SELECT USING (true);


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log activity_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_log_insert ON public.activity_log FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND ((org_id IS NULL) OR public.gy360_is_member(org_id))));


--
-- Name: activity_log activity_log_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_log_read ON public.activity_log FOR SELECT USING (public.gy360_is_official(org_id));


--
-- Name: balance_adjustments adjustments_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY adjustments_org ON public.balance_adjustments USING (((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text))))));


--
-- Name: user_orgs admins_manage_org_user_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_manage_org_user_orgs ON public.user_orgs USING (public.gy360_is_org_admin(org_id)) WITH CHECK (public.gy360_is_org_admin(org_id));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_org ON public.attendance USING (((meeting_id IN ( SELECT meetings.id
   FROM public.meetings
  WHERE (meetings.org_id IN ( SELECT profiles.org_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text))))));


--
-- Name: balance_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_log ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_log broadcast_log_sa_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcast_log_sa_all ON public.broadcast_log USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: collection_activation_requests car_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY car_insert ON public.collection_activation_requests FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.user_orgs
  WHERE ((user_orgs.user_id = auth.uid()) AND (user_orgs.org_id = collection_activation_requests.org_id) AND (user_orgs.role = 'admin'::text))))));


--
-- Name: collection_activation_requests car_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY car_select ON public.collection_activation_requests FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.user_orgs
  WHERE ((user_orgs.user_id = auth.uid()) AND (user_orgs.org_id = collection_activation_requests.org_id) AND (user_orgs.role = 'admin'::text))))));


--
-- Name: collection_activation_requests car_update_sa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY car_update_sa ON public.collection_activation_requests FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: collection_activation_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collection_activation_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: contribution_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contribution_types ENABLE ROW LEVEL SECURITY;

--
-- Name: contribution_types contribution_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contribution_types_delete ON public.contribution_types FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: contribution_types contribution_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contribution_types_insert ON public.contribution_types FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: contribution_types contribution_types_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contribution_types_read ON public.contribution_types FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: contribution_types contribution_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contribution_types_update ON public.contribution_types FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: disbursement_records disb_all_sa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disb_all_sa ON public.disbursement_records USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: disbursement_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disbursement_records ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses expenses_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_delete ON public.expenses FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: expenses expenses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_insert ON public.expenses FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: expenses expenses_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_read ON public.expenses FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: expenses expenses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_update ON public.expenses FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: feature_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_requests feature_requests_admin_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feature_requests_admin_rw ON public.feature_requests USING (((EXISTS ( SELECT 1
   FROM public.user_orgs uo
  WHERE ((uo.user_id = auth.uid()) AND (uo.org_id = feature_requests.org_id) AND (uo.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.user_orgs uo
  WHERE ((uo.user_id = auth.uid()) AND (uo.org_id = feature_requests.org_id) AND (uo.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text))))));


--
-- Name: fines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fines ENABLE ROW LEVEL SECURITY;

--
-- Name: fines fines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fines_delete ON public.fines FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: fines fines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fines_insert ON public.fines FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: fines fines_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fines_read ON public.fines FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: fines fines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fines_update ON public.fines FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings meetings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_delete ON public.meetings FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: meetings meetings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_insert ON public.meetings FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: meetings meetings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_read ON public.meetings FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: meetings meetings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_update ON public.meetings FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: members members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_delete ON public.members FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: members members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_insert ON public.members FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: members members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_read ON public.members FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: members members_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_update ON public.members FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: merry_go_round_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merry_go_round_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: messages_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages_log ENABLE ROW LEVEL SECURITY;

--
-- Name: messages_log messages_log_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_log_delete ON public.messages_log FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: messages_log messages_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_log_insert ON public.messages_log FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: messages_log messages_log_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_log_read ON public.messages_log FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: messages_log messages_log_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_log_update ON public.messages_log FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: merry_go_round_cycles mgr_cycles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mgr_cycles_insert ON public.merry_go_round_cycles FOR INSERT WITH CHECK ((org_id IN ( SELECT user_orgs.org_id
   FROM public.user_orgs
  WHERE (user_orgs.user_id = auth.uid()))));


--
-- Name: merry_go_round_cycles mgr_cycles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mgr_cycles_select ON public.merry_go_round_cycles FOR SELECT USING ((org_id IN ( SELECT user_orgs.org_id
   FROM public.user_orgs
  WHERE (user_orgs.user_id = auth.uid()))));


--
-- Name: notification_log notif_log_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_log_own ON public.notification_log USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: notification_log notif_log_sa_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_log_sa_read ON public.notification_log FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: org_payment_providers opp_delete_sa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opp_delete_sa ON public.org_payment_providers FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: org_payment_providers opp_insert_sa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opp_insert_sa ON public.org_payment_providers FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: org_payment_providers opp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opp_select ON public.org_payment_providers FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.user_orgs
  WHERE ((user_orgs.user_id = auth.uid()) AND (user_orgs.org_id = org_payment_providers.org_id))))));


--
-- Name: org_payment_providers opp_update_sa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opp_update_sa ON public.org_payment_providers FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: org_payment_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_payment_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: round_contributions org_round_contributions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_round_contributions ON public.round_contributions USING ((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: round_disbursements org_round_disbursements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_round_disbursements ON public.round_disbursements USING ((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: round_slots org_round_slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_round_slots ON public.round_slots USING ((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: organisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

--
-- Name: organisations orgs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_delete ON public.organisations FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: organisations orgs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_insert ON public.organisations FOR INSERT WITH CHECK (public.gy360_is_sa());


--
-- Name: organisations orgs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_read ON public.organisations FOR SELECT USING (public.gy360_is_member(id));


--
-- Name: organisations orgs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_update ON public.organisations FOR UPDATE USING (public.gy360_is_org_admin(id)) WITH CHECK (public.gy360_is_org_admin(id));


--
-- Name: otp_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_requests payment_requests_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_requests_delete ON public.payment_requests FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: payment_requests payment_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_requests_insert ON public.payment_requests FOR INSERT WITH CHECK ((public.gy360_is_official(org_id) OR (public.gy360_is_member(org_id) AND (status = 'pending'::text))));


--
-- Name: payment_requests payment_requests_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_requests_read ON public.payment_requests FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: payment_requests payment_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_requests_update ON public.payment_requests FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: payment_settlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_members pending_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pending_all ON public.pending_members USING (((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text))))));


--
-- Name: pending_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_members ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings platform_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: platform_settings platform_settings_sa_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_sa_all ON public.platform_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: platform_settings platform_settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_write ON public.platform_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK ((id = auth.uid()));


--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (true);


--
-- Name: profiles profiles_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE USING ((public.gy360_is_sa() OR ((org_id IS NOT NULL) AND public.gy360_is_org_admin(org_id)))) WITH CHECK ((public.gy360_is_sa() OR ((org_id IS NOT NULL) AND public.gy360_is_org_admin(org_id))));


--
-- Name: profiles profiles_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (role = ( SELECT profiles_1.role
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_delete ON public.projects FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: projects projects_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_insert ON public.projects FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: projects projects_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_read ON public.projects FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: projects projects_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_update ON public.projects FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: push_subscriptions push_sub_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_sub_own ON public.push_subscriptions USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: round_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.round_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: round_disbursements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.round_disbursements ENABLE ROW LEVEL SECURITY;

--
-- Name: round_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.round_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_settlements sa_manage_payment_settlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sa_manage_payment_settlements ON public.payment_settlements USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: savings_rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.savings_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: savings_rounds savings_rounds_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY savings_rounds_delete ON public.savings_rounds FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: savings_rounds savings_rounds_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY savings_rounds_insert ON public.savings_rounds FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: savings_rounds savings_rounds_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY savings_rounds_read ON public.savings_rounds FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: savings_rounds savings_rounds_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY savings_rounds_update ON public.savings_rounds FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: settlement_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_batches settlement_org_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_org_read ON public.settlement_batches FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_orgs
  WHERE ((user_orgs.user_id = auth.uid()) AND (user_orgs.org_id = settlement_batches.org_id) AND (user_orgs.role = ANY (ARRAY['admin'::text, 'treasurer'::text, 'officer'::text]))))));


--
-- Name: settlement_batches settlement_org_request_welfare; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_org_request_welfare ON public.settlement_batches FOR INSERT WITH CHECK (((line_type = 'welfare'::text) AND (requested_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.user_orgs
  WHERE ((user_orgs.user_id = auth.uid()) AND (user_orgs.org_id = settlement_batches.org_id) AND (user_orgs.role = ANY (ARRAY['admin'::text, 'treasurer'::text, 'officer'::text])))))));


--
-- Name: settlement_batches settlement_sa_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_sa_all ON public.settlement_batches USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: sms_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sms_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_usage sms_usage_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sms_usage_org ON public.sms_usage USING (((org_id IN ( SELECT profiles.org_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text))))));


--
-- Name: activity_log superadmin_read_activity_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_read_activity_log ON public.activity_log FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))));


--
-- Name: user_orgs superadmin_read_all_user_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_read_all_user_orgs ON public.user_orgs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: table_banking_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.table_banking_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: table_banking_loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.table_banking_loans ENABLE ROW LEVEL SECURITY;

--
-- Name: table_banking_loans table_banking_loans_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_loans_delete ON public.table_banking_loans FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: table_banking_loans table_banking_loans_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_loans_insert ON public.table_banking_loans FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: table_banking_loans table_banking_loans_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_loans_read ON public.table_banking_loans FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: table_banking_loans table_banking_loans_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_loans_update ON public.table_banking_loans FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: table_banking_pools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.table_banking_pools ENABLE ROW LEVEL SECURITY;

--
-- Name: table_banking_pools table_banking_pools_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_pools_delete ON public.table_banking_pools FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: table_banking_pools table_banking_pools_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_pools_insert ON public.table_banking_pools FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: table_banking_pools table_banking_pools_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_pools_read ON public.table_banking_pools FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: table_banking_pools table_banking_pools_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY table_banking_pools_update ON public.table_banking_pools FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: table_banking_repayments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.table_banking_repayments ENABLE ROW LEVEL SECURITY;

--
-- Name: taya_faq; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taya_faq ENABLE ROW LEVEL SECURITY;

--
-- Name: taya_faq taya_faq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY taya_faq_read ON public.taya_faq FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: taya_question_log taya_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY taya_log_insert ON public.taya_question_log FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: taya_question_log taya_log_sa_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY taya_log_sa_read ON public.taya_question_log FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));


--
-- Name: taya_question_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taya_question_log ENABLE ROW LEVEL SECURITY;

--
-- Name: taya_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taya_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: table_banking_contributions tb_contrib_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tb_contrib_all ON public.table_banking_contributions USING ((org_id IN ( SELECT user_orgs.org_id
   FROM public.user_orgs
  WHERE (user_orgs.user_id = auth.uid()))));


--
-- Name: table_banking_repayments tb_repay_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tb_repay_all ON public.table_banking_repayments USING ((org_id IN ( SELECT user_orgs.org_id
   FROM public.user_orgs
  WHERE (user_orgs.user_id = auth.uid()))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_delete ON public.transactions FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: transactions transactions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_insert ON public.transactions FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: transactions transactions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_read ON public.transactions FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: transactions transactions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_update ON public.transactions FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: user_orgs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_orgs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_orgs users_insert_own_user_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_user_orgs ON public.user_orgs FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_orgs users_read_own_user_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_user_orgs ON public.user_orgs FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_orgs users_update_own_user_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own_user_orgs ON public.user_orgs FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: welfare_event_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.welfare_event_types ENABLE ROW LEVEL SECURITY;

--
-- Name: welfare_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.welfare_events ENABLE ROW LEVEL SECURITY;

--
-- Name: welfare_events welfare_events_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY welfare_events_delete ON public.welfare_events FOR DELETE USING (public.gy360_is_official(org_id));


--
-- Name: welfare_events welfare_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY welfare_events_insert ON public.welfare_events FOR INSERT WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: welfare_events welfare_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY welfare_events_read ON public.welfare_events FOR SELECT USING (public.gy360_is_member(org_id));


--
-- Name: welfare_events welfare_events_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY welfare_events_update ON public.welfare_events FOR UPDATE USING (public.gy360_is_official(org_id)) WITH CHECK (public.gy360_is_official(org_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION claim_my_member_records(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_my_member_records() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_my_member_records() TO authenticated;
GRANT ALL ON FUNCTION public.claim_my_member_records() TO service_role;


--
-- Name: FUNCTION create_organisation(p_name text, p_sms_label text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_organisation(p_name text, p_sms_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_organisation(p_name text, p_sms_label text) TO authenticated;
GRANT ALL ON FUNCTION public.create_organisation(p_name text, p_sms_label text) TO service_role;


--
-- Name: FUNCTION delete_user_completely(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_user_completely(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.delete_user_completely(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_user_completely(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_platform_settings_safe(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_platform_settings_safe() TO anon;
GRANT ALL ON FUNCTION public.get_platform_settings_safe() TO authenticated;
GRANT ALL ON FUNCTION public.get_platform_settings_safe() TO service_role;


--
-- Name: FUNCTION gy360_check_household_link(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_check_household_link() TO anon;
GRANT ALL ON FUNCTION public.gy360_check_household_link() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_check_household_link() TO service_role;


--
-- Name: FUNCTION gy360_close_join_request_on_membership(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_close_join_request_on_membership() TO anon;
GRANT ALL ON FUNCTION public.gy360_close_join_request_on_membership() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_close_join_request_on_membership() TO service_role;


--
-- Name: FUNCTION gy360_feature_usage(p_org uuid, p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gy360_feature_usage(p_org uuid, p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gy360_feature_usage(p_org uuid, p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_feature_usage(p_org uuid, p_key text) TO service_role;


--
-- Name: FUNCTION gy360_guard_daraja_payment_requests(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_daraja_payment_requests() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_daraja_payment_requests() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_daraja_payment_requests() TO service_role;


--
-- Name: FUNCTION gy360_guard_instant_pay_switch(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_instant_pay_switch() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_instant_pay_switch() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_instant_pay_switch() TO service_role;


--
-- Name: FUNCTION gy360_guard_join_request(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_join_request() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_join_request() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_join_request() TO service_role;


--
-- Name: FUNCTION gy360_guard_org_destination(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_org_destination() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_org_destination() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_org_destination() TO service_role;


--
-- Name: FUNCTION gy360_guard_org_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_org_plan() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_org_plan() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_org_plan() TO service_role;


--
-- Name: FUNCTION gy360_guard_profile_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_profile_role() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_profile_role() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_profile_role() TO service_role;


--
-- Name: FUNCTION gy360_guard_user_orgs(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_guard_user_orgs() TO anon;
GRANT ALL ON FUNCTION public.gy360_guard_user_orgs() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_guard_user_orgs() TO service_role;


--
-- Name: FUNCTION gy360_is_client_request(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_is_client_request() TO anon;
GRANT ALL ON FUNCTION public.gy360_is_client_request() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_is_client_request() TO service_role;


--
-- Name: FUNCTION gy360_is_member(p_org uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_is_member(p_org uuid) TO anon;
GRANT ALL ON FUNCTION public.gy360_is_member(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_is_member(p_org uuid) TO service_role;


--
-- Name: FUNCTION gy360_is_official(p_org uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_is_official(p_org uuid) TO anon;
GRANT ALL ON FUNCTION public.gy360_is_official(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_is_official(p_org uuid) TO service_role;


--
-- Name: FUNCTION gy360_is_org_admin(p_org uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_is_org_admin(p_org uuid) TO anon;
GRANT ALL ON FUNCTION public.gy360_is_org_admin(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_is_org_admin(p_org uuid) TO service_role;


--
-- Name: FUNCTION gy360_is_sa(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_is_sa() TO anon;
GRANT ALL ON FUNCTION public.gy360_is_sa() TO authenticated;
GRANT ALL ON FUNCTION public.gy360_is_sa() TO service_role;


--
-- Name: FUNCTION gy360_org_role(p_org uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_org_role(p_org uuid) TO anon;
GRANT ALL ON FUNCTION public.gy360_org_role(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_org_role(p_org uuid) TO service_role;


--
-- Name: FUNCTION gy360_shares_org(p_user uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gy360_shares_org(p_user uuid) TO anon;
GRANT ALL ON FUNCTION public.gy360_shares_org(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.gy360_shares_org(p_user uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION increment_taya_usage(p_org_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_taya_usage(p_org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.increment_taya_usage(p_org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.increment_taya_usage(p_org_id uuid) TO service_role;


--
-- Name: FUNCTION insert_founder_member(p_org_id uuid, p_user_id uuid, p_full_name text, p_phone text, p_email text, p_join_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.insert_founder_member(p_org_id uuid, p_user_id uuid, p_full_name text, p_phone text, p_email text, p_join_date date) TO anon;
GRANT ALL ON FUNCTION public.insert_founder_member(p_org_id uuid, p_user_id uuid, p_full_name text, p_phone text, p_email text, p_join_date date) TO authenticated;
GRANT ALL ON FUNCTION public.insert_founder_member(p_org_id uuid, p_user_id uuid, p_full_name text, p_phone text, p_email text, p_join_date date) TO service_role;


--
-- Name: FUNCTION link_member_to_org(p_user_id uuid, p_org_id uuid, p_role text, p_full_name text, p_phone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.link_member_to_org(p_user_id uuid, p_org_id uuid, p_role text, p_full_name text, p_phone text) TO anon;
GRANT ALL ON FUNCTION public.link_member_to_org(p_user_id uuid, p_org_id uuid, p_role text, p_full_name text, p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.link_member_to_org(p_user_id uuid, p_org_id uuid, p_role text, p_full_name text, p_phone text) TO service_role;


--
-- Name: FUNCTION sa_user_last_seen(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sa_user_last_seen() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sa_user_last_seen() TO authenticated;
GRANT ALL ON FUNCTION public.sa_user_last_seen() TO service_role;


--
-- Name: FUNCTION set_org_feature(p_org uuid, p_key text, p_on boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_org_feature(p_org uuid, p_key text, p_on boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_org_feature(p_org uuid, p_key text, p_on boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_org_feature(p_org uuid, p_key text, p_on boolean) TO service_role;


--
-- Name: FUNCTION start_free_trial(p_org uuid, p_plan text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_free_trial(p_org uuid, p_plan text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_free_trial(p_org uuid, p_plan text) TO authenticated;
GRANT ALL ON FUNCTION public.start_free_trial(p_org uuid, p_plan text) TO service_role;


--
-- Name: FUNCTION update_bank_balance(p_org_id uuid, p_amount numeric, p_direction text, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_bank_balance(p_org_id uuid, p_amount numeric, p_direction text, p_date date) TO anon;
GRANT ALL ON FUNCTION public.update_bank_balance(p_org_id uuid, p_amount numeric, p_direction text, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.update_bank_balance(p_org_id uuid, p_amount numeric, p_direction text, p_date date) TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_log TO anon;
GRANT ALL ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: TABLE attendance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance TO anon;
GRANT ALL ON TABLE public.attendance TO authenticated;
GRANT ALL ON TABLE public.attendance TO service_role;


--
-- Name: TABLE balance_adjustments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.balance_adjustments TO anon;
GRANT ALL ON TABLE public.balance_adjustments TO authenticated;
GRANT ALL ON TABLE public.balance_adjustments TO service_role;


--
-- Name: TABLE broadcast_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.broadcast_log TO anon;
GRANT ALL ON TABLE public.broadcast_log TO authenticated;
GRANT ALL ON TABLE public.broadcast_log TO service_role;


--
-- Name: TABLE collection_activation_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collection_activation_requests TO anon;
GRANT ALL ON TABLE public.collection_activation_requests TO authenticated;
GRANT ALL ON TABLE public.collection_activation_requests TO service_role;


--
-- Name: TABLE contribution_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contribution_types TO anon;
GRANT ALL ON TABLE public.contribution_types TO authenticated;
GRANT ALL ON TABLE public.contribution_types TO service_role;


--
-- Name: TABLE disbursement_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.disbursement_records TO anon;
GRANT ALL ON TABLE public.disbursement_records TO authenticated;
GRANT ALL ON TABLE public.disbursement_records TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO anon;
GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE feature_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feature_requests TO anon;
GRANT ALL ON TABLE public.feature_requests TO authenticated;
GRANT ALL ON TABLE public.feature_requests TO service_role;


--
-- Name: TABLE fines; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fines TO anon;
GRANT ALL ON TABLE public.fines TO authenticated;
GRANT ALL ON TABLE public.fines TO service_role;


--
-- Name: TABLE meetings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meetings TO anon;
GRANT ALL ON TABLE public.meetings TO authenticated;
GRANT ALL ON TABLE public.meetings TO service_role;


--
-- Name: TABLE members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.members TO anon;
GRANT ALL ON TABLE public.members TO authenticated;
GRANT ALL ON TABLE public.members TO service_role;


--
-- Name: TABLE merry_go_round_cycles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merry_go_round_cycles TO anon;
GRANT ALL ON TABLE public.merry_go_round_cycles TO authenticated;
GRANT ALL ON TABLE public.merry_go_round_cycles TO service_role;


--
-- Name: TABLE messages_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages_log TO anon;
GRANT ALL ON TABLE public.messages_log TO authenticated;
GRANT ALL ON TABLE public.messages_log TO service_role;


--
-- Name: TABLE notification_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_log TO anon;
GRANT ALL ON TABLE public.notification_log TO authenticated;
GRANT ALL ON TABLE public.notification_log TO service_role;


--
-- Name: TABLE org_payment_providers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.org_payment_providers TO anon;
GRANT ALL ON TABLE public.org_payment_providers TO authenticated;
GRANT ALL ON TABLE public.org_payment_providers TO service_role;


--
-- Name: TABLE organisations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organisations TO anon;
GRANT ALL ON TABLE public.organisations TO authenticated;
GRANT ALL ON TABLE public.organisations TO service_role;


--
-- Name: TABLE organisations_public; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organisations_public TO anon;
GRANT ALL ON TABLE public.organisations_public TO authenticated;
GRANT ALL ON TABLE public.organisations_public TO service_role;


--
-- Name: TABLE otp_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.otp_codes TO anon;
GRANT ALL ON TABLE public.otp_codes TO authenticated;
GRANT ALL ON TABLE public.otp_codes TO service_role;


--
-- Name: TABLE payment_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_requests TO anon;
GRANT ALL ON TABLE public.payment_requests TO authenticated;
GRANT ALL ON TABLE public.payment_requests TO service_role;


--
-- Name: TABLE payment_settlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_settlements TO anon;
GRANT ALL ON TABLE public.payment_settlements TO authenticated;
GRANT ALL ON TABLE public.payment_settlements TO service_role;


--
-- Name: TABLE pending_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pending_members TO anon;
GRANT ALL ON TABLE public.pending_members TO authenticated;
GRANT ALL ON TABLE public.pending_members TO service_role;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_settings TO anon;
GRANT ALL ON TABLE public.platform_settings TO authenticated;
GRANT ALL ON TABLE public.platform_settings TO service_role;


--
-- Name: TABLE platform_settings_public; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_settings_public TO anon;
GRANT ALL ON TABLE public.platform_settings_public TO authenticated;
GRANT ALL ON TABLE public.platform_settings_public TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE round_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.round_contributions TO anon;
GRANT ALL ON TABLE public.round_contributions TO authenticated;
GRANT ALL ON TABLE public.round_contributions TO service_role;


--
-- Name: TABLE round_disbursements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.round_disbursements TO anon;
GRANT ALL ON TABLE public.round_disbursements TO authenticated;
GRANT ALL ON TABLE public.round_disbursements TO service_role;


--
-- Name: TABLE round_slots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.round_slots TO anon;
GRANT ALL ON TABLE public.round_slots TO authenticated;
GRANT ALL ON TABLE public.round_slots TO service_role;


--
-- Name: TABLE savings_rounds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.savings_rounds TO anon;
GRANT ALL ON TABLE public.savings_rounds TO authenticated;
GRANT ALL ON TABLE public.savings_rounds TO service_role;


--
-- Name: TABLE settlement_batches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settlement_batches TO anon;
GRANT ALL ON TABLE public.settlement_batches TO authenticated;
GRANT ALL ON TABLE public.settlement_batches TO service_role;


--
-- Name: TABLE sms_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sms_usage TO anon;
GRANT ALL ON TABLE public.sms_usage TO authenticated;
GRANT ALL ON TABLE public.sms_usage TO service_role;


--
-- Name: TABLE table_banking_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.table_banking_contributions TO anon;
GRANT ALL ON TABLE public.table_banking_contributions TO authenticated;
GRANT ALL ON TABLE public.table_banking_contributions TO service_role;


--
-- Name: TABLE table_banking_loans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.table_banking_loans TO anon;
GRANT ALL ON TABLE public.table_banking_loans TO authenticated;
GRANT ALL ON TABLE public.table_banking_loans TO service_role;


--
-- Name: TABLE table_banking_pools; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.table_banking_pools TO anon;
GRANT ALL ON TABLE public.table_banking_pools TO authenticated;
GRANT ALL ON TABLE public.table_banking_pools TO service_role;


--
-- Name: TABLE table_banking_repayments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.table_banking_repayments TO anon;
GRANT ALL ON TABLE public.table_banking_repayments TO authenticated;
GRANT ALL ON TABLE public.table_banking_repayments TO service_role;


--
-- Name: TABLE taya_faq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.taya_faq TO anon;
GRANT ALL ON TABLE public.taya_faq TO authenticated;
GRANT ALL ON TABLE public.taya_faq TO service_role;


--
-- Name: TABLE taya_question_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.taya_question_log TO anon;
GRANT ALL ON TABLE public.taya_question_log TO authenticated;
GRANT ALL ON TABLE public.taya_question_log TO service_role;


--
-- Name: TABLE taya_usage_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.taya_usage_log TO anon;
GRANT ALL ON TABLE public.taya_usage_log TO authenticated;
GRANT ALL ON TABLE public.taya_usage_log TO service_role;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transactions TO anon;
GRANT ALL ON TABLE public.transactions TO authenticated;
GRANT ALL ON TABLE public.transactions TO service_role;


--
-- Name: TABLE user_orgs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_orgs TO anon;
GRANT ALL ON TABLE public.user_orgs TO authenticated;
GRANT ALL ON TABLE public.user_orgs TO service_role;


--
-- Name: TABLE welfare_event_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.welfare_event_types TO anon;
GRANT ALL ON TABLE public.welfare_event_types TO authenticated;
GRANT ALL ON TABLE public.welfare_event_types TO service_role;


--
-- Name: TABLE welfare_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.welfare_events TO anon;
GRANT ALL ON TABLE public.welfare_events TO authenticated;
GRANT ALL ON TABLE public.welfare_events TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- ═══════════════════════════════════════════════════════════════════
-- Pieces that live outside the public schema (not in the live dump)
-- ═══════════════════════════════════════════════════════════════════
SELECT pg_catalog.set_config('search_path', 'public', false);

-- New sign-ups get a profile (and group link, when invited)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- The member's "waiting for M-Pesa" screen listens for payment updates
DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payment_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_requests;
  END IF;
END
$rt$;

-- Platform settings: one row, test mode, no real keys
INSERT INTO public.platform_settings (id, daraja_env, daraja_enabled, promo_active, promo_days, payment_mode)
VALUES (1, 'sandbox', false, true, '60', 'manual')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- TEST DATA (made up; phone numbers are not real)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO public.organisations (id, name, org_code, plan, status, subscription_status, subscription_expires, sms_bundle, sms_label, features)
VALUES
 ('5a000000-0000-4000-8000-000000000001', 'Staging Test Chama', 'GYTEST', 'pro', 'active', 'active', '2027-12-31', 500, 'GY360 TEST',
  '{"households": true}'),
 ('5a000000-0000-4000-8000-000000000002', 'Staging Small Group', 'GYSMAL', 'starter', 'active', 'active', NULL, 20, 'GY360 TEST', NULL);

INSERT INTO public.contribution_types (id, org_id, name, amount, frequency, income_type, is_member_income) VALUES
 ('5b000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', 'Monthly contribution', 200, 'monthly', 'admin_income', true),
 ('5b000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', 'Savings', NULL, 'monthly', 'member_savings', true),
 ('5b000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000002', 'Monthly contribution', 500, 'monthly', 'admin_income', true);

INSERT INTO public.members (id, org_id, member_number, display_number, full_name, phone, status, join_date, savings_balance, household_principal_id) VALUES
 ('5c000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '001', '001', 'Test Admin (you)',  '254700000001', 'active',   '2026-01-01', 3000, NULL),
 ('5c000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', '002', '002', 'Achieng Test',      '254700000002', 'active',   '2026-01-01', 2400, NULL),
 ('5c000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', '003', '003', 'Otieno Test',       '254700000003', 'active',   '2026-01-01', 1800, NULL),
 ('5c000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', '004', '004', 'Akinyi Otieno Test','254700000004', 'active',   '2026-01-01', 0,    '5c000000-0000-4000-8000-000000000003'),
 ('5c000000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000001', '005', '005', 'Ouma Test',         '254700000005', 'arrears',  '2026-01-01', 200,  NULL),
 ('5c000000-0000-4000-8000-000000000006', '5a000000-0000-4000-8000-000000000001', '006', '006', 'Wanjiku Test',      '254700000006', 'arrears',  '2026-03-01', 0,    NULL),
 ('5c000000-0000-4000-8000-000000000007', '5a000000-0000-4000-8000-000000000001', '007', '007', 'Kamau Test',        NULL,           'inactive', '2026-01-01', 0,    NULL),
 ('5c000000-0000-4000-8000-000000000008', '5a000000-0000-4000-8000-000000000002', '001', '001', 'Small Group Admin', '254700000008', 'active',   '2026-05-01', 0,    NULL);

-- Monthly contributions Feb-Sep and savings, varied so some members are behind
INSERT INTO public.transactions (org_id, member_id, type_id, amount, transaction_date, notes)
SELECT '5a000000-0000-4000-8000-000000000001', m.id, '5b000000-0000-4000-8000-000000000001',
       CASE WHEN m.id = '5c000000-0000-4000-8000-000000000003' THEN 400 ELSE 200 END,
       (date '2026-02-28' + (g || ' month')::interval)::date, 'Test data'
FROM public.members m, generate_series(0, 7) g
WHERE m.org_id = '5a000000-0000-4000-8000-000000000001'
  AND (m.id IN ('5c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000003')
       OR (m.id = '5c000000-0000-4000-8000-000000000005' AND g < 3));
INSERT INTO public.transactions (org_id, member_id, type_id, amount, transaction_date, notes)
SELECT '5a000000-0000-4000-8000-000000000001', m.id, '5b000000-0000-4000-8000-000000000002', m.savings_balance, date '2026-08-31', 'Test data'
FROM public.members m WHERE m.org_id = '5a000000-0000-4000-8000-000000000001' AND m.savings_balance > 0;

INSERT INTO public.welfare_events (id, org_id, event_type, contribution_per_member, event_date, notes, is_active) VALUES
 ('5d000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', 'Test Party Fund', 1000, '2026-12-05', 'Test data', true);
INSERT INTO public.transactions (org_id, member_id, welfare_event_id, amount, transaction_date, notes) VALUES
 ('5a000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000002', '5d000000-0000-4000-8000-000000000001', 1000, '2026-10-01', 'Test data'),
 ('5a000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000003', '5d000000-0000-4000-8000-000000000001', 1000, '2026-10-02', 'Test data');

INSERT INTO public.expenses (org_id, category, description, amount, expense_date, entry_type)
VALUES ('5a000000-0000-4000-8000-000000000001', 'Venue', 'Test meeting venue', 1500, '2026-09-20', 'expense');

INSERT INTO public.meetings (org_id, meeting_date, meeting_time, venue, agenda, status) VALUES
 ('5a000000-0000-4000-8000-000000000001', '2026-11-08', '14:00', 'Test venue', 'Test agenda: year-end plans', 'scheduled');

-- ═══════════════════════════════════════════════════════════════════
-- Make someone staging superadmin and admin of the test groups.
-- Sign up on staging first, then run (with your staging sign-up email):
--   select public.staging_make_admin('you@example.com');
-- Only exists on staging.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.staging_make_admin(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_uid IS NULL THEN RETURN 'No staging account with that email yet. Sign up on staging first.'; END IF;
  INSERT INTO public.profiles (id, email, full_name, role) VALUES (v_uid, p_email, split_part(p_email, '@', 1), 'superadmin')
    ON CONFLICT (id) DO UPDATE SET role = 'superadmin', org_id = '5a000000-0000-4000-8000-000000000001';
  INSERT INTO public.user_orgs (user_id, org_id, role) VALUES
    (v_uid, '5a000000-0000-4000-8000-000000000001', 'admin'), (v_uid, '5a000000-0000-4000-8000-000000000002', 'admin')
    ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'admin';
  UPDATE public.members SET user_id = v_uid, portal_email = p_email WHERE id = '5c000000-0000-4000-8000-000000000001';
  RETURN 'Done: ' || p_email || ' is staging superadmin and admin of both test groups.';
END;
$$;
REVOKE ALL ON FUNCTION public.staging_make_admin(text) FROM public, anon, authenticated;

COMMIT;
