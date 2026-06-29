// supabase/functions/paystack-charge/index.ts
// Initiates a Paystack M-Pesa mobile money charge (STK Push equivalent)
// Called from the browser billing cart — secret key never exposed to client

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

    // Load Paystack secret key from platform_settings
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: ps } = await supabase
      .from('platform_settings')
      .select('paystack_secret_key, paystack_enabled')
      .single();

    if (!ps?.paystack_enabled || !ps?.paystack_secret_key) {
      return new Response(JSON.stringify({ error: 'Paystack not enabled' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Format phone to international (254XXXXXXXXX)
    let phone254 = phone.toString().replace(/\s+/g, '').replace(/[^0-9]/g, '');
    if (phone254.startsWith('0')) phone254 = '254' + phone254.slice(1);
    if (!phone254.startsWith('254')) phone254 = '254' + phone254;

    // Create a pending payment_request so webhook can match it
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

    if (prErr) throw new Error(prErr.message);

    // Initiate Paystack mobile money charge
    const paystackRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ps.paystack_secret_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(parseFloat(amount) * 100), // Paystack uses kobo/cents (KES * 100)
        currency: 'KES',
        mobile_money: {
          phone: phone254,
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
      })
    });

    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      // Clean up the payment_request if Paystack rejected it
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({ error: paystackData.message || 'Paystack charge failed' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update payment_request with Paystack reference
    await supabase.from('payment_requests')
      .update({ paystack_ref: paystackData.data?.reference || ref })
      .eq('id', pr.id);

    return new Response(JSON.stringify({
      success: true,
      reference: paystackData.data?.reference || ref,
      payment_request_id: pr.id,
      display_text: paystackData.data?.display_text || 'Check your phone for an M-Pesa prompt',
      status: paystackData.data?.status,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
