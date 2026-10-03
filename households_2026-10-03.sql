-- households_2026-10-03.sql
-- Lets a member "contribute through" another member of the same group (a
-- spouse whose dues the household's principal pays). Money stays recorded
-- against the principal; the link only changes how figures are shown.
-- Safe to run more than once.

alter table public.members add column if not exists household_principal_id uuid
  references public.members(id) on delete set null;
create index if not exists members_household_principal_idx on public.members(household_principal_id);

-- A member cannot be linked to themselves, and only to someone in the same group
create or replace function public.gy360_check_household_link()
returns trigger language plpgsql as $$
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
drop trigger if exists gy360_check_household_link on public.members;
create trigger gy360_check_household_link before insert or update of household_principal_id on public.members
  for each row execute function public.gy360_check_household_link();
