-- join_requests_close_members_2026-10-05.sql
-- Closes join requests from people who are ALREADY in the group (their
-- account is already linked to a member record, or already in user_orgs),
-- and makes sure it can never pile up again: whenever someone is added to a
-- group, any request they had waiting for that group is closed automatically.
-- Run the PREVIEW first. Safe to run more than once.

-- PREVIEW (read only): requests that are already matched
select o.name as grp, p.full_name as requested_as, p.email,
       m.full_name as already_linked_to, coalesce(m.display_number, m.member_number) as no,
       uo.role as already_in_group_as
from public.pending_members p
join public.organisations o on o.id = p.org_id
left join public.members m on m.org_id = p.org_id and m.user_id = p.user_id
left join public.user_orgs uo on uo.org_id = p.org_id and uo.user_id = p.user_id
where p.status = 'pending' and p.user_id is not null and (m.id is not null or uo.user_id is not null)
order by 1, 2;

begin;

-- 1. Close them, recording which member record each account is linked to
update public.pending_members p
   set status = 'approved',
       linked_member_id = coalesce(p.linked_member_id,
         (select m.id from public.members m where m.org_id = p.org_id and m.user_id = p.user_id limit 1)),
       reviewed_at = now(),
       notes = trim(both ' ' from coalesce(p.notes, '') || ' Closed automatically: already a member.')
 where p.status = 'pending' and p.user_id is not null
   and (exists (select 1 from public.members m where m.org_id = p.org_id and m.user_id = p.user_id)
        or exists (select 1 from public.user_orgs uo where uo.org_id = p.org_id and uo.user_id = p.user_id));

-- 2. From now on: joining a group closes your waiting request for it
create or replace function public.gy360_close_join_request_on_membership()
returns trigger language plpgsql security definer set search_path = public as $$
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
drop trigger if exists gy360_close_join_request_on_membership on public.user_orgs;
create trigger gy360_close_join_request_on_membership after insert on public.user_orgs
  for each row execute function public.gy360_close_join_request_on_membership();

commit;

-- CHECK (read only): should return no rows
select p.full_name, p.email from public.pending_members p
where p.status = 'pending' and p.user_id is not null
  and exists (select 1 from public.user_orgs uo where uo.org_id = p.org_id and uo.user_id = p.user_id);
