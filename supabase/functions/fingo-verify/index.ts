// supabase/functions/fingo-verify/index.ts
//
// Active-poll equivalent of paystack-verify for Fingo charges — asks Fingo
// directly via GET /v1/transaction?merchantTransactionId=... (confirmed
// against docs.fingopay.io) rather than depending solely on their webhook,
// same lesson learned from the Paystack webhook-delivery gap earlier in
// this project.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creditMemberContribution } from '../_shared/creditMemberContribution.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { payment_request_id } = await req.json();
    if (!payment_request_id) {
      return new Response(JSON.stringify({ error: 'Missing payment_request_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

    // Same ownership check as paystack-verify.
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

    const { data: ps } = await supabase.from('platform_settings').select('fingo_api_key').maybeSingle();
    if (!ps?.fingo_api_key) {
      return new Response(JSON.stringify({ error: 'Fingo not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const reference = pr.paystack_ref || pr.mpesa_ref; // reused generically, see v3g migration note
    const fingoRes = await fetch(
      `https://api.fingopay.io/v1/transaction?merchantTransactionId=${encodeURIComponent(reference)}`,
      { headers: { 'Authorization': `Bearer ${ps.fingo_api_key}` } }
    );
    const fingoData = await fingoRes.json();
    const fingoStatus = fingoData?.data?.status;

    console.log('[GY360 Fingo Verify] ref:', reference, 'status:', fingoStatus);

    // Per Fingo's Transaction schema: pending, completed, failed, settled,
    // initiated, rejected.
    if (fingoStatus === 'completed' || fingoStatus === 'settled') {
      if (pr.payment_type === 'member_contribution') {
        await creditMemberContribution(supabase, pr, reference);
      }
      return new Response(JSON.stringify({ status: 'approved' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (fingoStatus === 'failed' || fingoStatus === 'rejected') {
      await supabase.from('payment_requests').update({
        status: 'declined',
        paystack_status: fingoStatus,
        notes: (pr.notes || '') + ` | Fingo reported: ${fingoStatus}`,
      }).eq('id', pr.id);
      return new Response(JSON.stringify({ status: 'declined' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // pending / initiated — customer likely still entering PIN
    return new Response(JSON.stringify({ status: 'pending' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 Fingo Verify] fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
