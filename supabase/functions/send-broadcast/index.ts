// supabase/functions/send-broadcast/index.ts
//
// Superadmin-only platform-wide broadcast tool. Separate from automatic
// payment notifications (those go through creditMemberContribution.ts
// directly) — this is the manual composer for announcements, maintenance
// notices, etc., sent to all users, selected organisations, or selected
// individual members.

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
    const { title, body, url, target_type, target_ids } = await req.json();

    if (!title || !body || !target_type) {
      return new Response(JSON.stringify({ error: 'Missing title, body, or target_type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!['all', 'orgs', 'members'].includes(target_type)) {
      return new Response(JSON.stringify({ error: 'target_type must be all, orgs, or members' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Superadmin-only — same caller-auth pattern used throughout this
    // project's Edge Functions. This one is more consequential than most
    // (it can message every user on the platform at once), so the check
    // is not optional.
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

    const { data: callerProfile } = await supabase.from('profiles')
      .select('role').eq('id', callerUser.id).maybeSingle();
    if (callerProfile?.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden — superadmin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Resolve target_type into an actual list of user IDs ──
    let userIds: string[] = [];

    if (target_type === 'all') {
      const { data } = await supabase.from('profiles').select('id');
      userIds = (data || []).map((r: any) => r.id);

    } else if (target_type === 'orgs') {
      if (!Array.isArray(target_ids) || !target_ids.length) {
        return new Response(JSON.stringify({ error: 'target_ids required for orgs' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const { data } = await supabase.from('user_orgs').select('user_id').in('org_id', target_ids);
      userIds = (data || []).map((r: any) => r.user_id);

    } else if (target_type === 'members') {
      if (!Array.isArray(target_ids) || !target_ids.length) {
        return new Response(JSON.stringify({ error: 'target_ids required for members' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      // target_ids here are members.id — resolve to their linked auth user, if any
      const { data } = await supabase.from('members').select('user_id').in('id', target_ids).not('user_id', 'is', null);
      userIds = (data || []).map((r: any) => r.user_id);
    }

    userIds = [...new Set(userIds.filter(Boolean))];

    const result = await sendPushNotification(supabase, userIds, title, body, url);

    await supabase.from('broadcast_log').insert({
      sent_by: callerUser.id,
      title, body,
      target_type,
      target_ids: target_ids || null,
      recipient_count: userIds.length,
      sent_count: result.sent,
      failed_count: result.failed,
    });

    return new Response(JSON.stringify({
      success: true,
      recipient_count: userIds.length,
      sent: result.sent,
      failed: result.failed,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[GY360 Broadcast] fatal:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
