// supabase/functions/daraja-verify/index.ts
//
// Safety net for a callback that is late or never arrives. The billing
// checkout calls this while a payment is still pending; it asks Safaricom
// directly what happened and settles the payment if it is done.
//
// Called by our own client with the user's login, so it deploys normally:
//   supabase functions deploy daraja-verify

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DarajaConfigError, getDarajaConfig } from '../_shared/darajaClient.ts';
import { verifyDarajaPayment } from '../_shared/darajaProcessing.ts';
import { authorizeOrgAccess } from '../_shared/authorizeOrgAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let payload: any;
    try { payload = await req.json(); } catch (_e) { return json({ error: 'Invalid request body' }, 400); }
    const paymentRequestId = payload?.payment_request_id;
    if (!paymentRequestId) return json({ error: 'Missing payment_request_id' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: pr } = await supabase
      .from('payment_requests').select('*').eq('id', paymentRequestId).eq('provider', 'daraja').maybeSingle();
    if (!pr) return json({ error: 'Payment not found' }, 404);

    // The caller must belong to the org that owns this payment.
    const access = await authorizeOrgAccess(req, supabase, createClient, pr.org_id);
    if (!access.ok) return json({ error: access.error }, access.status);

    let cfg;
    try {
      cfg = getDarajaConfig();
    } catch (e) {
      if (e instanceof DarajaConfigError) return json({ status: pr.status, message: 'not configured' });
      throw e;
    }

    const result = await verifyDarajaPayment(supabase, cfg, pr);
    return json(result);
  } catch (err: any) {
    console.error('[daraja-verify] fatal:', err?.message);
    return json({ error: err?.message || 'Unexpected error' }, 500);
  }
});
