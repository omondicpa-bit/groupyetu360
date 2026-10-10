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
| `app.groupyetu.org` | The live app, repo `omondicpa-bit/groupyetu360`, GitHub Pages via the "Deploy static content to Pages" workflow (`.github/workflows/static.yml`), CNAME to `omondicpa-bit.github.io` |

## Backend

| Item | Where |
|---|---|
| Live database, sign-in and Edge Functions | Supabase project `eengldzvvgplgzvbutal` |
| Staging database (test data only) | Supabase project `zrjctzauufromazxrpvb` (groupyetu360-staging, free plan, Europe) |
| Live / staging switch in the app | `js/env.js` (chosen by web address; staging never falls back to live) |
| Edge Function secrets (Daraja, Celcom SMS, Resend, VAPID, Anthropic) | Supabase dashboard > Edge Functions > Secrets |
| Android app | Google Play, package `com.ephtechnologies.groupyetu360`; built by `.github/workflows/build-android.yml`; upload key in GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`) |
| Payments | Safaricom Daraja (live); SasaPay / Paystack code kept as backup |
| SMS | Celcom Africa (sender EPH TECH / group labels) |

## Planned

1. **Staging** at `staging.groupyetu.org` with its own Supabase project (test data, Daraja sandbox, SMS to the owner's number only). Changes go to the `staging` branch first, are tried there, then merged to `main` (live). Database scripts run on staging first.
2. **Console** at `console.groupyetu.org` for superadmin and EPH staff, separate from the member app, behind Cloudflare Access (named staff emails) with compulsory two-factor sign-in.
3. Hosting for staging (and later the console) on **Cloudflare Pages**, which is already in the same Cloudflare account as the DNS.
