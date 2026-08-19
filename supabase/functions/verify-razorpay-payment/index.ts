/**
 * verify-razorpay-payment
 * =======================
 * The only place a paid plan is allowed to be granted.
 *
 * It re-computes Razorpay's HMAC-SHA256 signature over "order_id|payment_id"
 * with RAZORPAY_KEY_SECRET and refuses to write anything unless it matches.
 * The plan and the amount are then read back from the ORDER stored at Razorpay
 * (created by create-razorpay-order), not from the request body — so a caller
 * cannot pay 199 and claim the 499 plan, and cannot fabricate a payment at all
 * without the secret.
 *
 * Required secrets:
 *   RAZORPAY_KEY_ID             - needed for the Basic auth used to read the order back
 *   RAZORPAY_KEY_SECRET         - signature key. NEVER ship this to the client.
 *   SUPABASE_URL                - injected by the platform
 *   SUPABASE_ANON_KEY           - injected by the platform
 *   SUPABASE_SERVICE_ROLE_KEY   - injected by the platform; used to write the grant
 *
 *   supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
 *
 * Deploy:
 *   supabase functions deploy verify-razorpay-payment
 *
 * Request  (POST, Authorization: Bearer <user jwt>):
 *   { "razorpay_order_id": "order_…", "razorpay_payment_id": "pay_…", "razorpay_signature": "…" }
 * Responses:
 *   200 { "ok": true,  "paymentId": "pay_…", "plan": "estimate_generate", "expiresAt": "2026-09-18T…Z" }
 *   202 { "ok": false, "pending": true, "status": "authorized", … }   money not captured yet
 *   4xx/5xx { "error": "…" }
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Mirror of src/lib/plans.ts — prices in whole rupees. Keep the two in sync. */
const PLAN_PRICES: Record<string, number> = {
  growth: 199,
  pro: 349,
  estimate_generate: 399,
  support: 499,
};

/**
 * Plan ids an unmigrated database still accepts. Identical shim to the one in
 * src/hooks/useRazorpaySubscription.ts — remove both once the CHECK constraints
 * on subscriptions.plan and companies.subscription_plan have been widened.
 *
 * Both map to `pro`, never `growth`: growth has unlocksEstimates false, so
 * laundering a 399-rupee estimate_generate payment into it puts the merchant
 * back on the Estimates lock screen they just paid to get past. `pro` is the
 * cheapest legacy id that unlocks both estimates and the premium skins.
 */
const LEGACY_PLAN_FALLBACK: Record<string, string> = {
  estimate_generate: "pro",
  support: "pro",
};

const CHECK_VIOLATION = "23514";
const SUBSCRIPTION_DAYS = 30;

type Admin = ReturnType<typeof createClient>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison — a plain `===` on a signature leaks it byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Write companies.subscription_plan, retrying with a legacy id if the CHECK
 * constraint on that column has not been widened yet.
 *
 * Safe to call twice for the same payment: it sets an absolute expiry rather
 * than adding days, so a retry cannot stack a second month onto one charge.
 */
async function grantCompanyPlan(
  admin: Admin,
  companyId: string,
  planId: string,
  expiresAtIso: string,
): Promise<{ storedPlan: string; error: unknown }> {
  let storedPlan = planId;
  let { error } = await admin
    .from("companies")
    .update({ subscription_plan: storedPlan, subscription_expires_at: expiresAtIso })
    .eq("id", companyId);

  if ((error as { code?: string } | null)?.code === CHECK_VIOLATION && LEGACY_PLAN_FALLBACK[storedPlan]) {
    const legacy = LEGACY_PLAN_FALLBACK[storedPlan];
    console.warn(
      `[verify] companies.subscription_plan rejected "${storedPlan}" (CHECK constraint); stored "${legacy}" instead. ` +
      `Apply the migration in supabase/migrations/ that widens the plan CHECK constraints.`,
    );
    storedPlan = legacy;
    ({ error } = await admin
      .from("companies")
      .update({ subscription_plan: legacy, subscription_expires_at: expiresAtIso })
      .eq("id", companyId));
  }

  return { storedPlan, error };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      console.error("[verify] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
      return json({ error: "Payment gateway is not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    } | null;

    const orderId = body?.razorpay_order_id ?? "";
    const paymentId = body?.razorpay_payment_id ?? "";
    const signature = (body?.razorpay_signature ?? "").toLowerCase();

    if (!orderId || !paymentId || !signature) {
      return json({ error: "order id, payment id and signature are all required" }, 400);
    }

    // ---- 1. Signature. Nothing below runs unless this passes. ----------------
    const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
    if (!timingSafeEqual(expected, signature)) {
      console.warn("[verify] signature mismatch for", paymentId, "user", user.id);
      return json({ error: "Invalid payment signature" }, 400);
    }

    const basicAuth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

    // ---- 2. What was actually bought, according to Razorpay. -----------------
    const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
      headers: { Authorization: basicAuth },
    });
    const order = await orderRes.json().catch(() => null);
    if (!orderRes.ok || !order?.id) {
      console.error("[verify] could not read order:", orderRes.status, order);
      return json({ error: "Could not verify the order with Razorpay" }, 502);
    }

    const paymentRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: basicAuth },
    });
    const payment = await paymentRes.json().catch(() => null);
    if (!paymentRes.ok || !payment?.id) {
      console.error("[verify] could not read payment:", paymentRes.status, payment);
      return json({ error: "Could not verify the payment with Razorpay" }, 502);
    }

    if (payment.order_id !== orderId) {
      return json({ error: "Payment does not belong to this order" }, 400);
    }

    // 'authorized' means the bank has only put a hold on the funds. If the
    // capture never happens the hold lapses and NOTHING is ever settled to us —
    // so an authorized payment must not buy a month. 202 rather than an error:
    // the customer has done nothing wrong and the payment may still capture, so
    // the client shows "still processing" and the receipt screen keeps polling.
    if (payment.status === "authorized") {
      console.warn("[verify] payment", paymentId, "is authorized but not captured yet");
      return json({
        ok: false,
        pending: true,
        status: payment.status,
        paymentId,
        message: "Payment is still processing. Your plan will activate as soon as it is captured.",
      }, 202);
    }
    if (payment.status !== "captured") {
      return json({ error: `Payment is not complete (status: ${payment.status})` }, 400);
    }
    if (Number(payment.amount) !== Number(order.amount)) {
      return json({ error: "Paid amount does not match the order" }, 400);
    }

    const planId = String(order?.notes?.plan_id ?? "");
    const companyId = String(order?.notes?.company_id ?? "");
    const priceRupees = PLAN_PRICES[planId];

    if (!priceRupees || !companyId) {
      console.error("[verify] order notes are missing plan_id / company_id:", order?.notes);
      return json({ error: "This order was not created by CatalogShare" }, 400);
    }
    if (Number(order.amount) !== priceRupees * 100) {
      console.error("[verify] amount/plan mismatch:", order.amount, planId);
      return json({ error: "Order amount does not match the plan price" }, 400);
    }

    // ---- 3. Grant, with the service role. -----------------------------------
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, owner_id, email, name")
      .eq("id", companyId)
      .maybeSingle();

    if (!company || company.owner_id !== user.id) {
      return json({ error: "This payment belongs to a different account" }, 403);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    const row = {
      company_id: companyId,
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      amount: Number(order.amount),
      status: "active",
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    // Idempotency is enforced by the database, not by a read-then-write: the
    // checkout handler, a retry and the webhook can all be in flight at once, and
    // a SELECT-then-INSERT lets every one of them see "no row" and insert.
    // `subscriptions_razorpay_payment_id_key` (migration 20260819000003) makes the
    // second insert a no-op instead.
    //
    // NOTE: no `onConflict` target on purpose. That index is partial, and Postgres
    // can only infer a partial unique index when the statement repeats its
    // predicate — which PostgREST cannot express. Omitting the target emits a bare
    // `ON CONFLICT DO NOTHING`, which works; adding one fails with 42P10.
    let storedPlan = planId;
    let { data: inserted, error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .upsert({ ...row, plan: storedPlan }, { ignoreDuplicates: true })
      .select("id");

    if ((insertError as { code?: string } | null)?.code === CHECK_VIOLATION && LEGACY_PLAN_FALLBACK[storedPlan]) {
      storedPlan = LEGACY_PLAN_FALLBACK[storedPlan];
      console.warn(
        `[verify] the database rejected plan "${planId}" (CHECK constraint); stored "${storedPlan}" instead. ` +
        `Apply the migration in supabase/migrations/ that widens the plan CHECK constraints.`,
      );
      ({ data: inserted, error: insertError } = await supabaseAdmin
        .from("subscriptions")
        .upsert({ ...row, plan: storedPlan }, { ignoreDuplicates: true })
        .select("id"));
    }
    if (insertError) {
      console.error("[verify] subscription insert failed:", insertError);
      return json({ error: "Payment verified but could not be recorded. Support has been notified." }, 500);
    }

    // Zero rows back from an ignore-duplicates upsert means the row already
    // existed. Do NOT return early: the existing row is very often one the CLIENT
    // wrote just before the guard trigger blocked its companies update, so the
    // plan may still be un-granted. Re-assert the grant against the row's own
    // expiry so a retry can never stack a second month onto one charge.
    const duplicate = !inserted || inserted.length === 0;
    let effectiveExpiry = expiresAt.toISOString();

    if (duplicate) {
      const { data: existing } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan, expires_at")
        .eq("razorpay_payment_id", paymentId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing?.expires_at) effectiveExpiry = String(existing.expires_at);

      // A client-written row records whatever the browser guessed. The order is
      // server truth, so correct the stored plan when the two disagree.
      if (existing && existing.plan !== storedPlan) {
        const { error: fixError } = await supabaseAdmin
          .from("subscriptions")
          .update({ plan: storedPlan })
          .eq("id", existing.id);
        if ((fixError as { code?: string } | null)?.code === CHECK_VIOLATION && LEGACY_PLAN_FALLBACK[storedPlan]) {
          storedPlan = LEGACY_PLAN_FALLBACK[storedPlan];
          await supabaseAdmin.from("subscriptions").update({ plan: storedPlan }).eq("id", existing.id);
        } else if (fixError) {
          console.warn("[verify] could not correct the stored plan (non-blocking):", fixError);
        }
      }
    }

    const grant = await grantCompanyPlan(supabaseAdmin, companyId, storedPlan, effectiveExpiry);
    storedPlan = grant.storedPlan;

    if (grant.error) {
      console.error("[verify] company plan update failed:", grant.error);
      return json({ error: "Payment verified but the plan could not be activated. Please contact support." }, 500);
    }

    return json({ ok: true, paymentId, plan: storedPlan, expiresAt: effectiveExpiry, duplicate });
  } catch (err) {
    console.error("[verify] unexpected failure:", err);
    return json({ error: "Unexpected error" }, 500);
  }
});
