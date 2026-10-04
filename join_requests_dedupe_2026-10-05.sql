-- join_requests_dedupe_2026-10-05.sql
-- One join request per person per group.
--   1. Removes duplicate PENDING requests already waiting (same group and the
--      same account, or the same email), keeping the earliest one.
--   2. Adds unique indexes so the database itself refuses a second pending
--      request from the same person for the same group.
--   3. Refuses a request from someone who is already in that group.
-- One transaction. Safe to run more than once.

begin;

-- 0. Before removing duplicates, keep any phone number a duplicate carried
update public.pending_members k set phone = d.phone
from public.pending_members d
where k.status = 'pending' and d.status = 'pending' and k.org_id = d.org_id and k.id <> d.id
  and lower(trim(k.email)) = lower(trim(d.email))
  and coalesce(trim(k.phone), '') = '' and coalesce(trim(d.phone), '') <> '';

-- 1. Duplicates: keep the first request each person made to each group
with ranked as (
  select id,
         row_number() over (
           partition by org_id, coalesce(user_id::text, lower(trim(email)))
           order by requested_at nulls last, id
         ) as rn
  from public.pending_members
  where status = 'pending'
)
delete from public.pending_members p
using ranked r
where p.id = r.id and r.rn > 1;

-- ...and the same email under different accounts / no account
with ranked as (
  select id,
         row_number() over (
           partition by org_id, lower(trim(email))
           order by (user_id is null), requested_at nulls last, id
         ) as rn
  from public.pending_members
  where status = 'pending' and email is not null and trim(email) <> ''
)
delete from public.pending_members p
using ranked r
where p.id = r.id and r.rn > 1;

-- 2. The database refuses a second pending request
create unique index if not exists pending_members_one_per_user
  on public.pending_members (org_id, user_id) where status = 'pending' and user_id is not null;
create unique index if not exists pending_members_one_per_email
  on public.pending_members (org_id, lower(trim(email))) where status = 'pending' and email is not null and trim(email) <> '';

-- 3. No request from someone already in the group
create or replace function public.gy360_guard_join_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and new.user_id is not null
     and exists (select 1 from public.user_orgs where user_id = new.user_id and org_id = new.org_id) then
    raise exception 'ALREADY_MEMBER: You are already a member of this group.';
  end if;
  return new;
end;
$$;
drop trigger if exists gy360_guard_join_request on public.pending_members;
create trigger gy360_guard_join_request before insert on public.pending_members
  for each row execute function public.gy360_guard_join_request();

-- Check: no group should show the same person twice
select org_id, coalesce(user_id::text, lower(trim(email))) as person, count(*) as pending_requests
from public.pending_members where status = 'pending'
group by 1, 2 having count(*) > 1;

commit;
