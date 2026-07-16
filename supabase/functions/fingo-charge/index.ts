// supabase/functions/fingo-charge/index.ts
//
// Fingo Pay equivalent of paystack-charge — same security posture (caller
// auth + org-membership check), same "never trust the client for money-
// routing fields" principle, adapted to Fingo's actual API (confirmed
// against docs.fingopay.io, not guessed):
//   POST https://api.fingopay.io/v1/mpesa/charge
//   Auth: Bearer <api key>, Idempotency-Key header (required in live)
//   Body: { merchantTransactionId, amount (cents), phoneNumber, narration,
//           subMerchantId, webhookUrl? }
//
// IMPORTANT DIFFERENCE FROM PAYSTACK: Fingo's charge has no equivalent of
// Paystack's `transaction_charge`/`bearer` automatic split — subMerchantId
// is purely for internal tagging/reporting. The FULL gross amount lands in
// EPH's own Fingo account; moving the org's share out is a separate,
// currently-manual disbursement step (per the deliberate "prove it works
// before automating" decision), not something this function does.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Same gross-up logic as calculateFingoGrossCharge() in utils.js — kept in
// sync manually, same reasoning as creditMemberContribution's duplication
// note: Deno Edge Functions can't easily share non-DB logic with the
// browser bundle the way _shared/ shares logic between two Edge Functions.
const FINGO_FEE_BANDS: [number, number, number][] = [
  [1, 49, 2], [50, 100, 2], [101, 500, 5], [501, 1000, 9],
  [1001, 1500, 14], [1501, 2500, 22], [2501, 3500, 16], [3501, 5000, 21],
  [5001, 7500, 26], [7501, 10000, 29], [10001, 15000, 69], [15001, 20000, 75],
  [20001, 25000, 81], [25001, 30000, 87],
];
function fingoBaseFeeForAmount(amount: number): number {
  for (const [min, max, fee] of FINGO_FEE_BANDS) if (amount >= min && amount <= max) return fee;
  return FINGO_FEE_BANDS[FINGO_FEE_BANDS.length - 1][2];
}
function calculateFingoGrossCharge(netAmount: number, feeMultiplier: number) {
  let gross = netAmount;
  for (let i = 0; i < 6; i++) {
    const baseFee = fingoBaseFeeForAmount(gross);
    const totalFee = Math.round(baseFee * feeMultiplier);
    const newGross = netAmount + totalFee;
    if (newGross === gross) break;
    gross = newGross;
  }
  const baseFee = fingoBaseFeeForAmount(gross);
  const totalFee = Math.round(baseFee * feeMultiplier);
  return { netAmount, gross: netAmount + totalFee, fee: totalFee };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { org_id, phone, payment_type, notes, member_id, allocations } = await req.json();

    if (!org_id || !phone) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Same caller-auth + org-membership check as paystack-charge ──
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

    const { data: membership } = await supabase
      .from('user_orgs').select('role').eq('user_id', callerUser.id).eq('org_id', org_id).maybeSingle();
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

    // ── Server looks up the org's Fingo sub-merchant itself — never trusts
    // a client-supplied subMerchantId, same principle as recomputing the
    // fee split server-side in paystack-charge. ──
    const { data: providerRow } = await supabase
      .from('org_payment_providers').select('provider_account_ref')
      .eq('org_id', org_id).eq('provider', 'fingo').maybeSingle();
    if (!providerRow?.provider_account_ref) {
      return new Response(JSON.stringify({ error: 'Fingo is not configured for this organisation' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const subMerchantId = providerRow.provider_account_ref;

    const { data: ps } = await supabase.from('platform_settings')
      .select('fingo_api_key, fingo_fee_multiplier').maybeSingle();
    if (!ps?.fingo_api_key) {
      return new Response(JSON.stringify({ error: 'Fingo not enabled. Configure in SA Platform Settings.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const feeMultiplier = ps.fingo_fee_multiplier != null ? Number(ps.fingo_fee_multiplier) : 2.0;

    // ── Recompute the charge server-side from allocations — same
    // discipline as paystack-charge, never trust a client-supplied amount
    // for what actually gets charged. ──
    let parsedAllocations: Array<{ amount?: number }> = [];
    try { parsedAllocations = JSON.parse(allocations || '[]'); } catch (e) { /* validated below */ }
    const netAmount = parsedAllocations.reduce((s, a) => s + Number(a.amount || 0), 0);
    if (!netAmount || netAmount <= 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid allocations' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const calc = calculateFingoGrossCharge(netAmount, feeMultiplier);
    console.log('[GY360 Fingo] Server-computed charge:', JSON.stringify(calc));

    // Fingo requires whole-KES amounts (divisible by 100 in their cents
    // representation) and a minimum of KES 10 — confirmed in their OpenAPI
    // spec, not assumed.
    if (calc.gross < 10) {
      return new Response(JSON.stringify({ error: 'Amount is below Fingo\'s minimum charge of Ksh 10' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fingo phone format: +254/254/0 followed by 7 or 1 and eight digits —
    // confirmed against their published pattern, not assumed.
    let phoneNormalised = phone.toString().replace(/\D/g, '');
    if (phoneNormalised.startsWith('0')) phoneNormalised = '254' + phoneNormalised.slice(1);
    if (!phoneNormalised.startsWith('254')) phoneNormalised = '254' + phoneNormalised;
    phoneNormalised = '+' + phoneNormalised;

    const ref = 'GYF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

    const { data: pr, error: prErr } = await supabase.from('payment_requests').insert({
      org_id,
      member_id: member_id || null,
      payment_type: payment_type || 'member_contribution',
      provider: 'fingo',
      amount: calc.gross,
      mpesa_ref: ref,
      paystack_ref: ref, // reused generically as "the provider's own reference" — see v3g migration note
      paystack_status: 'pending',
      status: 'pending',
      notes: notes || '',
      payment_date: new Date().toISOString().split('T')[0],
      allocations: allocations || null,
    }).select('id').single();

    if (prErr) throw new Error('DB error: ' + prErr.message);

    const chargeBody = {
      merchantTransactionId: ref,
      amount: Math.round(calc.gross * 100), // cents, per Fingo's spec
      phoneNumber: phoneNormalised,
      narration: (notes || 'GroupYetu360 contribution').slice(0, 140),
      subMerchantId,
    };

    console.log('[GY360 Fingo] Charge request:', JSON.stringify(chargeBody));

    const fingoRes = await fetch('https://api.fingopay.io/v1/mpesa/charge', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ps.fingo_api_key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(chargeBody),
    });

    const fingoData = await fingoRes.json();
    console.log('[GY360 Fingo] Response status:', fingoRes.status, 'body:', JSON.stringify(fingoData));

    if (fingoRes.status !== 202 || fingoData?.status !== 'success') {
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({
        error: `Fingo: ${fingoData?.message || fingoData?.error?.message || 'Unknown error'}`,
        debug: fingoData,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reference: ref,
      payment_request_id: pr.id,
      display_text: 'Check your phone for an M-Pesa prompt',
      net_amount: calc.netAmount,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 Fingo] charge fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
