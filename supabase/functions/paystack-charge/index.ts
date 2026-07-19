// supabase/functions/paystack-charge/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mirrors calculateGrossCharge() in utils.js exactly — given the net amount an
// org must receive, computes the gross member charge and the exact flat fee
// (transaction_charge) that guarantees gross - transactionCharge = net, by
// construction, with zero rounding drift. Kept here so the server can
// independently verify/recompute this instead of trusting client-supplied
// numbers for a subaccount split — a tampered client could otherwise
// under-report EPH's cut (the org still always gets its net amount either
// way, since that's enforced by Paystack's own split math against whatever
// transactionCharge is actually sent — this closes the gap on EPH's margin
// specifically, not on org/member safety, which was already sound).
function calculateGrossCharge(netAmount: number, platformFeePercent: number, paystackFeePercent: number) {
  const totalRate = (platformFeePercent + paystackFeePercent) / 100;
  if (totalRate >= 1) throw new Error('Fee rates cannot total 100% or more');
  const grossExact = netAmount / (1 - totalRate);
  const gross = Math.ceil(grossExact);
  const fee = gross - netAmount;
  return { netAmount, gross, fee, transactionCharge: fee };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      org_id, amount, phone, email, payment_type, notes, member_id,
      subaccount, bearer, allocations
    } = await req.json();

    if (!org_id || !amount || !phone || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Verify the caller is a real, logged-in user, and that they actually
    // belong to org_id — this Edge Function used to trust org_id/amount/phone
    // from the raw request body with no auth check at all, meaning anyone who
    // found this URL could trigger a real M-Pesa charge attributed to any org.
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

    // Confirm the caller actually belongs to this org before letting them
    // trigger a charge attributed to it.
    const { data: membership } = await supabase
      .from('user_orgs')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('org_id', org_id)
      .maybeSingle();

    // Superadmin doesn't have a user_orgs row for every org (access comes from
    // profiles.role = 'superadmin' instead) — without this check, SA's own
    // legitimate support actions would be incorrectly blocked by the
    // membership check above.
    let isSuperadmin = false;
    if (!membership) {
      const { data: callerProfile } = await supabase
        .from('profiles').select('role').eq('id', callerUser.id).maybeSingle();
      isSuperadmin = callerProfile?.role === 'superadmin';
    }

    if (!membership && !isSuperadmin) {
      return new Response(JSON.stringify({ error: 'Forbidden — not a member of this organisation' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: ps } = await supabase
      .from('platform_settings')
      .select('paystack_secret_key, paystack_enabled, platform_fee_percent, paystack_fee_percent')
      .single();

    if (!ps?.paystack_enabled || !ps?.paystack_secret_key) {
      return new Response(JSON.stringify({ error: 'Paystack not enabled. Configure in SA Platform Settings.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Member-contribution subaccount charges: recompute the fee split
    // server-side rather than trusting the client's gross/transaction_charge.
    // The client sends `amount` (its own gross-up calculation, used purely to
    // drive its UI) and `allocations` (the real net breakdown the member
    // chose) — here we IGNORE the client's `amount` entirely for this path,
    // sum `allocations` for the true net amount, and independently derive the
    // gross charge + fee from the platform's own fee rates. This is what
    // actually gets sent to Paystack, so a tampered client can't under-report
    // EPH's cut — it can't even successfully pass a manipulated split, since
    // the server never looks at a client-supplied transaction_charge at all.
    let finalAmount = parseFloat(amount);
    let finalTransactionCharge: number | undefined;
    let netAmountForRecord: number | null = null;

    if (subaccount) {
      let parsedAllocations: Array<{ amount?: number }> = [];
      try { parsedAllocations = JSON.parse(allocations || '[]'); } catch (e) { /* falls through to validation below */ }

      const netAmount = parsedAllocations.reduce((s, a) => s + Number(a.amount || 0), 0);
      if (!netAmount || netAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Missing or invalid allocations for a subaccount charge' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const platformFeePercent = ps.platform_fee_percent != null ? Number(ps.platform_fee_percent) : 0.5;
      const paystackFeePercent = ps.paystack_fee_percent != null ? Number(ps.paystack_fee_percent) : 1.5;
      const calc = calculateGrossCharge(netAmount, platformFeePercent, paystackFeePercent);

      finalAmount = calc.gross;
      finalTransactionCharge = calc.transactionCharge;
      netAmountForRecord = calc.netAmount;

      console.log('[GY360] Server-recomputed subaccount split:', JSON.stringify(calc), '(client sent amount:', amount, ')');
    }

    // Paystack Kenya M-Pesa: phone must be in format +2547XXXXXXXX (E.164 with +)
    let phoneE164 = phone.toString().replace(/\D/g, '');
    if (phoneE164.startsWith('0')) phoneE164 = '254' + phoneE164.slice(1);
    if (!phoneE164.startsWith('254')) phoneE164 = '254' + phoneE164;
    phoneE164 = '+' + phoneE164; // Paystack requires the + prefix

    console.log('[GY360] Phone normalised to:', phoneE164);

    // Create pending payment_request
    const ref = 'GY-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const { data: pr, error: prErr } = await supabase.from('payment_requests').insert({
      org_id,
      member_id: member_id || null,
      payment_type: payment_type || 'subscription',
      amount: finalAmount,
      provider: 'paystack',
      mpesa_ref: ref,
      paystack_ref: ref,
      paystack_status: 'pending',
      status: 'pending',
      notes: notes || '',
      payment_date: new Date().toISOString().split('T')[0],
      // Passed through as-is (already JSON.stringify'd by the client) so
      // approvePaymentRequest() in finance.js can parse it exactly like the
      // manual "Report a Payment" flow already does — this is what makes the
      // right contribution type + net amount actually get credited instead
      // of falling into that function's "no allocations" generic fallback.
      allocations: allocations || null,
    }).select('id').single();

    if (prErr) throw new Error('DB error: ' + prErr.message);

    // Paystack Charge — mobile_money for KES
    const chargeBody: Record<string, unknown> = {
      email,
      amount: Math.round(finalAmount * 100), // kobo/cents
      currency: 'KES',
      mobile_money: {
        phone: phoneE164,
        provider: 'mpesa',
      },
      reference: ref,
      metadata: {
        payment_request_id: pr.id,
        org_id,
        custom_fields: [
          { display_name: 'Organisation', variable_name: 'org_id', value: org_id },
          { display_name: 'Payment Type', variable_name: 'payment_type', value: payment_type || 'subscription' },
        ]
      }
    };

    // Only attached when a subaccount is provided — every existing caller
    // (platform subscription/SMS billing) never sends one, so this leaves
    // that flow completely unchanged.
    if (subaccount) {
      chargeBody.subaccount = subaccount;
      chargeBody.bearer = bearer || 'account';
      if (finalTransactionCharge != null) {
        chargeBody.transaction_charge = Math.round(finalTransactionCharge * 100);
      }
    }

    console.log('[GY360] Paystack charge request:', JSON.stringify(chargeBody));

    const paystackRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ps.paystack_secret_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chargeBody)
    });

    const paystackData = await paystackRes.json();
    console.log('[GY360] Paystack response status:', paystackRes.status);
    console.log('[GY360] Paystack response body:', JSON.stringify(paystackData));

    if (!paystackData.status) {
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({
        error: `Paystack: ${paystackData.message || 'Unknown error'}`,
        debug: { code: paystackData.code, data: paystackData.data, phone_sent: phoneE164 }
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const finalRef = paystackData.data?.reference || ref;
    if (finalRef !== ref) {
      await supabase.from('payment_requests').update({ paystack_ref: finalRef }).eq('id', pr.id);
    }

    return new Response(JSON.stringify({
      success: true,
      reference: finalRef,
      payment_request_id: pr.id,
      display_text: paystackData.data?.display_text || 'Check your phone for an M-Pesa prompt',
      status: paystackData.data?.status,
      net_amount: netAmountForRecord, // for the client to display in its confirmation state, if useful
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[GY360] paystack-charge fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
