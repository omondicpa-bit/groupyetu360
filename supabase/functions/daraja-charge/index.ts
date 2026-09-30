// supabase/functions/daraja-charge/index.ts
//
// Starts an M-Pesa Express (STK Push) prompt on EPH's own Paybill. Two
// kinds of charge go through here now:
//   - Platform billing (subscription/SMS bundles) - validated against
//     billingPrices.ts's fixed price list, same as always.
//   - Member contributions - validated against darajaContributionValidation.ts,
//     which grosses up whatever the member is contributing by the real
//     settlement fee for wherever that money has to end up, so the group
//     receives their contribution untouched (see darajaSettlementFees.ts).
//
// Same request and response contract as paystack-charge for the
// member-contribution case, so the billing/contribution checkout code only
// has to pick a different function name.
//
// Deploy normally (it authenticates the logged-in caller itself):
//   supabase functions deploy daraja-charge

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildCallbackUrl, DarajaConfigError, getDarajaConfig, normalisePhone, stkPush,
} from '../_shared/darajaClient.ts';
import { validateBillingCart } from '../_shared/billingPrices.ts';
import { validateDarajaContribution } from '../_shared/darajaContributionValidation.ts';
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
    const { org_id, amount, phone, payment_type, notes, member_id, allocations } = payload || {};
    if (!org_id || !amount || !phone) return json({ error: 'Missing required fields' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const access = await authorizeOrgAccess(req, supabase, createClient, org_id);
    if (!access.ok) return json({ error: access.error }, access.status);

    const isContribution = payment_type === 'member_contribution';
    let expectedAmount: number;
    let storedAllocations: string | null = null;

    if (isContribution) {
      const { data: org, error: orgErr } = await supabase
        .from('organisations')
        .select('disbursement_method, welfare_disbursement_method')
        .eq('id', org_id).maybeSingle();
      if (orgErr || !org) return json({ error: 'Could not load organisation settlement settings.' }, 500);

      const result = validateDarajaContribution(allocations, amount, org);
      if (!result.ok) return json({ error: result.error }, 400);
      expectedAmount = result.grossTotal;
      storedAllocations = JSON.stringify(result.allocations);
    } else {
      // Only subscription and SMS billing goes through this path. The
      // amount is checked against the server's own price list, not
      // trusted from the client.
      const cart = validateBillingCart(payment_type, notes, amount);
      if (!cart.ok) return json({ error: cart.error }, 400);
      expectedAmount = cart.expected;
    }

    const phone254 = normalisePhone(phone);
    if (!phone254) return json({ error: 'Enter a valid Safaricom number, for example 0712 345 678.' }, 400);

    let cfg;
    try {
      cfg = getDarajaConfig();
    } catch (e) {
      if (e instanceof DarajaConfigError) {
        console.error('[daraja-charge]', e.message);
        return json({ error: 'Safaricom billing is not available right now. Please try again later or contact support.' }, 503);
      }
      throw e;
    }

    // Light abuse guard: a stranger with a login could otherwise fire repeated
    // prompts at someone's phone under the GroupYetu360 name. Fails open if the
    // check itself cannot run, so it can never block a genuine payment.
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count, error: rlErr } = await supabase
        .from('payment_requests')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org_id).eq('provider', 'daraja').eq('status', 'pending')
        .gte('created_at', since);
      if (!rlErr && (count ?? 0) >= 5) {
        return json({ error: 'Too many payment prompts in a short time. Please wait a few minutes and try again.' }, 429);
      }
    } catch (_e) { /* fail open */ }

    const ref = 'GYD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const { data: pr, error: prErr } = await supabase.from('payment_requests').insert({
      org_id,
      member_id: member_id || null,
      payment_type: payment_type || (isContribution ? 'member_contribution' : 'subscription'),
      provider: 'daraja',
      amount: expectedAmount,
      mpesa_ref: ref,
      paystack_ref: ref, // the generic "provider reference" column, replaced by Safaricom's id below
      paystack_status: 'pending',
      status: 'pending',
      notes: notes || '',
      payment_date: new Date().toISOString().split('T')[0],
      allocations: storedAllocations,
    }).select('id').single();
    if (prErr) throw new Error('DB error: ' + prErr.message);

    let push;
    try {
      push = await stkPush(cfg, {
        amount: expectedAmount,
        phone: phone254,
        callbackUrl: buildCallbackUrl(),
        accountRef: 'GY360-' + String(org_id).replace(/-/g, '').slice(0, 6), // 12 characters
        desc: isContribution ? 'GY360 contrib' : 'GY360 billing',            // 13 characters
      });
    } catch (e: any) {
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      console.error('[daraja-charge] STK Push failed:', e?.message, JSON.stringify(e?.detail ?? {}));
      return json({ error: `Safaricom: ${e?.message || 'the prompt could not be sent'}` }, 502);
    }

    // Save Safaricom's CheckoutRequestID so the callback can find this row.
    let saved = false;
    for (let i = 0; i < 3 && !saved; i++) {
      const { error } = await supabase.from('payment_requests')
        .update({ paystack_ref: push.checkoutRequestId }).eq('id', pr.id);
      if (!error) saved = true;
    }
    if (!saved) {
      console.error('[daraja-charge] Could not save CheckoutRequestID for', pr.id, push.checkoutRequestId);
      return json({ error: 'The prompt was sent but could not be tracked. Do not pay, and contact support.' }, 500);
    }

    return json({
      success: true,
      reference: push.checkoutRequestId,
      payment_request_id: pr.id,
      display_text: push.customerMessage || 'Check your phone for an M-Pesa prompt',
    });
  } catch (err: any) {
    console.error('[daraja-charge] fatal:', err?.message);
    return json({ error: err?.message || 'Unexpected error' }, 500);
  }
});
