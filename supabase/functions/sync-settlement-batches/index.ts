// Supabase Edge Function: sync-settlement-batches
// Moves the settlement_batches reconciliation (previously run client-side in
// js/settings.js) server-side, using the service role key.
//
// Why this exists: settlement_batches only allows superadmin to insert/update
// at the RLS level (correct — it's EPH's internal settlement ledger, not
// something any org admin should be able to write to directly). That's fine
// when the superadmin's own Settlements page calls the sync, but broke
// completely for org admins: loadOrgSettlements() called the same client-side
// sync, and every insert was silently rejected with a 403 (visible only as a
// console.warn, never surfaced to the org admin) — meaning an org's
// settlement history depended entirely on whether the superadmin happened to
// have opened their own Settlements page first. Confirmed via browser console:
// "new row violates row-level security policy for table settlement_batches".
//
// This function does the exact same reconciliation logic (kept byte-for-byte
// equivalent to the old client-side syncSettlementBatches()), but running
// with the service role so it works regardless of which role calls it.
// Callers only ever get back counts, never other orgs' raw payment data, so
// there's no data-exposure concern in always reconciling every org's batches
// regardless of who triggered it.
//
// Deploy: supabase functions deploy sync-settlement-batches

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
    // ── Verify the caller is a real, logged-in user. Not scoped to a
    // specific org's membership — this function reconciles every org's
    // batches in one pass and never returns raw payment data to the caller,
    // only aggregate counts, so there's nothing org-specific to authorise
    // beyond "this is an actual logged-in account, not anonymous."
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
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
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service-role client — bypasses RLS, same reconciliation regardless of
    // whether an org admin or the superadmin triggered it.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const since = new Date(); since.setDate(since.getDate() - 60);
    const sinceStr = since.toISOString().split('T')[0];

    const { data: rows, error: rowsErr } = await supabase.from('payment_requests')
      .select('org_id, provider, payment_date, allocations')
      .in('provider', ['sasapay', 'fingo', 'paystack'])
      .eq('status', 'approved')
      .eq('payment_type', 'member_contribution')
      .gte('payment_date', sinceStr);
    if (rowsErr) {
      return new Response(
        JSON.stringify({ error: 'Could not load payment_requests: ' + rowsErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const groups: Record<string, number> = {};
    for (const row of rows || []) {
      let allocs: any[] = [];
      try { allocs = JSON.parse(row.allocations || '[]'); } catch (e) { continue; }
      for (const a of allocs) {
        if (a.isWelfare) continue; // welfare — admin requests settlement explicitly, per event
        if (a.isMGR) continue;     // MGR — auto-created server-side the moment a round completes
        const lineType = a.isTB ? 'table_banking' : 'regular';
        const key = `${row.org_id}|${row.provider}|${row.payment_date}|${lineType}`;
        groups[key] = (groups[key] || 0) + Number(a.amount || 0);
      }
    }

    const { data: existing } = await supabase.from('settlement_batches')
      .select('org_id,provider,settlement_date,line_type,status,amount')
      .in('line_type', ['regular', 'table_banking'])
      .gte('settlement_date', sinceStr);
    const existingMap: Record<string, any> = {};
    (existing || []).forEach((b: any) => {
      existingMap[`${b.org_id}|${b.provider}|${b.settlement_date}|${b.line_type}`] = b;
    });

    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    for (const [key, amount] of Object.entries(groups)) {
      const [org_id, provider, settlement_date, line_type] = key.split('|');
      const roundedAmount = Math.round(amount * 100) / 100;
      const existingBatch = existingMap[key];
      if (!existingBatch) {
        toInsert.push({ org_id, provider, settlement_date, line_type, amount: roundedAmount });
      } else if (existingBatch.status === 'pending' && Number(existingBatch.amount) !== roundedAmount) {
        toUpdate.push({ org_id, provider, settlement_date, line_type, amount: roundedAmount });
      }
    }

    let insertError: string | null = null;
    if (toInsert.length) {
      const { error } = await supabase.from('settlement_batches').insert(toInsert);
      if (error) insertError = error.message;
    }
    for (const u of toUpdate) {
      await supabase.from('settlement_batches').update({ amount: u.amount })
        .eq('org_id', u.org_id).eq('provider', u.provider)
        .eq('settlement_date', u.settlement_date).eq('line_type', u.line_type);
    }

    return new Response(
      JSON.stringify({
        inserted: toInsert.length,
        updated: toUpdate.length,
        insertError,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
