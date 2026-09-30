// supabase/functions/_shared/claimSettlement.ts
//
// Same reasoning as claimPaymentRequest.ts, applied to payment_settlements.
// Autopilot firing the instant a contribution is credited, and SA clicking
// "Process Payout" on the same row, or two autopilot triggers overlapping,
// are all real ways this could get called twice for one settlement. This is
// what makes exactly one of them win.

export async function claimSettlement(supabase: any, settlement: { id: string }) {
  const { data: claimed, error } = await supabase
    .from('payment_settlements')
    .update({ status: 'processing' })
    .eq('id', settlement.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) {
    console.error('[claimSettlement] Claim failed (DB error):', error.message);
    return null;
  }
  if (!claimed) {
    console.log('[claimSettlement] Already claimed by another concurrent call, id:', settlement.id);
    return null;
  }
  return claimed;
}
