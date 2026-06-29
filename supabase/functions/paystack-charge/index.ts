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
      return new Response(JSON.stringify({ error: 'Paystack not enabled. Check SA Platform Settings.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normalise phone — Paystack Kenya M-Pesa wants 07XXXXXXXXX (10 digits local)
    let phoneLocal = phone.toString().replace(/\D/g, '');
    if (phoneLocal.startsWith('254')) phoneLocal = '0' + phoneLocal.slice(3);
    if (phoneLocal.startsWith('0254')) phoneLocal = '0' + phoneLocal.slice(4);
    if (!/^(07|01)\d{8}$/.test(phoneLocal)) {
      return new Response(JSON.stringify({ error: `Phone must be 07XXXXXXXX or 01XXXXXXXX format. Got: ${phoneLocal}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

    // Call Paystack Charge API
    const chargeBody = {
      email,
      amount: Math.round(parseFloat(amount) * 100), // kobo
      currency: 'KES',
      mobile_money: {
        phone: phoneLocal,
        provider: 'mpesa',
      },
      reference: ref,
      metadata: {
        payment_request_id: pr.id,
        org_id,
        custom_fields: [
          { display_name: 'Org', variable_name: 'org_id', value: org_id },
          { display_name: 'Type', variable_name: 'payment_type', value: payment_type || 'subscription' },
        ]
      }
    };

    console.log('[GY360] Paystack charge body:', JSON.stringify(chargeBody));

    const paystackRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ps.paystack_secret_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chargeBody)
    });

    const paystackData = await paystackRes.json();
    console.log('[GY360] Paystack response:', JSON.stringify(paystackData));

    if (!paystackData.status) {
      // Clean up payment_request
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      // Return Paystack's exact error so we can debug
      return new Response(JSON.stringify({
        error: paystackData.message || 'Paystack rejected the charge',
        paystack_code: paystackData.code,
        paystack_raw: paystackData
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update ref if Paystack assigned a different one
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
    console.error('[GY360] paystack-charge error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
