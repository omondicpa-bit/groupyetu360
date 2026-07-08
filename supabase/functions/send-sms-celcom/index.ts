// Supabase Edge Function: send-sms-celcom
// Proxies SMS requests to Celcom Africa API (browser calls blocked by CORS)
// Credentials are read server-side from platform_settings using the service role key,
// bypassing RLS — this is what lets ANY org admin trigger SMS without needing read
// access to platform_settings themselves (that table is correctly superadmin-only now).
// Deploy: supabase functions deploy send-sms-celcom

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message, recipients, org_id } = await req.json();

    if (!message || !recipients?.length) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Missing message or recipients' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!org_id) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Missing org_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Verify the caller is a real, logged-in member of org_id — this
    // function used to accept only { message, recipients } with no auth
    // check and no org_id at all, meaning anyone with the URL could send
    // arbitrary SMS at the platform's expense, attributed to no org.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service-role client — bypasses RLS, reads platform_settings regardless of caller's role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: membership } = await supabase
      .from('user_orgs')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('org_id', org_id)
      .maybeSingle();
    if (!membership) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Forbidden — not a member of this organisation' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // NOTE: this confirms membership only, not remaining sms_bundle balance.
    // The client still calls trackSmsUsage() separately, after the fact, to
    // deduct — sending and deduction are not yet one atomic server-side step.
    // Flagged in SECURITY_AUDIT_2026-07-08.md as a follow-up needing a design
    // decision (e.g. should sending hard-block at 0 balance?) before changing.

    const { data: ps, error: psError } = await supabase
      .from('platform_settings')
      .select('celcom_api_key, celcom_partner_id, celcom_shortcode')
      .maybeSingle();

    if (psError || !ps?.celcom_api_key || !ps?.celcom_partner_id) {
      return new Response(
        JSON.stringify({ sent: 0, failed: recipients.length, error: 'Celcom credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mobile = recipients.join(',');

    const payload = {
      apikey: ps.celcom_api_key,
      partnerID: ps.celcom_partner_id,
      shortcode: ps.celcom_shortcode || 'EPH TECH',
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

    let sent = 0, failed = 0;
    if (result?.responses?.length) {
      result.responses.forEach((r: any) => {
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
