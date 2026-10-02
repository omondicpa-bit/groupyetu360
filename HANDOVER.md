# GroupYetu360 — Handover
**Last updated:** 1 October 2026 (UI redesign phase 1: design system v1 foundation)
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

### 🟢 B2C payouts live, autopilot proven (1 Oct 2026)
A real B2C payout went through via the API, then autopilot fired a second one by itself on a fresh Daraja contribution, end to end with no manual step. The blocker was never code. It was the operator account structure on Safaricom's side, resolved as described below.

**Operator structure on org.ke.m-pesa.com (shortcode 1273386), confirmed from the portal itself:**
- `felixomondi` is the **Business Administrator** (Access Channel = Web), not the Business Manager. Earlier versions of this file said otherwise. That was wrong. The Administrator creates operators and assigns roles, but **cannot** set a password on an API operator (the "Set Password" button on the operator's page is greyed out when logged in as felixomondi).
- `omondifelix` is the **Business Manager** (Access Channel = Web), created 1 Oct 2026 by felixomondi specifically to unlock this. Logged in as omondifelix, Set Password on the API operator is enabled.
- `felixjakano` is the **API initiator** (Access Channel = API, Operator ID `203206691000405102`). Now **Active**. This is the account `DARAJA_INITIATOR_NAME` points to.

**Where things actually are in the portal**, so nobody has to rediscover them:
- Administration → Organization Operator lists every operator. The Operation column is a plain **"Detail"** text link, not an icon, and it does not appear on the row of whoever is logged in.
- Detail opens the operator's page. **Set Password** is a button at the top right of that page, next to Create Task. It is only enabled for a Business Manager login.
- The activation email/SMS is the right path for a Web operator, never for an API operator.
- When creating a Web operator, IPRS = YES verifies the National ID and names against Kenya's population register. It worked first time.

**How the working credential was produced:** felixjakano's password (set by omondifelix) → Daraja portal, Generate Security Credential, Production → `DARAJA_INITIATOR_SECURITY_CREDENTIAL`. If felixjakano's password is ever reset, the credential must be regenerated and the secret updated, or every payout will fail with a wrong-PIN-style error.

**How autopilot actually behaves** (`_shared/creditDarajaContribution.ts`):
- Only acts on contributions credited after it is switched on. Existing pending settlements are not swept; they still need "Process Payout".
- Fires at the moment of crediting, not on a daily batch.
- A contribution split between regular funds and a welfare event becomes two settlement rows, so two payouts.
- A failed attempt is logged under `[creditDarajaContribution]` and left on the Payouts page for manual retry. The member's contribution is credited either way.

**Still open on this feature:**
- 🟡 **B2B not yet tested.** Code path is the same `processSettlement()`, but no real paybill destination has been tried. Test once a group with an active paybill as its Settlement Destination exists.
- 🟡 **Trim felixjakano's roles.** It still holds extras (Org Reversals Initiator, Bundle Purchase ORG Initiator, B2C Reversal/Reversal Initiator/Reversal Approver, BusinessPayToBulk ORG API Initiator). Keep only ORG B2C API initiator, Business Paybill Org API initiator, and Balance Query / Transaction Status Query ORG API if offered. Do the trim after B2B is confirmed, so a missing role can't be confused with a B2B failure.
- ⚪ felixjakano's Rule Profile shows "Web Operator Rule Profile" despite being an API operator. B2C works with it as is, so leave it alone unless B2B fails for an unexplained reason.
- ⚪ If a payout ever fails without a clear reason, build the TransactionStatus API check (already approved on the account) to get Safaricom's own failure reason rather than inferring from SMS.

**Separately, unrelated, already resolved:** hub.m-pesaforbusiness.co.ke had an intermittent expired-certificate error for a few days (1 Oct 2026). It was Safaricom's own infrastructure, not Felix's network or device. Resolved on its own. Nothing to action.

### 🟡 UI redesign in progress - Design system v1 "Ledger" (from 1 Oct 2026)
Felix chose Direction A ("Ledger") from the Design canvas "GroupYetu360 UI Redesign" (claude.ai artifact BZRUZHnoECQtZhqxHC4bTH). It holds the reference screens: admin overview, members list, member home on a phone, and the member M-Pesa pay flow. Direction B is on the canvas too but was not chosen.

**Phase 1 shipped (foundation, no logic changes):**
- Font is Manrope everywhere through `var(--font)`. Inter and Crimson Pro are gone; never hard-code a font-family again.
- `:root` tokens re-valued in place (neutral surfaces, maroon brand, teal = money in, amber = needs action, red = problem) plus `--radius-*` and `--shadow-*`. Old token names kept so existing inline styles follow along.
- A "DESIGN SYSTEM V1" layer at the end of `style.css` restyles the shell and shared components: sidebar (now light), nav, cards, stat cards, buttons, inputs, tables, badges, alerts, tabs, modals, toast. Page heroes are a single interim maroon band until each page is redesigned.
- Navigation regrouped in `buildNav()`: Home / Money / People / Group / Me, flat, no collapsible drawers. Superadmin: Platform / Money / System. Links keep the `showPage('<id>')` onclick shape because `showPage()` matches on it.
- `js/icons.js` (loaded before `auth.js`): `gyIcon(name, size)` returns a line icon. Use it instead of emoji or Unicode symbols in all new and touched UI.

**Rules for every UI change from now on:** no emoji as icons; no new inline colours (use tokens); no new font-family declarations; sentence case labels, not UPPERCASE; status shown as `.badge-*` pills; figures in tabular numerals.

**Phase 2a shipped:** admin Overview (desktop page header replaces the maroon hero, stat-card icons, quick actions, attention cards; mobile admin home emoji replaced) and the superadmin Platform overview (its inline `<style>` block in `index.html` re-tokenised: no coloured KPI stripes, sentence-case labels, pill badges). New shared classes: `.ds-page-head`, `.ds-page-title`, `.ds-eyebrow`, `.ds-page-actions`, `.ds-stat-icon`, `.ds-attn-amber/red`, `.ds-qa`, `.ds-btn-auto` (`.btn-primary` is full-width by default; add this for inline buttons). Pages with their own inline `<style>` block override style.css, so re-tokenise them in place.

**Phase 2b shipped:** member home on mobile (white summary cards, line icons, a large "Make a payment" button, sentence case; dark theme untouched) and the member payment modal (sentence case, maroon primary "Send M-Pesa prompt", clearer waiting/received/not-completed states, full-height sheet on phones). `portal.js` emoji replaced with `gyIcon()`; icons added: check, link, alert, inbox.

**Phase 2c shipped:** Members page. Table view by default on desktop (cards on phones), filter tabs with counts (All, Active, Behind = status `arrears`, Inactive), search with icon, list/card switch, an amber "N members are behind" bar that opens Messages with "In arrears" preselected (`remindArrearsMembers()`), empty states. New shared classes for list pages: `.ds-toolbar`, `.ds-segmented`, `.ds-search`, `.ds-callout-amber`, `.ds-table`, `.ds-person`, `.ds-avatar`, `.ds-num`, `.ds-empty`, `.ds-icon-btn`, `.ds-sr`. Bulk M-Pesa prompts to everyone behind (as drawn on the canvas) are NOT built; that needs a server-side batch STK function with rate limiting.

**Phase 2d shipped:** Contributions & money (Finance) page. Light page header replaces the gradient hero; white score and stat cards with line icons; view tabs (Ledger, Expenses, Fines) on the left and record actions on the right; ledger amounts right-aligned, type badges neutral, delete is a quiet trash icon; mobile Money screen in light mode uses white cards. Also app-wide: emoji stripped from the start of all toast messages (90 calls).

**Phase 2e shipped:** Welfare, Merry-go-round and Table banking pages (light page headers; neutral stat and event cards; dark segmented tabs; line icons for event types, collection methods and empty states; sentence case; quiet trash-icon deletes). App-wide: every modal close button (24) is now an icon button with `aria-label="Close"`. WhatsApp share text deliberately keeps its emoji. Remaining interim maroon banners: none.

**Phase 2f shipped (1 Oct 2026):** Projects, Meetings, Messages on the design system. **Felix's colour decision: primary action buttons are TEAL** (`--action`, `--action-dk`, `--action-ring` tokens). Maroon stays the brand colour (logo, active menu item, emphasis), not the button colour. Inline `background:var(--maroon|--teal)` was stripped from 45 primary buttons so the class decides; never add inline colours to `.btn-primary` again. Sidebar collapse button now sits inside the sidebar's top-right corner so it never covers page titles.

**Phase 2g shipped:** Settings, Plan & billing (plan card is now a white card; status badge colours set in `updateBillingHero`), Payouts to your account, Approvals, My account, and the superadmin Billing, Payouts, Activity log, Platform settings, Users, Revenue pages. `.section-header` is restyled globally to match `.ds-page-head`, so any page using it gets the new header. Founder marks are now a small "Founder" pill (`.ds-founder`), not the 🏛 emoji. Payout status pills use tokens.

**Phase 3a shipped (pop-up windows and sweep):** all 25 modals tidied (sentence-case titles, no emoji labels, no arrows on buttons, readable label sizes); every `✕` button is an icon with an aria-label; Taya panel tiles use line icons; 37 legacy UPPERCASE rules in older style.css sections and 50 inline UPPERCASE labels converted to sentence case (kept: menu section labels, calendar month). Leading emoji stripped from labels across all JS (73). Fixed white-on-light headers left behind on My meetings, Notices and Approvals.

**Dark mode (phase 3b, 1 Oct 2026):** rebuilt as one token block at the end of style.css (`body.mob-dark{...}` re-values every token). The 94 old hand-written dark rules and all `body:not(.mob-dark)` scoping were removed. Toggle: sun/moon on phone home, and a new "Dark mode" button in the sidebar footer (desktop too). The saved choice is applied on load on every screen (`initMobTheme` runs at startup). It does NOT follow the device setting automatically yet; switch that on after Felix has reviewed dark mode screen by screen. Rule from now on: no hard-coded colours in markup or JS (`#fff`, `#f5f5f5`, etc.), use tokens (`--surface`, `--surface-1/2/3`, `--border-soft`, `--ink*`, `--*-pale`) or dark mode breaks.

**Record a payment window (phase 3d):** redesigned as three numbered steps (Who paid? / What is it for? / Payment details), a member context card after choosing a member (`renderPayMemberCard()`: name, phone, balances, status), item rows with a "Ksh" amount field and a trash icon, and a footer with a large total and a save button that reads "Save Ksh X". Becomes a bottom sheet on phones. Saving logic (`saveModalTransaction`) unchanged.

**Sign-in screen (phase 3c):** redesigned. Left: solid deep-maroon brand panel with a headline, a short pitch, a live-looking product preview card (static HTML, sample figures) and three plain-language points; old animated rings/Venn removed. Right: plain card form, segmented Sign in / Create account tabs (now matched by `data-tab`, which also fixed "Create account" never highlighting), Google button, icon inputs, a Show/Hide password button (`togglePasswordVisibility()`), teal submit. Under 900px the brand panel is replaced by a small logo row above the form.

**Plan & billing pricing cards (phase 3b):** redesigned as four separate cards with tagline, large price, monthly equivalent, member cap pill, check-icon feature lists (excluded features muted), a "Most popular" badge on Standard (teal border), a "Current plan" badge, and full-width actions ("Start 60-day free trial", "Upgrade to X", "Renew X", "Included in your plan"). Classes `.plan-*`; logic in `renderBillingPlanCards()`.

**Next phases, one screen per delivery:** contributions, welfare, merry-go-round, table banking, settings, SA payouts. Each one replaces its page hero and inline styles with the components above, matching the canvas.

### 🟢 Collection and payout hardened (1 Oct 2026) - read before touching Daraja code
Full detail in `SECURITY_AUDIT_2026-10-01.md`. What a future session must know:
- **Daraja `payment_requests` rows cannot be written from the browser at all** (trigger `gy360_guard_daraja_payment_requests`). Only Edge Functions (service role) and the SQL editor can. If an SA "approve" button ever errors on a Daraja row, that is the trigger working; fix it in SQL, never by loosening the trigger.
- **Payouts only go to a verified destination.** `organisations.disbursement_verified` is reset by trigger whenever anyone but SA changes a destination column. SA verifies by clicking "Verify & Save Destination" on the group's Settlement Destination card. A blocked payout shows "Blocked: ... not verified" on the Payouts page.
- **`checkPayoutAllowed()` in `_shared/darajaPayoutProcessing.ts` is the last line of defence.** Do not bypass or weaken it for convenience. Ceiling is the `DARAJA_PAYOUT_MAX_KES` secret, default 150,000.
- **"Outcome unknown" payouts** (`outcome_uncertain = true`) come from Safaricom timeouts or network errors after sending. Retry asks SA to confirm in the M-Pesa portal that the money did not go out. The proper fix is the TransactionStatus API check, still not built.
- **`DARAJA_CALLBACK_SECRET` is now mandatory.** Without it every callback is ignored (payments still complete through `daraja-verify`, payouts would sit in Processing).
- **Unique indexes:** one Daraja checkout = one payment row; one payment = one settlement per fund.

### 🟠 RLS lets any member write group records - next security priority
Found from the policy text on 1 Oct 2026. `transactions`, `members` and `payment_requests` each have an `ALL` policy for every member of the group, so any member can create, edit or delete contribution records and balances through the API. EPH's money is safe (the payout guards above don't rely on these tables), but a group's own books are not. Needs a role-aware rework using `user_orgs.role`, tested against every client write path. Also: group admins can change their own plan/SMS bundle, because trial activation and expiry run in the browser.

### 🔴 Android signing keystore is public
`keystore-base64.txt` (PKCS12, the Play Store signing keystore) has been committed to this public repo since commit `425e917` ("Move Android build to GitHub Actions"). It is password-protected, but it should not be public. Move it into a GitHub Actions secret, decode it in the workflow, and remove the file from the repo. Removing it from the latest commit does not remove it from history, so treat it as exposed regardless. Check whether Play App Signing is enabled (if so, this is only the upload key and Google can reset it).

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
The service itself shut down; no org was using it as their active provider. Removed from both org-level Active Provider selectors, the Collection Activation approval flow, the Payment Service Providers card, and `portal.js`'s charge/verify/fee-calculation routing. The three Edge Functions (`fingo-charge`, `fingo-verify`, `fingo-webhook`) were actually still in the repo until 1 Oct 2026, when they were removed together with the unused `daraja-stk`, and undeployed with `supabase functions delete`.
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
