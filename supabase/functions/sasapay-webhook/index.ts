// supabase/functions/sasapay-webhook/index.ts
//
// Receives SasaPay's "C2B Callback Results" (sent to the CallBackURL we
// supply with each charge request — NOT their separate app-level IPN,
// deliberately, to keep one deterministic callback per charge and avoid
// any risk of double-crediting from two different notification streams).
//
// SECURITY NOTE: SasaPay's documentation describes no callback signature
// scheme (unlike Paystack's HMAC-SHA512 or Fingo's HMAC-SHA256+timestamp).
// As partial mitigation, this cross-checks the callback's claimed amount
// against what we actually charged before crediting anything — it cannot
// fully replace real signature verification, and this gap is worth
// raising directly with SasaPay's technical team.
//
// Correlation: SasaPay's own docs are inconsistent about which field
// echoes back our AccountReference (BillRefNumber in one place,
// PaymentRequestID/MerchantRequestID elsewhere in the same sample) — this
// checks all three defensively rather than assume one is reliably correct.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creditMemberContribution } from '../_shared/creditMemberContribution.ts';

// From SasaPay's dev console (not the public docs — more authoritative,
// dashboard-specific info Felix pulled directly). Trusted source IPs for
// their callback infrastructure.
const SASAPAY_TRUSTED_IPS = [
  '47.129.43.141', '13.229.247.179', '13.215.155.141', '13.214.60.231',
  '54.169.74.198', '18.142.226.87', '47.129.243.116', '13.250.110.3',
  '155.12.30.40', '155.12.30.58',
];

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // IP check — LOG ONLY for now, not enforced. Supabase Edge Functions may
  // sit behind infrastructure that changes the apparent source IP (proxies,
  // load balancers), so this needs confirming against real traffic before
  // it's safe to hard-block on. Worth tightening once confirmed reliable.
  const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipTrusted = SASAPAY_TRUSTED_IPS.includes(sourceIp);
  if (!ipTrusted) {
    console.warn('[GY360 SasaPay Webhook] Source IP not in trusted list (logged, not blocked):', sourceIp);
  }

  const rawBody = await req.text();
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response('OK', { status: 200 });
  }

  console.log('[GY360 SasaPay Webhook] Received:', JSON.stringify(event));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Try every plausible reference field SasaPay's own docs show — see note above.
  const candidateRefs = [event.BillRefNumber, event.PaymentRequestID, event.MerchantRequestID]
    .filter(Boolean);

  if (!candidateRefs.length) {
    console.error('[GY360 SasaPay Webhook] No usable reference field in callback');
    return new Response('OK', { status: 200 });
  }

  const { data: pr, error: prErr } = await supabase
    .from('payment_requests')
    .select('*')
    .in('paystack_ref', candidateRefs)
    .eq('status', 'pending')
    .maybeSingle();

  if (prErr) {
    console.error('[GY360 SasaPay Webhook] DB error looking up payment_request:', prErr.message);
    return new Response('OK', { status: 200 });
  }
  if (!pr) {
    console.log('[GY360 SasaPay Webhook] No pending payment_request matching refs:', JSON.stringify(candidateRefs));
    return new Response('OK', { status: 200 });
  }

  // ── Signature verification — LOG ONLY for now, not enforced ──
  // Per SasaPay's dev console: HMAC-SHA512, header X-SasaPay-Signature,
  // secret = Client ID (confirmed unusual but that's what's documented —
  // implemented exactly as specified, not "corrected" to client_secret),
  // message = "sasapay_transaction_code-merchant_code-account_number-
  // payment_reference-amount" hyphen-joined. The JSON field names in that
  // spec (snake_case) don't exactly match the callback payload's actual
  // field names (PascalCase, confirmed from public docs) — this is my best
  // interpretation of the mapping, not a certainty, so it logs match/
  // mismatch rather than blocking on it until confirmed against real
  // traffic. The amount cross-check below remains the enforced safety net
  // in the meantime.
  try {
    const { data: sigPs } = await supabase.from('platform_settings')
      .select('sasapay_client_id, sasapay_merchant_code').maybeSingle();
    if (sigPs?.sasapay_client_id) {
      const receivedSig = req.headers.get('x-sasapay-signature') || '';
      const message = [
        event.TransactionCode ?? '',
        event.MerchantCode ?? sigPs.sasapay_merchant_code ?? '',
        event.BillRefNumber ?? '',
        event.PaymentRequestID ?? event.CheckoutRequestID ?? '',
        event.TransAmount ?? '',
      ].join('-');
      const expectedSig = await hmacSha512Hex(sigPs.sasapay_client_id, message);
      const sigMatches = receivedSig && timingSafeEqual(receivedSig, expectedSig);
      if (sigMatches) {
        console.log('[GY360 SasaPay Webhook] ✓ Signature verified for ref', pr.paystack_ref);
      } else {
        console.warn('[GY360 SasaPay Webhook] Signature mismatch (logged, not blocked) — message:', message, 'received:', receivedSig.slice(0,20)+'...', 'expected:', expectedSig.slice(0,20)+'...');
      }
    }
  } catch (sigErr: any) {
    console.warn('[GY360 SasaPay Webhook] Signature check failed to run (non-fatal):', sigErr.message);
  }

  const resultCode = String(event.ResultCode ?? '');
  const reference = pr.paystack_ref;

  if (resultCode !== '0') {
    await supabase.from('payment_requests').update({
      status: 'declined',
      paystack_status: 'failed',
      notes: (pr.notes || '') + ` | SasaPay reported: ${event.ResultDesc || resultCode}`,
    }).eq('id', pr.id);
    return new Response('OK', { status: 200 });
  }

  // Defensive amount check — the one real mitigation available without a
  // documented signature scheme. Small tolerance for string/float
  // formatting differences, not for genuine mismatches.
  const claimedAmount = parseFloat(event.TransAmount ?? '0');
  const expectedAmount = Number(pr.amount);
  if (!claimedAmount || Math.abs(claimedAmount - expectedAmount) > 1) {
    console.error(`[GY360 SasaPay Webhook] Amount mismatch — expected ${expectedAmount}, callback claimed ${claimedAmount}. Refusing to credit ref ${reference}.`);
    await supabase.from('activity_log').insert({
      org_id: pr.org_id,
      user_name: 'SasaPay Webhook',
      user_role: 'system',
      action: 'WEBHOOK AMOUNT MISMATCH',
      details: `Ref ${reference}: expected Ksh ${expectedAmount}, callback claimed Ksh ${claimedAmount}. Not credited — needs manual review.`,
      created_at: new Date().toISOString(),
    }).catch(() => {});
    return new Response('OK', { status: 200 });
  }

  try {
    if (pr.payment_type === 'member_contribution') {
      await creditMemberContribution(supabase, pr, reference);

    } else if (pr.payment_type?.startsWith('subscription_') || pr.payment_type === 'subscription') {
      // Mirrors paystack-webhook's subscription activation exactly —
      // duplicated rather than shared, matching that this logic was never
      // extracted into _shared/ for Paystack either.
      const plan = pr.payment_type.includes('_') ? pr.payment_type.split('_').slice(1).join('_') : 'basic';
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      const expiryStr = expiry.toISOString().split('T')[0];

      await supabase.from('organisations').update({
        plan, subscription_status: 'active', subscription_expires: expiryStr, trial_used: true,
      }).eq('id', pr.org_id);

      await supabase.from('payment_requests').update({
        status: 'approved', paystack_status: 'success', mpesa_ref: reference,
        approved_at: new Date().toISOString(),
        notes: (pr.notes || '') + ` | Auto-approved via SasaPay webhook. Ref: ${reference}`,
      }).eq('id', pr.id);

      await supabase.rpc('update_bank_balance', {
        p_org_id: pr.org_id, p_amount: expectedAmount, p_direction: 'credit',
        p_date: new Date().toISOString().split('T')[0],
      });

      console.log(`[GY360 SasaPay Webhook] ✓ Activated ${plan} plan for org ${pr.org_id} until ${expiryStr}`);

    } else if (pr.payment_type?.startsWith('sms_bundle_')) {
      const smsCount = parseInt(pr.payment_type.split('_')[2]) || 0;
      if (smsCount > 0) {
        const { data: orgData } = await supabase.from('organisations').select('sms_bundle').eq('id', pr.org_id).single();
        await supabase.from('organisations').update({ sms_bundle: (orgData?.sms_bundle || 0) + smsCount }).eq('id', pr.org_id);
      }

      await supabase.from('payment_requests').update({
        status: 'approved', paystack_status: 'success', mpesa_ref: reference,
        approved_at: new Date().toISOString(),
        notes: (pr.notes || '') + ` | Auto-approved via SasaPay webhook. Ref: ${reference}`,
      }).eq('id', pr.id);

      await supabase.rpc('update_bank_balance', {
        p_org_id: pr.org_id, p_amount: expectedAmount, p_direction: 'credit',
        p_date: new Date().toISOString().split('T')[0],
      });

      console.log(`[GY360 SasaPay Webhook] ✓ Credited ${smsCount} SMS to org ${pr.org_id}`);

    } else {
      console.warn('[GY360 SasaPay Webhook] Unrecognised payment_type, marking approved with no crediting action:', pr.payment_type);
      await supabase.from('payment_requests').update({
        status: 'approved', paystack_status: 'success', mpesa_ref: reference,
        approved_at: new Date().toISOString(),
      }).eq('id', pr.id);
    }

    await supabase.from('activity_log').insert({
      org_id: pr.org_id, user_id: null, user_name: 'SasaPay Auto', user_role: 'system',
      action: 'PAYMENT AUTO-APPROVED',
      details: `Ksh ${expectedAmount.toLocaleString()} · ${pr.payment_type} · ref: ${reference}`,
      target_type: 'payment', target_id: pr.id, created_at: new Date().toISOString(),
    }).catch(() => {});

  } catch (err: any) {
    console.error('[GY360 SasaPay Webhook] Processing error:', err.message);
    await supabase.from('activity_log').insert({
      org_id: pr.org_id, user_name: 'SasaPay Webhook', user_role: 'system',
      action: 'WEBHOOK ERROR', details: `Failed for ref ${reference}: ${err.message}`,
      created_at: new Date().toISOString(),
    }).catch(() => {});
  }

  return new Response('OK', { status: 200 });
});
