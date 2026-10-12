# GroupYetu360 infrastructure

Where everything lives, and how changes reach users. Keep this file current
whenever a domain, host, key or environment changes. Never put secrets here
(passwords, service-role keys, M-Pesa or SMS credentials): name where they are
kept instead.

## Domain and DNS (checked 6 Oct 2026)

| Item | Where |
|---|---|
| Domain `groupyetu.org` | Registered at **Namecheap** |
| DNS (the address book) | **Cloudflare** (Namecheap points to `bruce.ns.cloudflare.com` and `kenia.ns.cloudflare.com`). All DNS changes are made in Cloudflare, not Namecheap. |
| `groupyetu.org` | Marketing website, repo `omondicpa-bit/groupyetu360-website`, GitHub Pages, proxied through Cloudflare |
| `www.groupyetu.org` | CNAME to `omondicpa-bit.github.io` |
| `staging.groupyetu.org` | Staging app (test data only, gold STAGING ribbon). Cloudflare Pages project `groupyetu360` building the `staging` branch; also at `groupyetu360-staging.pages.dev` |
| `app.groupyetu.org` | The live app, repo `omondicpa-bit/groupyetu360`, GitHub Pages via the "Deploy static content to Pages" workflow (`.github/workflows/static.yml`), CNAME to `omondicpa-bit.github.io` |

## Backend

| Item | Where |
|---|---|
| Live database, sign-in and Edge Functions | Supabase project `eengldzvvgplgzvbutal` (region eu-west-1, Ireland; session pooler `aws-0-eu-west-1.pooler.supabase.com`) |
| Staging database (test data only) | Supabase project `zrjctzauufromazxrpvb` (groupyetu360-staging, free plan, Europe); built by `sql/staging/staging_setup.sql` |
| Live / staging switch in the app | `js/env.js` (chosen by web address; staging never falls back to live) |
| Edge Function secrets (Daraja, Celcom SMS, Resend, VAPID, Anthropic) | Supabase dashboard > Edge Functions > Secrets |
| Android app | Google Play, package `com.ephtechnologies.groupyetu360`; built by `.github/workflows/build-android.yml`; upload key in GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`) |
| Payments | Safaricom Daraja (live); SasaPay / Paystack code kept as backup |
| SMS | Celcom Africa (sender EPH TECH / group labels) |

## Staging (live since 12 Oct 2026)

- **App:** push to the `staging` branch and Cloudflare Pages publishes it at `staging.groupyetu.org` within a minute or two.
- **Database:** Supabase `zrjctzauufromazxrpvb`. Auth Site URL `https://staging.groupyetu.org`; redirect URLs for that domain and the pages.dev one. Email sign-in only (Google sign-in is not set up on staging). `select public.staging_make_admin('<email>');` makes an account superadmin and admin of the two test groups.
- **Edge Functions:** `.github/workflows/deploy-staging-functions.yml` deploys them to the staging project on every push to `staging` that touches `supabase/functions/`. It needs the GitHub repository secret `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token) and, optionally, `STAGING_SMS_ALLOWLIST` (comma-separated phone numbers). The workflow is hard-wired to the staging project and refuses the live one.
- **SMS on staging:** the workflow sets `GY_ENV=staging`. With that set, `_shared/smsAllowlist.ts` sends only to numbers on `SMS_ALLOWLIST`, and sends nothing if the list is empty. Staging also has no Celcom credentials unless added to its `platform_settings`. On live, `GY_ENV` is not set and nothing changes.
- **M-Pesa on staging:** `DARAJA_ENV=sandbox`, with the Safaricom developer-portal sandbox keys set as staging function secrets.

**How a change goes live:** commit to `staging` → test at staging.groupyetu.org → merge `staging` into `main` → GitHub Pages publishes app.groupyetu.org. Database scripts run on the staging project first, then live.

## Planned

1. **Console** at `console.groupyetu.org` for superadmin and EPH staff, separate from the member app, behind Cloudflare Access (named staff emails) with compulsory two-factor sign-in, hosted on Cloudflare Pages.
