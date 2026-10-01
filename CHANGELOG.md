# Changelog - 1 October 2026 session

## Automated settlement (B2C/B2B payouts) - fully built, blocked on one external credential issue
- Member contributions can now be collected through Daraja (`daraja-charge` extended to accept `member_contribution`, validated against the real tariff-based settlement fee in `darajaContributionValidation.ts`, client-side preview in `utils.js` matches byte-for-byte, 58 cases tested).
- `payment_settlements` table added: per-contribution, in-flight payout tracking, separate from the org-level `settlement_batches` ledger on purpose, see that table's own comment for why. A successful automated payout writes into `settlement_batches` too, so the existing Settlements page stays accurate without needing to know autopilot exists.
- New SA Payouts page (`sa_payouts`): autopilot toggle, pending/failed queue, process/cancel per row, full detail modal. Autopilot toggle correctly uses `upsert({id:1,...})` against `platform_settings`, matching the established pattern, not a plain update.
- Real bug found and fixed: `daraja-verify`'s STK query treated ANY non-zero result code as a definite decline. Safaricom's query endpoint can return ambiguous transient codes right after PIN entry, before the backend settles - this wrongly declined a real, successful Ksh 100 payment. Fixed to only treat a short allowlist of well-known codes (1, 1032, 1037, 2001) as genuine failure, anything else now correctly stays pending. 5 tests added proving the exact bug and the fix.
- Real bug found and fixed: the SA Billing "Pending Payment Requests" queue had no filter on `payment_type` at all, so a Daraja member contribution could appear there and get clicked "Approve" by a button that only knows how to activate subscriptions/SMS bundles. It silently did neither, just flipped status to approved with nothing actually credited. Filter added, and `approvePayment()` now refuses `member_contribution` rows outright as a second layer of defence.
- One real stuck transaction (Felix's own Ksh 100 test, `payment_requests.id = dba2b80f-...`) manually corrected via a one-off, audited SQL script after being caught by the above bug, properly credited, settlement row created retroactively.
- **B2C payouts still do not work end to end** - every attempt so far fails with a message equivalent to "wrong PIN," despite STK Push (collection) working perfectly on a completely separate credential system. Root cause now understood, not yet resolved - see HANDOVER, this is the single most important thing the next session needs to pick up.

---

# Changelog - 30 September 2026 session

## Safaricom Direct - live and proven
- Two CHECK constraints (`platform_settings_subscription_payment_provider_check`, `payment_requests_provider_check`) were quietly blocking `'daraja'` after everything else was correctly deployed and configured. Both widened via `ALTER TABLE`, nothing else that was already allowed removed.
- Real production test: Ksh 75 SMS bundle, real STK prompt, real payment, credited instantly. End-to-end chain confirmed: callback, atomic claim, crediting, activity log, no bank_balance side effect.
- Platform Settings restructured per Felix's direction: a dedicated "Instant Payment" card (master toggle + provider dropdown, together, replacing the previous split where the toggle lived in the Paystack card and the dropdown lived in the SasaPay card, silently misleading anyone trying to enable a different provider) and a grouped "Payment Service Providers" card with each provider as an independently-collapsible nested panel, rather than four separate top-level cards.
- Group-level (member contribution) collection via Safaricom remains explicitly deferred - Felix's call, tracked in HANDOVER.

## Bank balance bug - fixed at the source, historical data corrected
- `paystack-webhook` and `sasapay-webhook` (2 call sites) were crediting the PAYING org's own bank_balance whenever a subscription or SMS bundle payment was auto-approved - money going to EPH was wrongly also added to the org's own balance. All three call sites removed. Member contributions were never affected.
- Three orgs corrected via a query that subtracts the exact wrongly-credited total from each org's current balance (not a fixed snapshot number), confirmed safe regardless of other activity on those accounts since.

## Fingo removed entirely
- The service shut down; no live org was using it. Removed from both org-level Active Provider selectors, the Collection Activation approval flow, the Payment Service Providers card, and `portal.js`'s member-payment charge/verify/fee routing.
- The three Fingo Edge Functions deleted from the repo (still need `supabase functions delete` run per function to actually undeploy).
- Deliberately left in place: the Settlements reconciliation code still recognizes `'fingo'` as a historical provider value, so past settlement records stay queryable.

## Also fixed along the way
- `sw.js` threw an uncaught error trying to cache `chrome-extension://` requests (the Cache API only accepts http/https) - added a scheme guard, wrapped in `.catch()`.
- Reverted a bad push that had rolled back the cache-bust version on all nine script tags to a much older value and silently removed the Daraja dropdown option - likely an old `index.html` from Downloads overwriting the current one. Rebuilt from a fresh clone, version bumped to a value that's never existed on the site before, to rule out any ambiguity this time.

---

# Changelog - 28 September 2026 session

## Payments - Safaricom Direct (EPH Paybill 1273386), built dormant
- Added `daraja-charge`, `daraja-callback` (rewritten) and `daraja-verify` Edge Functions, plus shared modules `darajaClient`, `billingPrices`, `creditPlatformPayment`, `darajaProcessing`, `authorizeOrgAccess`. Subscription and SMS bundle billing only. Member contributions are unchanged and stay on the group providers.
- New third option in Super Admin Platform Settings: "Safaricom Direct (EPH Paybill)". Default stays Paystack, so nothing changes until it is selected.
- The billing amount is verified on the server against the price list (plans, and Ksh 1.50 per SMS). Paystack and SasaPay still trust the amount the browser sends.
- Combined carts (plan + SMS bundle) credit both parts. Credited in a single organisation update.
- Safety layers on the callback: optional secret in the callback URL, amount cross-check, atomic claim (`claimPaymentRequest`), late-success recovery after a wrongly declined request.
- Safety net for a missing callback: the billing poll loop calls `daraja-verify` (asks Safaricom directly via STK Query) from about 15 seconds in, for this provider only.
- Deliberately does NOT credit the paying group's bank balance (see HANDOVER open items).
- Old `daraja-stk` left in place, unused and superseded. Retire it once Safaricom Direct is proven live.
- Tested against a fake database and fake Safaricom (44 checks, including duplicate and simultaneous callbacks, amount tampering, and retry after a crediting failure). Strict type-check clean. Not yet run against real Safaricom.

---

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
