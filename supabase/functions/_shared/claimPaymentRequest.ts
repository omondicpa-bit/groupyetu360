// supabase/functions/_shared/claimPaymentRequest.ts
//
// Atomically claims a payment_request row before crediting it, so two
// near-simultaneous callers (a provider's webhook retry + the client's own
// ~2s status-polling, or a provider sending more than one callback for the
// same event) can never both process the same payment.
//
// This is the exact fix applied to paystack-webhook/paystack-verify on
// 19 Jul 2026 after it caused a real triple-credit on a live Ksh 817
// contribution (ref GY-1784460645802-NC1BZ) — a plain SELECT-then-credit
// check is not atomic: both callers can read status='pending' before either
// one has written back 'approved', since creditMemberContribution() only
// ever marks the row approved at the very end, after every other side effect
// (balance update, SMS, activity log) has already fired.
//
// Audit finding, 24 Jul 2026: that fix was only ever applied to Paystack's
// two functions. sasapay-webhook, fingo-webhook, and fingo-verify all still
// called creditMemberContribution() straight after a plain SELECT, with the
// identical unprotected window — just never yet triggered on those two
// providers. Extracted here (rather than copy-pasted a third time) so this
// exact fix-drift can't happen again the next time a provider is added.
//
// Usage: call this immediately after finding a pending payment_request and
// BEFORE calling creditMemberContribution(). If it returns null, another
// concurrent call already claimed (or is claiming) this row — return
// immediately without doing anything further.

export async function claimPaymentRequest(supabase: any, pr: { id: string }) {
  const { data: claimed, error } = await supabase
    .from('payment_requests')
    .update({ status: 'processing' })
    .eq('id', pr.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) {
    console.error('[claimPaymentRequest] Claim failed (DB error):', error.message);
    return null;
  }
  if (!claimed) {
    console.log('[claimPaymentRequest] Already claimed by another concurrent call, id:', pr.id);
    return null;
  }
  return claimed;
}
