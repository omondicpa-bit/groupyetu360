# GroupYetu360 — Handover Summary
_Read this first if picking up a new session. Full technical detail for everything below is in CHANGELOG.md — this is the "what do I need to know before touching anything" version._

**As of:** 5 Jul 2026, end of session · **Code state:** app SW v5.21, cache-bust v=2026070505

---

## Deploy mechanism changed today — read this before troubleshooting any future deploy issue

GitHub Pages was switched from **"Deploy from a branch"** to **"GitHub Actions"** as the deploy source (Settings → Pages). This was because two workflow runs got permanently stuck in "Queued" for hours and could not even be cancelled — GitHub's own backend lost track of them. The new Actions-based workflow (`.github/workflows/static.yml`) includes a `concurrency` guard so overlapping deploys queue safely instead of racing each other, which is what caused several of that day's runs to fail with "Deployment failed, try again later."

**The workflow deliberately does NOT upload the whole repo.** A staging step (`rsync` with excludes) copies only actual web assets into `_site/` before upload — Android/Gradle build files, `supabase/` (SQL source, not runtime-needed), `*.sql` migration scripts, and `CHANGELOG.md`/`HANDOVER.md` are excluded. The changelog/handover exclusion is deliberate and important: those files contain real member names and internal incident detail, and would otherwise be publicly reachable at a guessable URL if deployed. **They stay in git/GitHub for reference, just not on the live site.**

If a future deploy fails: check the Actions tab first (`.github/workflows/static.yml`), not GitHub Pages legacy settings — the mechanism is now Actions-based end to end.

---

## Registration/reset/invite — completely overhauled this session, read before touching auth.js/utils.js/portal.js

**Two separate root causes, found in sequence — both real, both now fixed:**

1. **The DB trigger (`v3f_registration_overhaul.sql`) 500'd on every signup at first** — it assumed `profiles` had an `email` column; it doesn't (`profiles` has `id, org_id, role, full_name, phone, id_number, created_at, two_fa_enabled` — confirmed via `information_schema.columns`). Corrected version removes every `profiles.email` reference. ⚠️ `settings.js`'s `openOrgDetail()` makes the same wrong assumption and degrades silently rather than crashing — **not fixed yet**, flagged for next session.

2. **Even after the trigger worked, confirm/reset links still misbehaved** — because a completely separate, older function `handleAuthRedirect()` in `utils.js` ran *before* `init()` in the page bootstrap, checked the URL hash for `type=signup`/`type=recovery` (the old fragile mechanism), and — if it matched — showed its own hardcoded password form and **skipped `init()` entirely**, meaning the whole new `?intent=` routing never got a chance to execute. This function never signed anyone out either, which is why refreshing silently logged people in. **Removed entirely** — `init()` now runs directly and is the only auth-bootstrap code path. Also removed a duplicate copy of the same bootstrap sequence that was sitting in `portal.js` (leftover from an old "auto-split from index.html" refactor).

**If a future "confirm/reset link does something weird" bug shows up again:** check for any OTHER stray legacy auth-handling code first (grep for `location.hash`, `type=signup`, `type=recovery` across all `.js` files) before assuming the bug is in `auth.js`'s `init()` itself — this exact failure mode (a second, forgotten handler intercepting first) is exactly what cost an extra round this session.

**Root cause of the original bug (the one that started this whole thread):** `profiles` table's INSERT policy requires `auth.uid() = id`. Since `signUp()` with email confirmation ON doesn't create a session until the link is clicked, every client-side attempt to write a `profiles` row immediately after `signUp()` was silently blocked by RLS — for every registration, not intermittently.

**Permanent fix, not a patch:**
- Every `signUp()`/`resetPasswordForEmail()` call now carries an explicit `?intent=confirm|reset|invite` on its redirect URL. `init()` in `auth.js` routes strictly off that param.
- All `profiles`/`user_orgs`/`pending_members` creation moved into a `SECURITY DEFINER` trigger on `auth.users` (`v3f_registration_overhaul.sql`).
- Every auth screen signs the user out afterward and shows an explicit "please log in" screen.
- Fixed two more real bugs found while tracing this: forgot-password was redirecting to the marketing site instead of the app; adding a brand-new member with "send portal invite" checked was silently sending nothing at all.

**⚠️ Needs verification at start of next session:**
- Confirm `v3f_registration_overhaul.sql` (corrected version, no `email` column) has been run.
- Paste `email_template_reset_password.html` into Supabase Dashboard → Auth → Email Templates → Reset Password.
- Full test checklist: register → confirm link → should land on "Email confirmed!" (not reset-password), refresh should NOT log in. Forgot-password → correct domain → set password → signs out, shows "Password set!" screen.

**⚠️ Known limitation, not fixed this session:** admin-invited members still receive Supabase's "Confirm signup" wording, not true "Invite" wording — requires moving invites to a server-side Edge Function using Supabase's native invite API. Real, bigger follow-up.

**⚠️ Product decision made without explicit sign-off, easy to reverse:** invited members now see "Password set — please log in" instead of auto-entering the app after setting their first password, for consistency with reset-password. One-line change in `setNewPassword()` if auto-login is preferred instead.

---

## Where things stand otherwise

**Confirmed working, deployed and tested this session:**
- Delete User (`delete_user_completely()`) — final fix: `pending_members.user_id` is `NOT NULL`, so the function was trying to null it and failing, rolling back the entire deletion silently. Now deletes those rows outright instead of nulling them (their `reviewed_by` handling elsewhere is unaffected — that's still correctly nulled, not deleted, since it's a different person's audit trail). Confirmed working — Atinda's account fully deletes now.
- All other 12 FK-reference columns checked and confirmed nullable — no other NOT NULL surprises waiting in that catalog.

**Still outstanding from earlier in the day, not re-verified this entry:**
- Confirm the ~10 ADA members whose access was accidentally wiped earlier are still showing correct access, and whether any need their **role** manually restored (see CHANGELOG.md for names — role data for anyone who was admin/treasurer within ADA specifically could not be recovered).

## Architecture notes still worth knowing (see memory for full detail)

- `profiles.role` = platform-wide account status. `user_orgs.role` = actual per-org permission. Never conflate the two.
- `platform_settings` is superadmin-only via RLS (intentional — holds API secrets). Non-sensitive fields should read `platform_settings_public` instead.
- SA's `currentOrg` is a placeholder object with no `.id` field except when actively viewing a specific org.
- Full FK catalog for anything pointing at `profiles.id`/`auth.users.id` is documented in CHANGELOG.md.
- **New as of this session:** `profiles`/`user_orgs`/`pending_members` row creation at signup time is now handled by a DB trigger (`handle_new_user()`), not client-side JS. If a future "new user isn't getting linked correctly" bug shows up, check the trigger and its metadata fields first, not the client code.

## Not built, explicitly deferred (asked about, not forgotten)

- Saving a custom SMS audience as a named, reusable sub-group — bigger feature, needs a new table, deferred by Felix.
- Self-service CSV import for member data — intentional white-glove sales-tool decision, not a gap.
- SMS Leopard / Africa's Talking still SA-only-functional (Supabase free-plan Edge Function DNS restriction) — Celcom is the working primary.
- Moving invite emails to a proper server-side Edge Function for correct "You've been invited" wording (see limitation above).

## Also in flight, not app-code related

- **Google Play closed testing:** 14-day clock running, started ~1 Jul — check tester count hasn't dipped below 12.
- **Marketing:** Blog #2 ("Chama Management Software checklist") was scheduled for Mon 6 Jul — confirm it actually got pushed.
- Twitter/X — check whether it's live and whether the Blog #1 tweet was sent.

---

_This file and CHANGELOG.md should both be updated with every session's work — this one stays short and current-state-focused, CHANGELOG.md keeps full technical detail per change. Both are excluded from the live deploy artifact (see deploy section above) so they can safely contain full internal detail._
