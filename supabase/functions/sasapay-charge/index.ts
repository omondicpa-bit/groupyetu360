// supabase/functions/sasapay-charge/index.ts
//
// SasaPay equivalent of paystack-charge/fingo-charge — but structurally
// different from both, per Felix's confirmed conversation with SasaPay:
// there is NO per-org sub-account/sub-shop available without separate PSP
// licensing. Every org's collections land in the SAME pooled EPH merchant
// wallet. Per-org attribution happens entirely inside GroupYetu360's own
// database (via `allocations`, same as the other providers), not via any
// SasaPay-side routing — there is none.
//
// Also handles platform subscription/SMS billing (payment_type starting
// with 'subscription_' or 'sms_bundle_'), per Felix's request to toggle
// platform billing between Paystack and SasaPay — mirrors how
// paystack-charge already handles that same payment_type shape.
//
// Built against SasaPay's actual documented API (docs.sasapay.app),
// confirmed, not guessed:
//   Auth:   GET {base_url}/api/v1/auth/token/?grant_type=client_credentials
//           Header: Authorization: Basic base64(client_id:client_secret)
//   Charge: POST {base_url}/api/v1/payments/request-payment/
//   NetworkCode 63902 = M-Pesa specifically (0 is SasaPay-wallet-only, a
//   different, OTP-based flow we don't want here).
//
// KNOWN GAP: SasaPay's docs describe no callback signature/HMAC scheme,
// unlike Paystack (SHA-512) and Fingo (SHA-256 with timestamp). The
// webhook that receives the result of this charge does a defensive
// amount + merchant-code cross-check as partial mitigation, but this is a
// real, acknowledged limitation — worth confirming directly with SasaPay's
// technical team whether an undocumented signing mechanism exists.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Same gross-up logic as calculateGrossCharge() in utils.js — SasaPay is
// percentage-based like Paystack (0.2% collection fee, per Felix's
// negotiated rate), so this mirrors Paystack's closed-form math exactly,
// not Fingo's tiered-band iteration.
function calculateGrossCharge(netAmount: number, platformFeePercent: number, sasapayFeePercent: number) {
  const totalRate = (platformFeePercent + sasapayFeePercent) / 100;
  if (totalRate >= 1) throw new Error('Fee rates cannot total 100% or more');
  const gross = Math.ceil(netAmount / (1 - totalRate));
  const fee = gross - netAmount;
  return { netAmount, gross, fee };
}

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
    const { org_id, amount, phone, payment_type, notes, member_id, allocations } = await req.json();

    if (!org_id || !phone) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Same caller-auth + org-membership check as every other provider ──
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

    const { data: ps } = await supabase.from('platform_settings')
      .select('sasapay_client_id, sasapay_client_secret, sasapay_merchant_code, sasapay_base_url, sasapay_fee_percent, sasapay_platform_fee_percent')
      .maybeSingle();

    if (!ps?.sasapay_client_id || !ps?.sasapay_client_secret || !ps?.sasapay_merchant_code) {
      return new Response(JSON.stringify({ error: 'SasaPay not configured. Set it up in SA Platform Settings.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const baseUrl = ps.sasapay_base_url || 'https://sandbox.sasapay.app';

    const isMemberContribution = payment_type === 'member_contribution';
    let finalAmount: number;

    if (isMemberContribution) {
      // Recomputed server-side from allocations — never trust a
      // client-supplied amount for money that credits a specific member's
      // ledger, same discipline as paystack-charge/fingo-charge.
      let parsedAllocations: Array<{ amount?: number }> = [];
      try { parsedAllocations = JSON.parse(allocations || '[]'); } catch (e) { /* validated below */ }
      const netAmount = parsedAllocations.reduce((s, a) => s + Number(a.amount || 0), 0);
      if (!netAmount || netAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Missing or invalid allocations' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      // SasaPay's own fee and EPH's markup are both read from real
      // Settings fields now — see calculation below.
      // Both rates now real, dedicated Settings fields — SasaPay's own fee
      // was previously hardcoded here, and EPH's markup was silently
      // reusing Paystack's shared column. Separated because SasaPay's
      // pooled-wallet + manual settlement model carries real disbursement
      // overhead Paystack's automatic settlement doesn't.
      const sasapayFeePercent = ps.sasapay_fee_percent != null ? Number(ps.sasapay_fee_percent) : 0.2;
      const platformFeePercent = ps.sasapay_platform_fee_percent != null ? Number(ps.sasapay_platform_fee_percent) : 1.3;
      const calc = calculateGrossCharge(netAmount, platformFeePercent, sasapayFeePercent);
      finalAmount = calc.gross;
      console.log('[GY360 SasaPay] Server-computed charge:', JSON.stringify(calc));
    } else {
      // Subscription/SMS billing — client-supplied amount trusted here,
      // same existing precedent as paystack-charge's non-member-contribution path.
      finalAmount = parseFloat(amount);
      if (!finalAmount || finalAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid amount' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // SasaPay phone format: 254XXXXXXXXX, no + prefix (confirmed from
    // their docs examples) — different from Paystack's +254 requirement.
    let phoneNormalised = phone.toString().replace(/\D/g, '');
    if (phoneNormalised.startsWith('0')) phoneNormalised = '254' + phoneNormalised.slice(1);
    if (!phoneNormalised.startsWith('254')) phoneNormalised = '254' + phoneNormalised;

    const ref = 'GYS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

    const { data: pr, error: prErr } = await supabase.from('payment_requests').insert({
      org_id,
      member_id: member_id || null,
      payment_type: payment_type || 'subscription',
      provider: 'sasapay',
      amount: finalAmount,
      mpesa_ref: ref,
      paystack_ref: ref, // reused generically as "the provider's own reference" — see earlier migration notes
      paystack_status: 'pending',
      status: 'pending',
      notes: notes || '',
      payment_date: new Date().toISOString().split('T')[0],
      allocations: allocations || null,
    }).select('id').single();

    if (prErr) throw new Error('DB error: ' + prErr.message);

    let accessToken: string;
    try {
      accessToken = await getSasaPayToken(baseUrl, ps.sasapay_client_id, ps.sasapay_client_secret);
    } catch (authErr: any) {
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({ error: 'SasaPay authentication failed: ' + authErr.message }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sasapay-webhook`;
    const chargeBody = {
      MerchantCode: ps.sasapay_merchant_code,
      NetworkCode: '63902', // M-Pesa specifically — confirmed from SasaPay's channel codes docs
      'Transaction Fee': 0,
      Currency: 'KES',
      Amount: finalAmount.toFixed(2),
      CallBackURL: webhookUrl,
      PhoneNumber: phoneNormalised,
      TransactionDesc: (notes || 'GroupYetu360 payment').slice(0, 100),
      AccountReference: ref,
    };

    console.log('[GY360 SasaPay] Charge request:', JSON.stringify(chargeBody));

    const chargeRes = await fetch(`${baseUrl}/api/v1/payments/request-payment/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chargeBody),
    });

    const chargeData = await chargeRes.json();
    console.log('[GY360 SasaPay] Response status:', chargeRes.status, 'body:', JSON.stringify(chargeData));

    if (!chargeData?.status) {
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({
        error: `SasaPay: ${chargeData?.detail || chargeData?.ResponseDescription || 'Unknown error'}`,
        debug: chargeData,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reference: ref,
      payment_request_id: pr.id,
      display_text: chargeData?.CustomerMessage || 'Check your phone for an M-Pesa prompt',
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 SasaPay] charge fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
