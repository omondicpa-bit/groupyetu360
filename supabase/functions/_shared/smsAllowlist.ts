// SMS safety net for the staging environment.
//
// Live: GY_ENV is not set, so every number passes through unchanged.
// Staging: GY_ENV=staging is set as a function secret (the staging deploy
// workflow sets it). Then only numbers listed in SMS_ALLOWLIST (comma
// separated, any format: 0712..., 254712..., +254712...) are sent to.
// If staging has no allowlist at all, nothing is sent — it fails closed,
// so a test can never text a real member.

function last9(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-9);
}

export function isStaging(): boolean {
  return (Deno.env.get('GY_ENV') || '').toLowerCase() === 'staging';
}

export function filterSmsRecipients(phones: string[]): { allowed: string[]; blocked: number } {
  if (!isStaging()) return { allowed: phones, blocked: 0 };
  const allow = new Set(
    (Deno.env.get('SMS_ALLOWLIST') || '').split(',').map(last9).filter((p) => p.length === 9)
  );
  const allowed = phones.filter((p) => allow.has(last9(p)));
  if (allowed.length < phones.length) {
    console.warn(`[staging] SMS blocked for ${phones.length - allowed.length} number(s) not on SMS_ALLOWLIST`);
  }
  return { allowed, blocked: phones.length - allowed.length };
}
