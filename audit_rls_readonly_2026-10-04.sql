-- audit_rls_readonly_2026-10-04.sql
-- READ ONLY. Lists who may read and write each money and membership table,
-- so the open audit item "every member can write group records" can be
-- fixed precisely. Changes nothing. Send the result back.
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       coalesce(json_agg(json_build_object(
         'policy', p.polname,
         'for', case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
         'roles', (select array_agg(rolname) from pg_roles where oid = any(p.polroles)),
         'using', pg_get_expr(p.polqual, p.polrelid),
         'check', pg_get_expr(p.polwithcheck, p.polrelid)
       ) order by p.polname) filter (where p.polname is not null), '[]') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policy p on p.polrelid = c.oid
where c.relkind = 'r'
  and c.relname in ('members','transactions','expenses','payment_requests','payment_settlements','organisations',
                    'user_orgs','profiles','welfare_events','fines','meetings','projects','savings_rounds',
                    'table_banking_pools','table_banking_loans','withdrawal_requests','messages_log',
                    'contribution_types','collection_activation_requests','feature_requests','activity_log','otp_codes')
group by c.relname, c.relrowsecurity
order by c.relname;
