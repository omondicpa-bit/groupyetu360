// GroupYetu360 — verify-2fa-otp Edge Function
// Verifies a submitted OTP against the otp_codes table
// Returns { valid: true } or { valid: false, error: '...' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Email and code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find a valid, unused OTP for this email
    const { data: otpRow, error } = await sb.from('otp_codes')
      .select('id, code, expires_at, used')
      .eq('email', normalizedEmail)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !otpRow) {
      return new Response(
        JSON.stringify({ valid: false, error: 'No valid code found. Please sign in again.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiry
    if (new Date(otpRow.expires_at) < new Date()) {
      await sb.from('otp_codes').update({ used: true }).eq('id', otpRow.id);
      return new Response(
        JSON.stringify({ valid: false, error: 'Code has expired. Please sign in again.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check code — constant-time comparison to prevent timing attacks
    const submitted = String(code).trim();
    const stored = String(otpRow.code).trim();
    if (submitted !== stored) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Incorrect code. Please try again.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark OTP as used — prevents replay attacks
    await sb.from('otp_codes').update({ used: true }).eq('id', otpRow.id);

    // Clean up all old codes for this email
    await sb.from('otp_codes')
      .delete()
      .eq('email', normalizedEmail);

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('verify-2fa-otp error:', err);
    return new Response(
      JSON.stringify({ valid: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
