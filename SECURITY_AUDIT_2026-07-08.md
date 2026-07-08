# GroupYetu360 — Security Audit
**Date:** 8 Jul 2026 · Conducted against live `main` branch, commit `9b0de27`

This audit was prompted by the SasaPay wallet-collection discussion — moving from "software that reads M-Pesa webhooks" to "software that touches pooled group money" raises the bar on every one of these findings. Everything below was traced against actual code, not assumed.

**Status: fixes for #1–#7 below have been implemented this session** (code changes only — SQL/RLS check #8 still needs you to run the query at the bottom and share the result). Full detail per fix is in `CHANGELOG.md`.

---

## 🔴 CRITICAL — fix before any wallet/SasaPay work proceeds

### 1. `paystack-charge` Edge Function has no caller authentication
**File:** `supabase/functions/paystack-charge/index.ts`

This function initiates a real M-Pesa charge via Paystack. It never calls `auth.getUser()` or checks a JWT — it trusts whatever `org_id`, `amount`, `phone`, and `email` arrive in the raw POST body. Anyone who discovers the function's URL (a predictable Supabase pattern: `https://<project>.supabase.co/functions/v1/paystack-charge`) can:
- Trigger a real M-Pesa STK prompt to **any phone number**, with **no relationship to GroupYetu360 at all**
- Attribute the resulting `payment_request` to **any `org_id`** in the system — including crediting a payment to an org the caller doesn't belong to
- Do this with zero login, zero rate limit

**Impact:** harassment vector (unsolicited M-Pesa prompts, brand damage), and a real fraud vector once wallet collection is live — an attacker could initiate charges attributed to a group they don't run, or spam prompts hoping a confused victim pays into the wrong place.

### 2. `daraja-stk` Edge Function — identical vulnerability, worse blast radius
**File:** `supabase/functions/daraja-stk/index.ts`

Same issue: no authentication at all. Additionally, this one accepts a `useOrgCredentials: true` flag that — if set — uses **that specific org's own configured Daraja merchant credentials** to initiate the charge. An unauthenticated caller could trigger charges through an org's own Safaricom merchant relationship without ever being a member of that org.

### 3. `send-sms-celcom` Edge Function — no authentication, spends real money
**File:** `supabase/functions/send-sms-celcom/index.ts`

Same pattern again: anyone can call this directly and send arbitrary SMS text to arbitrary phone numbers, drawing from the platform's shared Celcom credit balance, with GroupYetu360's shortcode as the sender. This is both a direct cost (draining SMS credit with no relation to any real org's usage) and a reputational/abuse vector (spam or harassment sent under your brand name).

**Fix for all three (1, 2, 3):** each function must, as the very first thing it does:
1. Read the `Authorization: Bearer <token>` header from the incoming request
2. Call `supabase.auth.getUser(token)` to resolve the real caller
3. Reject with 401 if no valid user
4. For any function scoped to a specific `org_id`, additionally query `user_orgs` to confirm the caller actually belongs to that `org_id` (with an appropriate role — e.g. admin/treasurer for financial actions) before proceeding
5. Reject with 403 if the caller isn't a legitimate member of the org they're claiming to act for

This is the same pattern already correctly implemented in `admin-user-update` — it just needs to be applied to these three as well.

---

## 🟠 HIGH — fix soon, real but narrower exposure

### 4. `daraja-callback` has no idempotency guard
**File:** `supabase/functions/daraja-callback/index.ts`

Looks up the pending payment by `checkoutRequestId` alone — no `status = 'pending'` filter, unlike its Paystack equivalent which correctly has one. Safaricom **does retry callbacks** under real network/timeout conditions. If a successful callback is delivered twice, SMS bundle credits and subscription extensions would be applied **twice** for one real payment.

**Fix:** add `.eq('status', 'pending')` to the lookup, exactly matching the pattern already used correctly in `paystack-webhook`.

### 5. Stored XSS via fine "reason" field
**File:** `js/finance.js` (3 locations: lines ~579, 585, 601)

`f.reason` (free text, entered by whoever issues a fine) is inserted directly into `innerHTML` with no escaping. A malicious or compromised admin account could enter a `<script>` payload as a fine's reason, which would then execute in the browser of every member (and every other admin) who subsequently views that fine.

**Fix:** escape all user-controlled text before interpolating into `innerHTML`, or switch these specific insertions to safe DOM construction (`textContent` on a created element) instead of template-literal `innerHTML`.

### 6. `send-2fa-otp` has no rate limiting
**File:** `supabase/functions/send-2fa-otp/index.ts`

Accepts any email, unlimited times, no throttle. Doesn't leak whether an account exists (that part is correctly designed), but combined with no rate limit, it's an open vector for spamming arbitrary inboxes with GroupYetu360-branded emails, and for running up Resend API usage.

**Fix:** before generating a new OTP, check for a recent (e.g. within 60 seconds) unexpired code already issued to that email in `otp_codes`, and reject/reuse rather than issuing unlimited new ones.

---

## 🟡 MEDIUM — worth doing, lower urgency

### 7. Non-timing-safe signature comparison in `paystack-webhook`
The HMAC signature check uses plain `sig !== expectedSig` string comparison rather than a constant-time comparison. Low real-world exploitability (requires precise network timing measurement against a live endpoint), but this is the kind of thing worth doing right given real money flows through this function.

### 8. RLS policies on financial tables — not yet re-verified this session
I traced the client and Edge Function code thoroughly, but haven't re-confirmed the actual RLS policies currently active on `transactions`, `expenses`, `payment_requests`, and `organisations` against direct client reads/writes (separate from the Edge Functions above, which use the service role and bypass RLS entirely regardless). **Action needed:** run the query at the bottom of this document and share the result so this can be finished properly.

---

## What's already good (worth knowing, not just bad news)

- `paystack-webhook` correctly verifies Paystack's HMAC-SHA512 signature and has proper idempotency via its `status = 'pending'` filter — this is the right pattern, just not yet applied everywhere.
- No service-role or secret keys are exposed anywhere in client-side code — only the correct publishable/anon key.
- `admin-user-update` correctly verifies the caller is a superadmin before doing anything.
- The `update_bank_balance` RPC (fixed this session) is atomic and now has no lock-related gap.

---

## Recommended fix order

1. Add caller authentication to `paystack-charge`, `daraja-stk`, `send-sms-celcom` (Critical #1–3) — these are the ones that matter most given the wallet-collection direction, and should be treated as blocking that work, not parallel to it.
2. Fix `daraja-callback` idempotency (#4) — quick, prevents real double-crediting.
3. Fix the XSS (#5) — quick, contained.
4. Add rate limiting to `send-2fa-otp` (#6).
5. Run the RLS check below and close out #8.
6. Timing-safe comparison (#7) — lowest priority, do when convenient.

---

## RLS check to run in Supabase SQL editor

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('transactions', 'expenses', 'payment_requests', 'organisations')
ORDER BY tablename, cmd;
```
