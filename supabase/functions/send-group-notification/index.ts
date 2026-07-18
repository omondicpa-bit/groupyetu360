// supabase/functions/send-group-notification/index.ts
//
// Push-notification counterpart to the existing bulk-SMS flow
// (sendSms() in modules.js) — same recipients, same message, delivered
// as a push to whichever of them also have the app installed with
// notifications enabled. SMS remains the actual send-to-everyone
// mechanism (works regardless of app install); this is purely additive,
// same "never a replacement for SMS" principle used for payment
// confirmations and everything else push-related in this project.
//
// Deliberately scoped to ORG-LEVEL communication only (an admin
// messaging their own group's members) — not a platform-wide tool.
// That's what the SA Broadcast Composer is for, with its own separate
// superadmin-only auth path.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/sendPushNotification.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { org_id, user_ids, title, body, url } = await req.json();

    if (!org_id || !Array.isArray(user_ids) || !user_ids.length || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing org_id, user_ids, title, or body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Same caller-auth pattern as every other Edge Function in this
    // project — must be an admin/treasurer/officer of this specific org,
    // or superadmin. A member sending SMS to their own group already
    // requires this same permission client-side (canDo('sendSms')); this
    // re-checks it server-side rather than trusting the client's gate.
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
    if (!membership || !['admin', 'treasurer', 'officer'].includes(membership.role)) {
      const { data: callerProfile } = await supabase
        .from('profiles').select('role').eq('id', callerUser.id).maybeSingle();
      isSuperadmin = callerProfile?.role === 'superadmin';
      if (!isSuperadmin) {
        return new Response(JSON.stringify({ error: 'Forbidden — admin/treasurer/officer only' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Only push to users who are actually members of THIS org — a caller
    // can't be handed a list of arbitrary user_ids and have them all
    // pushed to regardless of membership.
    const { data: validMembers } = await supabase
      .from('user_orgs').select('user_id').eq('org_id', org_id).in('user_id', user_ids);
    const validUserIds = (validMembers || []).map((m: any) => m.user_id);

    if (!validUserIds.length) {
      return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, note: 'No valid org members among the given user_ids' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await sendPushNotification(supabase, validUserIds, title, body, url || '/');

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 Group Notification] fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
