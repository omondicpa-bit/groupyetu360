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
    const { message, recipients, org_id, platform } = await req.json();

    if (!message || !recipients?.length) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Missing message or recipients' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // platform: true = a message from EPH itself (superadmin only, checked
    // below), e.g. welcoming people who signed up but have no group yet.
    // It belongs to no group, so no org_id and no group label.
    if (!org_id && platform !== true) {
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

    const { data: membership } = org_id ? await supabase
      .from('user_orgs')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('org_id', org_id)
      .maybeSingle() : { data: null };

    let isSuperadmin = false;
    if (!membership) {
      const { data: callerProfile } = await supabase
        .from('profiles').select('role').eq('id', callerUser.id).maybeSingle();
      isSuperadmin = callerProfile?.role === 'superadmin';
    }

    if (platform === true && !isSuperadmin) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Forbidden: platform messages are superadmin only' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!membership && !isSuperadmin) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Forbidden — not a member of this organisation' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // Only officials send group SMS (audit, Oct 2026: any member could call
    // this directly and spend the group's credit).
    if (!isSuperadmin && !['admin', 'treasurer', 'officer'].includes(String(membership?.role || ''))) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, error: 'Only group officials can send SMS.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // Credit is checked and used up here, on the server. The browser can no
    // longer change sms_bundle upwards (plan guard), and treasurers/officers
    // cannot update the organisation row at all, so deduction must live here.
    const billOrg = !!org_id && platform !== true && !isSuperadmin;
    if (billOrg) {
      const { data: bal } = await supabase.from('organisations').select('sms_bundle').eq('id', org_id).maybeSingle();
      if (Number(bal?.sms_bundle || 0) < recipients.length) {
        return new Response(
          JSON.stringify({ sent: 0, failed: 0, error: `Not enough SMS credit: ${Number(bal?.sms_bundle || 0)} left for ${recipients.length} recipients. Buy a bundle in Plan & billing.` }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    // Prefix the group's short label onto the message, so members know which
    // group texted them - the sender ID on every SMS is the single shared
    // "EPH TECH" shortcode above, not each group's own name, so without this
    // a member has no way to tell which of their groups sent it. Skipped
    // entirely if the group hasn't set a label yet (existing groups start
    // blank until SA sets one - see HANDOVER), and skipped if the message
    // already mentions the label, so it's never duplicated.
    let outgoingMessage = message;
    const { data: orgRow } = org_id ? await supabase
      .from('organisations').select('sms_label').eq('id', org_id).maybeSingle() : { data: null };
    // Platform messages from EPH carry the GroupYetu360 label, the same way
    // group messages carry the group's own label.
    const label = platform === true ? 'GroupYetu360' : orgRow?.sms_label?.trim();
    // Group messages: skip the label if the text already mentions the group.
    // Platform messages always mention GroupYetu360 in the body, so there
    // the label is only skipped if the text already starts with it.
    const alreadyLabelled = platform === true
      ? message.trim().toLowerCase().startsWith(String(label).toLowerCase() + ':')
      : !!label && message.toLowerCase().includes(String(label).toLowerCase());
    if (label && !alreadyLabelled) {
      outgoingMessage = `${label}:\n\n${message}`;
    }

    const mobile = recipients.join(',');

    const payload = {
      apikey: ps.celcom_api_key,
      partnerID: ps.celcom_partner_id,
      shortcode: ps.celcom_shortcode || 'EPH TECH',
      message: outgoingMessage,
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

    if (billOrg && sent > 0) {
      try {
        const { data: org } = await supabase.from('organisations')
          .select('sms_bundle, sms_used, two_fa_enabled').eq('id', org_id).maybeSingle();
        if (org) {
          const newBundle = Math.max(0, Number(org.sms_bundle || 0) - sent);
          const upd: Record<string, unknown> = { sms_bundle: newBundle, sms_used: Number(org.sms_used || 0) + sent };
          if (newBundle === 0 && org.two_fa_enabled) upd.two_fa_enabled = false;  // never lock admins out
          await supabase.from('organisations').update(upd).eq('id', org_id);
        }
        const month = new Date().toISOString().slice(0, 7);
        const { data: usage } = await supabase.from('sms_usage').select('id, messages_sent').eq('org_id', org_id).eq('month', month).maybeSingle();
        if (usage) await supabase.from('sms_usage').update({ messages_sent: Number(usage.messages_sent || 0) + sent }).eq('id', usage.id);
        else await supabase.from('sms_usage').insert({ org_id, month, messages_sent: sent });
      } catch (e) { console.error('[send-sms-celcom] usage update failed:', (e as Error).message); }
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
