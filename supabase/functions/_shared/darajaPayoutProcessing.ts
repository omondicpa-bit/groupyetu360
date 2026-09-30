// supabase/functions/_shared/darajaPayoutProcessing.ts
//
// Fires an actual B2C or B2B payment for one payment_settlements row, and
// processes the async result Safaricom posts back. Called two ways:
//   - Automatically, the instant a Daraja contribution is credited, when
//     autopilot is on (see creditDarajaContribution.ts).
//   - Manually, when SA clicks "Process Payout" on a pending row, autopilot
//     off (see daraja-payout/index.ts).
// Both paths converge here, so there's exactly one place that can actually
// move money out, and exactly one place that decides a payout succeeded.

import { claimSettlement } from './claimSettlement.ts';
import {
  DarajaConfig, DarajaInitiatorConfig, b2bPayment, b2cPayment,
  buildPayoutResultUrl, normalisePhone,
} from './darajaClient.ts';

export type ProcessOutcome =
  | { outcome: 'sent'; method: 'b2c' | 'b2b'; checkoutId: string }
  | { outcome: 'already-claimed' | 'no-destination' | 'invalid-destination' | 'invalid-method' }
  | { outcome: 'error'; error: string };

async function releaseSettlement(supabase: any, settlementId: string, reason: string) {
  // Sent back to 'failed', not 'pending' - an immediate rejection from
  // Safaricom (bad destination, misconfigured credentials) is very unlikely
  // to succeed on a silent auto-retry, and a retry storm against a bad
  // number is worse than surfacing it once on the Payouts page for SA to
  // fix and re-queue deliberately.
  await supabase.from('payment_settlements')
    .update({ status: 'failed', failure_reason: reason })
    .eq('id', settlementId).eq('status', 'processing');
}

export async function processSettlement(
  supabase: any,
  settlement: { id: string; org_id: string; fund_type: string; amount: number },
  cfg: DarajaConfig,
  initCfg: DarajaInitiatorConfig,
  fetchFn: typeof fetch = fetch,
): Promise<ProcessOutcome> {
  const claimed = await claimSettlement(supabase, settlement);
  if (!claimed) return { outcome: 'already-claimed' };

  try {
    const { data: org, error: orgErr } = await supabase
      .from('organisations').select('*').eq('id', claimed.org_id).maybeSingle();
    if (orgErr || !org) { await releaseSettlement(supabase, claimed.id, 'Organisation not found'); return { outcome: 'error', error: 'org not found' }; }

    const isWelfare = claimed.fund_type === 'welfare';
    const method = isWelfare ? (org.welfare_disbursement_method || org.disbursement_method) : org.disbursement_method;
    if (!method) {
      await releaseSettlement(supabase, claimed.id, 'No settlement destination configured for this organisation.');
      return { outcome: 'no-destination' };
    }

    const resultUrl = buildPayoutResultUrl();
    const remarks = `GY360 ${claimed.fund_type} settlement`.slice(0, 100);

    if (method === 'mpesa') {
      const phoneRaw = isWelfare ? (org.welfare_disbursement_mpesa_number || org.disbursement_mpesa_number) : org.disbursement_mpesa_number;
      const phone = normalisePhone(phoneRaw);
      if (!phone) {
        await releaseSettlement(supabase, claimed.id, 'No valid M-Pesa number configured for this organisation.');
        return { outcome: 'invalid-destination' };
      }
      const res = await b2cPayment(cfg, {
        amount: claimed.amount, phone,
        initiatorName: initCfg.initiatorName, securityCredential: initCfg.securityCredential,
        resultUrl, timeoutUrl: resultUrl, remarks,
      }, fetchFn);
      await supabase.from('payment_settlements').update({ checkout_id: res.conversationId, method: 'b2c' }).eq('id', claimed.id);
      return { outcome: 'sent', method: 'b2c', checkoutId: res.conversationId };
    }

    if (method === 'bank') {
      const bankPaybill = isWelfare ? (org.welfare_disbursement_bank_paybill || org.disbursement_bank_paybill) : org.disbursement_bank_paybill;
      const accountRef = isWelfare ? (org.welfare_disbursement_bank_account_number || org.disbursement_bank_account_number) : org.disbursement_bank_account_number;
      if (!bankPaybill || !accountRef) {
        await releaseSettlement(supabase, claimed.id, 'No valid bank Paybill and account number configured for this organisation.');
        return { outcome: 'invalid-destination' };
      }
      const res = await b2bPayment(cfg, {
        amount: claimed.amount, receiverShortcode: bankPaybill, accountReference: accountRef,
        initiatorName: initCfg.initiatorName, securityCredential: initCfg.securityCredential,
        resultUrl, timeoutUrl: resultUrl, remarks,
      }, fetchFn);
      await supabase.from('payment_settlements').update({ checkout_id: res.conversationId, method: 'b2b' }).eq('id', claimed.id);
      return { outcome: 'sent', method: 'b2b', checkoutId: res.conversationId };
    }

    await releaseSettlement(supabase, claimed.id, `Unknown settlement method: ${method}`);
    return { outcome: 'invalid-method' };
  } catch (e: any) {
    await releaseSettlement(supabase, settlement.id, e?.message || 'Unknown error');
    return { outcome: 'error', error: e?.message || 'Unknown error' };
  }
}

// Writes a successful automated payout into settlement_batches too, the
// same table the existing Settlements page already reads, so that page
// stays the one true picture rather than a second, disconnected list.
// Mirrors sync-settlement-batches' own upsert-by-day logic: add to today's
// batch for this org/provider/line if one exists and is still pending,
// otherwise create a new one, already marked paid.
async function rollUpIntoSettlementBatches(supabase: any, settlement: any, providerReference: string) {
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase
    .from('settlement_batches')
    .select('id, amount, status, auto_settled')
    .eq('org_id', settlement.org_id).eq('provider', 'daraja')
    .eq('settlement_date', today).eq('line_type', settlement.fund_type === 'welfare' ? 'welfare' : 'regular')
    .maybeSingle();

  // Two cases merge into the existing row instead of creating a new one:
  // a still-open 'pending' batch (from the ordinary sync process, not yet
  // paid), or an already-'paid' batch that was ALSO auto-settled earlier
  // today - a second Daraja contribution settling on the same day for the
  // same org/line should accumulate into one row, not create a duplicate.
  // Deliberately never merges into a 'paid' batch that a person closed out
  // manually - that row's payout_reference is a real reference to a real
  // bank transfer SA made, overwriting or adding to its amount without
  // that being true would corrupt the audit trail.
  const canMerge = existing && (existing.status === 'pending' || (existing.status === 'paid' && existing.auto_settled === true));
  if (canMerge) {
    await supabase.from('settlement_batches').update({
      amount: Number(existing.amount) + Number(settlement.amount),
      ...(existing.status === 'pending' ? {} : { payout_reference: providerReference }),
    }).eq('id', existing.id);
    return;
  }
  await supabase.from('settlement_batches').insert({
    org_id: settlement.org_id, provider: 'daraja', settlement_date: today,
    line_type: settlement.fund_type === 'welfare' ? 'welfare' : 'regular',
    amount: settlement.amount, status: 'paid', paid_at: new Date().toISOString(),
    payout_method: settlement.method, payout_reference: providerReference,
    auto_settled: true,
  });
}

export type CallbackOutcome = 'invalid' | 'unknown-reference' | 'already-processed' | 'settled' | 'failed' | 'error';

export async function handlePayoutCallback(supabase: any, body: any): Promise<CallbackOutcome> {
  const result = body?.Result;
  if (!result || !result.ConversationID) return 'invalid';
  const conversationId = String(result.ConversationID);

  const { data: settlement } = await supabase
    .from('payment_settlements').select('*').eq('checkout_id', conversationId).maybeSingle();
  if (!settlement) return 'unknown-reference';
  if (settlement.status !== 'processing') return 'already-processed';

  const resultCode = Number(result.ResultCode);
  if (resultCode !== 0) {
    // Same guarded-update-then-check-it-actually-matched pattern as the
    // success path below, for the identical reason: a status read at the
    // top of this function is not itself a lock, two callbacks for the
    // same conversation can both pass that check before either one writes.
    const { data: claimed } = await supabase.from('payment_settlements').update({
      status: 'failed', failure_reason: result.ResultDesc || `Safaricom result code ${resultCode}`,
    }).eq('id', settlement.id).eq('status', 'processing').select().maybeSingle();
    return claimed ? 'failed' : 'already-processed';
  }

  const params: Record<string, unknown> = {};
  const items = result.ResultParameters?.ResultParameter;
  if (Array.isArray(items)) for (const i of items) if (i?.Key) params[i.Key] = i.Value;
  const providerReference = String(result.TransactionID || params.TransactionReceipt || conversationId);
  const fee = params.DebitPartyCharges !== undefined && params.DebitPartyCharges !== ''
    ? Number(params.DebitPartyCharges) : null;

  // The status check above is a plain read, not a lock - two callbacks for
  // the same conversation (a genuine possibility, Safaricom can resend) can
  // both reach this point having both seen 'processing'. The WHERE clause
  // on this update is the actual guard; .select().maybeSingle() is what
  // lets this code tell whether ITS update actually matched a row or
  // silently affected zero, the same reasoning claimSettlement() and
  // claimPaymentRequest() are built around. Caught by the "two simultaneous
  // callbacks" test below - without this, both calls proceeded as if they
  // had won.
  const { data: claimed, error: updErr } = await supabase.from('payment_settlements').update({
    status: 'settled', provider_reference: providerReference, settled_at: new Date().toISOString(),
    settlement_fee: fee,
  }).eq('id', settlement.id).eq('status', 'processing').select().maybeSingle();
  if (updErr) { console.error('[daraja-payout-callback] Could not mark settled:', updErr.message); return 'error'; }
  if (!claimed) return 'already-processed';

  try {
    await rollUpIntoSettlementBatches(supabase, settlement, providerReference);
  } catch (e: any) {
    // The payout itself succeeded and is correctly marked settled above -
    // a failure here only means the existing Settlements page is briefly
    // out of sync, not that anything about the payout is wrong. Logged for
    // follow-up, not retried automatically, to avoid double-counting into
    // settlement_batches if retried blindly.
    console.error('[daraja-payout-callback] Roll-up into settlement_batches failed (payout still settled correctly):', e?.message);
  }

  return 'settled';
}
