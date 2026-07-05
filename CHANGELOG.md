# GroupYetu360 — Development Changelog
_Maintained for Play Store closed-testing report and cross-session handover. Newest entries at top._

---

## Session: 5 Jul 2026 (continued — incident + final fix)

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
