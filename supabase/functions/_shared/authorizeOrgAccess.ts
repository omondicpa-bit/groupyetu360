// supabase/functions/_shared/authorizeOrgAccess.ts
//
// Confirms the caller is a logged-in user who belongs to the given org (or is
// a superadmin). Same rules as the inline block in paystack-charge, pulled out
// so daraja-charge and daraja-verify cannot drift apart.
//
// createClient is passed in rather than imported, so this file has no URL
// imports and stays easy to type-check.

export type AccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function authorizeOrgAccess(
  req: Request,
  supabaseAdmin: any,
  createClient: (url: string, key: string, opts?: unknown) => any,
  orgId: string,
): Promise<AccessResult> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.replace('Bearer ', '')) return { ok: false, status: 401, error: 'Unauthorized' };

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: membership } = await supabaseAdmin
    .from('user_orgs').select('role').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (membership) return { ok: true, userId: user.id };

  // Superadmin has no user_orgs row for every org.
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role === 'superadmin') return { ok: true, userId: user.id };

  return { ok: false, status: 403, error: 'Forbidden: not a member of this organisation' };
}
