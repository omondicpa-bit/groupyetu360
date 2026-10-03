-- sa_last_seen_2026-10-03.sql
-- Lets superadmin see when each account last signed in. Sign-in times live
-- in Supabase's protected auth.users table, which the browser cannot read;
-- this function returns ONLY the id and last sign-in time, and ONLY to a
-- superadmin. Everyone else gets nothing. Safe to run more than once.

create or replace function public.sa_user_last_seen()
returns table (id uuid, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin') then
    return;  -- not superadmin: return no rows
  end if;
  return query
    select u.id, u.last_sign_in_at, u.email_confirmed_at
    from auth.users u;
end;
$$;

revoke all on function public.sa_user_last_seen() from public, anon;
grant execute on function public.sa_user_last_seen() to authenticated;
