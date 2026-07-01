// GroupYetu360 — send-2fa-otp Edge Function
// Generates a 6-digit OTP, stores it in otp_codes table, emails it via Resend
// Uses SERVICE ROLE key — never exposed to browser

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Use service role client — bypasses RLS to write to otp_codes
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Clean up any existing unused OTPs for this email
    await sb.from('otp_codes')
      .delete()
      .eq('email', normalizedEmail)
      .eq('used', false);

    // Generate 6-digit OTP server-side
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    // Store OTP with 5-minute expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: insertErr } = await sb.from('otp_codes').insert({
      email: normalizedEmail,
      code: otp,
      expires_at: expiresAt,
      used: false,
    });

    if (insertErr) {
      console.error('OTP insert error:', insertErr);
      return new Response(
        JSON.stringify({ error: 'Failed to generate code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send OTP email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'GroupYetu360 <info@groupyetu.org>',
        to: [normalizedEmail],
        subject: 'Your GroupYetu360 sign-in code',
        html: `
          <!DOCTYPE html>
          <html>
          <body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
            <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
              <div style="background:#800020;padding:24px 32px">
                <div style="font-size:22px;font-weight:700;color:#fff">
                  GroupYetu<span style="color:#e0b84a">360</span>
                </div>
                <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;letter-spacing:.08em;text-transform:uppercase">
                  Community Management
                </div>
              </div>
              <div style="padding:32px">
                <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:8px">
                  Your sign-in verification code
                </div>
                <div style="font-size:13px;color:#6b7280;margin-bottom:28px;line-height:1.6">
                  Enter this code in the GroupYetu360 app to complete your sign-in.
                  This code expires in <strong>5 minutes</strong>.
                </div>
                <div style="background:#f4f9f7;border:2px solid #0f6e56;border-radius:8px;padding:20px;text-align:center;margin-bottom:28px">
                  <div style="font-size:38px;font-weight:700;color:#800020;letter-spacing:10px;font-family:monospace">
                    ${otp}
                  </div>
                </div>
                <div style="font-size:12px;color:#9ca3af;line-height:1.6">
                  If you did not try to sign in to GroupYetu360, please ignore this email.
                  Do not share this code with anyone — EPH Technologies staff will never ask for it.
                </div>
              </div>
              <div style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #e5e7eb">
                <div style="font-size:11px;color:#9ca3af">
                  © 2026 EPH Technologies Limited · groupyetu.org
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.text();
      console.error('Resend error:', emailErr);
      return new Response(
        JSON.stringify({ error: 'Failed to send email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('send-2fa-otp error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
