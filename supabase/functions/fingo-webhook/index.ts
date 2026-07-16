// supabase/functions/fingo-webhook/index.ts
//
// Receives Fingo Pay's transaction.* events and credits member contributions
// automatically. Scoped to member_contribution only for now — Fingo isn't
// used for platform subscription/SMS billing (that stays on Paystack), so
// there's no equivalent logic to replicate here for those types.
//
// Signature scheme confirmed against docs.fingopay.io/webhooks (not
// guessed): header "X-Fingo-Signature: t=<unix>, v1=<hex_hmac>", where
// v1 = hex(hmac_sha256(secret, t + "." + raw_body)), and t must be within
// 5 minutes of now. This differs from Paystack's scheme (SHA-512 over the
// raw body alone, no timestamp) — each provider's webhook verifies against
// its own documented format, not a shared assumption.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creditMemberContribution } from '../_shared/creditMemberContribution.ts';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-fingo-signature') || '';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: ps } = await supabase.from('platform_settings')
    .select('fingo_webhook_secret').maybeSingle();
  if (!ps?.fingo_webhook_secret) {
    console.error('[GY360 Fingo Webhook] No fingo_webhook_secret configured');
    return new Response('OK', { status: 200 }); // 200 so Fingo doesn't retry forever on a config issue
  }

  // Parse "t=<unix>, v1=<hex>"
  const parts = sigHeader.split(',').map(p => p.trim());
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));
  const t = tPart?.split('=')[1];
  const v1 = v1Part?.split('=')[1];

  if (!t || !v1) {
    console.error('[GY360 Fingo Webhook] Malformed signature header:', sigHeader);
    return new Response('Bad signature header', { status: 400 });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(t)) > 300) {
    console.error('[GY360 Fingo Webhook] Timestamp outside 5-minute window');
    return new Response('Timestamp out of window', { status: 400 });
  }

  const expected = await hmacSha256Hex(ps.fingo_webhook_secret, `${t}.${rawBody}`);
  if (!timingSafeEqual(v1, expected)) {
    console.error('[GY360 Fingo Webhook] Signature mismatch — rejecting');
    return new Response('Invalid signature', { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch (e) {
    return new Response('OK', { status: 200 });
  }

  console.log('[GY360 Fingo Webhook] Event received:', event.type);

  // C2B charge events carry data directly under `data`; payout events (not
  // used yet — disbursement is manual) sometimes nest under `data.object`
  // per Fingo's own docs. Only charge events matter here.
  const data = event.data;
  if (!data || data.type !== 'charge') {
    return new Response('OK', { status: 200 });
  }

  const reference = data.merchantTransactionId;
  if (!reference) {
    console.error('[GY360 Fingo Webhook] No merchantTransactionId in event');
    return new Response('OK', { status: 200 });
  }

  // paystack_ref is reused generically as "the provider's own reference"
  // regardless of provider — see v3g migration note.
  const { data: pr, error: prErr } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('paystack_ref', reference)
    .eq('status', 'pending')
    .maybeSingle();

  if (prErr) {
    console.error('[GY360 Fingo Webhook] DB error looking up payment_request:', prErr.message);
    return new Response('OK', { status: 200 });
  }
  if (!pr) {
    // Already processed (idempotency — same principle as paystack-webhook)
    // or genuinely not found; either way, nothing to do.
    console.log('[GY360 Fingo Webhook] No pending payment_request for ref:', reference);
    return new Response('OK', { status: 200 });
  }

  if (event.type === 'transaction.succeeded') {
    if (pr.payment_type === 'member_contribution') {
      await creditMemberContribution(supabase, pr, reference);
    } else {
      console.log('[GY360 Fingo Webhook] Non-member_contribution success — no handler for this type on Fingo:', pr.payment_type);
    }
  } else if (event.type === 'transaction.failed' || event.type === 'transaction.creation_failed') {
    await supabase.from('payment_requests').update({
      status: 'declined',
      paystack_status: 'failed',
      notes: (pr.notes || '') + ` | Fingo reported: ${data.message || event.type}`,
    }).eq('id', pr.id);
  }
  // transaction.reversed intentionally not auto-handled — a reversal on an
  // already-credited contribution needs a human decision (claw back the
  // transaction? adjust balances?), not a silent automated reversal.

  return new Response('OK', { status: 200 });
});
