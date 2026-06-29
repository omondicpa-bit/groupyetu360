// supabase/functions/paystack-charge/index.ts
// Initiates a Paystack M-Pesa mobile money charge (STK Push)
// Called from the browser — secret key stays server-side

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
      return new Response(JSON.stringify({ error: 'Paystack not enabled on this platform' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Paystack Kenya M-Pesa requires 07XXXXXXXXX or 01XXXXXXXXX (10 digits, local format)
    let phoneLocal = phone.toString().replace(/\s+/g, '').replace(/[^0-9]/g, '');
    // Strip leading + or country code 254
    if (phoneLocal.startsWith('254')) phoneLocal = '0' + phoneLocal.slice(3);
    if (phoneLocal.startsWith('+254')) phoneLocal = '0' + phoneLocal.slice(4);
    // Must start with 07 or 01 and be 10 digits
    if (!/^(07|01)\d{8}$/.test(phoneLocal)) {
      return new Response(JSON.stringify({ error: `Invalid M-Pesa number: ${phoneLocal}. Use format 07XXXXXXXX.` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create pending payment_request first so webhook can match it
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

    if (prErr) throw new Error('Failed to create payment record: ' + prErr.message);

    // Call Paystack Charge API
    const paystackRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ps.paystack_secret_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(parseFloat(amount) * 100), // Paystack uses kobo (KES × 100)
        currency: 'KES',
        mobile_money: {
          phone: phoneLocal,    // Local format: 07XXXXXXXX
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
    console.log('[GY360 paystack-charge] Paystack response:', JSON.stringify(paystackData));

    if (!paystackData.status) {
      // Clean up failed payment_request
      await supabase.from('payment_requests').delete().eq('id', pr.id);
      return new Response(JSON.stringify({
        error: paystackData.message || 'Paystack rejected the charge request'
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update with actual Paystack reference if different
    const finalRef = paystackData.data?.reference || ref;
    if (finalRef !== ref) {
      await supabase.from('payment_requests').update({ paystack_ref: finalRef }).eq('id', pr.id);
    }

    return new Response(JSON.stringify({
      success: true,
      reference: finalRef,
      payment_request_id: pr.id,
      display_text: paystackData.data?.display_text || 'Check your phone for an M-Pesa STK prompt',
      status: paystackData.data?.status,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[GY360 paystack-charge] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
