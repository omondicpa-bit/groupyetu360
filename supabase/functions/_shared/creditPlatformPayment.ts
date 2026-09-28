// supabase/functions/_shared/creditPlatformPayment.ts
//
// Credits a paid subscription and/or SMS bundle payment_request. Call it only
// AFTER claimPaymentRequest() has returned the claimed row (status is
// 'processing'), so two concurrent callers can never both credit.
//
// Differences from the crediting blocks in paystack-webhook and
// sasapay-webhook, all deliberate:
//
// 1. Combined carts. The billing checkout stores only the FIRST cart item in
//    payment_type and the whole cart in notes. sasapay-webhook reads only
//    payment_type, so a plan plus an SMS bundle credits the plan and silently
//    drops the SMS. Here both are credited.
//
// 2. No update_bank_balance() call. The paying group hands money to EPH, so
//    its own bank balance must not go up. The manual approval flow
//    (approvePayment in js/utils.js) does not touch it either.
//
// 3. One organisations update carries every change, so a partial failure cannot
//    leave a plan activated with the SMS missing.
//
// Failure handling: if the organisation update fails, the claim is released
// (processing back to pending) so the verify fallback can retry safely. If the
// organisation update SUCCEEDS but the approval mark then fails, the claim is
// NOT released, because a retry would credit a second time. That case is
// logged for manual review instead.

import { parseBillingItems } from './billingPrices.ts';

export interface CreditContext {
  reference: string; // M-Pesa receipt when known, otherwise the checkout id
  source: string;    // for notes and the activity log, e.g. 'Daraja callback'
}

async function logActivity(supabase: any, pr: any, userName: string, action: string, details: string) {
  try {
    await supabase.from('activity_log').insert({
      org_id: pr.org_id,
      user_id: null,
      user_name: userName,
      user_role: 'system',
      action,
      details,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('[creditPlatformPayment] activity_log insert failed (non-fatal):', e?.message);
  }
}

async function releaseClaim(supabase: any, pr: any) {
  await supabase.from('payment_requests').update({ status: 'pending' }).eq('id', pr.id).eq('status', 'processing');
}

export async function creditPlatformPayment(supabase: any, pr: any, ctx: CreditContext): Promise<{ credited: boolean; summary: string }> {
  const items = parseBillingItems(pr.payment_type, pr.notes);
  const plan = items.plans[0] || null;
  const smsCount = items.smsBundles.reduce((s, n) => s + n, 0);

  if (!plan && smsCount <= 0) {
    await releaseClaim(supabase, pr);
    await logActivity(supabase, pr, ctx.source, 'WEBHOOK ERROR',
      `Ref ${ctx.reference}: paid, but no recognised plan or SMS bundle in "${pr.payment_type}". Needs manual review.`);
    return { credited: false, summary: 'no recognised items' };
  }

  const updates: Record<string, unknown> = {};
  const today = new Date();
  if (plan) {
    const expiry = new Date(today);
    expiry.setFullYear(expiry.getFullYear() + 1);
    updates.plan = plan;
    updates.subscription_status = 'active';
    updates.subscription_expires = expiry.toISOString().split('T')[0];
    updates.subscription_paid_date = today.toISOString().split('T')[0];
    updates.trial_used = true;
  }
  if (smsCount > 0) {
    const { data: org, error: readErr } = await supabase
      .from('organisations').select('sms_bundle').eq('id', pr.org_id).single();
    if (readErr) {
      await releaseClaim(supabase, pr);
      throw new Error('Could not read SMS balance: ' + readErr.message);
    }
    updates.sms_bundle = (org?.sms_bundle || 0) + smsCount;
  }

  const { error: updErr } = await supabase.from('organisations').update(updates).eq('id', pr.org_id);
  if (updErr) {
    await releaseClaim(supabase, pr);
    throw new Error('Organisation update failed: ' + updErr.message);
  }

  // Money is credited from here on. Never release the claim after this point.
  let marked = false;
  let lastErr = '';
  for (let attempt = 0; attempt < 3 && !marked; attempt++) {
    const { error } = await supabase.from('payment_requests').update({
      status: 'approved',
      paystack_status: 'success',
      mpesa_ref: ctx.reference,
      approved_at: new Date().toISOString(),
      notes: (pr.notes || '') + ` | Auto-approved via ${ctx.source}. Ref: ${ctx.reference}`,
    }).eq('id', pr.id);
    if (!error) marked = true; else lastErr = error.message;
  }

  const summary = [plan ? `${plan} plan` : '', smsCount > 0 ? `${smsCount} SMS` : ''].filter(Boolean).join(' + ');
  if (!marked) {
    await logActivity(supabase, pr, ctx.source, 'WEBHOOK ERROR',
      `Ref ${ctx.reference}: credited ${summary} but could not mark the payment approved (${lastErr}). Do NOT credit again. Mark it approved manually.`);
    return { credited: true, summary };
  }

  await logActivity(supabase, pr, ctx.source, 'PAYMENT AUTO-APPROVED',
    `Ksh ${Number(pr.amount).toLocaleString('en-KE')} · ${summary} · ref: ${ctx.reference}`);
  console.log(`[creditPlatformPayment] Credited ${summary} for org ${pr.org_id} (ref ${ctx.reference})`);
  return { credited: true, summary };
}
