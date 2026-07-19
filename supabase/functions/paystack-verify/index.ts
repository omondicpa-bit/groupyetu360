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
// as a second path — both now use an atomic UPDATE...WHERE status='pending'
// claim (see claimPaymentRequest in paystack-webhook, and the inline claim
// below) before crediting anything, so whichever of them — or whichever
// overlapping poll — actually wins the row is the only one that processes
// the payment. A plain status check here was not enough on its own: it's a
// read, and the row wasn't marked 'approved' until the very end of
// creditMemberContribution, leaving a real window for near-simultaneous
// calls to all read 'pending' and all credit the same payment.

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
    // IMPORTANT: this reference belongs to a Charge (from paystack-charge's
    // POST /charge call), not an initialized Transaction — those are two
    // separate objects in Paystack's API. /transaction/verify/:reference is
    // for the latter and doesn't recognize a charge-only reference, which is
    // why an earlier version of this function immediately reported failure
    // even when the charge was genuinely still in progress. The correct
    // endpoint for a Charge API payment is Check Pending Charge:
    // GET /charge/:reference
    const verifyRes = await fetch(`https://api.paystack.co/charge/${encodeURIComponent(reference)}`, {
      headers: { 'Authorization': `Bearer ${ps.paystack_secret_key}` }
    });
    const verifyData = await verifyRes.json();
    const paystackStatus = verifyData?.data?.status;

    console.log('[GY360 Verify] ref:', reference, 'Paystack status:', paystackStatus);

    if (paystackStatus === 'success') {
      if (pr.payment_type === 'member_contribution') {
        // Atomic claim — see paystack-webhook's claimPaymentRequest() for the
        // full rationale. The check at line 98 above is a read; multiple
        // overlapping polls (this endpoint is hit every ~2s while the STK
        // prompt is open) or a poll racing the webhook could all pass it
        // before any of them had credited anything. This UPDATE...WHERE
        // status='pending' is what actually makes only one caller proceed.
        const { data: claimed, error: claimErr } = await supabase
          .from('payment_requests')
          .update({ status: 'processing' })
          .eq('id', pr.id)
          .eq('status', 'pending')
          .select()
          .maybeSingle();

        if (claimErr) {
          console.error('[GY360 Verify] Claim failed (DB error):', claimErr.message);
        } else if (!claimed) {
          console.log('[GY360 Verify] Payment already claimed by another call, skipping ref:', reference);
        } else {
          const result = await creditMemberContribution(supabase, claimed, reference);
          if (!result?.success) {
            await supabase.from('payment_requests').update({ status: 'pending' }).eq('id', pr.id).eq('status', 'processing');
          }
        }
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

    // Charge API terminal failure statuses — matches Paystack's documented
    // charge lifecycle (pending/send_pin/send_otp/send_phone/send_birthday/
    // open_url/pay_offline are all still-in-progress states, not failures).
    if (paystackStatus === 'failed' || paystackStatus === 'timeout' || paystackStatus === 'abandoned' || paystackStatus === 'reversed') {
      await supabase.from('payment_requests').update({
        status: 'declined',
        paystack_status: paystackStatus,
        notes: (pr.notes || '') + ` | Paystack reported: ${paystackStatus}`,
      }).eq('id', pr.id).eq('status', 'pending');
      return new Response(JSON.stringify({ status: 'declined' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Still in progress (pending, send_pin, send_otp, pay_offline, etc.) —
    // customer likely still has the STK prompt open.
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
