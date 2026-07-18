// supabase/functions/sasapay-verify/index.ts
//
// NOT a true synchronous verify, unlike paystack-verify/fingo-verify — and
// that's a real architectural fact about SasaPay's API, not a shortcut
// taken here. Confirmed against their actual docs:
//   - "Check Transaction Status" (status-query) responds with literally
//     "Your request has been received. Check your callback url for
//     response" — it never answers directly, it just triggers another
//     webhook delivery.
//   - "Verify Transaction" (transactions/verify) DOES answer directly,
//     but requires transactionCode — something SasaPay only gives us
//     AFTER a payment succeeds, so it can't be used to check something
//     that's still pending.
//
// So this is a NUDGE, not a verify: it asks SasaPay to redeliver the
// result to our webhook, using the CheckoutRequestId we already have from
// the original charge. Genuinely useful if a webhook delivery went
// missing, but callers should expect "OK, asked them to resend" as the
// response — not an immediate approved/declined answer the way the other
// two providers' verify functions give.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getSasaPayToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${baseUrl}/api/v1/auth/token/?grant_type=client_credentials`, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${credentials}` },
  });
  const data = await res.json();
  if (!data?.access_token) throw new Error('SasaPay auth failed: ' + (data?.detail || 'no access_token returned'));
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { payment_request_id } = await req.json();
    if (!payment_request_id) {
      return new Response(JSON.stringify({ error: 'Missing payment_request_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Same caller-auth + ownership check as paystack-verify/fingo-verify.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: pr, error: prErr } = await supabase
      .from('payment_requests').select('*').eq('id', payment_request_id).maybeSingle();
    if (prErr || !pr) {
      return new Response(JSON.stringify({ error: 'Payment request not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let authorised = false;
    if (pr.member_id) {
      const { data: memberRow } = await supabase.from('members')
        .select('user_id').eq('id', pr.member_id).maybeSingle();
      if (memberRow?.user_id === callerUser.id) authorised = true;
    }
    if (!authorised) {
      const { data: membership } = await supabase.from('user_orgs')
        .select('role').eq('user_id', callerUser.id).eq('org_id', pr.org_id).maybeSingle();
      if (membership) authorised = true;
    }
    if (!authorised) {
      const { data: callerProfile } = await supabase.from('profiles')
        .select('role').eq('id', callerUser.id).maybeSingle();
      if (callerProfile?.role === 'superadmin') authorised = true;
    }
    if (!authorised) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (pr.status !== 'pending') {
      return new Response(JSON.stringify({ status: pr.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: ps } = await supabase.from('platform_settings')
      .select('sasapay_client_id, sasapay_client_secret, sasapay_merchant_code, sasapay_base_url').maybeSingle();
    if (!ps?.sasapay_client_id || !ps?.sasapay_client_secret || !ps?.sasapay_merchant_code) {
      return new Response(JSON.stringify({ error: 'SasaPay not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const baseUrl = ps.sasapay_base_url || 'https://api.sasapay.app';

    // We don't have CheckoutRequestId stored (the original charge response
    // included one, but it was never saved) — MerchantTransactionReference
    // is documented as an acceptable alternative identifier, and that's
    // exactly what our own reference is.
    const reference = pr.paystack_ref || pr.mpesa_ref;
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sasapay-webhook`;

    const accessToken = await getSasaPayToken(baseUrl, ps.sasapay_client_id, ps.sasapay_client_secret);

    const nudgeRes = await fetch(`${baseUrl}/api/v1/transactions/status-query/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        MerchantCode: ps.sasapay_merchant_code,
        MerchantTransactionReference: reference,
        CallbackUrl: webhookUrl,
      }),
    });
    const nudgeData = await nudgeRes.json();
    console.log('[GY360 SasaPay Verify/Nudge] status-query response:', JSON.stringify(nudgeData));

    // This is NOT an approved/declined answer — it's confirmation that
    // SasaPay will (re)send the real result to our webhook. The caller
    // should keep polling/listening as normal; this just makes a missing
    // webhook less likely to matter.
    return new Response(JSON.stringify({
      status: 'pending',
      nudge_sent: !!nudgeData?.status,
      detail: nudgeData?.message || nudgeData?.detail || null,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 SasaPay Verify/Nudge] fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
