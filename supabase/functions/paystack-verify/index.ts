// supabase/functions/paystack-verify/index.ts
//
// Actively asks Paystack whether a charge succeeded, rather than passively
// waiting for their charge.success webhook to arrive. Built after live
// testing showed the webhook wasn't reaching us for member_contribution
// charges even though Paystack itself confirmed the charge succeeded
// (customer was debited, Paystack sent its own confirmation email) — the
// gap was in outbound webhook delivery from Paystack's side, not in our
// crediting logic, which already worked correctly once triggered manually.
//
// This is called by the client on a fast poll (every ~2s) instead of
// passively watching payment_requests.status. The webhook stays in place
// as a second, idempotent path — whichever gets there first wins, since
// both check status='pending' before crediting anything.

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

    // Same auth pattern as paystack-charge — verify the caller is a real
    // logged-in user before telling them anything about a payment's status.
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

    // Confirm the caller actually owns this payment (their own member record)
    // or is an admin/superadmin for the org it belongs to — same spirit as
    // paystack-charge's org-membership check, so this endpoint can't be used
    // to peek at or trigger crediting for someone else's payment.
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

    // Already resolved — nothing to verify, just report current state.
    if (pr.status !== 'pending') {
      return new Response(JSON.stringify({ status: pr.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: ps } = await supabase.from('platform_settings')
      .select('paystack_secret_key').single();
    if (!ps?.paystack_secret_key) {
      return new Response(JSON.stringify({ error: 'Paystack not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const reference = pr.paystack_ref || pr.mpesa_ref;
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { 'Authorization': `Bearer ${ps.paystack_secret_key}` }
    });
    const verifyData = await verifyRes.json();
    const paystackStatus = verifyData?.data?.status;

    console.log('[GY360 Verify] ref:', reference, 'Paystack status:', paystackStatus);

    if (paystackStatus === 'success') {
      if (pr.payment_type === 'member_contribution') {
        await creditMemberContribution(supabase, pr, reference);
      } else {
        // Subscription/SMS billing isn't broken (the webhook already handles
        // it reliably per Felix) — this endpoint only actively credits
        // member_contribution for now. Still report success so the client
        // isn't left hanging if it's ever called for another type.
        console.log('[GY360 Verify] Non-member_contribution success — deferring to webhook for crediting:', pr.payment_type);
      }
      return new Response(JSON.stringify({ status: 'approved' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (paystackStatus === 'failed' || paystackStatus === 'abandoned' || paystackStatus === 'reversed') {
      await supabase.from('payment_requests').update({
        status: 'declined',
        paystack_status: paystackStatus,
        notes: (pr.notes || '') + ` | Paystack reported: ${paystackStatus}`,
      }).eq('id', pr.id);
      return new Response(JSON.stringify({ status: 'declined' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Still pending on Paystack's side too (customer hasn't entered their PIN yet)
    return new Response(JSON.stringify({ status: 'pending' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 Verify] fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
