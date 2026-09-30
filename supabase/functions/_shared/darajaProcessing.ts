// supabase/functions/_shared/darajaProcessing.ts
//
// The decision logic behind daraja-callback (Safaricom posts the result) and
// daraja-verify (our client asks Safaricom directly when a callback is late).
// Both end at the same atomic claim + credit, so whichever arrives first wins
// and the other becomes a harmless no-op.
//
// Kept apart from the HTTP handlers so it can be exercised with a fake
// database and a fake Safaricom.

import { claimPaymentRequest } from './claimPaymentRequest.ts';
import { creditPlatformPayment } from './creditPlatformPayment.ts';
import { creditDarajaContribution } from './creditDarajaContribution.ts';
import { DarajaConfig, stkQuery } from './darajaClient.ts';

// Platform billing (subscription/SMS) and member contributions credit
// completely differently - the first tops up the org's own plan/SMS
// bundle, the second updates members' balances and (for Daraja
// specifically) queues a real settlement. Routed here once, so both
// callback and verify paths can't drift apart on which one they call.
function creditByPaymentType(supabase: any, pr: any, reference: string, source: string) {
  if (pr.payment_type === 'member_contribution') {
    return creditDarajaContribution(supabase, pr, reference);
  }
  return creditPlatformPayment(supabase, pr, { reference, source });
}

export type CallbackOutcome =
  | 'invalid' | 'unknown-reference' | 'already-processed' | 'declined'
  | 'amount-mismatch' | 'claim-lost' | 'credited' | 'error';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findByCheckoutId(supabase: any, checkoutId: string) {
  const { data } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('paystack_ref', checkoutId) // paystack_ref is the generic "provider reference" column
    .eq('provider', 'daraja')
    .maybeSingle();
  return data || null;
}

async function logProblem(supabase: any, pr: any, action: string, details: string) {
  try {
    await supabase.from('activity_log').insert({
      org_id: pr.org_id, user_id: null, user_name: 'Daraja', user_role: 'system',
      action, details, target_type: 'payment', target_id: pr.id,
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('[daraja] activity_log insert failed (non-fatal):', e?.message);
  }
}

function readMetadata(cb: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const items = cb?.CallbackMetadata?.Item;
  if (Array.isArray(items)) for (const i of items) if (i?.Name) out[i.Name] = i.Value;
  return out;
}

// Handles the body Safaricom POSTs to daraja-callback.
export async function processDarajaCallback(
  supabase: any,
  body: any,
  opts: { retryDelayMs?: number } = {},
): Promise<CallbackOutcome> {
  const cb = body?.Body?.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return 'invalid';
  const checkoutId = String(cb.CheckoutRequestID);

  // daraja-charge saves the CheckoutRequestID a few milliseconds after the
  // prompt is sent. A callback cannot beat that in practice (the customer has
  // to type a PIN first), but one short retry costs nothing.
  let pr = await findByCheckoutId(supabase, checkoutId);
  if (!pr) {
    await sleep(opts.retryDelayMs ?? 1500);
    pr = await findByCheckoutId(supabase, checkoutId);
  }
  if (!pr) {
    console.warn('[daraja-callback] No payment request for checkout id:', checkoutId);
    return 'unknown-reference';
  }

  const resultCode = Number(cb.ResultCode);
  if (resultCode !== 0) {
    if (pr.status === 'pending') {
      await supabase.from('payment_requests').update({
        status: 'declined',
        paystack_status: 'failed',
        notes: (pr.notes || '') + ` | Safaricom: ${cb.ResultDesc || resultCode}`,
      }).eq('id', pr.id).eq('status', 'pending');
    }
    return 'declined';
  }

  if (pr.status === 'approved' || pr.status === 'processing') return 'already-processed';

  // Safaricom callbacks are unsigned, so check the paid amount against the
  // amount WE requested. The same check SasaPay's webhook uses. A mismatch is
  // left pending: a genuine payment is then picked up by daraja-verify, which
  // asks Safaricom directly.
  const meta = readMetadata(cb);
  const paid = Number(meta.Amount);
  const expected = Number(pr.amount);
  if (!Number.isFinite(paid) || Math.abs(paid - expected) > 0.5) {
    console.error(`[daraja-callback] Amount mismatch: expected ${expected}, callback said ${paid}. Not crediting ${checkoutId}.`);
    await logProblem(supabase, pr, 'WEBHOOK AMOUNT MISMATCH',
      `Ref ${checkoutId}: expected Ksh ${expected}, callback claimed ${paid}. Not credited, needs manual review.`);
    return 'amount-mismatch';
  }

  // A success that arrives after we already marked the request declined (for
  // example a verify query that read a timeout just before the customer
  // answered). Safaricom's success is authoritative, so reopen it.
  if (pr.status === 'declined') {
    await supabase.from('payment_requests')
      .update({ status: 'pending', paystack_status: 'pending' })
      .eq('id', pr.id).eq('status', 'declined');
  }

  const claimed = await claimPaymentRequest(supabase, pr);
  if (!claimed) return 'claim-lost';

  try {
    const receipt = String(meta.MpesaReceiptNumber || checkoutId);
    await creditByPaymentType(supabase, claimed, receipt, 'Daraja callback');
    return 'credited';
  } catch (e: any) {
    console.error('[daraja-callback] Crediting failed:', e?.message);
    await logProblem(supabase, pr, 'WEBHOOK ERROR', `Ref ${checkoutId}: ${e?.message}`);
    return 'error';
  }
}

export type VerifyStatus = 'approved' | 'declined' | 'pending' | 'processing';

// Asks Safaricom what happened to an STK Push and settles it if it is done.
// Called by daraja-verify when the callback is late or never arrives.
export async function verifyDarajaPayment(
  supabase: any,
  cfg: DarajaConfig,
  pr: any,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: VerifyStatus; message?: string }> {
  if (pr.status === 'approved') return { status: 'approved' };
  if (pr.status === 'declined' || pr.status === 'rejected') return { status: 'declined' };
  if (pr.status === 'processing') return { status: 'processing' };

  const checkoutId = String(pr.paystack_ref || '');
  // Until daraja-charge stores Safaricom's id, paystack_ref still holds our own
  // GYD- reference and there is nothing to ask Safaricom about yet.
  if (!checkoutId || checkoutId.startsWith('GYD-')) return { status: 'pending', message: 'prompt not registered yet' };

  const q = await stkQuery(cfg, checkoutId, fetchFn);

  if (q.state === 'success') {
    const claimed = await claimPaymentRequest(supabase, pr);
    if (!claimed) return { status: 'processing' };
    try {
      await creditByPaymentType(supabase, claimed, checkoutId, 'Daraja verify (STK query)');
      return { status: 'approved' };
    } catch (e: any) {
      console.error('[daraja-verify] Crediting failed:', e?.message);
      await logProblem(supabase, pr, 'WEBHOOK ERROR', `Ref ${checkoutId}: ${e?.message}`);
      return { status: 'pending', message: 'crediting failed, will retry' };
    }
  }

  if (q.state === 'failed') {
    await supabase.from('payment_requests').update({
      status: 'declined',
      paystack_status: 'failed',
      notes: (pr.notes || '') + ` | Safaricom: ${q.resultDesc || q.resultCode}`,
    }).eq('id', pr.id).eq('status', 'pending');
    return { status: 'declined', message: q.resultDesc };
  }

  return { status: 'pending', message: q.resultDesc };
}
