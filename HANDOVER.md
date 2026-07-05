# GroupYetu360 — Handover Summary
_Read this first if picking up a new session. Full technical detail for everything below is in CHANGELOG.md — this is the "what do I need to know before touching anything" version._

**As of:** 5 Jul 2026, end of session · **Live version:** app SW v5.18, marketing site cache-bust v=2026070502

---

## Where things stand right now

**Shipped and confirmed working today:**
- Registration: password strength rules (6+ chars, upper, lower, number) with a live checklist UI
- Registration: proper "Email confirmed!" landing screen for fresh signups (previously silently logged people straight into the app with no acknowledgment)
- Login: fixed a real race condition where 2FA accounts briefly flashed into the actual app before the OTP screen took over
- Login: modern 6-box auto-advancing OTP input (Paystack-style), paste support, 30s resend cooldown
- SMS: admins can now select individual members via checkboxes for ad-hoc sub-group sends (executive, women's wing, youth, etc.) — no formal sub-group/tagging feature exists, this is manual per-send selection
- Fixed: deleting a member left their org access (`user_orgs`) behind even though their member record was gone — they'd still show up as "belonging" to the org with blank data
- Fixed: "Delete User" (full account deletion) was blocked by foreign key constraints across 13+ tables that reference a user as "who did this" (transactions, expenses, payment approvals, etc.) — now nulls those references instead of blocking or cascading into data loss

**⚠️ Needs verification at the start of next session, not assumed done:**
- Confirm Atinda Obed's account is now **fully deleted** (was the ongoing test case all session — last action was rerunning the fixed `delete_user_completely` against him, but this wasn't confirmed successful before the session ended)
- Confirm the ~10 ADA members whose access was accidentally wiped (see incident below) are still showing correct access, and check with ADA whether any of them need their **role** manually restored — Austine Olare, Brian Magero, David Okoth Otieno, Peter Ouma Ombwayo, Raphael Onyango, Stephen Otieno, Francis Onyango Nyawalo, Fredrick Oduor Oremo, Tyrus Omondi Okuyu were all reset to plain "member" since their original role (if elevated) couldn't be recovered

## ⚠️ Incident this session (read before running any DB cleanup query)

A diagnostic query meant to find one orphaned record (Atinda's) instead matched on a condition (`user_orgs.user_id = members.user_id`) that many legitimate members also failed to meet, because `members.user_id` is null until first login. Running it deleted real access for ~10 active members. Recovered by rebuilding from their still-intact `members` rows, matched by phone instead. Full detail and the exact lesson (narrow ID-specific deletes over broad heuristic matches, when the target is already known) is in CHANGELOG.md under "Incident: a cleanup query removed workspace access."

**Practical implication for next session:** any DB query that *deletes* or *removes access* based on a join/match — even after a SELECT preview — needs the matching logic itself checked for false negatives before running. A clean-looking preview doesn't guarantee the match condition is correct.

## Architecture notes still worth knowing (see memory for full detail)

- `profiles.role` = platform-wide account status. `user_orgs.role` = actual per-org permission. Never conflate the two — this distinction is also what the Set Role bug (fixed earlier in the week) was about.
- `platform_settings` is superadmin-only via RLS (correct, intentional — holds API secrets). Anything needing non-sensitive fields (support contact, sms_provider, etc.) should read `platform_settings_public` instead.
- SA's `currentOrg` is a placeholder object with no `.id` field except when actively viewing a specific org — gets reset on navigation, not on modal close.
- Full FK reference catalog for anything pointing at `profiles.id` or `auth.users.id` is now known and documented (14+ tables) — no need to rediscover this if another "delete X" flow hits a constraint error; check CHANGELOG.md's final entry for the complete list first.

## Not built, explicitly deferred (asked about, not forgotten)

- Saving a custom SMS audience as a named, reusable sub-group (currently: re-select members every send) — bigger feature, needs a new table, Felix said per-send selection is fine for now
- Self-service CSV import for member data migration — currently white-glove, founder-assisted only (this is an intentional sales-tool decision from the marketing plan, not a gap)
- SMS Leopard / Africa's Talking still not fully activated (Leopard: sender ID pending; both are SA-only-functional due to Supabase free-plan Edge Function DNS restrictions) — Celcom is the working primary and that's what's actually in use

## Also in flight, not app-code related

- **Google Play closed testing:** 14-day clock running, started ~1 Jul, 12+ testers confirmed at last check — needs the tester count kept above 12 the whole window, check this hasn't dipped
- **Marketing:** Blog #1 published and distributed; Blog #2 ("Chama Management Software checklist") was drafted and ready, scheduled for Mon 6 Jul per the content calendar — confirm whether it actually got pushed
- Twitter/X page — Felix was setting one up as an additive channel (not replacing Facebook/WhatsApp); check whether it's live and whether the Blog #1 tweet was ever sent

---

_This file and CHANGELOG.md should both be updated going forward — this one stays short and current-state-focused, CHANGELOG.md keeps full technical detail per change._
