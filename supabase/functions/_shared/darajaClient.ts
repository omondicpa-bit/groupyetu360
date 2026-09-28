// supabase/functions/_shared/darajaClient.ts
//
// Thin client for Safaricom's Daraja API (M-Pesa Express, also called STK
// Push), used for EPH's own Paybill: subscription and SMS bundle billing.
// This is NOT used for member contributions, which stay on the group
// providers (Paystack, Fingo, SasaPay).
//
// Secrets (supabase secrets set ...):
//   DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET  from the Daraja app
//   DARAJA_SHORTCODE                              the Paybill number
//   DARAJA_PASSKEY                                emailed by Safaricom at go-live
//   DARAJA_ENV                                    'production' or 'sandbox' (unset = sandbox)
//   DARAJA_CALLBACK_SECRET                        optional but recommended, random hex
//                                                 string added to the callback URL

export class DarajaConfigError extends Error {}
export class DarajaRequestError extends Error {
  detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.detail = detail;
  }
}

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  env: 'production' | 'sandbox';
  baseUrl: string;
}

export function getDarajaConfig(): DarajaConfig {
  const consumerKey = Deno.env.get('DARAJA_CONSUMER_KEY') || '';
  const consumerSecret = Deno.env.get('DARAJA_CONSUMER_SECRET') || '';
  const shortcode = (Deno.env.get('DARAJA_SHORTCODE') || '').trim();
  const passkey = Deno.env.get('DARAJA_PASSKEY') || '';
  const env = Deno.env.get('DARAJA_ENV') === 'production' ? 'production' : 'sandbox';

  const missing: string[] = [];
  if (!consumerKey) missing.push('DARAJA_CONSUMER_KEY');
  if (!consumerSecret) missing.push('DARAJA_CONSUMER_SECRET');
  if (!shortcode) missing.push('DARAJA_SHORTCODE');
  if (!passkey) missing.push('DARAJA_PASSKEY');
  if (missing.length) throw new DarajaConfigError('Missing Daraja secrets: ' + missing.join(', '));

  return {
    consumerKey, consumerSecret, shortcode, passkey, env,
    baseUrl: env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
  };
}

// The callback URL Safaricom posts the STK result to. When DARAJA_CALLBACK_SECRET
// is set it rides along as ?s=..., and daraja-callback ignores any request that
// does not carry it. Safaricom callbacks are unsigned, so this is the only way
// to stop a stranger who finds the URL from posting fake results.
export function buildCallbackUrl(): string {
  const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/daraja-callback`;
  const secret = Deno.env.get('DARAJA_CALLBACK_SECRET') || '';
  return secret ? `${base}?s=${encodeURIComponent(secret)}` : base;
}

export function callbackSecretMatches(provided: string | null): boolean {
  const secret = Deno.env.get('DARAJA_CALLBACK_SECRET') || '';
  if (!secret) return true; // not configured, nothing to enforce
  if (!provided || provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

// Kenya has no daylight saving, so East Africa Time is always UTC+3.
export function nairobiTimestamp(now: number = Date.now()): string {
  return new Date(now + 3 * 3600 * 1000).toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

// Accepts 07xx, 01xx, 7xx, 2547xx and +2547xx. Returns 2547XXXXXXXX or null.
export function normalisePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('254')) {
    // already international
  } else if (d.startsWith('0')) {
    d = '254' + d.slice(1);
  } else if (d.length === 9 && (d.startsWith('7') || d.startsWith('1'))) {
    d = '254' + d;
  }
  return /^254[71]\d{8}$/.test(d) ? d : null;
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

export function clearDarajaTokenCache() { cachedToken = null; }

export async function getAccessToken(cfg: DarajaConfig, fetchFn: typeof fetch = fetch): Promise<string> {
  const key = cfg.env + ':' + cfg.consumerKey;
  if (cachedToken && cachedToken.key === key && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const res = await fetchFn(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`) },
  });
  let data: any = {};
  try { data = JSON.parse(await res.text()); } catch (_e) { /* handled below */ }
  if (!res.ok || !data?.access_token) {
    throw new DarajaRequestError(`Safaricom authentication failed (HTTP ${res.status})`);
  }
  const ttl = parseInt(String(data.expires_in || '3599'), 10);
  cachedToken = { key, token: data.access_token, expiresAt: Date.now() + Math.max(60, ttl - 120) * 1000 };
  return data.access_token;
}

async function darajaPost(cfg: DarajaConfig, path: string, body: unknown, fetchFn: typeof fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(cfg, fetchFn);
    const res = await fetchFn(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data: any = {};
    try { data = JSON.parse(await res.text()); } catch (_e) { /* non-JSON body */ }
    // A cached token can go stale, for example after the app credentials are
    // rotated. Drop it and retry once with a fresh one.
    const badToken = res.status === 401 || data?.errorCode === '404.001.03';
    if (badToken && attempt === 0) { clearDarajaTokenCache(); continue; }
    return { status: res.status, data };
  }
  throw new DarajaRequestError('Safaricom rejected the access token');
}

export interface StkPushParams {
  amount: number;
  phone: string;       // 2547XXXXXXXX
  callbackUrl: string;
  accountRef: string;  // shown to the customer, max 12 characters
  desc: string;        // max 13 characters
}

export async function stkPush(cfg: DarajaConfig, p: StkPushParams, fetchFn: typeof fetch = fetch) {
  const timestamp = nairobiTimestamp();
  const body = {
    BusinessShortCode: Number(cfg.shortcode),
    Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(p.amount),
    PartyA: Number(p.phone),
    PartyB: Number(cfg.shortcode),
    PhoneNumber: Number(p.phone),
    CallBackURL: p.callbackUrl,
    AccountReference: p.accountRef.slice(0, 12),
    TransactionDesc: p.desc.slice(0, 13),
  };
  const { status, data } = await darajaPost(cfg, '/mpesa/stkpush/v1/processrequest', body, fetchFn);
  if (String(data?.ResponseCode) !== '0' || !data?.CheckoutRequestID) {
    throw new DarajaRequestError(
      data?.errorMessage || data?.ResponseDescription || `Safaricom rejected the request (HTTP ${status})`,
      data,
    );
  }
  return {
    checkoutRequestId: String(data.CheckoutRequestID),
    merchantRequestId: String(data.MerchantRequestID || ''),
    customerMessage: String(data.CustomerMessage || ''),
  };
}

export interface StkQueryResult {
  state: 'success' | 'failed' | 'pending' | 'error';
  resultCode?: number;
  resultDesc?: string;
}

// Asks Safaricom directly what happened to an STK Push. Used as the safety
// net for a callback that never arrived. The query reply does not carry the
// M-Pesa receipt number or the amount, only whether it succeeded.
export async function stkQuery(cfg: DarajaConfig, checkoutRequestId: string, fetchFn: typeof fetch = fetch): Promise<StkQueryResult> {
  const timestamp = nairobiTimestamp();
  const body = {
    BusinessShortCode: Number(cfg.shortcode),
    Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };
  const { status, data } = await darajaPost(cfg, '/mpesa/stkpushquery/v1/query', body, fetchFn);

  // While the customer has not answered the prompt yet, Safaricom replies
  // with an error saying the transaction is still being processed.
  if (data?.errorCode === '500.001.1001' || /being processed/i.test(String(data?.errorMessage || ''))) {
    return { state: 'pending' };
  }
  if (data?.ResultCode !== undefined && data?.ResultCode !== null && data?.ResultCode !== '') {
    const code = Number(data.ResultCode);
    return code === 0
      ? { state: 'success', resultCode: 0, resultDesc: data.ResultDesc }
      : { state: 'failed', resultCode: code, resultDesc: data.ResultDesc };
  }
  return { state: 'error', resultDesc: data?.errorMessage || `HTTP ${status}` };
}
