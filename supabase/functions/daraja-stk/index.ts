// Supabase Edge Function: daraja-stk
// Initiates M-Pesa STK Push via Safaricom Daraja API
// Called by the GroupYetu360 frontend when user clicks "Pay Now via M-Pesa"

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { phone, amount, orgId, paymentType, accountRef, useOrgCredentials } = await req.json();

    if (!phone || !amount || !orgId) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Verify the caller is a real, logged-in member of orgId — this
    // function used to trust orgId/amount/phone from the raw request body
    // with no auth check, meaning anyone could trigger a real STK push
    // (including through an org's OWN Daraja credentials via useOrgCredentials)
    // with no login at all.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Init Supabase admin client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: membership } = await supabase
      .from("user_orgs")
      .select("role")
      .eq("user_id", callerUser.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden — not a member of this organisation" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Get Daraja credentials ────────────────────────────────────────────
    let consumerKey: string, consumerSecret: string, shortcode: string, passkey: string, env: string;

    if (useOrgCredentials) {
      // Org has their own Daraja account (Standard/Pro)
      const { data: org } = await supabase
        .from("organisations")
        .select("daraja_consumer_key,daraja_consumer_secret,daraja_shortcode,daraja_passkey,daraja_env")
        .eq("id", orgId)
        .single();

      if (!org?.daraja_consumer_key) {
        return new Response(JSON.stringify({ success: false, error: "Org Daraja credentials not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      consumerKey = org.daraja_consumer_key;
      consumerSecret = org.daraja_consumer_secret;
      shortcode = org.daraja_shortcode;
      passkey = org.daraja_passkey;
      env = org.daraja_env || "production";
    } else {
      // Use platform Daraja credentials (for subscription payments to EPH)
      consumerKey = Deno.env.get("DARAJA_CONSUMER_KEY") || "";
      consumerSecret = Deno.env.get("DARAJA_CONSUMER_SECRET") || "";
      shortcode = Deno.env.get("DARAJA_SHORTCODE") || "";
      passkey = Deno.env.get("DARAJA_PASSKEY") || "";
      env = Deno.env.get("DARAJA_ENV") || "sandbox";
    }

    if (!consumerKey || !shortcode) {
      return new Response(JSON.stringify({ success: false, error: "Daraja credentials not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const baseUrl = env === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

    // ── Get OAuth token ───────────────────────────────────────────────────
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        "Authorization": "Basic " + btoa(`${consumerKey}:${consumerSecret}`)
      }
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return new Response(JSON.stringify({ success: false, error: "Failed to get Daraja token: " + JSON.stringify(tokenData) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Build STK Push request ────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    // Normalise phone: 0712345678 → 254712345678
    const normalizedPhone = phone.replace(/^0/, "254").replace(/^\+/, "").replace(/\s/g, "");
    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/daraja-callback`;

    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount), // must be integer
      PartyA: normalizedPhone,
      PartyB: shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: callbackUrl,
      AccountReference: accountRef || `GY360-${orgId.slice(0, 8)}`,
      TransactionDesc: `GroupYetu360 ${paymentType || "payment"}`
    };

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(stkBody)
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode !== "0") {
      return new Response(JSON.stringify({
        success: false,
        error: stkData.ResponseDescription || stkData.errorMessage || "STK Push rejected by Safaricom"
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Save pending payment request to DB ────────────────────────────────
    const checkoutId = stkData.CheckoutRequestID;
    await supabase.from("payment_requests").insert({
      org_id: orgId,
      payment_type: paymentType,
      amount,
      status: "pending",
      reference: checkoutId,
      mpesa_ref: null, // filled by callback
      notes: `STK Push initiated — ${normalizedPhone}`,
      requested_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      checkoutRequestId: checkoutId,
      merchantRequestId: stkData.MerchantRequestID,
      message: "STK Push sent to " + normalizedPhone
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
