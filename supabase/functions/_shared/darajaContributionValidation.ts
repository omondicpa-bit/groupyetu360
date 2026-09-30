// supabase/functions/_shared/darajaContributionValidation.ts
//
// The member-contribution equivalent of billingPrices.ts's validateBillingCart,
// but the "price list" here isn't fixed plans and SMS bundles, it's whatever
// the member typed, grossed up by a settlement fee that depends on WHERE the
// money has to go. A regular contribution and a welfare contribution in the
// same payment can settle to two different destinations, each with its own
// fee, so this returns each portion's gross separately, not just one total.

import { calculateSettlementGrossUp, SettlementDestinationType } from './darajaSettlementFees.ts';

export interface ContributionAllocation {
  memberId?: string;
  typeName: string;
  amount: number;
  isWelfare?: boolean;
  eventId?: string;
  typeId?: string;
  isTB?: boolean;
  poolId?: string;
  isMGR?: boolean;
  slotId?: string;
}

export type ValidatedContribution =
  | {
      ok: true;
      allocations: ContributionAllocation[];
      netRegular: number;
      netWelfare: number;
      grossRegular: number;
      grossWelfare: number;
      grossTotal: number;
      regularDestination: SettlementDestinationType | null;
      welfareDestination: SettlementDestinationType | null;
    }
  | { ok: false; error: string };

// A group with no disbursement_method set yet can still collect (the money
// simply queues in payment_settlements until SA configures a destination or
// processes it manually), but there is then no way to quote a settlement
// fee up front, so contributions are blocked until a destination exists -
// better than guessing a fee and getting it wrong.
function destinationTypeFor(method: string | null | undefined): SettlementDestinationType | null {
  if (method === 'mpesa') return 'b2c_registered';
  if (method === 'bank') return 'b2b';
  return null;
}

export function validateDarajaContribution(
  allocationsRaw: string | null | undefined,
  requestedAmount: unknown,
  org: {
    disbursement_method?: string | null;
    welfare_disbursement_method?: string | null;
  },
): ValidatedContribution {
  let allocations: ContributionAllocation[] = [];
  try { allocations = JSON.parse(allocationsRaw || '[]'); } catch (_e) { /* falls through to the empty-check below */ }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    return { ok: false, error: 'Missing or invalid allocations for this contribution.' };
  }
  for (const a of allocations) {
    if (!a || typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount <= 0) {
      return { ok: false, error: 'Every allocation needs a valid positive amount.' };
    }
  }

  const welfareAllocs = allocations.filter((a) => a.isWelfare && a.eventId);
  const regularAllocs = allocations.filter((a) => !(a.isWelfare && a.eventId));
  const netRegular = regularAllocs.reduce((s, a) => s + a.amount, 0);
  const netWelfare = welfareAllocs.reduce((s, a) => s + a.amount, 0);

  const regularDestination = destinationTypeFor(org.disbursement_method);
  const welfareDestination = destinationTypeFor(org.welfare_disbursement_method || org.disbursement_method);

  if (netRegular > 0 && !regularDestination) {
    return { ok: false, error: 'This group has no settlement destination configured yet. Contact support before contributing via Safaricom Direct.' };
  }
  if (netWelfare > 0 && !welfareDestination) {
    return { ok: false, error: 'This group has no welfare settlement destination configured yet. Contact support before contributing via Safaricom Direct.' };
  }

  const grossRegular = netRegular > 0 ? calculateSettlementGrossUp(netRegular, regularDestination!).gross : 0;
  const grossWelfare = netWelfare > 0 ? calculateSettlementGrossUp(netWelfare, welfareDestination!).gross : 0;
  const grossTotal = grossRegular + grossWelfare;

  const requested = Number(requestedAmount);
  if (!Number.isFinite(requested) || Math.round(requested) !== Math.round(grossTotal)) {
    return { ok: false, error: `The amount does not match the contribution and settlement fee (expected Ksh ${grossTotal.toLocaleString('en-KE')}). Refresh and try again.` };
  }

  return { ok: true, allocations, netRegular, netWelfare, grossRegular, grossWelfare, grossTotal, regularDestination, welfareDestination };
}
