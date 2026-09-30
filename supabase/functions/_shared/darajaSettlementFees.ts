// supabase/functions/_shared/darajaSettlementFees.ts
//
// Real Safaricom tariff tables, transcribed from the PDFs Felix shared
// (30 Sep 2026): M-PESA Paybill tariff sheet (B2C tables) and the signed
// B2B Terms and Conditions (Schedule 1). Used to work out, at the moment a
// member pays, exactly what it will cost EPH to settle that same amount
// out to the group's own account - so the member can be charged that real
// cost plus EPH's 1%, and the group receives their contribution untouched.
//
// KEEP IN SYNC WITH THE SOURCE PDFs. If Safaricom revises tariffs, these
// bands need updating here, or every settlement after that silently
// under-charges or over-charges by the difference.

export type SettlementDestinationType = 'b2c_registered' | 'b2c_unregistered' | 'b2b';

interface Band { min: number; max: number; fee: number; }

// M-PESA B2C Payments to Registered Users
const B2C_REGISTERED: Band[] = [
  { min: 1, max: 49, fee: 0 },
  { min: 50, max: 100, fee: 0 },
  { min: 101, max: 500, fee: 5 },
  { min: 501, max: 1000, fee: 5 },
  { min: 1001, max: 1500, fee: 5 },
  { min: 1501, max: 2500, fee: 9 },
  { min: 2501, max: 3500, fee: 9 },
  { min: 3501, max: 5000, fee: 9 },
  { min: 5001, max: 7500, fee: 11 },
  { min: 7501, max: 10000, fee: 11 },
  { min: 10001, max: 15000, fee: 11 },
  { min: 15001, max: 20000, fee: 11 },
  { min: 20001, max: 25000, fee: 13 },
  { min: 25001, max: 30000, fee: 13 },
  { min: 30001, max: 35000, fee: 13 },
  { min: 35001, max: 40000, fee: 13 },
  { min: 40001, max: 45000, fee: 13 },
  { min: 45001, max: 50000, fee: 13 },
  { min: 50001, max: 70000, fee: 13 },
  { min: 70001, max: 150000, fee: 13 },
];

// M-PESA B2C Payments to Unregistered Users
const B2C_UNREGISTERED: Band[] = [
  { min: 101, max: 500, fee: 8 },
  { min: 501, max: 1000, fee: 14 },
  { min: 1001, max: 1500, fee: 14 },
  { min: 1501, max: 2500, fee: 18 },
  { min: 2501, max: 3500, fee: 25 },
  { min: 3501, max: 5000, fee: 30 },
  { min: 5001, max: 7500, fee: 37 },
  { min: 7501, max: 10000, fee: 46 },
  { min: 10001, max: 15000, fee: 62 },
  { min: 15001, max: 20000, fee: 67 },
  { min: 20001, max: 25000, fee: 73 },
  { min: 25001, max: 30000, fee: 73 },
  { min: 30001, max: 35000, fee: 73 },
];

// M-PESA B2B Tariff (Business Pay Bill), signed Terms and Conditions Schedule 1
const B2B: Band[] = [
  { min: 1, max: 49, fee: 2 },
  { min: 50, max: 100, fee: 3 },
  { min: 101, max: 500, fee: 8 },
  { min: 501, max: 1000, fee: 13 },
  { min: 1001, max: 1500, fee: 18 },
  { min: 1501, max: 2500, fee: 25 },
  { min: 2501, max: 3500, fee: 30 },
  { min: 3501, max: 5000, fee: 39 },
  { min: 5001, max: 7500, fee: 48 },
  { min: 7501, max: 10000, fee: 54 },
  { min: 10001, max: 15000, fee: 63 },
  { min: 15001, max: 20000, fee: 68 },
  { min: 20001, max: 25000, fee: 74 },
  { min: 25001, max: 30000, fee: 79 },
  { min: 30001, max: 35000, fee: 90 },
  { min: 35001, max: 40000, fee: 106 },
  { min: 40001, max: 45000, fee: 110 },
  { min: 45001, max: 50000, fee: 115 },
  { min: 50001, max: Infinity, fee: 115 }, // flat above 50,000, confirmed on the tariff schedule up to 50,000,000
];

const TABLES: Record<SettlementDestinationType, Band[]> = {
  b2c_registered: B2C_REGISTERED,
  b2c_unregistered: B2C_UNREGISTERED,
  b2b: B2B,
};

export function lookupSettlementFee(amount: number, destinationType: SettlementDestinationType): number {
  const bands = TABLES[destinationType];
  const band = bands.find((b) => amount >= b.min && amount <= b.max);
  if (band) return band.fee;
  // Below every table's minimum (a 0-49 payout to an unregistered user has
  // no listed band) or above the highest listed max - fall back to the
  // most expensive band on that table rather than silently charging 0,
  // since undercharging is the direction that costs EPH money.
  return bands[bands.length - 1]?.fee ?? 0;
}

export const EPH_SETTLEMENT_MARGIN_PERCENT = 1; // Felix's decision, 30 Sep 2026 - "the 1% is enough for me"

export interface SettlementGrossUp {
  net: number;              // exactly what the group/beneficiary receives
  settlementFee: number;    // what Safaricom will charge EPH to send it
  ephMargin: number;        // EPH's 1%
  gross: number;            // what the member is actually charged
  destinationType: SettlementDestinationType;
}

// The member pays net + settlementFee + ephMargin. The group receives
// exactly net, untouched, so GY360's own records and the group's bank
// statement always match to the shilling - the whole point of this design.
export function calculateSettlementGrossUp(net: number, destinationType: SettlementDestinationType): SettlementGrossUp {
  const settlementFee = lookupSettlementFee(net, destinationType);
  const ephMargin = Math.round(net * (EPH_SETTLEMENT_MARGIN_PERCENT / 100));
  return { net, settlementFee, ephMargin, gross: net + settlementFee + ephMargin, destinationType };
}
