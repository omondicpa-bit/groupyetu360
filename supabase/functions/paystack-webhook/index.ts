// supabase/functions/paystack-webhook/index.ts
// Receives Paystack charge.success event and auto-activates subscription/SMS bundle

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creditMemberContribution } from '../_shared/creditMemberContribution.ts';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('x-paystack-signature') || '';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Load secret key
  const { data: ps } = await supabase
    .from('platform_settings')
    .select('paystack_secret_key')
    .single();

  if (!ps?.paystack_secret_key) {
    console.error('[GY360 Webhook] No paystack_secret_key in platform_settings');
    return new Response('OK', { status: 200 }); // return 200 so Paystack doesn't retry
  }

  // Verify HMAC-SHA512 using Web Crypto API (Deno native — no import needed)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ps.paystack_secret_key);
  const msgData = encoder.encode(body);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-512' },
    false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  console.log('[GY360 Webhook] sig received:', sig.slice(0, 20) + '...');
  console.log('[GY360 Webhook] sig expected:', expectedSig.slice(0, 20) + '...');

  // Timing-safe comparison — a plain !== leaks timing information about how
  // many leading characters matched, which matters for a function protecting
  // real payment confirmations. Constant-time regardless of where they diverge.
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  if (!timingSafeEqual(sig, expectedSig)) {
    console.error('[GY360 Webhook] HMAC mismatch — rejecting');
    return new Response('Invalid signature', { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(body); } catch(e) {
    return new Response('OK', { status: 200 });
  }

  console.log('[GY360 Webhook] Event received:', event.event);

  // Only process successful charges
  if (event.event !== 'charge.success') {
    return new Response('OK', { status: 200 });
  }

  const data = event.data;
  const reference = data?.reference;
  const amountKes = (data?.amount || 0) / 100;

  console.log('[GY360 Webhook] charge.success ref:', reference, 'amount KES:', amountKes);

  if (!reference) {
    console.error('[GY360 Webhook] No reference in event data');
    return new Response('OK', { status: 200 });
  }

  // Find matching payment_request by paystack_ref
  const { data: pr, error: prErr } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('paystack_ref', reference)
    .eq('status', 'pending')
    .maybeSingle();

  if (prErr) {
    console.error('[GY360 Webhook] DB error looking up payment_request:', prErr.message);
    return new Response('OK', { status: 200 });
  }

  if (!pr) {
    // Try matching by mpesa_ref as fallback
    const { data: pr2 } = await supabase
      .from('payment_requests')
      .select('*')
      .eq('mpesa_ref', reference)
      .eq('status', 'pending')
      .maybeSingle();

    if (!pr2) {
      console.error('[GY360 Webhook] No pending payment_request found for ref:', reference);
      return new Response('OK', { status: 200 });
    }
    return await claimAndProcess(supabase, pr2, reference, amountKes, data);
  }

  return await claimAndProcess(supabase, pr, reference, amountKes, data);
});

// ── Atomic claim ────────────────────────────────────────────────────────
// Paystack can and does retry webhook delivery, and the client separately
// polls paystack-verify every ~2s while the STK prompt is open — both paths
// used to just SELECT-check status='pending' and credit, trusting "whichever
// gets there first wins". That's not actually safe: the row was only ever
// marked 'approved' at the very end of creditMemberContribution, well after
// every transaction/balance/SMS side effect had already fired, so two or
// three near-simultaneous calls could all read 'pending' before any of them
// wrote 'approved' — and all three would fully process the same payment.
// This UPDATE...WHERE status='pending' is a single, row-locked Postgres
// statement: only one concurrent caller can ever match the WHERE clause and
// flip it to 'processing'; every other caller gets 0 rows back and bails out
// here, before touching anything. This is what actually closes the race —
// the status filter alone never did.
async function claimPaymentRequest(supabase: any, pr: any) {
  const { data: claimed, error } = await supabase
    .from('payment_requests')
    .update({ status: 'processing' })
    .eq('id', pr.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) {
    console.error('[GY360 Webhook] Claim failed (DB error):', error.message);
    return null;
  }
  if (!claimed) {
    console.log('[GY360 Webhook] Payment already claimed by another call, skipping ref:', pr.paystack_ref || pr.mpesa_ref);
    return null;
  }
  return claimed;
}

async function claimAndProcess(supabase: any, pr: any, reference: string, amountKes: number, paystackData: any) {
  const claimed = await claimPaymentRequest(supabase, pr);
  if (!claimed) return new Response('OK', { status: 200 });
  return await processPayment(supabase, claimed, reference, amountKes, paystackData);
}

async function processPayment(supabase: any, pr: any, reference: string, amountKes: number, paystackData: any) {
  const orgId = pr.org_id;
  const paymentType = pr.payment_type || '';
  const today = new Date().toISOString().split('T')[0];

  console.log('[GY360 Webhook] Processing payment_request id:', pr.id, 'type:', paymentType);

  // Member contributions (Paystack subaccounts) need entirely different
  // handling from subscription/SMS billing — welfare-vs-regular splitting,
  // per-member balance updates, fine auto-resolution, and a bank_balance
  // credit for only the non-welfare portion (never the full gross charge).
  // Routed to its own function and returned early so the subscription/SMS
  // path below is completely untouched.
  if (paymentType === 'member_contribution') {
    return await processMemberContribution(supabase, pr, reference, amountKes);
  }

  try {
    if (paymentType.startsWith('subscription_') || paymentType === 'subscription') {
      const plan = paymentType.includes('_') ? paymentType.split('_').slice(1).join('_') : 'basic';
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      const expiryStr = expiry.toISOString().split('T')[0];

      const { error: orgErr } = await supabase.from('organisations').update({
        plan,
        subscription_status: 'active',
        subscription_expires: expiryStr,
        trial_used: true,
      }).eq('id', orgId);

      if (orgErr) throw new Error('Org update failed: ' + orgErr.message);
      console.log(`[GY360 Webhook] ✓ Activated ${plan} plan for org ${orgId} until ${expiryStr}`);

    } else if (paymentType.startsWith('sms_bundle_')) {
      const smsCount = parseInt(paymentType.split('_')[2]) || 0;
      if (smsCount > 0) {
        const { data: orgData } = await supabase
          .from('organisations').select('sms_bundle').eq('id', orgId).single();
        const newCount = (orgData?.sms_bundle || 0) + smsCount;
        const { error: smsErr } = await supabase.from('organisations')
          .update({ sms_bundle: newCount }).eq('id', orgId);
        if (smsErr) throw new Error('SMS bundle update failed: ' + smsErr.message);
        console.log(`[GY360 Webhook] ✓ Credited ${smsCount} SMS to org ${orgId} (new total: ${newCount})`);
      }
    }

    // Handle combo orders — parse notes for additional items
    if (pr.notes && pr.notes.includes('sms_bundle_') && !paymentType.startsWith('sms_bundle_')) {
      const parts = pr.notes.split('+').map((p: string) => p.trim());
      for (const part of parts) {
        if (part.startsWith('sms_bundle_')) {
          const smsCount = parseInt(part.split('_')[2]) || 0;
          if (smsCount > 0) {
            const { data: orgData } = await supabase.from('organisations').select('sms_bundle').eq('id', orgId).single();
            await supabase.from('organisations').update({ sms_bundle: (orgData?.sms_bundle || 0) + smsCount }).eq('id', orgId);
            console.log(`[GY360 Webhook] ✓ Combo: credited additional ${smsCount} SMS`);
          }
        }
      }
    }

    // Mark payment_request approved
    await supabase.from('payment_requests').update({
      status: 'approved',
      paystack_status: 'success',
      mpesa_ref: reference,
      approved_at: new Date().toISOString(),
      notes: (pr.notes || '') + ` | Auto-approved via Paystack webhook. ref: ${reference}`,
    }).eq('id', pr.id);

    // Atomic bank balance credit
    await supabase.rpc('update_bank_balance', {
      p_org_id: orgId,
      p_amount: amountKes,
      p_direction: 'credit',
      p_date: today,
    });

    // Activity log
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_id: null,
      user_name: 'Paystack Auto',
      user_role: 'system',
      action: 'PAYMENT AUTO-APPROVED',
      details: `Ksh ${amountKes.toLocaleString()} · ${paymentType} · ref: ${reference}`,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });

    console.log('[GY360 Webhook] ✓ Complete for ref:', reference);

  } catch(err: any) {
    console.error('[GY360 Webhook] Processing error:', err.message);
    await supabase.from('payment_requests').update({ status: 'pending' }).eq('id', pr.id).eq('status', 'processing');
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_name: 'Paystack Webhook',
      user_role: 'system',
      action: 'WEBHOOK ERROR',
      details: `Failed for ref ${reference}: ${err.message}`,
      created_at: new Date().toISOString(),
    }).catch(() => {});
  }

  return new Response('OK', { status: 200 });
}

// ── Member contribution crediting — thin wrapper around the shared function
// so paystack-charge's server-side verify path and this webhook both use
// exactly the same logic, rather than two copies that can silently drift.
async function processMemberContribution(supabase: any, pr: any, reference: string, amountKes: number) {
  const result = await creditMemberContribution(supabase, pr, reference);
  // creditMemberContribution sets status='approved' itself on success but
  // swallows its own errors internally (logs + returns {success:false}
  // rather than throwing) — so a failure here needs the same revert-to-
  // 'pending' treatment as the subscription/SMS path above, or the claim
  // above leaves this row stuck in 'processing' forever with no retry.
  if (!result?.success) {
    await supabase.from('payment_requests').update({ status: 'pending' }).eq('id', pr.id).eq('status', 'processing');
  }
  return new Response('OK', { status: 200 });
}
