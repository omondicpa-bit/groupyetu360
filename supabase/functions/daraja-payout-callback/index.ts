// supabase/functions/daraja-payout-callback/index.ts
//
// Safaricom posts the B2C or B2B result here (ResultURL). Called by
// Safaricom, not our client, so it MUST be deployed with --no-verify-jwt,
// same reason as daraja-callback:
//
//   supabase functions deploy daraja-payout-callback --no-verify-jwt
//
// Logic lives in _shared/darajaPayoutProcessing.ts. This file only deals
// with HTTP and always answers 200, since Safaricom retries anything else.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callbackSecretMatches } from '../_shared/darajaClient.ts';
import { handlePayoutCallback } from '../_shared/darajaPayoutProcessing.ts';

const ack = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  try {
    const provided = new URL(req.url).searchParams.get('s');
    if (!callbackSecretMatches(provided)) {
      console.warn('[daraja-payout-callback] Rejected a callback with a missing or wrong secret.');
      return ack();
    }

    let body: any;
    try { body = await req.json(); } catch (_e) { return ack(); }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const outcome = await handlePayoutCallback(supabase, body);
    console.log('[daraja-payout-callback] outcome:', outcome, 'conversation:', body?.Result?.ConversationID);
  } catch (e: any) {
    console.error('[daraja-payout-callback] Error:', e?.message);
  }
  return ack();
});
