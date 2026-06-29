// supabase/functions/paystack-webhook/index.ts
// Receives Paystack payment confirmation, verifies HMAC signature,
// then auto-activates subscription or credits SMS bundle — no SA approval needed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

serve(async (req) => {
  // Paystack sends POST only
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('x-paystack-signature');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Load secret key to verify HMAC
  const { data: ps } = await supabase
    .from('platform_settings')
    .select('paystack_secret_key')
    .single();

  if (!ps?.paystack_secret_key) {
    return new Response('Not configured', { status: 500 });
  }

  // Verify Paystack HMAC signature
  const expectedSig = createHmac('sha512', ps.paystack_secret_key)
    .update(body)
    .digest('hex');

  if (sig !== expectedSig) {
    console.error('[GY360 Paystack Webhook] Invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }

  let event;
  try { event = JSON.parse(body); } catch(e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // We only care about successful charges
  if (event.event !== 'charge.success') {
    return new Response('OK', { status: 200 });
  }

  const data = event.data;
  const reference = data?.reference;
  const amountKes = (data?.amount || 0) / 100; // Convert from kobo back to KES

  if (!reference) return new Response('No reference', { status: 400 });

  // Find the matching payment_request
  const { data: pr, error: prErr } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('paystack_ref', reference)
    .eq('status', 'pending')
    .maybeSingle();

  if (prErr || !pr) {
    console.error('[GY360 Paystack Webhook] No matching payment_request for ref:', reference);
    return new Response('Payment request not found', { status: 404 });
  }

  const orgId = pr.org_id;
  const paymentType = pr.payment_type || '';
  const today = new Date().toISOString().split('T')[0];

  // ── AUTO-ACTIVATE based on payment_type ──
  try {
    if (paymentType.startsWith('subscription_') || paymentType === 'subscription') {
      // Extract plan from payment_type e.g. 'subscription_basic' → 'basic'
      const plan = paymentType.includes('_') ? paymentType.split('_')[1] : 'basic';

      // Calculate expiry: 1 year from today
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      const expiryStr = expiry.toISOString().split('T')[0];

      await supabase.from('organisations').update({
        plan,
        subscription_status: 'active',
        subscription_expires: expiryStr,
        trial_used: true,
      }).eq('id', orgId);

      console.log(`[GY360 Paystack Webhook] Activated ${plan} plan for org ${orgId} until ${expiryStr}`);

    } else if (paymentType.startsWith('sms_bundle_')) {
      // e.g. 'sms_bundle_500' → add 500 SMS credits
      const smsCount = parseInt(paymentType.split('_')[2]) || 0;
      if (smsCount > 0) {
        // Atomic increment of sms_bundle
        const { data: orgData } = await supabase
          .from('organisations')
          .select('sms_bundle')
          .eq('id', orgId)
          .single();

        await supabase.from('organisations').update({
          sms_bundle: (orgData?.sms_bundle || 0) + smsCount
        }).eq('id', orgId);

        console.log(`[GY360 Paystack Webhook] Credited ${smsCount} SMS to org ${orgId}`);
      }
    }

    // Handle combo orders (plan + sms_bundle in notes)
    // e.g. notes: 'subscription_basic + sms_bundle_200'
    if (pr.notes && pr.notes.includes('+')) {
      const parts = pr.notes.split('+').map(p => p.trim());
      for (const part of parts) {
        if (part.startsWith('sms_bundle_') && !paymentType.startsWith('sms_bundle_')) {
          const smsCount = parseInt(part.split('_')[2]) || 0;
          if (smsCount > 0) {
            const { data: orgData } = await supabase.from('organisations').select('sms_bundle').eq('id', orgId).single();
            await supabase.from('organisations').update({ sms_bundle: (orgData?.sms_bundle || 0) + smsCount }).eq('id', orgId);
          }
        }
      }
    }

    // Mark payment_request as approved
    await supabase.from('payment_requests').update({
      status: 'approved',
      paystack_status: 'success',
      mpesa_ref: data?.authorization?.receiver_bank_account_number || reference,
      approved_at: new Date().toISOString(),
      notes: (pr.notes || '') + ` | Auto-approved via Paystack. Paystack ref: ${reference}`,
    }).eq('id', pr.id);

    // Update bank balance (credit)
    await supabase.rpc('update_bank_balance', {
      p_org_id: orgId,
      p_amount: amountKes,
      p_direction: 'credit',
      p_date: today,
    });

    // Log activity
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_id: null,
      user_name: 'Paystack Auto',
      user_role: 'system',
      action: 'PAYMENT AUTO-APPROVED',
      details: `Paystack payment confirmed. Ksh ${amountKes.toLocaleString()} · ref ${reference} · type: ${paymentType}`,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });

  } catch(err) {
    console.error('[GY360 Paystack Webhook] Activation error:', err.message);
    // Don't return error — Paystack will retry if we return non-200
    // Log the failure and return 200 to stop retries
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_name: 'Paystack Webhook',
      user_role: 'system',
      action: 'WEBHOOK ERROR',
      details: `Paystack webhook activation failed for ref ${reference}: ${err.message}`,
      created_at: new Date().toISOString(),
    });
  }

  return new Response('OK', { status: 200 });
});
