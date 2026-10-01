// supabase/functions/daraja-payout/index.ts
//
// SA clicks "Process Payout" on a pending settlement (autopilot off, or a
// failed one being retried). Same processSettlement() core autopilot uses,
// just triggered by a person instead of firing automatically.
//
// Deploy normally (it authenticates the logged-in caller itself):
//   supabase functions deploy daraja-payout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DarajaConfigError, getDarajaConfig, getDarajaInitiatorConfig } from '../_shared/darajaClient.ts';
import { processSettlement } from '../_shared/darajaPayoutProcessing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function isSuperadmin(req: Request, supabase: any): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.replace('Bearer ', '')) return false;
  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await callerClient.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return profile?.role === 'superadmin';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let payload: any;
    try { payload = await req.json(); } catch (_e) { return json({ error: 'Invalid request body' }, 400); }
    const settlementId = payload?.settlement_id;
    if (!settlementId) return json({ error: 'Missing settlement_id' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Payouts move real money out of EPH's account - superadmin only,
    // unlike ordinary org-scoped actions.
    if (!(await isSuperadmin(req, supabase))) return json({ error: 'Forbidden: superadmin only' }, 403);

    const { data: settlement } = await supabase
      .from('payment_settlements').select('*').eq('id', settlementId).maybeSingle();
    if (!settlement) return json({ error: 'Settlement not found' }, 404);
    if (settlement.status !== 'pending' && settlement.status !== 'failed') {
      return json({ error: `Cannot process a settlement with status '${settlement.status}'` }, 400);
    }
    // A retried failed settlement needs to look pending again before the
    // shared atomic claim (which only ever claims from 'pending') will
    // pick it up.
    // A payout whose outcome Safaricom never confirmed may already have been
    // paid. Retrying blind could pay twice, so SA has to say they checked.
    if (settlement.status === 'failed' && settlement.outcome_uncertain === true && payload?.confirmed_not_sent !== true) {
      return json({
        error: 'This payout\'s outcome was never confirmed by Safaricom. Check the M-Pesa portal first, and only retry if the money did not go out.',
        needs_confirmation: true,
      }, 409);
    }
    if (settlement.status === 'failed') {
      await supabase.from('payment_settlements')
        .update({ status: 'pending', failure_reason: null, outcome_uncertain: false })
        .eq('id', settlementId).eq('status', 'failed');
      if (settlement.outcome_uncertain === true) {
        await supabase.from('activity_log').insert({
          org_id: settlement.org_id, user_id: null, user_name: 'Superadmin', user_role: 'superadmin',
          action: 'UNCERTAIN PAYOUT RETRIED',
          details: `Settlement ${settlementId} (Ksh ${settlement.amount}) retried after SA confirmed the first attempt did not go out.`,
          target_type: 'settlement', target_id: settlementId, created_at: new Date().toISOString(),
        });
      }
    }

    let cfg, initCfg;
    try {
      cfg = getDarajaConfig();
      initCfg = getDarajaInitiatorConfig();
    } catch (e) {
      if (e instanceof DarajaConfigError) return json({ error: 'Daraja payout is not configured yet: ' + e.message }, 503);
      throw e;
    }

    const result = await processSettlement(supabase, settlement, cfg, initCfg);
    return json(result);
  } catch (err: any) {
    console.error('[daraja-payout] fatal:', err?.message);
    return json({ error: err?.message || 'Unexpected error' }, 500);
  }
});
