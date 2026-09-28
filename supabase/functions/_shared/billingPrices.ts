// supabase/functions/_shared/billingPrices.ts
//
// Server-side copy of the platform billing price list, used by daraja-charge
// to check that the amount a client asks us to charge really matches the
// plan and SMS bundle it says it is buying.
//
// Why this exists: paystack-charge and sasapay-charge both trust the amount
// the browser sends for subscription and SMS billing. A modified client could
// therefore buy a large SMS bundle for a few shillings, and every SMS costs
// EPH real money at Celcom. The Daraja path checks the amount on the server.
//
// KEEP IN SYNC with the client:
//   - PLAN_PRICES in js/settings.js
//   - the SMS pills in index.html (data-sms / data-amount), which are all
//     exactly Ksh 1.50 per SMS
// If either changes, change this file in the same commit.

export const PLAN_PRICES: Record<string, number> = { basic: 3000, standard: 6000, pro: 12000 };
export const SMS_UNIT_PRICE = 1.5;
export const MAX_SMS_BUNDLE = 10000;

export interface BillingItems {
  plans: string[];
  smsBundles: number[];
}

// A cart is sent as payment_type = first item, notes = every item joined with
// " + " (see the billing checkout in js/settings.js). Webhooks later append
// " | Auto-approved..." text to notes, so parsing stops at the first pipe.
// Anything that is not a recognised item is ignored, because notes is free text.
export function parseBillingItems(
  paymentType: string | null | undefined,
  notes: string | null | undefined,
): BillingItems {
  const candidates: string[] = [];
  for (const part of String(paymentType || '').split('+')) candidates.push(part.trim());
  for (const part of String(notes || '').split('|')[0].split('+')) candidates.push(part.trim());

  const plans = new Set<string>();
  const sms = new Set<number>();
  for (const c of candidates) {
    if (!c) continue;
    let m = c.match(/^subscription_([a-z0-9_]+)$/);
    if (m) { plans.add(m[1]); continue; }
    m = c.match(/^sms_bundle_(\d+)$/);
    if (m) { sms.add(parseInt(m[1], 10)); continue; }
  }
  return { plans: [...plans], smsBundles: [...sms] };
}

export function expectedAmount(items: BillingItems): number {
  const plan = items.plans[0];
  const sms = items.smsBundles[0];
  return (plan ? PLAN_PRICES[plan] || 0 : 0) + (sms ? sms * SMS_UNIT_PRICE : 0);
}

export type CartCheck =
  | { ok: true; expected: number; items: BillingItems }
  | { ok: false; error: string };

export function validateBillingCart(
  paymentType: string | null | undefined,
  notes: string | null | undefined,
  amount: unknown,
): CartCheck {
  const items = parseBillingItems(paymentType, notes);

  if (items.plans.length === 0 && items.smsBundles.length === 0) {
    return { ok: false, error: 'Nothing to pay for. Select a plan or an SMS bundle first.' };
  }
  if (items.plans.length > 1 || items.smsBundles.length > 1) {
    return { ok: false, error: 'Only one plan and one SMS bundle can be paid for at a time.' };
  }
  if (items.plans.length === 1 && !(items.plans[0] in PLAN_PRICES)) {
    return { ok: false, error: 'That plan cannot be paid for through this checkout.' };
  }
  if (items.smsBundles.length === 1) {
    const n = items.smsBundles[0];
    if (!Number.isInteger(n) || n <= 0 || n > MAX_SMS_BUNDLE) {
      return { ok: false, error: 'Invalid SMS bundle size.' };
    }
  }

  const expected = expectedAmount(items);
  const requested = Number(amount);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, error: 'Invalid amount.' };
  }
  // M-Pesa STK Push only takes whole shillings, so a fractional expected
  // total (for example an odd-sized SMS bundle) can never be charged.
  if (!Number.isInteger(expected) || expected <= 0) {
    return { ok: false, error: 'This combination cannot be charged as a whole-shilling amount.' };
  }
  if (Math.round(requested) !== expected) {
    return { ok: false, error: `The amount does not match the selected items (expected Ksh ${expected.toLocaleString('en-KE')}). Refresh the page and try again.` };
  }
  return { ok: true, expected, items };
}
