// supabase/functions/paystack-charge/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { org_id, amount, phone, email, payment_type, notes, member_id } = await req.json();

    if (!org_id || !amount || !phone || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: ps } = await supabase
      .from('platform_settings')
      .select('paystack_secret_key, paystack_enabled')
      .single();

    if (!ps?.paystack_enabled || !ps?.paystack_secret_key) {
      return new Response(JSON.stringify({ error: 'Paystack not enabled. Configure in SA Platform Settings.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
      amount: parseFloat(amount),
      mpesa_ref: ref,
      paystack_ref: ref,
      paystack_status: 'pending',
      status: 'pending',
      notes: notes || '',
      payment_date: new Date().toISOString().split('T')[0],
    }).select('id').single();

    if (prErr) throw new Error('DB error: ' + prErr.message);

    // Paystack Charge — mobile_money for KES
    const chargeBody = {
      email,
      amount: Math.round(parseFloat(amount) * 100), // kobo/cents
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
