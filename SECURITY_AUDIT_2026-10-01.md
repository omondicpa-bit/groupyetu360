# SECURITY_AUDIT_2026-10-01.md

Third audit. Scope: money in (Safaricom STK collection) and money out (B2C/B2B payouts, autopilot), plus anything that can change where or how much money moves. Read directly from the code on `main` at commit `5b798f7` plus the M-Pesa account label change.

## Why this audit matters more than the last two

Until 1 Oct 2026 nothing in GroupYetu360 could send money out on its own. Now autopilot can. Every Daraja payout comes out of EPH's single paybill float, which holds every group's money together. So any way to make a settlement row bigger than the money actually received, or to create a second settlement for the same payment, or to change where a payout goes, is now a direct loss of real money, paid out in seconds with no person looking.

The collection side is mostly well built: atomic claims, server-side amount validation, an abuse guard, and org-membership checks are all in place and correct. The gaps are almost all in one place: **the payout trusts database rows that clients can still write to.**

---

## 🔴 CRITICAL

### C1. A pending Daraja payment can be inflated after it is created

`daraja-charge` validates the amount and allocations correctly, then stores them on the `payment_requests` row. But nothing stops that row being edited afterwards. The client already updates `payment_requests` directly (`utils.js` approvePayment, `finance.js` approvals), so org admins and treasurers have UPDATE rights on it through RLS.

Attack, by a group admin or treasurer:
1. Start a real Ksh 100 contribution through Safaricom Direct.
2. Before paying, edit the row: `amount = 100000` and `allocations` to match.
3. Pay Ksh 100. The callback sees a mismatch and correctly refuses.
4. Call `daraja-verify`. The STK Query only confirms "success", it returns no amount, so verify credits the row as edited.
5. `creditDarajaContribution` creates a Ksh 100,000 settlement from the edited allocations, and autopilot pays it straight out to the group's destination.

Even simpler: editing only `allocations` (not `amount`) passes the callback's own amount check, since that check compares against `amount`, never against the allocations that actually drive the payout.

**Cost to attacker:** Ksh 100. **Loss to EPH:** whatever the float holds.

### C2. A finished Daraja payment can be replayed

Two routes to a second payout from one real payment:
- **Reset:** set an `approved` Daraja row back to `pending` and call `daraja-verify`. Safaricom still reports that checkout as successful, so it is claimed, credited and paid out again.
- **Copy:** insert a new `payment_requests` row with `provider = 'daraja'` and `paystack_ref` set to the CheckoutRequestID of an earlier successful payment (the client is given this ID by `daraja-charge`). Members insert `payment_requests` rows already ("Report a Payment"), so this may be open to ordinary members, not just admins. RLS policy text is needed to confirm.

Nothing in the schema ties one Safaricom checkout to one payment row, or one payment row to one settlement.

### C3. A group can change its payout destination at any time, and autopilot follows immediately

`saveDisbursementDetails()` (`settings.js`) writes `disbursement_method` and `disbursement_mpesa_number` straight to `organisations` from the group's own session. `processSettlement` reads the destination live at payout time. SA verifies the destination once, but nothing records that a later change was never verified.

A compromised or dishonest group admin changes the number, and the next contribution goes to them. This is the classic chama fraud pattern, now automated.

The same unrestricted UPDATE on `organisations` very likely also lets a group admin set its own `plan`, `subscription_status`, `subscription_expires` and `sms_bundle` (the SA approve flow writes these from the client), which is a revenue leak rather than a theft, but the same fix closes it.

### C4. Safaricom callbacks are trusted if the URL secret is missing

`callbackSecretMatches()` returns `true` when `DARAJA_CALLBACK_SECRET` is not set. Callbacks are unsigned. Since the payer is handed their own CheckoutRequestID, anyone who knows the callback URL could post a "success" for a payment they never made, with the correct amount, and get credited and paid out. Applies to `daraja-payout-callback` as well (a forged "failed" result invites a manual retry, so a double payout).

**Check now:** `supabase secrets list` must show `DARAJA_CALLBACK_SECRET`. Even when it is set, a URL secret is the only defence, and it travels in every request.

---

## 🟠 HIGH

### H1. A payout timeout is treated as a failure, which invites a double payment

`QueueTimeOutURL` points at the same handler as `ResultURL`. A timeout arrives with a non-zero code and is marked `failed`. A network error after Safaricom has already accepted a B2C request is also marked `failed` (`releaseSettlement` in the catch). In both cases the money may well have moved. SA then sees "failed", clicks Retry, and pays twice.

### H2. No last line of defence at the point money leaves

`processSettlement` checks the destination is well formed, but never checks the money:
- that the payment it came from is `approved` and from Daraja,
- that total settlements for that payment do not exceed what was actually collected,
- that the amount is within a sane ceiling.

If any earlier layer is ever bypassed (C1, C2, or a future bug), nothing stops the payout. This one check would have neutralised C1 and C2 on its own.

---

## 🟡 MEDIUM

### M1. Allocation IDs are not checked to belong to the paying group

`memberId`, `eventId`, `poolId` and `slotId` in allocations come from the client and are used with the service role. A member of group A can credit balances or MGR slots in group B. They pay real money to do it, so it is not theft, but it corrupts another group's records and can complete another group's MGR round.

### M2. Superadmin is now a money-moving account

`daraja-payout` correctly allows superadmin only. But one stolen SA password can now push out payouts and edit destinations. 2FA for SA should be mandatory, not optional.

### M3. RLS on the financial tables has never been confirmed

Asked for in both earlier audits, still not done. C1 to C3 are rated on what the client code shows it can do. The policy text decides whether ordinary members, not just admins, are exposed.

---

## ⚪ LOW / housekeeping

- `fingo-charge`, `fingo-verify`, `fingo-webhook` are still in the repo (HANDOVER says removed) and may still be deployed. `fingo-webhook` runs with `--no-verify-jwt`. Undeploy and delete.
- `daraja-stk` is unused. Undeploy and delete.
- `keystore-base64.txt` is public (see HANDOVER).
- SasaPay webhook signature still not sent by SasaPay (known, external). Becomes moot once SasaPay is retired.

## ✅ What is already good

- Atomic claims on both `payment_requests` and `payment_settlements`, and on both payout callback outcomes. No double-credit or double-settle race found.
- `daraja-charge` recomputes the gross amount from server-side fee tables and rejects any mismatch.
- `daraja-payout` is superadmin-only, checked server-side.
- `daraja-charge` and `daraja-verify` both confirm the caller belongs to the org.
- Constant-time secret comparison. Abuse guard on STK prompts.
- The new M-Pesa account label is display only; matching never relies on it.

---

## Proposed fix (one build)

1. **Database guards (migration)**
   - Trigger on `payment_requests`: client roles (`authenticated`, `anon`) cannot insert, update or delete any row where `provider = 'daraja'`. Only Edge Functions (service role) and the SQL editor can. Closes C1 and C2.
   - Unique index on `payment_requests (paystack_ref) where provider = 'daraja'`. One Safaricom checkout, one row.
   - Unique index on `payment_settlements (payment_request_id, fund_type)`. One payment, one settlement per fund.
   - Trigger on `payment_settlements`: clients may only move `pending` to `cancelled`, and only as superadmin.
   - New `organisations.disbursement_verified` flag. A trigger forces it to `false` whenever a non-superadmin changes any destination column, and blocks non-superadmins from changing plan, subscription and SMS bundle columns. Existing configured groups start as verified so nothing breaks today.
2. **Outflow guard in `processSettlement`** (H2): refuse unless the source payment is an approved Daraja payment, total settlements for it do not exceed its amount, the destination is verified, and the amount is under a configurable ceiling.
3. **Callbacks** (C4): fail closed if `DARAJA_CALLBACK_SECRET` is missing, and confirm every STK success with Safaricom's own STK Query before crediting.
4. **Payout uncertainty** (H1): timeouts and post-send network errors become `unknown`, not `failed`. Retry of an `unknown` payout is blocked until a Transaction Status query confirms it did not go through.
5. **Allocation scoping** (M1): `daraja-charge` rejects any member, event, pool or slot ID that is not in the paying org.
6. **Cleanup:** remove Fingo and `daraja-stk`.

## Until the fix ships

**Turn autopilot off.** Manual "Process Payout" puts a person in front of every amount and destination, which blocks the automated part of C1 to C3. This is a small cost while the guards are built.

## Read-only query to run (third request)

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('payment_requests', 'payment_settlements', 'organisations',
                    'settlement_batches', 'transactions', 'members')
order by tablename, cmd;
```

---

## Status after the fix build (1 Oct 2026, same day)

RLS policy text was supplied. It confirmed the findings and widened two of them: `payment_requests` has an `ALL` policy for **every member** of the group (not only admins), so C1 and C2 were open to ordinary members.

| Finding | Status | How |
|---|---|---|
| C1 inflate a pending payment | ✅ Fixed | Trigger: clients cannot insert, update or delete Daraja `payment_requests` rows. Outflow guard re-checks against the payment's own allocations. |
| C2 replay a finished payment | ✅ Fixed | Same trigger, plus unique index on the Daraja checkout id and on `(payment_request_id, fund_type)` for settlements. |
| C3 change the payout destination | ✅ Fixed | `organisations.disbursement_verified`. A trigger resets it on any non-SA change and stops non-SA setting it. Payouts refuse unverified destinations. SA's "Verify & Save" sets it. |
| C4 forged callbacks | ✅ Fixed | Callbacks fail closed without `DARAJA_CALLBACK_SECRET`. STK success is cross-checked with Safaricom's STK Query; a definite "failed" from Safaricom blocks crediting. |
| H1 timeout treated as failure | ✅ Fixed | Separate timeout URL. Timeouts and post-send network errors set `outcome_uncertain`. Retry then needs SA to confirm the money did not go out. |
| H2 no outflow check | ✅ Fixed | `checkPayoutAllowed()`: source must be an approved Daraja payment of the same group, amount within what that payment allocated to the fund, total settlements within what was collected, destination verified, amount under the ceiling (`DARAJA_PAYOUT_MAX_KES`, default 150,000). |
| M1 cross-group allocation IDs | ✅ Fixed | `daraja-charge` rejects members, events, pools, slots or types from another group. |
| M2 SA 2FA | Open | Make 2FA mandatory for superadmin. |
| Fingo and `daraja-stk` | ✅ Removed | Deleted from the repo; undeploy commands in the delivery. |

Also fixed along the way: `creditDarajaContribution` created settlements even when crediting had failed. It now stops.

Verified locally: the migration was run against a real Postgres (PGlite) with the actual JWT-role mechanism, 23 checks. The Edge Function logic was run under Deno against an in-memory database, 24 checks, including every attack path above.

## New findings from the RLS text (not fixed in this build)

These do not move EPH's money, so they were kept out of the payout build, but they matter for a chama product because they let one member falsify the group's own records.

- 🟠 **`transactions_org` is `ALL` for every member of the group.** Any member can insert, edit or delete contribution records directly through the API, bypassing the treasurer. Should be: members read, admin/treasurer write.
- 🟠 **`members_org` is `ALL` for every member.** Any member can edit any member's row, including `shares_balance` and `savings_balance`.
- 🟡 **`org_payment_requests` is `ALL` for every member.** Non-Daraja rows (manual "Report a Payment") can be edited or deleted by any member.
- 🟡 **Group admins can change their own plan, subscription and SMS bundle.** Trial activation and expiry are written from the browser, so locking these columns first needs those two steps moved server-side.
- ⚪ Several policies still key off the legacy `profiles.org_id` rather than `user_orgs`, so members of more than one group get inconsistent access.

Recommended next: a role-aware RLS rework for `transactions`, `members` and `payment_requests`, using `user_orgs.role`, tested against every client write path first.
