# Staging database

`staging_setup.sql` builds the staging Supabase project (`zrjctzauufromazxrpvb`)
from scratch: the live structure (copied 10 Oct 2026 with
`tools/dump-live-schema.ps1`, structure only, no member data), the sign-up
trigger on `auth.users`, realtime for `payment_requests`, a test-mode
platform settings row, and made-up test groups.

- Run it once, in the **staging** project's SQL editor. It stops itself on any
  database that already has GroupYetu360 tables (so it cannot run on live).
- After signing up on staging, run `select public.staging_make_admin('your@email');`
  to become staging superadmin and admin of both test groups.
- From now on every database change runs on staging first, then live.
