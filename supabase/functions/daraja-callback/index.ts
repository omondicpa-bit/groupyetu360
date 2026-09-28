// supabase/functions/daraja-callback/index.ts
//
// Safaricom posts the STK Push result here. It is called by Safaricom, not by
// our client, so it MUST be deployed with --no-verify-jwt or Supabase's
// gateway rejects every call with a 401 before this code runs (the same
// silent failure that hid Paystack's and Fingo's webhooks for months):
//
//   supabase functions deploy daraja-callback --no-verify-jwt
//
// The decision logic lives in _shared/darajaProcessing.ts. This file only
// deals with HTTP and always answers 200, because Safaricom retries anything else.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callbackSecretMatches } from '../_shared/darajaClient.ts';
import { processDarajaCallback } from '../_shared/darajaProcessing.ts';

const ack = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  try {
    // Callbacks are unsigned. If DARAJA_CALLBACK_SECRET is set, only requests
    // carrying it in the URL are acted on. A rejected call still gets a normal
    // 200, so a probe learns nothing.
    const provided = new URL(req.url).searchParams.get('s');
    if (!callbackSecretMatches(provided)) {
      console.warn('[daraja-callback] Rejected a callback with a missing or wrong secret.');
      return ack();
    }

    let body: any;
    try { body = await req.json(); } catch (_e) { return ack(); }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const outcome = await processDarajaCallback(supabase, body);
    console.log('[daraja-callback] outcome:', outcome, 'checkout:', body?.Body?.stkCallback?.CheckoutRequestID);
  } catch (e: any) {
    console.error('[daraja-callback] Error:', e?.message);
  }
  return ack();
});
