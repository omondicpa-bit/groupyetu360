// supabase/functions/paystack-webhook/index.ts
// Receives Paystack charge.success event and auto-activates subscription/SMS bundle

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    // Use pr2
    return await processPayment(supabase, pr2, reference, amountKes, data);
  }

  return await processPayment(supabase, pr, reference, amountKes, data);
});

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

// ── Member contribution crediting — ported from approvePaymentRequest() in
// finance.js, so an automatic Paystack confirmation produces exactly the same
// records a manual admin approval would: welfare kept separate from
// shares/savings, bank_balance only credited for the non-welfare portion,
// fines auto-resolved, and the summary transaction tagged with the member's
// chosen contribution type (via `allocations`, set by paystack-charge from
// what the member picked at checkout) instead of falling into any generic
// "just log the gross amount" fallback.
async function processMemberContribution(supabase: any, pr: any, reference: string, amountKes: number) {
  const orgId = pr.org_id;
  const today = new Date().toISOString().split('T')[0];

  try {
    let allocations: any[] = [];
    try { allocations = JSON.parse(pr.allocations || '[]'); } catch (e) { /* falls through to fallback below */ }

    // Shouldn't happen — paystack-charge always sets allocations for this
    // payment type and rejects the charge otherwise — but if one somehow
    // arrives without one, record something rather than silently dropping
    // real money with no ledger entry at all.
    if (!allocations.length) {
      console.error('[GY360 Webhook] member_contribution with no allocations — using fallback amount:', pr.id);
      allocations = [{ typeName: 'Payment', amount: pr.amount }];
    }

    const welfareAllocs = allocations.filter((a: any) => a.isWelfare && a.eventId);
    const regularAllocs = allocations.filter((a: any) => !(a.isWelfare && a.eventId));
    const regularTotal = regularAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    const welfareTotal = welfareAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);

    let successCount = 0;

    const { data: member } = await supabase.from('members')
      .select('shares_balance,savings_balance,registration_paid')
      .eq('id', pr.member_id).maybeSingle();

    // One summary transaction for the non-welfare portion
    if (regularAllocs.length && regularTotal > 0) {
      const allocationSummary = regularAllocs
        .map((a: any) => a.typeName + ': Ksh ' + Number(a.amount).toLocaleString())
        .join(' | ');
      const summaryTxn: any = {
        org_id: orgId,
        member_id: pr.member_id,
        amount: regularTotal,
        mpesa_ref: reference,
        transaction_date: pr.payment_date || today,
        notes: `Auto-approved via Paystack. Ref: ${reference}. ${allocationSummary}`,
      };
      const firstTypedAlloc = regularAllocs.find((a: any) => a.typeId && a.typeId.length > 10);
      if (firstTypedAlloc) summaryTxn.type_id = firstTypedAlloc.typeId;
      const { error: txErr } = await supabase.from('transactions').insert(summaryTxn);
      if (!txErr) successCount++;
      else console.error('[GY360 Webhook] regular transaction insert failed:', txErr.message);
    }

    // Separate, properly-tagged transaction per welfare allocation
    for (const alloc of welfareAllocs) {
      const { error: welErr } = await supabase.from('transactions').insert({
        org_id: orgId,
        member_id: pr.member_id,
        amount: Number(alloc.amount),
        mpesa_ref: reference,
        transaction_date: pr.payment_date || today,
        welfare_event_id: alloc.eventId,
        notes: `Welfare contribution — ${alloc.typeName}. Auto-approved via Paystack. Ref: ${reference}.`,
      });
      if (!welErr) successCount++;
      else console.error('[GY360 Webhook] welfare transaction insert failed:', welErr.message);
    }

    // Member balance updates — regular allocations only, welfare never
    // touches shares/savings, matching the manual approval path exactly.
    const memberUpdates: any = {};
    for (const alloc of regularAllocs) {
      const name = (alloc.typeName || '').toLowerCase();
      if (name.includes('share')) {
        memberUpdates.shares_balance = (memberUpdates.shares_balance ?? (member?.shares_balance || 0)) + Number(alloc.amount);
      } else if (name.includes('saving')) {
        memberUpdates.savings_balance = (memberUpdates.savings_balance ?? (member?.savings_balance || 0)) + Number(alloc.amount);
      }
      if (alloc.isReg) memberUpdates.registration_paid = true;
    }
    if (pr.member_id && Object.keys(memberUpdates).length) {
      const { error: memErr } = await supabase.from('members').update(memberUpdates).eq('id', pr.member_id);
      if (memErr) console.error('[GY360 Webhook] member balance update failed:', memErr.message);
    }

    // Bank balance — regular portion only. Welfare money stays entirely
    // outside bank_balance, by design, same as the manual approval path.
    if (regularTotal > 0) {
      const { error: bbErr } = await supabase.rpc('update_bank_balance', {
        p_org_id: orgId, p_amount: regularTotal, p_direction: 'credit', p_date: today,
      });
      if (bbErr) console.error('[GY360 Webhook] bank balance update failed:', bbErr.message);
    }

    // Auto-resolve fines
    const fineAllocs = allocations.filter((a: any) => a.isFine && a.fineId);
    for (const fa of fineAllocs) {
      await supabase.from('fines').update({
        status: 'paid',
        paid_date: pr.payment_date || today,
        recovery_method: 'mpesa',
      }).eq('id', fa.fineId);
      await supabase.from('expenses').insert({
        org_id: orgId,
        category: 'Fine',
        description: `Fine paid: ${fa.reason || 'fine'} — auto via Paystack`,
        amount: fa.amount,
        expense_date: pr.payment_date || today,
        entry_type: 'income',
      });
    }

    // Mark approved — no approved_by, matching how the existing
    // subscription/SMS auto-approval path also leaves it unset for
    // system-driven confirmations (there's no human approver here).
    await supabase.from('payment_requests').update({
      status: 'approved',
      paystack_status: 'success',
      mpesa_ref: reference,
      approved_at: new Date().toISOString(),
      notes: (pr.notes || '') + ` | Auto-approved via Paystack webhook. Ref: ${reference}`,
    }).eq('id', pr.id);

    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_id: null,
      user_name: 'Paystack Auto',
      user_role: 'system',
      action: 'MEMBER CONTRIBUTION AUTO-APPROVED',
      details: `Ksh ${regularTotal.toLocaleString()}${welfareTotal ? ' + Ksh ' + welfareTotal.toLocaleString() + ' welfare' : ''} · ref: ${reference}`,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });

    console.log('[GY360 Webhook] ✓ Member contribution processed for ref:', reference, '— transactions written:', successCount);

  } catch (err: any) {
    console.error('[GY360 Webhook] Member contribution processing error:', err.message);
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_name: 'Paystack Webhook',
      user_role: 'system',
      action: 'WEBHOOK ERROR',
      details: `Member contribution failed for ref ${reference}: ${err.message}`,
      created_at: new Date().toISOString(),
    }).catch(() => {});
  }

  return new Response('OK', { status: 200 });
}
