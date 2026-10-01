// supabase/functions/_shared/allocationScope.ts
//
// Every ID in a contribution must belong to the group being paid (audit
// M1). Crediting runs with the service role, so without this a member of
// one group could post balances or MGR slots into another group's records.
export async function checkAllocationsBelongToOrg(supabase: any, orgId: string, payerMemberId: any, allocations: any[]): Promise<string | null> {
  const uniq = (xs: any[]) => [...new Set(xs.filter((x) => typeof x === 'string' && x.length > 0))];
  const memberIds = uniq([payerMemberId, ...allocations.map((a) => a.memberId)]);
  const eventIds = uniq(allocations.map((a) => a.eventId));
  const poolIds = uniq(allocations.map((a) => a.poolId));
  const typeIds = uniq(allocations.map((a) => a.typeId).filter((t) => typeof t === 'string' && t.length > 10));
  const slotIds = uniq(allocations.map((a) => a.slotId));

  const countIn = async (table: string, ids: string[]) => {
    if (!ids.length) return 0;
    const { data, error } = await supabase.from(table).select('id').in('id', ids).eq('org_id', orgId);
    if (error) throw new Error(`Could not check ${table}: ${error.message}`);
    return (data || []).length;
  };

  if ((await countIn('members', memberIds)) !== memberIds.length) return 'One of the members in this payment does not belong to this group.';
  if ((await countIn('welfare_events', eventIds)) !== eventIds.length) return 'One of the welfare events in this payment does not belong to this group.';
  if ((await countIn('table_banking_pools', poolIds)) !== poolIds.length) return 'One of the table banking pools in this payment does not belong to this group.';
  if ((await countIn('contribution_types', typeIds)) !== typeIds.length) return 'One of the contribution types in this payment does not belong to this group.';

  if (slotIds.length) {
    const { data: slots, error } = await supabase.from('round_slots').select('id, round_id').in('id', slotIds);
    if (error) throw new Error('Could not check round_slots: ' + error.message);
    if ((slots || []).length !== slotIds.length) return 'One of the rotating savings slots in this payment was not found.';
    const roundIds = uniq((slots || []).map((sl: any) => sl.round_id));
    if ((await countIn('savings_rounds', roundIds)) !== roundIds.length) return 'One of the rotating savings slots in this payment does not belong to this group.';
  }
  return null;
}
