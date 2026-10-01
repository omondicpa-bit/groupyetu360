# GroupYetu360 — Handover
**Last updated:** 19 July 2026 (SasaPay integration, settlements, MGR/TB, security session)
**Repo path:** `C:\Users\Felix\groupyetu360`

---

## ⚠️ STANDING RULES — read this section every session, no exceptions

These exist specifically so Felix never has to repeat himself. Any new Claude instance picking up this project should treat this section as binding.

### Deployment discipline
1. **Every file delivery includes the full exact PowerShell block** — `copy` commands with the real path (`C:\Users\Felix\groupyetu360\...`, never a placeholder), `git add .`, `git commit -m "..."`, `git push`. Never assume Felix knows the destination path.
2. **`index.html`'s cache-bust query string (`?v=...`) MUST be bumped on every delivery that touches a JS file it loads**, even if `index.html` itself wasn't otherwise edited. This was the direct cause of at least two "my changes aren't showing up" incidents this session. If you edit `portal.js`/`modules.js`/`settings.js`/`auth.js`/`utils.js` and don't also bump and re-deliver `index.html`, the browser will keep serving the old file indefinitely.
3. **Every Edge Function that receives an external webhook (not called by our own client) needs `--no-verify-jwt` on deploy** — `supabase functions deploy <name> --no-verify-jwt`. Confirmed root cause: Supabase's gateway rejects any request without a valid Supabase auth token *before your code even runs*, and external services (SasaPay, Paystack, Fingo) never send one. This silently broke Paystack's and Fingo's webhooks for the entire project history before it was found — they were only ever "working" because the active-verify polling fallback was quietly doing the real job. Functions needing this flag: `paystack-webhook`, `sasapay-webhook`, `daraja-callback` (Fingo's webhook was removed along with the rest of Fingo, 30 Sep 2026). Apply it to any new webhook-receiving function by default.
4. **Before editing any file, check whether it was already modified earlier in the same session** (compare what's in `/mnt/user-data/outputs/` against `/mnt/user-data/uploads/`) rather than assuming the original upload is current. This has caused real regressions when a stale upload silently reverted an earlier fix.

### Financial/architecture principles (do not deviate without asking)
5. **Settlement never touches a group's own records.** `settlement_batches` is EPH's own internal ledger of money collected via SasaPay/Fingo that needs disbursing to a group. A group's `bank_balance`/`transactions` only ever move because the system credited a real contribution or an admin manually recorded something — never because of what happens on the settlement side. This was explicitly corrected mid-session after an earlier design mistakenly had "Mark Paid" debit `bank_balance`.
6. **Settlement only ever reflects money that actually came through our APIs** (`provider IN ('sasapay','fingo')`). Anything paid manually/directly is the group's own business, tracked by its own records, never counted toward what SA owes to disburse.
7. **Three different settlement triggers, by design, not inconsistency:**
   - **Regular contributions & Table Banking** — auto-batched daily via `syncSettlementBatches()`.
   - **Welfare** — never auto-batched. Admin explicitly clicks "Request Settlement" per event (events can run for days).
   - **MGR (rotating savings)** — never auto-batched, never admin-requested either. Created automatically, server-side, the instant a round reports fully paid (mix of API + manual sources allowed) — for the API-sourced portion only, which could be less than the round's full value or zero. Punctuality matters more here than anywhere else (a real person is owed money on a specific date), so it's the one flow with no manual trigger step at all.
8. **Manual payment details (paybill/till/phone) only ever appear inside the "Report a Payment" tab of the payment modal** — never on the Profile page, never in the "Pay Instantly" tab. This is a deliberate business decision to keep the default path toward instant pay, since GroupYetu360's revenue comes from instant-pay fees.
9. **MGR settlement destination is always the receiver's own member phone number** — auto-derived, never a manual entry form, since the receiver is always a known existing member. Welfare settlement, by contrast, can route to a non-member recipient (bereaved family, etc.) with name/phone/bank captured at event creation, defaulting to the group's normal platform.
10. **Phone numbers are load-bearing, not optional.** Regular signup requires and validates one; Google OAuth sign-in does not collect one at all. Any user with no phone on file gets auto-prompted (via the existing "My Account" panel on the workspace picker) the moment they land there, since MGR settlement and SMS confirmations both depend on it.

### Working style Felix has been explicit about
11. **Never guess twice at the same bug.** When a fix doesn't work, get real diagnostic evidence (console logs, DB queries, actual page source) before proposing another fix — this project has a documented history of wasted cycles from confident-but-wrong guesses (Paystack webhook status codes, SasaPay signature field mapping, this session's unresolved TB spacing bug).
12. **Full, complete builds in one pass are preferred over incremental small ones** — Felix would rather get the whole feature (schema + backend + UI + edge cases) in one delivery than piecemeal check-ins, provided the scope was actually confirmed first for genuinely large/ambiguous features.
13. **Confirm architecture before building anything non-trivial or ambiguous** — this project's most successful large builds (SasaPay pooled-wallet model, settlement redesign, MGR/TB integration) all started with Claude restating its understanding back to Felix before writing code, and Felix has responded well to this pattern specifically.
14. **"Modern, flawless fintech UI" is the explicit visual bar** — not just functional, genuinely polished (see: Settlement Details modal redesign, SA Billing's collapsible-card rework).

---

## Architecture overview

**Stack:** Supabase (Postgres/Auth/Edge Functions), GitHub Pages (static hosting for the web app), Android via Bubblewrap/TWA (GitHub Actions CI build → Play Store).

**Payment providers, live:**
- **Paystack** — per-org subaccounts, auto-settles within 24h on their side. Not part of the settlement_batches system (nothing for us to settle).
- **Fingo** — pooled wallet, no per-org routing. Manual disbursement recorder existed before settlement_batches; now largely superseded by it.
- **SasaPay** — pooled wallet, no per-org routing at all (confirmed directly with their team — sub-shops need separate PSP licensing we don't have). This is the newest, most actively developed integration this session.

**Key tables added/extended this session:** `settlement_batches`, `org_payment_providers`, `collection_activation_requests`, `welfare_events` (payout_type/recipient_* columns), `round_contributions`/`table_banking_contributions` (provider column), `organisations_public` (view), `push_subscriptions`, `notification_log`, `broadcast_log`.

---

## What's genuinely open right now

### 🔴 Unresolved bug — needs fresh eyes with a screenshot
**Table Banking page has a large blank vertical gap right after the app's top bar, before any content renders.** Extensively diagnosed this session with no resolution:
- Confirmed NOT caused by: the `.tb-hero`/`.tb-stats` unstyled-class bug (fixed, TB now reuses proven `.mgr-hero`/`.mgr-stats`), duplicate topbar buttons (fixed, removed), missing `pageTitles` entry (fixed, added), `.topbar` itself (verified 56px, white, correct), `.content` padding (verified 0, correct), `.page` class (verified simple show/hide, no extra spacing), `.tabs`/`.tab` (verified properly styled), deployment/cache-bust mismatch (verified — raw page source matches the built HTML exactly, byte for byte), and browser profile issues (tried Incognito, same result).
- MGR's own page, structurally near-identical (same hero pattern, same page/content/topbar treatment), displays with no issue — the difference between the two pages was never found despite direct side-by-side comparison.
- **Next step:** this needs actual visual inspection (screenshot) to resolve — static code analysis has been exhausted without success. Whoever picks this up next should NOT re-check any of the items above; start from "what does DevTools' Elements panel show as the actual rendered box between `.topbar` and `.mgr-hero` on the TB page specifically" with a real screenshot in hand.

### 🔴 SasaPay signature verification — external, not a code fix
Confirmed across multiple real transactions: SasaPay's `X-SasaPay-Signature` header is **never actually sent**, on either of their two callback shapes (the "C2B Callback Results" and the separate "IPN" notification). Their dev console documents HMAC-SHA512 signing; it's simply not arriving. This has been formally reported to their technical team (email drafted, sent by Felix) with a specific transaction reference to look up. **Do not attempt to re-guess the field mapping again** — the header itself is absent, confirmed via full (untruncated) log inspection, not a mapping problem. Waiting on their response. The amount-cross-check remains the only enforced defense in the meantime.

### 🟡 sasapay-verify is a "nudge," not a true verify
SasaPay's API has no synchronous "check now, get the answer now" endpoint — their only status-check endpoint always just triggers another webhook delivery rather than answering directly. `sasapay-verify` reflects this honestly: it prompts a redelivery at the 30-second mark if nothing's resolved, while the actual confirmation still comes from a self-poll of our own database (proven reliable in live testing).

### 🟡 IP whitelist for SasaPay — log-only, not enforced
Deliberately not blocking on this yet — no confidence that Supabase's Edge Function runtime reliably exposes SasaPay's true origin IP rather than an internal proxy IP. Revisit once there's real log data showing what IP actually shows up in practice.

### 🔴 B2C payouts not working yet - exact next steps, read this first
Autopilot, the Payouts page, settlement tracking, all of it is built and code-complete (see 1 Oct 2026 changelog entry). The ONLY thing blocking an actual working payout is one external Safaricom credential, not a code bug. Here is exactly where it stands:

**What's confirmed NOT the cause**, so don't re-investigate these:
- Not maker-checker. Approval Configurations for B2C Single Payments and B2B Single Payments are both set to "No Approval" (confirmed in the M-PESA Organization Portal, org.ke.m-pesa.com → Business Center → Approval Configurations).
- Not the account or the B2C product itself. A manual B2C payment sent directly through the Hub portal succeeded, real money moved. This isolates the problem to the API authentication layer specifically, nothing else.
- Not STK Push's credentials. Collection has worked repeatedly and uses a completely separate credential system (DARAJA_CONSUMER_KEY/SECRET + DARAJA_PASSKEY). B2C/B2B use DARAJA_INITIATOR_NAME + DARAJA_INITIATOR_SECURITY_CREDENTIAL, unrelated.

**The actual root cause, found via web search of Safaricom's own documented B2C setup process (Symatech Labs guide and others), not guesswork:** the API initiator is supposed to be a SEPARATE operator account from the Business Manager, created with Access Channel = API, not the Business Manager's own login reused for API calls. `felixomondi` is the Business Manager (Access Channel = Web). Every attempt so far has wrongly used felixomondi as if he were also the API initiator - that's why it keeps failing with a "wrong PIN"-equivalent message, there was never a correct password to find, because felixomondi was the wrong account entirely.

**What's already done, as of 1 Oct 2026:**
- A second operator, username `felixjakano`, Operator ID `203206691000405102`, Access Channel = API, has been created in org.ke.m-pesa.com → Administration → Organization Operator. Status shows "Pending Active."
- felixjakano currently has MORE roles than needed (Org Reversals Initiator, Bundle Purchase ORG Initiator, B2C Reversal/Reversal Initiator/Reversal Approver, BusinessPayToBulk ORG API Initiator, alongside the two that are actually needed: `ORG B2C API initiator` and `Business Paybill Org API initiator` which covers B2B). **Trim this list down once B2C is confirmed working** - an automated payout credential should only ever hold what it needs (ORG B2C API initiator, Business Paybill Org API initiator, Balance Query ORG API, and Transaction Status Query ORG API if available). Nothing resembling Business Manager, Administrator, Set Password, or Withdrawal roles belongs on this account.

**Exact next steps, in order:**
1. Confirm `felixomondi` has the **"Set Restricted ORG API Password"** role (visible in the same Organization Operator table, under felixomondi's Role column). Without this role, felixomondi cannot set felixjakano's password at all - if missing, that's a prerequisite fix first.
2. In the Organization Operator table, find felixjakano's row and look at the **Operation** column specifically - it's an icon/button, not text, so it won't show in a copy-pasted table. Click it, look for **Set Password**.
3. Set a password for felixjakano through that flow (not through the "activation link" email, which asks for a password felixjakano doesn't have yet and is the wrong path).
4. Use THAT password, felixjakano's, not felixomondi's, in the SecurityCredential generator (Test Credentials → Generate Security Credential Value, Production environment).
5. Update both secrets - the name needs to change, not just the credential:
   ```
   supabase secrets set DARAJA_INITIATOR_NAME=felixjakano
   supabase secrets set DARAJA_INITIATOR_SECURITY_CREDENTIAL=<the new value, no quotes>
   ```
6. Reset the stuck test settlement and retry from the Payouts page:
   ```sql
   update public.payment_settlements
   set status = 'pending', method = null, checkout_id = null
   where id = 'dedbcf82-7526-4b18-b009-e50487e6d433' and status = 'processing';
   ```
7. If it STILL fails after this, the credential/account structure theory is wrong and it's worth building the TransactionStatus API check (already approved on the account, URL was in the go-live email) to get Safaricom's own precise failure reason instead of inferring from an SMS again - this was deliberately not built yet since this lead seemed likely to resolve it first.

**Separately, unrelated, already resolved:** hub.m-pesaforbusiness.co.ke had an intermittent expired-certificate error for a few days (1 Oct 2026). Confirmed via direct fetch and Felix testing both WiFi and cellular that this was Safaricom's own infrastructure, not his network or device. Resolved on its own. Not a security concern, nothing to action.

### 🟢 Safaricom Direct (Daraja) - live and proven
Went live 30 September 2026. Felix bought a real SMS bundle (Ksh 75) through it and it credited instantly - callback, atomic claim, and crediting all confirmed working end to end with real Safaricom credentials.
Two CHECK constraints briefly blocked this after the code was already deployed and correctly configured: `platform_settings_subscription_payment_provider_check` and `payment_requests_provider_check` didn't list `'daraja'` as an allowed value. Both were widened, not replaced, so nothing else that was already allowed changed. If a future migration ever touches either constraint, make sure `'daraja'` stays in both lists.
Still platform billing only. Member-contribution collection via Safaricom is explicitly deferred (see the note below) - Felix's call, not a technical blocker beyond `daraja-charge` deliberately rejecting anything that isn't a subscription or SMS bundle payment.

### 🔴 Group-level Safaricom collection - explicitly deferred, not a build queued up
Felix's decision (30 Sep 2026): the per-org "Active Provider" selector offers only Paystack and SasaPay for now, on purpose. EPH's Paybill has no per-org sub-account splitting the way Paystack does, so Safaricom collection for member contributions means solving the same custody problem the original Safaricom research (months earlier) already ran into - who holds the money, how it reaches each group's own account, whether that needs B2B to a bank's own Paybill (which requires requesting the B2B product from Safaricom, not yet requested) or each group having its own Till. Don't build this without that conversation happening first.

### 🟢 Bank balance bug - fixed at the source, historical data corrected
`paystack-webhook` and `sasapay-webhook` (2 call sites in the latter) called `update_bank_balance(... 'credit')` for the PAYING group whenever a subscription or SMS bundle payment was auto-approved - money going to EPH was wrongly also credited to the org's own balance. All three call sites removed. Member contributions were never affected - those go through `processMemberContribution`/`creditMemberContribution`, which never reached this code. `daraja-charge`'s crediting path (`creditPlatformPayment`) was written correctly from the start and never had this bug.
Three orgs were affected historically; Felix ran the correction query (subtracts the exact wrongly-credited total from each org's current balance, not a fixed number, so it's safe regardless of what's happened on those accounts since).

### 🟢 Fingo removed entirely (30 Sep 2026)
The service itself shut down; no org was using it as their active provider. Removed from both org-level Active Provider selectors, the Collection Activation approval flow, the Payment Service Providers card, and `portal.js`'s charge/verify/fee-calculation routing. The three Edge Functions (`fingo-charge`, `fingo-verify`, `fingo-webhook`) are deleted from the repo - still need `supabase functions delete` run for each to actually undeploy them, git removal alone doesn't do that.
Deliberately NOT touched: the Settlements reconciliation code (`js/settings.js`, roughly lines 3116-3562) still recognizes `'fingo'` as a historical provider value in its queries and color legend, since real past settlement_batches rows used it. Removing that would make historical Fingo transactions unqueryable, not clean up anything.

### 🟡 sasapay-webhook drops the SMS part of a combined cart
Still open, not touched in the Fingo/bank-balance round. It credits from `payment_type` only, which holds just the first cart item. A plan plus SMS bundle credits the plan and loses the SMS. Paystack's webhook handles this via `notes`. `creditPlatformPayment` (used by Daraja) shows the fix, if this becomes worth doing for SasaPay too.

### 🟡 Known pre-existing bug, unrelated to this session's work
Mobile's Finance tab buttons (`onclick="finMobSwitchTab(...)"`) call a function that doesn't exist anywhere in the codebase. Found while building Settlements; not touched since it wasn't in scope at the time.

### ⚪ Needs a status check, not necessarily a build
- Play Store production approval — submitted a while back, current status unknown.
- Fingo's settlement flow — the settlement system covers both providers structurally, but recent real-world testing has been SasaPay-specific; Fingo's path through it hasn't been confirmed end-to-end.

### Parked, by Felix's own choice
- MGR/Table Banking collection workarounds beyond what's built — the core instant-pay + settlement integration is done; anything further wasn't specified.
- CBK PSP outreach (Wakandi, PayHero, Pesawise, Kasapay) — likely moot now that SasaPay is live, never formally closed out either way.

---

## This session's major builds (chronological)

1. **SasaPay integration from scratch** — production credentials, charge/webhook/verify functions, dedicated fee configuration (0.2% SasaPay + 1.3% EPH markup, both real Settings fields, not hardcoded), pooled-wallet architecture (no per-org sub-account, confirmed with their team).
2. **Multiple real SasaPay bugs found and fixed via evidence, not guessing:** Supabase gateway JWT rejection (the `--no-verify-jwt` discovery, which also revealed Paystack/Fingo's webhooks had silently never worked), a false-decline caused by misreading their dual-callback-shape design (the IPN notification carries no `ResultCode` and was being misread as failure), a `.catch()` chain that isn't valid on this Supabase client version in this Deno runtime.
3. **Unified settlement system** — built, then significantly corrected: bank_balance decoupling, per-provider/per-line-type structure, welfare's event-based (not date-based) grouping with admin-requested settlement, MGR's round-completion-triggered auto-settlement.
4. **MGR & Table Banking brought into instant-pay checkout** — new selectable items in the multi-item beneficiary system, server-side crediting into their own real tables (`round_contributions`/`table_banking_contributions`), MGR's completion-check ported server-side to trigger auto-settlement.
5. **Real security finding:** `organisations` table had `USING (true)` on its SELECT policy — any authenticated user could read every group's bank balance, disbursement account, and provider subaccount codes via the raw API. Fixed with a proper own-org-or-superadmin policy plus a narrow `organisations_public` view for the legitimate join-by-code lookup flow.
6. **Two real, separate bugs behind one bug report** — "auto-checkout page only allows one contribution item" was fixed by redesigning the beneficiary-row data model to support multiple items per person; "app always returns to picker on tab focus" was a missing guard against Supabase's routine `SIGNED_IN` refire on token refresh.
7. **A genuinely pre-existing, dormant bug found via user testing** — the SMS "Custom recipients" option had never worked since the feature was built: the picker's own code always tried to set the recipient dropdown to `"custom"`, but that option never existed in the `<select>` at all. One missing `<option>` tag, silently broken from day one.
8. **Table Banking UI overhaul** — fixed a real unstyled-CSS-class bug (`.tb-hero`/`.tb-stats` had zero CSS backing anywhere), redesigned Pool Overview from a dropdown-select into a proper list → detail navigation pattern, removed genuine duplicate buttons between the global topbar and the in-page hero. One remaining spacing issue not resolved — see Open Items above.
9. **Phone number now enforced as a real requirement** — Google OAuth sign-in was the actual gap (regular signup already validates one); auto-prompts via existing account panel infrastructure rather than new UI.
10. **Push notifications extended to bulk SMS and meeting reminders** — additive to SMS, never a replacement, matching the pattern already used for payment confirmations.

---

## Contact / escalation notes
- SasaPay signature issue: awaiting their technical team's response to the email sent (transaction ref `SPEJ7TFHC2N3L2P`, merchant 16213).
