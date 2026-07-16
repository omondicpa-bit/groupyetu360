// supabase/functions/_shared/creditMemberContribution.ts
//
// Ported from approvePaymentRequest() in finance.js, and shared between
// paystack-webhook (passive — waits for Paystack to call us) and
// paystack-verify (active — we ask Paystack directly). Keeping this logic in
// ONE place matters: this codebase has already had the same fix need
// reapplying twice elsewhere (SMS Leopard/Africa's Talking) because two
// near-duplicate copies drifted apart. Both callers should import this
// instead of keeping their own copy.
//
// Idempotency: callers MUST have already confirmed pr.status === 'pending'
// before calling this — it does not re-check itself, since both the webhook
// and the verify endpoint already filter on that in their own queries, and
// re-checking here would just be a second, redundant DB round trip on every
// call.

export async function creditMemberContribution(supabase: any, pr: any, reference: string) {
  const orgId = pr.org_id;
  const today = new Date().toISOString().split('T')[0];

  try {
    let allocations: any[] = [];
    try { allocations = JSON.parse(pr.allocations || '[]'); } catch (e) { /* falls through to fallback below */ }

    if (!allocations.length) {
      console.error('[GY360] member_contribution with no allocations — using fallback amount:', pr.id);
      allocations = [{ typeName: 'Payment', amount: pr.amount }];
    }

    const welfareAllocs = allocations.filter((a: any) => a.isWelfare && a.eventId);
    const regularAllocs = allocations.filter((a: any) => !(a.isWelfare && a.eventId));
    const regularTotal = regularAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    const welfareTotal = welfareAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);

    let successCount = 0;

    const { data: member } = await supabase.from('members')
      .select('shares_balance,savings_balance,registration_paid')
      .eq('id', pr.member_id).maybeSingle();

    // One summary transaction for the non-welfare portion
    if (regularAllocs.length && regularTotal > 0) {
      const allocationSummary = regularAllocs
        .map((a: any) => a.typeName + ': Ksh ' + Number(a.amount).toLocaleString())
        .join(' | ');
      const summaryTxn: any = {
        org_id: orgId,
        member_id: pr.member_id,
        amount: regularTotal,
        mpesa_ref: reference,
        transaction_date: pr.payment_date || today,
        notes: `Auto-approved via Paystack. Ref: ${reference}. ${allocationSummary}`,
      };
      const firstTypedAlloc = regularAllocs.find((a: any) => a.typeId && a.typeId.length > 10);
      if (firstTypedAlloc) summaryTxn.type_id = firstTypedAlloc.typeId;
      const { error: txErr } = await supabase.from('transactions').insert(summaryTxn);
      if (!txErr) successCount++;
      else console.error('[GY360] regular transaction insert failed:', txErr.message);
    }

    // Separate, properly-tagged transaction per welfare allocation
    for (const alloc of welfareAllocs) {
      const { error: welErr } = await supabase.from('transactions').insert({
        org_id: orgId,
        member_id: pr.member_id,
        amount: Number(alloc.amount),
        mpesa_ref: reference,
        transaction_date: pr.payment_date || today,
        welfare_event_id: alloc.eventId,
        notes: `Welfare contribution — ${alloc.typeName}. Auto-approved via Paystack. Ref: ${reference}.`,
      });
      if (!welErr) successCount++;
      else console.error('[GY360] welfare transaction insert failed:', welErr.message);
    }

    // Member balance updates — regular allocations only
    const memberUpdates: any = {};
    for (const alloc of regularAllocs) {
      const name = (alloc.typeName || '').toLowerCase();
      if (name.includes('share')) {
        memberUpdates.shares_balance = (memberUpdates.shares_balance ?? (member?.shares_balance || 0)) + Number(alloc.amount);
      } else if (name.includes('saving')) {
        memberUpdates.savings_balance = (memberUpdates.savings_balance ?? (member?.savings_balance || 0)) + Number(alloc.amount);
      }
      if (alloc.isReg) memberUpdates.registration_paid = true;
    }
    if (pr.member_id && Object.keys(memberUpdates).length) {
      const { error: memErr } = await supabase.from('members').update(memberUpdates).eq('id', pr.member_id);
      if (memErr) console.error('[GY360] member balance update failed:', memErr.message);
    }

    // Bank balance — regular portion only, welfare never touches it
    if (regularTotal > 0) {
      const { error: bbErr } = await supabase.rpc('update_bank_balance', {
        p_org_id: orgId, p_amount: regularTotal, p_direction: 'credit', p_date: today,
      });
      if (bbErr) console.error('[GY360] bank balance update failed:', bbErr.message);
    }

    // Auto-resolve fines
    const fineAllocs = allocations.filter((a: any) => a.isFine && a.fineId);
    for (const fa of fineAllocs) {
      await supabase.from('fines').update({
        status: 'paid',
        paid_date: pr.payment_date || today,
        recovery_method: 'mpesa',
      }).eq('id', fa.fineId);
      await supabase.from('expenses').insert({
        org_id: orgId,
        category: 'Fine',
        description: `Fine paid: ${fa.reason || 'fine'} — auto via Paystack`,
        amount: fa.amount,
        expense_date: pr.payment_date || today,
        entry_type: 'income',
      });
    }

    // Mark approved
    await supabase.from('payment_requests').update({
      status: 'approved',
      paystack_status: 'success',
      mpesa_ref: reference,
      approved_at: new Date().toISOString(),
      notes: (pr.notes || '') + ` | Auto-approved via Paystack. Ref: ${reference}`,
    }).eq('id', pr.id);

    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_id: null,
      user_name: 'Paystack Auto',
      user_role: 'system',
      action: 'MEMBER CONTRIBUTION AUTO-APPROVED',
      details: `Ksh ${regularTotal.toLocaleString()}${welfareTotal ? ' + Ksh ' + welfareTotal.toLocaleString() + ' welfare' : ''} · ref: ${reference}`,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });

    console.log('[GY360] ✓ Member contribution processed for ref:', reference, '— transactions written:', successCount);
    return { success: true };

  } catch (err: any) {
    console.error('[GY360] Member contribution processing error:', err.message);
    await supabase.from('activity_log').insert({
      org_id: orgId,
      user_name: 'Paystack (shared crediting)',
      user_role: 'system',
      action: 'WEBHOOK ERROR',
      details: `Member contribution failed for ref ${reference}: ${err.message}`,
      created_at: new Date().toISOString(),
    }).catch(() => {});
    return { success: false, error: err.message };
  }
}
