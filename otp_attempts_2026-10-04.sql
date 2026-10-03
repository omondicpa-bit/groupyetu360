-- otp_attempts_2026-10-04.sql
-- Counts wrong two-factor codes so a code is burnt after five wrong tries.
-- Run before deploying verify-2fa-otp. Safe to run more than once.
alter table public.otp_codes add column if not exists attempts integer not null default 0;
