// Supabase Edge Function: daraja-callback
// Safaricom calls this URL when the STK Push payment is completed or fails
// This is the CALLBACK URL set in daraja-stk — must be publicly accessible

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // Safaricom sends POST with JSON body
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse callback ────────────────────────────────────────────────────
    const result = body?.Body?.stkCallback;
    if (!result) {
      return new Response("Invalid callback structure", { status: 400 });
    }

    const checkoutRequestId = result.CheckoutRequestID;
    const merchantRequestId = result.MerchantRequestID;
    const resultCode = result.ResultCode; // 0 = success, anything else = failed/cancelled
    const resultDesc = result.ResultDesc;

    // Find the pending payment request — filtering on status='pending' is the
    // idempotency guard. Safaricom retries callbacks under real network/timeout
    // conditions; without this filter, a retried successful callback would
    // double-credit SMS bundles or subscription extensions for one real payment.
    const { data: payReq } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("reference", checkoutRequestId)
      .eq("status", "pending")
      .maybeSingle();

    if (!payReq) {
      console.log("No PENDING payment request found for checkout ID (already processed, or unknown):", checkoutRequestId);
      return new Response("OK", { status: 200 });
    }

    if (resultCode === 0) {
      // ── SUCCESSFUL PAYMENT ────────────────────────────────────────────
      // Extract M-Pesa receipt from callback metadata
      const items = result.CallbackMetadata?.Item || [];
      const getItem = (name: string) => items.find((i: any) => i.Name === name)?.Value;

      const mpesaReceipt  = getItem("MpesaReceiptNumber");
      const transAmount   = getItem("Amount");
      const phoneNumber   = getItem("PhoneNumber");
      const transDate     = getItem("TransactionDate"); // format: 20231218123456

      // Update payment request to approved
      await supabase.from("payment_requests").update({
        status: "approved",
        mpesa_ref: mpesaReceipt,
        approved_at: new Date().toISOString(),
        notes: `STK Push confirmed — ${phoneNumber} — Receipt: ${mpesaReceipt}`,
      }).eq("id", payReq.id);

      // ── Activate subscription or add SMS bundle ───────────────────────
      const paymentType = payReq.payment_type || "";
      const orgId = payReq.org_id;
      const updates: Record<string, any> = {};
      const today = new Date();

      const parts = paymentType.split("+");
      for (const part of parts) {
        if (part.startsWith("subscription_")) {
          const plan = part.replace("subscription_", "");
          const expiry = new Date(today);
          expiry.setFullYear(expiry.getFullYear() + 1);
          updates.plan = plan;
          updates.subscription_status = "active";
          updates.subscription_expires = expiry.toISOString().split("T")[0];
          updates.subscription_paid_date = today.toISOString().split("T")[0];
        } else if (part.startsWith("sms_bundle_")) {
          const smsCount = parseInt(part.replace("sms_bundle_", "")) || 0;
          const { data: org } = await supabase
            .from("organisations").select("sms_bundle").eq("id", orgId).single();
          updates.sms_bundle = (org?.sms_bundle || 0) + smsCount;
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("organisations").update(updates).eq("id", orgId);
      }

      // Log activity
      await supabase.from("activity_log").insert({
        org_id: orgId,
        action: "STK PAYMENT CONFIRMED",
        details: `M-Pesa STK Push confirmed. Receipt: ${mpesaReceipt}, Amount: Ksh ${transAmount}`,
        user_role: "system",
      }).catch(() => {}); // activity log is optional

      console.log("[daraja-callback] Payment confirmed:", mpesaReceipt, "for org:", orgId);

    } else {
      // ── FAILED / CANCELLED ────────────────────────────────────────────
      // ResultCode 1032 = user cancelled, 1037 = DS timeout, 2001 = wrong PIN
      await supabase.from("payment_requests").update({
        status: "declined",
        notes: `STK Push failed/cancelled: ${resultDesc} (code ${resultCode})`,
      }).eq("id", payReq.id);

      console.log("[daraja-callback] Payment failed:", resultCode, resultDesc);
    }

    // Always return 200 to Safaricom to acknowledge receipt
    return new Response("OK", { status: 200 });

  } catch (e) {
    console.error("[daraja-callback] Error:", e.message);
    // Still return 200 — Safaricom will retry on non-200
    return new Response("OK", { status: 200 });
  }
});
