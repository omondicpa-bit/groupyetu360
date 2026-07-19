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
// Supports paying for another member (or splitting a single charge across
// multiple beneficiaries — e.g. a member's own subscription + their spouse's,
// in one M-Pesa prompt): each allocation MAY carry its own `memberId`; any
// allocation without one falls back to the payer's own pr.member_id, for
// backward compatibility with payments made before this existed.
//
// Idempotency: callers MUST have already confirmed pr.status === 'pending'
// before calling this — it does not re-check itself, since both the webhook
// and the verify endpoint already filter on that in their own queries, and
// re-checking here would just be a second, redundant DB round trip on every
// call.

import { sendPushNotification } from './sendPushNotification.ts';

export async function creditMemberContribution(supabase: any, pr: any, reference: string) {
  const orgId = pr.org_id;
  const today = new Date().toISOString().split('T')[0];

  // Confirmation SMS template — {date} added per Felix's request, 16 Jul 2026.
  // Formatted as "16 Jul 2026" to match how dates read elsewhere in the app.
  const SMS_TEMPLATE = "GroupYetu360: Ksh {net_amount} contribution to {org_name} confirmed on {date}. Ref: {mpesa_ref}. For: {contribution_type}. New balance: Ksh {new_balance}. Thank you, {member_name}.";

  function formatSmsDate(d: Date): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function buildSms(vars: Record<string, string | number>): string {
    let msg = SMS_TEMPLATE;
    for (const [key, val] of Object.entries(vars)) {
      msg = msg.replace(`{${key}}`, String(val));
    }
    return msg;
  }

  // Sends directly to Celcom's API rather than calling send-sms-celcom over
  // HTTP — that function requires a real user JWT (org-membership check),
  // which this server-to-server context doesn't have. Same credentials,
  // same endpoint, same payload shape and response parsing as
  // send-sms-celcom itself (including their API's 'respose-code' typo) —
  // kept in sync with that function manually since Deno Edge Functions can't
  // easily share a non-DB HTTP call the way creditMemberContribution itself
  // is shared as a module. Wrapped so an SMS failure NEVER blocks or reverts
  // the crediting above it.
  async function sendConfirmationSms(supabase: any, celcomCreds: any, phone: string, message: string) {
    if (!celcomCreds?.celcom_api_key || !celcomCreds?.celcom_partner_id) {
      console.warn('[GY360] Skipping confirmation SMS — Celcom not configured');
      return;
    }
    try {
      const payload = {
        apikey: celcomCreds.celcom_api_key,
        partnerID: celcomCreds.celcom_partner_id,
        shortcode: celcomCreds.celcom_shortcode || 'EPH TECH',
        message,
        mobile: phone,
        messageID: Date.now().toString(),
      };
      const res = await fetch('https://isms.celcomafrica.com/api/services/sendsms/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      const code = result?.responses?.[0]?.['response-code'] ?? result?.responses?.[0]?.['respose-code'];
      console.log('[GY360] Confirmation SMS to', phone, '— code:', code, 'raw:', JSON.stringify(result));
    } catch (e: any) {
      console.error('[GY360] Confirmation SMS failed (non-fatal):', e.message);
    }
  }

  try {
    let allocations: any[] = [];
    try { allocations = JSON.parse(pr.allocations || '[]'); } catch (e) { /* falls through to fallback below */ }

    if (!allocations.length) {
      console.error('[GY360] member_contribution with no allocations — using fallback amount:', pr.id);
      allocations = [{ memberId: pr.member_id, typeName: 'Payment', amount: pr.amount }];
    }

    // Group allocations by beneficiary member — this is what makes "pay for
    // another member" and "split between myself and my spouse in one go"
    // work: each group gets processed exactly like a normal single-member
    // contribution (its own regular/welfare split, its own balance updates),
    // just looped once per distinct beneficiary instead of assuming everyone
    // in the payment is the payer themselves.
    const byMember = new Map<string, any[]>();
    for (const a of allocations) {
      const mId = a.memberId || pr.member_id;
      if (!byMember.has(mId)) byMember.set(mId, []);
      byMember.get(mId)!.push(a);
    }

    let successCount = 0;
    let grandRegularTotal = 0;
    let grandWelfareTotal = 0;
    let grandTBTotal = 0;
    let grandMGRTotal = 0;
    const touchedMGRSlots = new Set<string>(); // dedupe — same slot could appear across multiple beneficiaries in one split payment

    const { data: orgRow } = await supabase.from('organisations').select('name').eq('id', orgId).maybeSingle();
    const orgName = orgRow?.name || 'your group';
    const smsDate = formatSmsDate(new Date());
    const { data: celcomCreds } = await supabase.from('platform_settings')
      .select('celcom_api_key, celcom_partner_id, celcom_shortcode').maybeSingle();

    for (const [memberId, memberAllocs] of byMember.entries()) {
      const welfareAllocs = memberAllocs.filter((a: any) => a.isWelfare && a.eventId);
      const tbAllocs = memberAllocs.filter((a: any) => a.isTB && a.poolId);
      const mgrAllocs = memberAllocs.filter((a: any) => a.isMGR && a.slotId);
      const regularAllocs = memberAllocs.filter((a: any) => !(a.isWelfare && a.eventId) && !(a.isTB && a.poolId) && !(a.isMGR && a.slotId));
      const regularTotal = regularAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
      const welfareTotal = welfareAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
      const tbTotal = tbAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
      const mgrTotal = mgrAllocs.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
      grandRegularTotal += regularTotal;
      grandWelfareTotal += welfareTotal;
      grandTBTotal += tbTotal;
      grandMGRTotal += mgrTotal;

      const paidByAnother = memberId !== pr.member_id;
      const attribution = paidByAnother ? ' (paid on their behalf by another member)' : '';

      const { data: member } = await supabase.from('members')
        .select('shares_balance,savings_balance,registration_paid,phone,full_name,user_id')
        .eq('id', memberId).maybeSingle();

      // One summary transaction per beneficiary for their non-welfare portion
      if (regularAllocs.length && regularTotal > 0) {
        const allocationSummary = regularAllocs
          .map((a: any) => a.typeName + ': Ksh ' + Number(a.amount).toLocaleString())
          .join(' | ');
        const summaryTxn: any = {
          org_id: orgId,
          member_id: memberId,
          amount: regularTotal,
          mpesa_ref: reference,
          transaction_date: pr.payment_date || today,
          notes: `Auto-approved via Paystack. Ref: ${reference}. ${allocationSummary}${attribution}`,
        };
        const firstTypedAlloc = regularAllocs.find((a: any) => a.typeId && a.typeId.length > 10);
        if (firstTypedAlloc) summaryTxn.type_id = firstTypedAlloc.typeId;
        const { error: txErr } = await supabase.from('transactions').insert(summaryTxn);
        if (!txErr) successCount++;
        else console.error('[GY360] regular transaction insert failed:', txErr.message);
      }

      // Separate, properly-tagged transaction per welfare allocation, per beneficiary
      for (const alloc of welfareAllocs) {
        const { error: welErr } = await supabase.from('transactions').insert({
          org_id: orgId,
          member_id: memberId,
          amount: Number(alloc.amount),
          mpesa_ref: reference,
          transaction_date: pr.payment_date || today,
          welfare_event_id: alloc.eventId,
          notes: `Welfare contribution — ${alloc.typeName}. Auto-approved via Paystack. Ref: ${reference}.${attribution}`,
        });
        if (!welErr) successCount++;
        else console.error('[GY360] welfare transaction insert failed:', welErr.message);
      }

      // Table Banking — own table, same as manual recording, tagged with
      // provider so it's identifiable for settlement. Never touches
      // bank_balance, matching how the manual TB flow already works —
      // TB money is tracked in its own pool, not the group's general funds.
      for (const alloc of tbAllocs) {
        const { error: tbErr } = await supabase.from('table_banking_contributions').insert({
          pool_id: alloc.poolId,
          org_id: orgId,
          member_id: memberId,
          amount: Number(alloc.amount),
          payment_date: pr.payment_date || today,
          mpesa_ref: reference,
          provider: pr.provider,
          recorded_by: null,
        });
        if (!tbErr) successCount++;
        else console.error('[GY360] table banking contribution insert failed:', tbErr.message);
      }

      // MGR — own table (round_contributions), same shape as manual
      // recording, tagged with provider. Never touches bank_balance — this
      // money is destined for a specific round receiver via settlement,
      // not the group's own funds. status is 'paid' immediately since this
      // IS the actual payment confirmation, same trust level as a manually
      // recorded one.
      for (const alloc of mgrAllocs) {
        const { error: mgrErr } = await supabase.from('round_contributions').insert({
          round_id: alloc.roundId,
          slot_id: alloc.slotId,
          org_id: orgId,
          contributor_member_id: memberId,
          amount: Number(alloc.amount),
          method: 'mobile_money',
          mpesa_ref: reference,
          payment_date: pr.payment_date || today,
          status: 'paid',
          provider: pr.provider,
          recorded_by: null,
        });
        if (!mgrErr) { successCount++; touchedMGRSlots.add(alloc.slotId); }
        else console.error('[GY360] MGR round_contributions insert failed:', mgrErr.message);
      }

      // Member balance updates — per beneficiary, regular allocations only
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
      if (memberId && Object.keys(memberUpdates).length) {
        const { error: memErr } = await supabase.from('members').update(memberUpdates).eq('id', memberId);
        if (memErr) console.error('[GY360] member balance update failed:', memErr.message);
      }

      // Confirmation SMS — one per beneficiary, describing only their own
      // portion of this payment (not the combined charge), since each
      // beneficiary in a split payment is a separate person with their own
      // phone number and their own balance.
      let thisNetAmount = 0, typeLabel = 'Contribution', newBalance = 0;
      if (member?.phone || member?.user_id) {
        typeLabel = memberAllocs.map((a: any) => a.typeName).join(' + ') || 'Contribution';
        thisNetAmount = regularTotal + welfareTotal + tbTotal + mgrTotal;
        newBalance = (memberUpdates.shares_balance ?? member?.shares_balance ?? 0)
          + (memberUpdates.savings_balance ?? member?.savings_balance ?? 0);
      }
      if (member?.phone) {
        const message = buildSms({
          net_amount: thisNetAmount.toLocaleString(),
          org_name: orgName,
          date: smsDate,
          mpesa_ref: reference,
          contribution_type: typeLabel,
          new_balance: newBalance.toLocaleString(),
          member_name: member?.full_name || 'Member',
        });
        await sendConfirmationSms(supabase, celcomCreds, member.phone, message);
      }
      // Same confirmation, as a push notification, if this beneficiary has
      // the app installed and notifications enabled — additive to the SMS,
      // never a replacement for it (some members won't have the app).
      if (member?.user_id) {
        await sendPushNotification(
          supabase,
          [member.user_id],
          'Payment Confirmed',
          `Ksh ${thisNetAmount.toLocaleString()} — ${typeLabel} — ${orgName}`,
          '/#finance'
        );
      }
    }

    // MGR round-completion check — ported from the client-side
    // checkAndAutoCompleteSlot()'s detection logic, but this side only
    // ever creates a settlement_batch for the API-sourced portion; it
    // deliberately doesn't touch the existing direct/group_account/
    // treasurer completion behaviors, which stay exactly as they were —
    // those are for money that never came through us at all. A round can
    // be completed by a mix of sources; this only settles the slice that
    // actually landed in our pooled wallet, which could be less than the
    // round's full value, or even zero (in which case nothing is created).
    for (const slotId of touchedMGRSlots) {
      try {
        const { data: slot } = await supabase.from('round_slots')
          .select('id, round_id, member_id, received').eq('id', slotId).maybeSingle();
        if (!slot || slot.received) continue;

        const { data: round } = await supabase.from('savings_rounds')
          .select('*').eq('id', slot.round_id).maybeSingle();
        if (!round || !Array.isArray(round.pool_members)) continue;

        const expectedContributors = round.pool_members.filter((id: string) => id !== slot.member_id);
        if (!expectedContributors.length) continue;

        const { data: paidRows } = await supabase.from('round_contributions')
          .select('contributor_member_id, amount, provider').eq('slot_id', slotId).eq('status', 'paid');
        const paidIds = new Set((paidRows || []).map((r: any) => r.contributor_member_id));
        const allPaid = expectedContributors.every((id: string) => paidIds.has(id));
        if (!allPaid) continue;

        // Round is complete — mark received, same as the manual path does.
        const potAmount = expectedContributors.length * Number(round.amount_per_member || 0);
        await supabase.from('round_slots').update({
          received: true, received_date: today, amount_received: potAmount,
        }).eq('id', slotId);

        await supabase.from('round_disbursements').insert({
          round_id: slot.round_id, slot_id: slotId, org_id: orgId,
          receiving_member_id: slot.member_id, amount: potAmount, method: 'mixed',
          disbursement_date: today, disbursed_by: null,
          notes: 'Auto-completed: mix of instant-pay and other recorded contributions',
        });

        // Only the API-sourced portion needs settling — sum contributions
        // that actually carry a provider tag, regardless of round total.
        const apiSourcedTotal = (paidRows || [])
          .filter((r: any) => r.provider)
          .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

        if (apiSourcedTotal > 0) {
          const { data: receiverMember } = await supabase.from('members')
            .select('phone, full_name').eq('id', slot.member_id).maybeSingle();

          // One settlement batch per provider actually used, mirroring
          // welfare's pattern — a round could plausibly have used more
          // than one provider across its lifetime if the org switched.
          const byProvider: Record<string, number> = {};
          for (const r of paidRows || []) {
            if (!r.provider) continue;
            byProvider[r.provider] = (byProvider[r.provider] || 0) + Number(r.amount || 0);
          }
          for (const [provider, amount] of Object.entries(byProvider)) {
            const { error: settleErr } = await supabase.from('settlement_batches').insert({
              org_id: orgId, provider, settlement_date: today,
              line_type: 'mgr',
              amount, round_slot_id: slotId,
              payout_destination_type: 'direct',
              payout_destination_snapshot: {
                recipient_name: receiverMember?.full_name || null,
                recipient_phone: receiverMember?.phone || null,
              },
            });
            if (settleErr) console.error('[GY360] MGR settlement_batches insert failed:', settleErr.message);
          }
          console.log(`[GY360] MGR round complete — settlement created for slot ${slotId}, Ksh ${apiSourcedTotal} across ${Object.keys(byProvider).length} provider(s)`);
        } else {
          console.log(`[GY360] MGR round complete for slot ${slotId} — Ksh 0 came through our APIs, nothing to settle`);
        }
      } catch (mgrCompleteErr: any) {
        console.error('[GY360] MGR completion check failed for slot', slotId, ':', mgrCompleteErr.message);
      }
    }

    // Notify officials (admin/treasurer/officer) that a payment came in —
    // this is new, not a duplicate of the beneficiary confirmation above.
    // Nobody except the payer/beneficiary was ever told about a payment
    // before this; officials had to check the app to find out. One
    // combined notification per payment, not per beneficiary, since this
    // describes the whole transaction from the org's point of view.
    try {
      const { data: officials } = await supabase.from('user_orgs')
        .select('user_id').eq('org_id', orgId).in('role', ['admin', 'treasurer', 'officer']);
      const officialUserIds = (officials || []).map((o: any) => o.user_id);
      if (officialUserIds.length) {
        const { data: payerRow } = await supabase.from('members').select('full_name').eq('id', pr.member_id).maybeSingle();
        await sendPushNotification(
          supabase,
          officialUserIds,
          'Payment Received',
          `Ksh ${grandRegularTotal.toLocaleString()}${grandWelfareTotal ? ' + Ksh ' + grandWelfareTotal.toLocaleString() + ' welfare' : ''} from ${payerRow?.full_name || 'a member'} — ${orgName}`,
          '/#finance'
        );
      }
    } catch (e: any) {
      console.error('[GY360] Officials push notification failed (non-fatal):', e.message);
    }

    // Bank balance — ONE credit for the combined regular total across every
    // beneficiary in this single charge. Welfare money stays entirely
    // outside bank_balance, by design, same as the manual approval path.
    if (grandRegularTotal > 0) {
      const { error: bbErr } = await supabase.rpc('update_bank_balance', {
        p_org_id: orgId, p_amount: grandRegularTotal, p_direction: 'credit', p_date: today,
      });
      if (bbErr) console.error('[GY360] bank balance update failed:', bbErr.message);
    }

    // Auto-resolve fines — unaffected by beneficiary grouping, each fine
    // allocation already carries its own fineId regardless of who paid it.
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
      details: `Ksh ${grandRegularTotal.toLocaleString()}${grandWelfareTotal ? ' + Ksh ' + grandWelfareTotal.toLocaleString() + ' welfare' : ''}${grandTBTotal ? ' + Ksh ' + grandTBTotal.toLocaleString() + ' table banking' : ''}${grandMGRTotal ? ' + Ksh ' + grandMGRTotal.toLocaleString() + ' MGR' : ''}${byMember.size > 1 ? ' · split across ' + byMember.size + ' members' : ''} · ref: ${reference}`,
      target_type: 'payment',
      target_id: pr.id,
      created_at: new Date().toISOString(),
    });

    console.log('[GY360] ✓ Member contribution processed for ref:', reference, '— transactions written:', successCount, '— beneficiaries:', byMember.size);
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
