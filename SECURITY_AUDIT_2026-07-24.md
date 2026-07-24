# SECURITY_AUDIT_2026-07-24.md

Follow-up audit to SECURITY_AUDIT_2026-07-08.md. That audit's own findings
were re-checked first (see "Previous audit — status check" below); this pass
then went wider across Edge Functions, RLS-adjacent client code, and XSS
escaping consistency.

## 🔴 CRITICAL — fixed this session

### 1. SasaPay and Fingo had the same triple-credit race condition as Paystack — never actually fixed for them

On 19 Jul 2026, `paystack-webhook`/`paystack-verify` were fixed after a real
triple-credit on a live Ksh 817 contribution (ref GY-1784460645802-NC1BZ):
both functions used to `SELECT` for `status='pending'`, then credit — not
atomic, so a webhook retry and the client's own ~2s polling could both pass
that check before either wrote back `'approved'`.

**That fix was only ever applied to Paystack.** Checked every other caller of
the shared `creditMemberContribution()` and confirmed `sasapay-webhook`,
`fingo-webhook`, and `fingo-verify` all still had the exact same unprotected
pattern — a plain status check, then credit, with no atomic claim in
between. `creditMemberContribution()` only marks the row `'approved'` at the
very end (after balance/SMS/activity-log side effects), so the vulnerable
window is real and identical in shape to what already happened once.

Concretely:
- **Fingo**: `fingo-webhook` and `fingo-verify` both call
  `creditMemberContribution()` independently — a webhook event and the
  client's own status-poll can race exactly like Paystack's webhook+verify
  pair did.
- **SasaPay**: `sasapay-webhook` is confirmed (per its own code comments) to
  receive *two* separate callbacks per payment (an IPN, then the actual
  result). If SasaPay ever retries the result-shaped callback — normal
  webhook behavior when a response is slow — two calls could both pass the
  pending-check and both credit.

**Fixed:** extracted the atomic claim (`UPDATE payment_requests SET
status='processing' WHERE id=X AND status='pending' RETURNING *`) into a new
shared module, `_shared/claimPaymentRequest.ts`, rather than copy-pasting a
third time — this codebase has already had one fix drift apart across
duplicated copies before (SMS Leopard/Africa's Talking removal), and this is
exactly that failure mode again if left as three separate copies. Wired into
all three functions; `paystack-webhook`/`paystack-verify` untouched since
they already had their own working copy of the same logic.

**Files changed:** `supabase/functions/_shared/claimPaymentRequest.ts` (new),
`supabase/functions/fingo-webhook/index.ts`,
`supabase/functions/fingo-verify/index.ts`,
`supabase/functions/sasapay-webhook/index.ts`.

**Action needed:** deploy all three functions (see deploy commands below) —
this is a real, live vulnerability until deployed, not just committed.

---

## 🟡 MEDIUM

### 2. SasaPay webhook has no real signature verification (already self-documented in code, not newly found — surfaced here because it's the second-most-important open item)

`sasapay-webhook`'s own comments confirm: SasaPay documents HMAC-SHA512
signing, but no live callback has ever actually included the signature
header, across multiple real transactions. The code's actual protection is
an amount cross-check (reject if the callback's claimed amount doesn't match
what was charged) plus a trusted-IP list that's currently **logged only, not
enforced** (their own comment: "may sit behind infrastructure that changes
the apparent source IP... needs confirming against real traffic before it's
safe to hard-block on").

This means `sasapay-webhook` is, right now, an endpoint that will credit a
real member's contribution based on nothing but a POST body with the right
reference and amount — no cryptographic proof it came from SasaPay at all.
The amount check helps, but it's not equivalent to signature verification:
someone would need to know or guess a valid pending payment reference, which
isn't randomised to the same degree as (for example) Paystack's own
references.

**Not fixed this session** — this needs an actual answer from SasaPay's
technical team (already flagged in the code as worth raising directly),
not a guess at a workaround. Two things worth doing in parallel:
- Push SasaPay for a real answer on whether signing can be enabled for this
  merchant account.
- Consider tightening the trusted-IP check from log-only to enforced, once
  a few days of real traffic confirm the observed source IPs are stable —
  the code is already structured to make this a one-line change when ready.

### 3. Two stored-XSS gaps — admin-configurable free text rendered without escaping

The codebase has a consistent escaping helper (`h()` in utils.js) used in
the large majority of places that render user/admin-entered free text. Found
two spots that skipped it:

- `dashboard.js`: contribution type names (admin-configurable, e.g. "AGM Plus
  Party") rendered unescaped in the admin dashboard's contributions-by-type
  card.
- `auth.js`: platform bank name / account / paybill settings (superadmin-
  configured) rendered unescaped in the plan-activation payment prompt.

Both are stored-XSS risk: whoever can set that field (an org admin in the
first case, superadmin in the second) could have their raw HTML/script
execute in another viewer's browser. Lower severity than a random-member
vector since both require an already-privileged account, but still a real
gap given the point of `h()` existing everywhere else.

**Fixed:** both now wrapped in `h()`, matching the rest of the codebase.

**Files changed:** `js/dashboard.js`, `js/auth.js`.

### 4. `settlement_batches` had two separate DB-level gaps found in one day (this session, not this audit specifically — noted here for pattern-recognition)

Earlier today: an RLS gap (org admins couldn't write batch rows, correctly
blocked but silently) and a stale CHECK constraint (`provider` list never
updated when Paystack joined the settlement system) were both found and
fixed. Flagging the pattern rather than the specific bugs (already resolved):
`settlement_batches` is newer than most of the schema and has needed two
DB-level corrections in short order. Worth a deliberate look at its RLS
policies and constraints as a whole, rather than assuming the two fixes
already made are the only gaps.

---

## 🟢 LOW / CLEANUP

### 5. Daraja Edge Functions still deployed, but confirmed dead code

`daraja-stk` and `daraja-callback` still exist as deployed functions, but
there is zero client-side reference to either anywhere in `js/*.js` or
`index.html` — confirmed via grep, not assumed. Per earlier conversation,
Daraja was intentionally removed from the live payment provider set
(Paystack/Fingo/SasaPay only now). `daraja-stk` does have proper caller
authentication, so it's not an open door exactly, but an unreferenced
endpoint still holding real Safaricom credentials (if `platform_settings`
still has them configured) is unnecessary attack surface with no one
watching it. Recommend either deleting both functions and their directories,
or explicitly confirming they're intentionally kept for a future
reinstatement — not fixed here since deleting is a one-way action worth your
explicit go-ahead first.

---

## Previous audit (SECURITY_AUDIT_2026-07-08.md) — status check

Re-verified rather than assumed:

- **#7 Timing-safe signature comparison in `paystack-webhook`** — confirmed
  fixed. `timingSafeEqual()` is implemented and used for the signature
  check.
- **#6 Rate limiting on `send-2fa-otp`** — confirmed fixed. A 60-second
  throttle on repeat OTP issuance is in place.
- **#8 RLS policies on financial tables** — the SQL query that audit asked
  for was never confirmed as run. Still open. Given today's `settlement_batches`
  findings, this is worth actually doing now rather than deferring again:

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('transactions', 'expenses', 'payment_requests', 'organisations', 'settlement_batches')
ORDER BY tablename, cmd;
```

Run this and share the result — this is the one item from the last audit
that's been asked for twice now without ever actually landing.

---

## What's already good (worth knowing, not just bad news)

- Paystack, Fingo, and now (after this session) SasaPay's atomic-claim
  pattern all correctly prevent double-crediting.
- Fingo's webhook signature verification (HMAC-SHA256 + timestamp window,
  timing-safe comparison) is solid and exactly matches its documented spec.
- No hardcoded secrets or service-role keys found anywhere in client-side
  code — checked directly, not assumed.
- The `h()` escaping helper is used consistently in the large majority of
  places rendering user content; the two gaps found were genuinely the
  exceptions, not a systemic pattern.
- `settlement_batches`' RLS correctly blocks direct org-admin writes — the
  fix for that was to move the write server-side, not to loosen the policy,
  which was the right call rather than the easy one.

---

## Recommended fix order

1. **Deploy the three fixed functions** (`fingo-webhook`, `fingo-verify`,
   `sasapay-webhook`) — this is live-money-affecting until deployed.
2. Run the RLS query above and share results — closes a two-audits-old open
   item.
3. Raise the SasaPay signature question with their technical team directly.
4. Decide on Daraja functions: delete or explicitly keep.
5. Consider tightening SasaPay's IP check from log-only to enforced, once
   confirmed stable against real traffic.
