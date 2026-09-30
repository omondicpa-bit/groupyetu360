// supabase/functions/_shared/creditDarajaContribution.ts
//
// Wraps the same creditMemberContribution() Paystack and SasaPay already
// use, so a contribution collected via Daraja gets exactly the same
// transactions, member balance updates, and SMS/push confirmation as any
// other provider - no second, drifting copy of that logic. bank_balance
// credits at this point too, immediately, matching every other provider;
// see the migration's own note on why that's correct and not deferred
// until the real payout completes.
//
// What's new here, on top of the shared crediting: this is the only
// provider that can also pay the group out automatically, so this
// additionally creates the settlement tracking rows (one for the regular
// portion, one for welfare, whichever apply) and, if autopilot is on,
// fires the real payout immediately.

import { creditMemberContribution } from './creditMemberContribution.ts';
import { getDarajaConfig, getDarajaInitiatorConfig } from './darajaClient.ts';
import { processSettlement } from './darajaPayoutProcessing.ts';

export async function creditDarajaContribution(supabase: any, pr: any, reference: string) {
  await creditMemberContribution(supabase, pr, reference);

  let allocations: any[] = [];
  try { allocations = JSON.parse(pr.allocations || '[]'); } catch (_e) { /* nothing to settle */ }
  if (!allocations.length) return;

  const netRegular = allocations.filter((a) => !(a.isWelfare && a.eventId)).reduce((s, a) => s + Number(a.amount || 0), 0);
  const netWelfare = allocations.filter((a) => a.isWelfare && a.eventId).reduce((s, a) => s + Number(a.amount || 0), 0);

  const rowsToInsert: any[] = [];
  if (netRegular > 0) rowsToInsert.push({ payment_request_id: pr.id, org_id: pr.org_id, fund_type: 'regular', amount: netRegular });
  if (netWelfare > 0) rowsToInsert.push({ payment_request_id: pr.id, org_id: pr.org_id, fund_type: 'welfare', amount: netWelfare });
  if (!rowsToInsert.length) return;

  const { data: inserted, error: insErr } = await supabase
    .from('payment_settlements').insert(rowsToInsert).select();
  if (insErr) {
    // The contribution itself is already fully and correctly credited above
    // - a failure here only means these amounts won't show up for
    // autopilot or the Payouts page yet, not that anything about the
    // member's payment is wrong. Logged for SA to notice and create
    // manually if it ever happens, not retried blindly here.
    console.error('[creditDarajaContribution] Could not create settlement rows:', insErr.message);
    return;
  }

  const { data: ps } = await supabase.from('platform_settings').select('daraja_autopilot_enabled').maybeSingle();
  if (!ps?.daraja_autopilot_enabled) return;

  let cfg, initCfg;
  try {
    cfg = getDarajaConfig();
    initCfg = getDarajaInitiatorConfig();
  } catch (e: any) {
    console.error('[creditDarajaContribution] Autopilot is on but Daraja payout secrets are not configured:', e?.message);
    return;
  }

  for (const settlement of inserted || []) {
    try {
      await processSettlement(supabase, settlement, cfg, initCfg);
    } catch (e: any) {
      console.error('[creditDarajaContribution] Autopilot payout attempt failed for settlement', settlement.id, ':', e?.message);
    }
  }
}
