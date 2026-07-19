# Changelog — 19 July 2026 session

## Payments — SasaPay
- Added SasaPay as a third payment provider: production credentials, `sasapay-charge`/`sasapay-webhook`/`sasapay-verify` Edge Functions, dedicated fee fields (`sasapay_fee_percent` default 0.2%, `sasapay_platform_fee_percent` default 1.3% — was previously wrongly hardcoded/reusing Paystack's rate).
- Fixed: Supabase gateway silently rejecting all webhook callbacks with 401 (missing `--no-verify-jwt` on deploy) — root cause of a long-unsolved historical issue where Paystack/Fingo webhooks appeared to work but were actually never delivering; the active-verify polling fallback was doing all the real work undetected.
- Fixed: false "Payment Failed" on successful SasaPay payments — caused by misreading their informational IPN callback (no `ResultCode` field) as a failure.
- Fixed: `TypeError: ...insert(...).catch is not a function` crash in `sasapay-webhook` after successful crediting (three occurrences, replaced with proper try/catch).
- Fixed: checkout showing false timeout despite backend success — added a direct self-poll of `payment_requests.status` for SasaPay specifically, since no true synchronous verify endpoint exists on their side.
- `sasapay-verify` built as an honest "nudge" (prompts SasaPay to redeliver a stuck webhook) rather than a true verify, matching what their API actually supports.
- Confirmed via full log inspection: SasaPay never sends the `X-SasaPay-Signature` header on any real callback. Reported to their technical team; webhook simplified accordingly, defensive amount cross-check remains the enforced safety net.
- Added SasaPay to the org-level active-provider selector (three locations) and fixed a bug where selecting it would have silently broken checkout, since it has no per-org account reference the way Paystack/Fingo do.

## Settlement system
- Built `settlement_batches` — unified settlement tracking for SasaPay + Fingo collections, initially auto-synced daily.
- Corrected: settlement no longer debits `bank_balance` — was incorrectly treating settlement as if it were the group's own transaction history; now a fully separate ledger.
- Welfare made a separate settlement line, event-based (not date-based) and admin-requested via a new "Request Settlement" flow, since events can run for days and settlement must reflect only the API-sourced portion of what was collected.
- MGR (rotating savings) and Table Banking added to the settlement system: TB auto-batches like regular contributions; MGR creates its settlement batch automatically, server-side, the moment a round reports fully paid — for the API-sourced portion only, targeting the round's receiver directly via their own member phone.
- Settlements promoted to a standalone sidebar page for group admins (previously a buried Finance tab); SA's Billing page redesigned from a long scroll into collapsible cards with live summary badges.
- Fixed RLS gap blocking org admins from requesting welfare settlement (insert policy existed for superadmin only).

## Security
- **Real finding:** `organisations` table RLS had `USING (true)` on SELECT — any authenticated user could read every group's bank balance, disbursement bank/M-Pesa account, and payment provider subaccount codes via the raw API. Restricted to own-org-or-superadmin; added `organisations_public` view (id/name/org_code only) for the legitimate join-by-code lookup, with both call sites updated to use it.
- Added multi-org (`user_orgs`) coverage to `transactions` and `expenses` RLS policies, which previously only checked the legacy single-org `profiles.org_id` field.

## Checkout / instant pay
- Redesigned the beneficiary-row system to support multiple contribution items per person in one payment (previously one type per row, requiring duplicate rows for the same person).
- Added MGR and Table Banking as payable items in checkout. MGR scoped to "pay your own obligations only" (no paying on someone else's behalf, unlike other contribution types).
- Added a Safaricom network fee disclaimer to the checkout fee breakdown (decided weeks prior, never actually built until now).
- Fixed a flash of the manual "Report a Payment" page before instant-pay loads, caused by inconsistent default CSS visibility between the two modes.
- Manual payment details (paybill/till/phone) removed from the Profile page and from the "Pay Instantly" tab — now only visible inside "Report a Payment", a deliberate business decision to encourage instant pay.

## Bugs found via real user testing (not proactive audits)
- Fixed: app returning to the workspace picker on every tab focus / app resume — Supabase's routine `SIGNED_IN` refire on token refresh was triggering the full "just logged in" flow, missing the same guard `INITIAL_SESSION` already had.
- Fixed: "No phone numbers found for selected recipients" on custom SMS recipients — a dormant, likely-always-broken bug. The recipient dropdown was missing a `<option value="custom">` entirely, so the picker's own correct code silently failed to select it.
- Fixed: cache-bust version not bumped on a diagnostic delivery, causing "my fix isn't showing up" — root-caused and corrected mid-session.

## Table Banking
- Fixed unstyled CSS classes (`.tb-hero`/`.tb-stats` had no rules defined anywhere) — now reuses the proven `.mgr-hero`/`.mgr-stats` pattern.
- Redesigned Pool Overview from a dropdown-select into a proper pool list → pool detail navigation.
- Removed duplicate "+ New Pool"/"+ Issue Loan" buttons that were appearing in both the global topbar and the in-page hero.
- Added missing `pageTitles` entry (was showing the raw internal id `"table_banking"` as the page title).
- **Unresolved:** a vertical spacing gap between the app's top bar and the page's own hero banner remains, cause not identified despite extensive diagnosis — see HANDOVER.md Open Items.

## Other
- Phone number now enforced practically: Google OAuth sign-in (the actual gap — regular signup already requires one) triggers an auto-prompt via the existing account panel.
- Push notifications extended to bulk SMS announcements and meeting reminders (previously only payment confirmations and SA broadcasts).
- Welfare events now capture a settlement payout destination at creation (defaults to group's platform, overridable to a direct recipient with name/phone/bank).
