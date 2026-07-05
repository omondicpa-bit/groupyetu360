# GroupYetu360 — Development Changelog
_Maintained for Play Store closed-testing report and cross-session handover. Newest entries at top._

---

## Session: 5 Jul 2026

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
