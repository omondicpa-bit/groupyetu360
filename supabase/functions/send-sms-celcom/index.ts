// Supabase Edge Function: send-sms-celcom
// Proxies SMS requests to Celcom Africa API (browser calls blocked by CORS)
// Deploy: supabase functions deploy send-sms-celcom

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { apikey, partnerID, shortcode, message, recipients } = await req.json();

    if (!apikey || !partnerID || !message || !recipients?.length) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Celcom accepts comma-separated mobiles or repeated calls
    // Their API sends to multiple recipients in one request
    const mobile = recipients.join(',');

    const payload = {
      apikey,
      partnerID,
      shortcode: shortcode || 'EPH TECH',
      message,
      mobile,
      messageID: Date.now().toString()
    };

    const res = await fetch('https://isms.celcomafrica.com/api/services/sendsms/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    console.log('[celcom] raw response:', JSON.stringify(result));

    // Celcom returns { responses: [{ respose-code, response-description, mobile, messageid, network-id }] }
    let sent = 0, failed = 0;
    if (result?.responses?.length) {
      result.responses.forEach((r: any) => {
        // Celcom uses 'response-code' (correct) not 'respose-code' (their old docs typo)
        const code = (r['response-code'] ?? r['respose-code'])?.toString();
        if (code === '200') sent++;
        else failed++;
      });
    } else if (res.ok) {
      sent = recipients.length;
    } else {
      failed = recipients.length;
    }

    return new Response(
      JSON.stringify({ sent, failed, raw: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    console.error('[celcom] error:', e.message);
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
