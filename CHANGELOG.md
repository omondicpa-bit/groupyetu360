# GroupYetu360 — Development Changelog
_Maintained for Play Store closed-testing report and cross-session handover. Newest entries at top._

---

## Session: 8 Jul 2026 (continued) — full security audit, prompted by SasaPay wallet-collection plans

Full findings in `SECURITY_AUDIT_2026-07-08.md`. Summary of what was found and fixed:

**Critical — three Edge Functions had NO caller authentication at all**, meaning anyone with the function's URL (predictable Supabase pattern) could call them directly with no login:
- `paystack-charge` — could trigger a real M-Pesa charge via Paystack, attributed to any `org_id`, for any amount, to any phone number.
- `daraja-stk` — same issue, worse: could also trigger charges through an *org's own* Daraja merchant credentials if `useOrgCredentials: true` was passed. Not yet called by the client anywhere (Daraja per-org STK is still deferred per earlier notes), but the hole existed regardless.
- `send-sms-celcom` — could send arbitrary SMS to arbitrary numbers at the platform's expense, with no org attribution at all (the function didn't even accept an `org_id` parameter before this fix).

**Fixed:** all three now verify the caller via `Authorization: Bearer <token>` → `auth.getUser()`, then confirm the caller actually belongs to the `org_id` they're claiming to act for via `user_orgs`, before doing anything. Matches the pattern already correctly used in `admin-user-update`. Client-side: `send-sms-celcom`'s call in `utils.js` was sending the **static anon key** as the bearer token instead of the real user session token, and never passed `org_id` at all — both fixed. `paystack-charge`'s client call in `settings.js` was already correctly sending the real session token — no client fix needed there.

**High:**
- `daraja-callback` had no idempotency guard (unlike `paystack-webhook`, which correctly filters `status='pending'`) — a retried Safaricom callback (which does happen under real network conditions) could have double-credited SMS bundles or subscription extensions. Fixed by adding the same `status='pending'` filter.
- Stored XSS: `finance.js` inserted `f.reason` (a fine's free-text reason) into `innerHTML` unescaped in 3 places. A malicious or compromised admin account could have entered a `<script>` payload as a fine's reason, executing in every subsequent viewer's browser. Fixed using the existing `h()` escaping helper already correctly used elsewhere in the same file (line 525) — just wasn't applied consistently to all 3 spots.
- `send-2fa-otp` had no rate limiting — fixed with a 60-second per-email throttle using the existing `otp_codes` table (checks `created_at`, no new infra).

**Medium:**
- `paystack-webhook`'s HMAC signature check used a plain `!==` string comparison rather than timing-safe — fixed with a constant-time comparison function.
- RLS policies on `transactions`/`expenses`/`payment_requests`/`organisations` not yet re-verified against direct client access this session — query provided in the audit doc, needs Felix to run and share.

**⚠️ Not fixed, flagged for a design decision:** `send-sms-celcom` still checks org membership but not remaining `sms_bundle` balance before sending — the actual send (via Celcom) and the balance deduction (`trackSmsUsage()`) remain two separate steps, with sending happening first. A client that skipped the deduction call could still get sends without being charged against their bundle. Properly fixing this means moving the balance check + deduction into the same atomic server-side call, and deciding whether to hard-block sending at zero balance — didn't want to make that product decision unilaterally.

**Files changed:** `supabase/functions/paystack-charge/index.ts`, `supabase/functions/daraja-stk/index.ts`, `supabase/functions/send-sms-celcom/index.ts`, `supabase/functions/daraja-callback/index.ts`, `supabase/functions/paystack-webhook/index.ts`, `supabase/functions/send-2fa-otp/index.ts`, `js/utils.js`, `js/finance.js`. New: `SECURITY_AUDIT_2026-07-08.md`. SW bumped to v5.24, cache-bust to `v=2026070508`.

**⚠️ Edge Functions need to be redeployed, not just pushed to git** — unlike the app's own JS files (served directly from GitHub Pages), Supabase Edge Functions require `supabase functions deploy <name>` to actually take effect. Pushing these files to the repo alone does nothing until each of the 6 changed functions is redeployed.

**Test checklist:**
- Try calling `paystack-charge`/`daraja-stk`/`send-sms-celcom` directly (e.g. via curl/Postman) with no Authorization header — should get 401, not proceed.
- Try calling any of them with a valid logged-in user's token but an `org_id` they don't belong to — should get 403.
- Confirm normal in-app SMS sending and Paystack charging still work end-to-end as a real logged-in admin (these fixes should be invisible to legitimate use).
- Issue a test fine with a reason like `<b>test</b>` — should display as literal text `<b>test</b>`, not render as bold, confirming the XSS fix works.

---

## Session: 8 Jul 2026 — bank balance frozen (ADA), root cause was a prior session's own fix

**Reported:** ADA's bank balance stopped increasing with new deposits, stuck at whatever it was set to during a manual reset roughly a week earlier. A previous session's advice at the time was: "set the prevailing balance manually, then it will update automatically going forward" — this advice was the actual cause of the freeze, not a fix for it.

**Root cause, confirmed via the live function definitions (not guessed):** `update_bank_balance()` existed as **two overloaded functions** in the database — one taking `p_date` as `text`, one as `date`. The `text` version had `AND (bank_balance_locked IS NULL OR bank_balance_locked = false)` in its `WHERE` clause; the `date` version had no such check. Since the client always sends the date as a plain JS string, every real call was resolving to the broken `text` overload. The moment a manual balance is set, `settings.js` sets `bank_balance_locked = true` (intentionally, to make the Settings input field read-only afterward) — but this also caused the RPC's `WHERE` clause to match **zero rows** on every subsequent real transaction, silently returning `NULL` with no error thrown.

**Compounding it:** `updateBankBalance()` in `utils.js` wrapped the RPC call in a try/catch that only did `console.log` on error — no toast, nothing visible. So even the one path that *would* throw an actual error was invisible to any admin.

**Fix — surgical, not a feature removal.** Traced the actual intent of the lock: the Settings UI already correctly makes the balance input **read-only** once locked, with a note saying "Updates automatically with transactions." The lock was only ever meant to stop an admin from manually re-typing a number — never meant to block the automatic RPC. So instead of removing the manual-balance feature entirely (as first proposed), the fix is narrower: **dropped the broken `text`-parameter overload entirely**, leaving only the correct `date`-parameter version (no lock check) as the single, unambiguous function — see `v3h_fix_bank_balance_rpc.sql`. The existing manual-set-then-lock UI in Settings, and the SA-only `unlockBankBalance()` override, are both kept as-is — they were never the problem.

Also fixed `updateBankBalance()` in `utils.js` to stop silently swallowing errors — any failure (RPC error, or a `NULL` return from zero rows matched) now logs properly to console **and** shows a toast telling the admin the balance total may be wrong, so this specific failure mode can never be invisible again regardless of what causes a future issue.

**⚠️ ADA's balance still needs a one-time manual correction — not done automatically.** `diagnostic_ada_missed_balance.sql` sums everything recorded in `transactions` and `expenses` since the freeze date to estimate the correct current balance. This was deliberately left as a diagnostic query, not an auto-applied fix — Felix needs to review the numbers (and ideally cross-check against ADA's actual M-Pesa/bank statement for the period) before we write a corrected value back, since this is real group money and the reconstruction is only as good as what actually got recorded in the app.

**Files changed:** `js/utils.js`. New: `v3h_fix_bank_balance_rpc.sql` (run in Supabase SQL editor), `diagnostic_ada_missed_balance.sql` (run first, review before any correction). SW bumped to v5.23, cache-bust to `v=2026070507`.

**Test checklist:**
- After running the SQL fix, confirm only one `update_bank_balance` function remains: `SELECT oid, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'update_bank_balance';` should return exactly one row.
- Record a test contribution for a group whose balance was previously locked — confirm the balance actually increments now.
- Deliberately trigger a bank-balance RPC failure (e.g. temporarily pass an invalid org id in a test) and confirm the new toast warning actually appears — don't just trust the code, watch it fire once.

---

## Session: 7 Jul 2026 — reset/invite screen bugs, mandatory phone, missing profiles.email, duplicate-org root cause

**Reported:** reset-password and invite-password screens show white/invisible text while typing and don't show password requirements; refreshing during either screen logs the user straight into the app without ever setting a password; SA can't see registered users' phone/email; a "Send Mate" account had two identically-named "Hills" orgs in the activity log; SA feels slow to load, especially on mobile.

**1. White/invisible text on reset & invite screens — confirmed root cause, not a guess.** `showPasswordResetScreen()` (used for both `intent=reset` and `intent=invite`) applied inline dark-theme styling (`color:#fff` on a near-white `rgba(255,255,255,.08)` background) to its inputs — but this panel renders on the exact same **white card** as login/register, which correctly uses plain `class="form-input"` with no overrides (dark text on light surface, via the existing `.form-input` CSS rule). White text on a near-white background is why typed characters looked invisible. **Fixed** by removing every inline override and using the same bare `form-input` class every other working input on this screen uses. Also added the same live password-requirements checklist registration already has (`updatePasswordChecklist()` generalized to accept a suffix, so the two checklists — registration's and this one's — don't collide on shared element IDs).

**2. Refresh during reset/invite logs the user in without setting a password — confirmed root cause.** `init()` stripped the `?intent=` query param from the URL immediately on first load (so a refresh wouldn't re-trigger the screen) — but this meant a refresh **before** the user finished setting their password lost all record of why a session existed, and since Supabase had already authenticated them from the email link, the code fell through to `loadProfileAndOrg()` and logged them straight in. **Fixed** by also persisting the intent to `sessionStorage` at the same moment it's read from the URL, checked on every subsequent load if the URL param is gone, and cleared only once the flow actually completes (password set + signed out, or confirm screen shown + signed out).

**3. `profiles` never had an `email` column — this broke three separate things silently.** Confirmed via `information_schema.columns`. This wasn't caught earlier because none of the three failures crashed anything: the `admin-user-update` Edge Function's "sync email to profiles" step failed silently (no error check), `settings.js`'s `openOrgDetail()` select silently returned no `profiles` data, and the first draft of `handle_new_user()` this week 500'd loudly (the one exception, because a trigger failure aborts the whole transaction). **Fixed properly instead of patched a third time:** `v3g_add_profiles_email.sql` adds the column, backfills every existing profile from `auth.users`, and updates `handle_new_user()` to populate it going forward. The SA member-detail UI (`sau-email`, `sau-phone`) and `loadSAMembers()` (`select('*')` on profiles) already existed and already expected this column — **no JS changes were needed for SA to see phone+email, only this migration.** Also added proper error-checking to the `admin-user-update` sync step so a future silent failure of this kind surfaces in logs instead of disappearing.

**4. SA should NOT be able to see a user's password — this is impossible by design, not a missing feature.** Supabase (like any correctly-built auth system) stores passwords as a one-way hash — there is no operation, by anyone, that recovers the original password from it. If this were possible, it would mean passwords aren't properly hashed, which would be a severe vulnerability, not a convenience. The operational need this was probably reaching for — helping a locked-out user — is already fully covered by the existing "Update this user's login credentials" panel (SA sets a new email/password directly, no need to see the old one).

**5. Duplicate "Hills" org — root cause found, not assumed malicious.** The activity log showed two `ORG CREATED` entries for the same user, name, and org, one second apart. Traced to `registerNewOrg()` (called from two independent places: `pickerCreateOrg()` on the workspace picker, and a direct "Create Organisation" button elsewhere) having **no double-submit guard** — a fast double-click/double-tap, very plausible on mobile, fires it twice before the first call returns. **Fixed** with a `window._registeringOrg` flag inside `registerNewOrg()` itself (protects both call sites at once) plus a disabled-button guard on `pickerCreateOrg()`'s and `registerAccount()`'s and `joinOrg()`'s submit buttons for the same class of bug. ⚠️ **Deliberately did not add a uniqueness constraint on org name** — legitimately different chamas can share common names (e.g. many groups named "Umoja" or "Peace" genuinely exist), so hard-blocking by name would incorrectly reject real registrations. If Felix wants SA-facing duplicate-name *detection* (flagged, not blocked) as a follow-up, that's a small addition, not built this round.

**6. Mandatory phone number at registration.** `reg-phone` (self-registration) and `join-phone` (join-existing-org) are now required, validated via a new `isValidKenyanPhone()` helper (built on the existing `formatPhone()` E.164 normalizer already used for SMS, so validation and actual usage agree on what counts as valid) rather than a new, possibly-inconsistent format check. ⚠️ **Format validation only — not live/carrier verification.** True phone-ownership verification (send an OTP, require it back) is possible using the existing Celcom SMS Edge Function, but needs a new `phone_verifications` table (code + expiry + attempt limit) and costs one SMS credit per registration attempt. Not built this round — flagged as an available next step, not assumed wanted given the added cost/complexity.

**Files changed:** `auth.js`, `utils.js`, `index.html`, `supabase/functions/admin-user-update/index.ts`. New: `v3g_add_profiles_email.sql` (run in Supabase SQL editor). SW bumped to v5.22, cache-bust to `v=2026070506`.

**⚠️ Not addressed this round, needs follow-up:**
- SA slow-load-on-mobile — `loadSAMembers()` fetches ALL profiles/user_orgs/members/orgs with `select('*')` and no pagination on every load of the All Members / Platform Overview screens. This is a plausible contributor as the user count grows, but wasn't confirmed against actual load-time evidence — needs Network-tab timing from the specific slow screen before treating this as the fix, not a guess.
- `join-password` (join-existing-org flow) only checks length ≥ 6, not the same full strength rules (upper/lower/number) `registerAccount()`/`setNewPassword()` now enforce — a minor inconsistency, not fixed this round since it wasn't flagged.

**Test checklist:**
- Register with a brand-new email, no phone entered → should be blocked with a clear message.
- Click confirm-email link, refresh the "Email confirmed!" screen a few times → should stay put, never silently log in.
- Click an invite link, refresh the "Set your password" screen WITHOUT setting one → should stay on that screen, not enter the app. Type in the password field → text should be clearly visible, checklist should update live.
- SA → All Members → open any user → email and phone should now display (after running the SQL migration).
- Rapidly double-click "Create Group" → should only create one organisation, not two.

---

## Session: 5 Jul 2026 (continued yet further — the actual actual root cause)

**Before any of the below: the first version of `v3f_registration_overhaul.sql` caused a 500 on every signup.** It assumed `profiles` had an `email` column (based on other code elsewhere in the app referencing `profiles.email`) — it doesn't. Confirmed via `information_schema.columns`: `profiles` has exactly `id, org_id, role, full_name, phone, id_number, created_at, two_fa_enabled` — no `email`. The trigger's INSERT statements failed outright (Postgres error `42703: column "email" of relation "profiles" does not exist`), which aborted the whole transaction, which is why `signUp()` returned a 500 instead of silently misbehaving. Corrected version removes every `profiles.email` reference; `pending_members.email` was left as-is since that table genuinely does have the column. ⚠️ **Flagged, not fixed:** `settings.js`'s `openOrgDetail()` also does `select('id,full_name,role,email')` from `profiles` — same wrong assumption, degrades silently (error isn't checked) rather than crashing, so the SA org-detail page may be missing member email data right now.

**The overhaul below was structurally correct but never actually ran, separately from the above.** After fixing the trigger, registration itself started working — but confirm-email and forgot-password links still landed on a "reset password" prompt, and refreshing still logged people straight in, exactly as before the overhaul. Traced it down: there was a **second, older auth-handling function living in `utils.js`, never inspected during the overhaul**, called `handleAuthRedirect()`, wired into the page bootstrap like this:

```js
async function start() {
  const isReset = await handleAuthRedirect();
  if (!isReset) init();   // ← skipped entirely if handleAuthRedirect() returns true
}
```

`handleAuthRedirect()` checked `window.location.hash` for `type=signup` **or** `type=recovery` — the exact fragile hash-based mechanism the overhaul below was meant to replace, just living in a file nobody thought to check. Since Supabase's confirm-signup link legitimately contains `type=signup` in the hash, this old function matched it, showed its own hardcoded "Set New Password" form on the spot, and returned `true` — which meant **the new `init()` with all the `?intent=` routing never executed at all**, for either confirm or reset links. This function never signed anyone out either, which is why refreshing silently completed a login.

**Also found:** `portal.js` had a full duplicate copy of the same `start()` call and service worker registration — leftover from an "auto-split from index.html" refactor mentioned in that file's own header comment. Harmless on its own, but a second, independent invocation of the entire bootstrap sequence on every page load is exactly the kind of thing that makes bugs like this one hard to trace, since two copies of "the thing that runs first" can each behave differently.

**Fix:** removed `handleAuthRedirect()` and its companion `updatePassword()` from `utils.js` entirely — fully superseded by `auth.js`'s `init()`/`setNewPassword()`. Removed the duplicate `start()`/service-worker-registration block from `portal.js`, keeping the genuinely non-duplicated `beforeinstallprompt`/`showInstallBanner` PWA-install code that lives in the same file. Simplified `index.html`'s bootstrap to just call `init()` directly.

**Files changed:** `utils.js`, `portal.js`, `index.html`. SW bumped to v5.21, cache-bust to `v=2026070505`.

**Test checklist, same as the overhaul below, now that the actual blocker is gone:**
- Register with a brand-new email → confirm link → should land on "Email confirmed!" screen, not reset-password, and refreshing it should not log you in.
- Forgot password → link goes to app.groupyetu.org → set new password → should sign out and show "Password set! Sign in" screen, not auto-enter the app.

---

## Session: 5 Jul 2026 (continued further — registration/reset/invite complete overhaul)

**This closes out a bug that survived two earlier "fixes" this same day — both previous attempts patched symptoms without finding the actual root cause. This entry documents the full email/auth architecture so it doesn't need re-diagnosing next session.**

### The real root cause (confirmed, not inferred)

`registerAccount()`, `joinOrg()`, and `saveInviteAdmin()` all called `sb.auth.signUp()` and then **immediately** tried to write to `profiles` (and, for `joinOrg()`, also `user_orgs` and `pending_members`) from the client. With email confirmation ON, `signUp()` does **not** establish an active session until the user actually clicks the confirmation link — `authData.session` is `null` at that point. So these writes were running with **no authenticated session at all**.

Confirmed via `SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename='profiles'`:
```
profiles_insert | INSERT | (id = auth.uid())
```
With no session, `auth.uid()` is null, so `null = id` is false — **every one of these inserts was silently blocked by RLS.** None of the three call sites checked for an error (some unchecked entirely, one wrapped in a swallowing `try/catch`), so registration always *looked* successful (green success message shown) while the profile/org-link data silently never existed.

This also explains why the confirmation-link routing added earlier today ("if a profile exists → show confirmed screen, else → show reset screen") always misfired — the profile it was checking for was never actually there, for ANY self-registration, not intermittently. That's why a brand-new, never-used-before email reproduced the bug 100% of the time.

**Follow-on bug this caused:** `showPasswordResetScreen()` doesn't sign the user out (by design — it needs a live session to let them set a password). Since the routing bug sent self-registrations there instead of the confirmed-screen, users were left on that screen with a live session; refreshing the page silently completed a normal login. This looked like "confirming email logs me into my account on a random device" but was really just a consequence of being on the wrong screen.

**Two more real bugs found while tracing this:**
- `sendPasswordReset()` (forgot-password, auth.js) redirected to `https://groupyetu.org/` — the **marketing site**, not the app.
- The "add new member + send portal invite" flow (members.js, member-creation modal) used `resetPasswordForEmail()` to invite brand-new members. That function only sends anything if the email **already has an account** — for a genuinely new member it silently sent nothing at all, no account created, no email sent, while the UI reported "invite sent."

### The permanent fix — stop inferring intent, declare it explicitly

Both earlier "fixes" tried to **infer** what a confirmation link was for for (signup vs. reset vs. invite) from ambient signals — Supabase's URL hash `type` param, or "does a profile exist in the DB." Both are fragile and both broke. The fix: we already control every redirect URL generated (`emailRedirectTo`/`redirectTo` on every `signUp()`/`resetPasswordForEmail()` call) — so every one of them now carries an explicit `?intent=confirm|reset|invite` query param, and `init()` in `auth.js` routes strictly off that, ignoring Supabase's own event classification entirely. This is immune to hash-format differences (implicit vs. PKCE flow), timing races, and DB state.

**Redirect URLs, now all consistent:**
| Flow | File | Intent |
|---|---|---|
| Self-registration | `auth.js` → `registerAccount()` | `?intent=confirm` |
| Request to join an org | `auth.js` → `joinOrg()` | `?intent=confirm` |
| Forgot password | `auth.js` → `sendPasswordReset()` | `?intent=reset` (also fixed wrong domain) |
| Admin resend invite | `members.js` → invite-existing-member path | `?intent=invite` |
| New member + send invite | `members.js` → add-member modal | `?intent=invite` (also fixed the silent-failure bug above) |
| SA/admin inviting a team member | `settings.js` → `saveInviteAdmin()` | `?intent=invite` |
| Admin-triggered resets (2 places) | `settings.js` | `?intent=reset` |

### Profile/org creation no longer depends on session timing at all

Rather than leave the client-side upserts in place and just add error checking (they'd still fail — the problem isn't unhandled errors, it's that an anonymous request genuinely can't pass this RLS check), all of that logic moved into a **`SECURITY DEFINER` trigger on `auth.users`**, which runs with elevated privileges regardless of session state — see `v3f_registration_overhaul.sql`. It reads metadata now passed through every `signUp()` call (`join_org_id`, `invite_org_id`/`invite_role`/`invite_member_id`, `admin_invite_org_id`/`admin_invite_role`) and creates the right rows in `profiles`, `user_orgs`, and `pending_members` deterministically, every time, independent of whether the user has confirmed their email yet.

The old client-side upserts in `registerAccount()`, `joinOrg()`, and `saveInviteAdmin()` were **removed** (not just left as dead code) — they can never succeed given the RLS policy above, and leaving them in would be misleading for future debugging.

- ⚠️ **Not yet re-verified:** the self-healing invite-metadata block inside `_loadProfileAndOrgInner()` (auth.js ~line 158) still exists and runs fine on its own (it executes post-login, with a real session) — this is now a secondary safety net rather than the primary mechanism, since the trigger handles it up front. Left in place deliberately, should not conflict (uses `.upsert()`/idempotent update).

### Consistent, predictable session behaviour on every auth screen

Per explicit direction: no auth-related screen should leave a live session sitting around for a stray refresh to exploit.
- `showEmailConfirmedScreen()` — unchanged behaviour (already signed out correctly), now reached reliably via `intent=confirm`.
- `showPasswordResetScreen(intent)` — now takes `intent` (`'reset'` or `'invite'`) to show correctly worded copy for each case.
- `setNewPassword()` — **changed:** after successfully setting a password, now explicitly signs out and shows a new `showPasswordSetConfirmedScreen()` ("Password set! Sign in to get started") instead of silently continuing into the app. This applies to both forgot-password resets and first-time invite password setup, for consistent behaviour everywhere. **Decision made without explicit confirmation** — if immediate auto-login after an invited member sets their first password is preferred instead (less friction, arguably fine since it's their very first login ever), this is a one-line change back.

### Email templates
- **Reset Password** template in Supabase Dashboard was found to contain the **Invite** template's content verbatim (same "You've been invited..." copy) — this is what made the reset-password wording feel wrong. Corrected version provided: `email_template_reset_password.html`. Paste into Supabase Dashboard → Authentication → Email Templates → Reset Password.
- **Confirm signup** template (`email_template_confirm_signup.html`, unchanged) is correctly configured and was not the source of the bug.
- ⚠️ **Known limitation, flagged not fixed:** admin-invited members (via `saveInviteAdmin()`, and the members.js invite paths) still go through `signUp()`, which always sends Supabase's **"Confirm signup"** template — NOT the dashboard's "Invite user" template slot — regardless of what's pasted into that slot. So invited members currently see "Thanks for joining GroupYetu360" wording, which doesn't quite fit their situation (they didn't self-register). Getting genuinely correct "You've been invited" wording requires moving invites to Supabase's native `admin.inviteUserByEmail()` API, which needs a service-role key and must run server-side (an Edge Function, same pattern already used for Celcom SMS) — a real but bigger follow-up, not done in this session.

### Test checklist for next session
- Register with a brand-new email → confirm link → should land on "Email confirmed!" screen, NOT reset-password. Refreshing that screen should NOT log you in (session should already be cleared).
- Forgot password → link should go to `app.groupyetu.org` (not the marketing site) → set new password → should sign out and show "Password set! Sign in" screen, not auto-enter the app.
- Add a new member with "send portal invite" checked → confirm an actual account + email now goes out (previously silently did nothing).
- Join an existing org via the picker → after confirming email, check that `profiles`, `user_orgs` (role='pending'), and `pending_members` all actually have rows for that user (previously none were created).
- SA inviting a new admin/team member → confirm their profile/org role are correctly set after they confirm.

**Files changed:** `auth.js`, `members.js`, `settings.js`. New: `v3f_registration_overhaul.sql` (run in Supabase SQL editor), `email_template_reset_password.html` (paste into Supabase Dashboard). SW bumped to v5.20, cache-bust to `v=2026070504`.

---

## Session: 5 Jul 2026 (continued — real root cause found)

**The actual reason Atinda's ADA access kept coming back after every SQL fix**

Felix noticed something specific and correct: after clearing his `user_orgs` row via SQL, ADA disappeared from his SA profile — but reappeared the moment he actually logged in, both on his own workspace picker and back in SA's All Members view. He also correctly guessed that the *other* ~10 recovered members would self-heal automatically on their next login without needing manual SQL. Both observations pointed at the same mechanism.

**Root cause:** `profiles.org_id` is a separate, legacy single-org field, distinct from `user_orgs` (the real multi-org membership table). At login, if `user_orgs` comes back empty for a user, `_loadProfileAndOrgInner()` in `auth.js` falls back to `profiles.org_id` to decide which org to load them into — and if it finds one, it **recreates** the `user_orgs` row from it (this is the same "single org, skip picker, go straight in" fast path everyone uses on a normal day).

For the 10 real members: this field is still correctly set to ADA, so yes — their access genuinely will self-heal on next login, no manual fix required.

For Atinda: this field was **never cleared** when he was originally deleted as a member (that step didn't exist before today), so it's a stale pointer still saying "ADA" — meaning every login silently re-derives and recreates the exact `user_orgs` row we kept deleting via SQL. The app itself was undoing our fixes, not a caching or propagation issue.

**Fix:** `deleteMember()` (`members.js`) now also clears `profiles.org_id` on the deleted person's profile, but *only* if it currently matches the org they're being removed from (won't touch it if their primary org is elsewhere). One-time SQL also provided to clear Atinda's specific stale value directly (`clear_atinda_stale_org_id.sql`).

- **Test:** delete a member who has `profiles.org_id` pointing at that same org, confirm the field is nulled afterward (not just `user_orgs`). Then have Atinda log in again — ADA should not reappear anywhere this time.
- ⚠️ Did not touch the login fallback logic itself (`_loadProfileAndOrgInner`) — it's working as designed for everyone whose `profiles.org_id` is accurate; the bug was the *stale data*, not the fallback mechanism. Worth knowing this fallback exists if a similar "access came back after I deleted it" report shows up again for a different reason.

**Files changed:** `members.js`. SW bumped to v5.19, cache-bust to `v=2026070503`.

---

**⚠️ Incident: a cleanup query removed workspace access for ~10 real ADA members**

What happened: to fix Atinda's orphaned `user_orgs` row (see entry above), a diagnostic query was written that matched members by `user_orgs.user_id = members.user_id`. That query was flawed — many real, active ADA members had `members.user_id` still `NULL` (it only gets backfilled on first login via the app's self-heal logic), so the query wrongly identified them as "no member record, safe to remove" and deleted their `user_orgs` grant. Felix ran the full SQL file (including the flawed cleanup step) before a follow-up warning about it landed. Real members — Austine Olare, Brian Magero, David Okoth Otieno, Peter Ouma Ombwayo, Raphael Onyango, Stephen Otieno, Francis Onyango Nyawalo, Fredrick Oduor Oremo, Tyrus Omondi Okuyu, and others — temporarily lost access to ADA.

**Recovery:** their `members` rows were still intact (only `user_orgs` was wiped), so access was rebuilt from that — matched by phone instead of `user_id`, since `user_id` being null was the whole problem. Also backfilled `members.user_id` for everyone where it was still null but a phone match existed, closing the same gap for good. **Role information could not be recovered** — anyone who was `admin`/`treasurer` within ADA specifically (not just platform role) needs manual re-promotion via Set Role; this data was lost when the row was deleted and there's no way to reconstruct it from what remains.

**Correction:** the recovery script also accidentally re-granted Atinda access to ADA — his removal was the *original intentional test deletion*, not collateral damage, so he shouldn't have been restored. Removed again, this time with a scoped delete targeting only his specific user_id + the two orgs in question, not a broad matching query.

**Lesson, stated plainly for next session:** any query that *deletes* based on a join/match condition needs the match logic itself scrutinized for false negatives (people who look "unmatched" but genuinely aren't) before it's treated as safe to run — a SELECT preview isn't enough if the matching logic itself is wrong, since the preview will just as confidently show the wrong people. Prefer narrow, ID-specific deletes over broad heuristic-matched ones whenever the target is actually known (as it was here — Atinda's ID was known from the start).

**Bug: "Delete User" — final fix, based on the *complete* FK catalog**
- The first fix (earlier entry) only covered FKs pointing at `profiles.id`, found via `information_schema`. Testing surfaced a second failure on `pending_members.user_id`, which references `auth.users.id` directly — a completely different parent table that first search didn't check, and which `information_schema.constraint_column_usage` failed to surface at all even when queried directly (returned incomplete results — switched to querying `pg_constraint` directly instead, which is authoritative).
- Full catalog obtained via `pg_constraint`, confirmed complete. Most `auth.*` tables cascade automatically (identities, mfa_factors, sessions, oauth_*, webauthn_*, one_time_tokens) — no manual handling ever needed there. `members.user_id` and `user_orgs.user_id` also cascade/set-null automatically. The one real remaining gap was `pending_members.user_id` (no cascade) — now nulled alongside `pending_members.reviewed_by`.
- `delete_user_completely()` replaced again with the complete version — see `delete_user_completely_final.sql`.
- **Test:** Delete User on Atinda (should now fully succeed and remove him from ADA/Miruka entirely), and on any other test account regardless of which tables they've touched (transactions, pending join requests, payment approvals, etc.) — should no longer surface FK errors for any of the 13+ reference points now covered.

**Files changed (DB only, no app code this round):** `delete_user_completely()` function (twice, first incomplete then comprehensive), one-time data recovery for the incident above. No `.js`/`.html` changes.

---

**Bug: deleted members still showed as belonging to their org**
- Root cause: `deleteMember()` (superadmin-only "Delete Member" action) deleted the `members` row and its transactions/balance/attendance, but **never removed the `user_orgs` grant**. That grant is what actually controls whether someone shows up as belonging to an org platform-wide — so the member record was genuinely gone, but the person still appeared in "All Members" with the org listed (balance/status showing "—" since there was no member record left to read from).
- Fixed in `members.js`: `deleteMember()` now also deletes the matching `user_orgs` row.
- **Existing bad data from before this fix** (e.g. Atinda, already affected): needs a one-time SQL cleanup — see `fix_delete_user_and_orphaned_orgs.sql`, Step 2. Run the SELECT first to review, then the DELETE.

**Bug: "Delete User" (full account deletion) failing on FK constraint**
- `delete_user_completely()` RPC only deleted from `activity_log`/`members`/`user_orgs`/`profiles`/`auth.users` — didn't account for the 9 other tables that reference `profiles.id` as a "who did this" column (transactions, expenses, messages_log, pending_members, balance_adjustments, savings_rounds, round_contributions/disbursements, payment_requests, table_banking_pools/contributions/loans/repayments).
- Fixed: those references are now set to NULL before deletion (preserves the actual financial/audit records — a transaction shouldn't vanish because the person who recorded it left) rather than blocking the delete or cascading into record loss.
- ⚠️ Not yet verified: whether any of those 13 columns has a NOT NULL constraint, which would make the UPDATE fail instead of silently succeeding. If deleting a user throws a "null value violates not-null constraint" error next, that's the reason — will need a fallback (e.g. reassign to a placeholder "System" user) for that specific column.
- **Test:** try Delete User on someone who has recorded a transaction, an expense, AND approved a payment (covers 3 of the 13 tables) — should now succeed. Also re-test Atinda specifically once Step 2's cleanup has run.

**Files changed:** `members.js`. DB: `delete_user_completely()` function replaced, one-time data cleanup script provided (not yet run — needs Felix to review the SELECT before deleting). SW bumped to v5.18, cache-bust to `v=2026070502`.

---

**1. Registration flow — password rules**
- `auth.js`: added `validatePasswordStrength()` — requires 6+ chars, 1 uppercase, 1 lowercase, 1 number. Used in `registerAccount()`.
- `index.html` / `auth.js`: live checklist under the password field (✓/○ per rule, updates as you type) — `updatePasswordChecklist()`.
- **Test:** try registering with `abc123` (should fail — no uppercase), `ABCDEF` (fail — no lowercase/number), `Abc123` (should pass).

**2. Registration flow — professional email-confirmation screen**
- Root cause found: the existing `showEmailConfirmedScreen()` UI (✅ "Email confirmed!" + Sign In button) already existed but was **only reachable via the invite/password-reset flow** (Supabase `PASSWORD_RECOVERY` event). Fresh self-registration confirmation links fire a plain `SIGNED_IN` event instead, which was silently logging the user straight into the app with zero acknowledgment.
- `auth.js` `init()`: now inspects the URL hash for `type=signup` *before* anything else touches it. If present, shows `showEmailConfirmedScreen()` instead of loading the app, then clears the hash so a refresh doesn't re-trigger it.
- Added explicit `emailRedirectTo: 'https://app.groupyetu.org/'` to the `signUp()` call for reliability regardless of Supabase dashboard config.
- ⚠️ Two race conditions fixed as part of this (see below) — both were pre-existing, not introduced today.
- **Test:** register a brand-new account, confirm via the email link, verify you land on "Email confirmed!" screen (not silently logged into the app), click Sign In, log in normally.

**3. Login flow — 2FA "flash into app" race condition (real bug, not cosmetic)**
- Root cause: `signInWithPassword()` fires `SIGNED_IN` immediately, which the `onAuthStateChange` listener was racing to handle (calling `loadProfileAndOrg()`/showing the app) *before* `signIn()`'s own 2FA check had a chance to sign back out and show the OTP screen. That's the flash Felix reported.
- Fix: `window._suppressAuthAutoLoad` flag, set before `signInWithPassword()`, checked by the listener. `signIn()`/`verify2FA()` now explicitly call `loadProfileAndOrg()` themselves once they know which path they're on, instead of relying on the listener to race correctly.
- Same pattern applied to the signup-confirmation fix above (`_suppressAuthScreenOnce` for the `SIGNED_OUT` side) — `showEmailConfirmedScreen()` was calling `signOut()` without awaiting it, which could let a pending `INITIAL_SESSION` event slip through and load the app anyway.
- **Test:** log in as a 2FA-enabled account (SA or any admin with 2FA on) — should go straight to OTP screen with **no flash of the dashboard first**.

**4. Login flow — modern OTP UI**
- Replaced single wide text input with 6 individual auto-advancing boxes (Paystack-style): type advances focus, backspace goes back a box, paste distributes across all 6, auto-submits once the 6th digit is entered.
- Added 30-second resend cooldown (button disables with a live countdown) instead of an always-clickable resend link.
- Wrong code now shakes the boxes and auto-clears for retry, instead of just showing text.
- **Test:** type a code manually (check auto-advance), try backspacing, try pasting a 6-digit code, try resending twice quickly (second should be disabled with countdown), enter a wrong code (should shake + clear).

**5. SMS — custom audience selection**
- Added a 4th recipient option, "✓ Choose Members" — reveals a searchable checkbox list of all members with phone numbers. Built for ad-hoc sub-group sends (executive, women's wing, youth, etc.) since there's no formal sub-group/tagging feature yet.
- `modules.js`: `renderCustomMemberList()`, `filterCustomMemberList()`, `toggleCustomMember()`, `toggleAllCustomMembers()` (select-all/clear respects the current search filter). `sendSms()` now branches on `recipientType === 'custom'` and sends only to checked members.
- ⚠️ Follow-up not built yet: there's no way to *save* a custom selection as a named sub-group for reuse next time — each send requires re-checking members. Worth asking Felix if that's wanted before building it (bigger feature — would need a new table).
- **Test:** go to Messages → Choose Members → search for a member, check a few boxes, select-all/clear (with search active — should only affect visible/filtered rows), send, confirm the confirmation dialog says "N selected members" not a status label.

**Files changed:** `auth.js`, `index.html`, `modules.js`. SW bumped to v5.17, cache-bust to `v=2026070501`.

---

## How to use this file (for the next session)
- Each entry: date, what was asked, what was actually changed (files + functions), why, and what to manually test afterward.
- If you're picking this up in a new session: read the last 3-5 entries before doing anything, especially any marked ⚠️ (known follow-ups / things deliberately left alone).
- This file should be pushed to the repo alongside every code change from now on — it's part of the deliverable, not an afterthought.
