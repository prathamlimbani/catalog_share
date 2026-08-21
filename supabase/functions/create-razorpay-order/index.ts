/**
 * create-razorpay-order
 * =====================
 * Creates a Razorpay order for a signed-in company owner.
 *
 * The price is looked up HERE, from the constant below, and never taken from
 * the request. The client may only say *which* plan it wants; how much that
 * costs is server truth. Paired with `verify-razorpay-payment`, this is what
 * makes a subscription impossible to grant yourself from the browser console.
 *
 * Required secrets:
 *   RAZORPAY_KEY_ID       - Razorpay API key id (rzp_live_… / rzp_test_…)
 *   RAZORPAY_KEY_SECRET   - Razorpay API key secret. NEVER ship this to the client.
 *   SUPABASE_URL          - injected by the platform
 *   SUPABASE_ANON_KEY     - injected by the platform
 *
 *   supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
 *
 * Deploy:
 *   supabase functions deploy create-razorpay-order
 *
 * Request  (POST, Authorization: Bearer <user jwt>):
 *   { "planId": "estimate_generate", "companyId": "<uuid>" }
 * Response:
 *   { "orderId": "order_…", "amount": 39900, "currency": "INR", "keyId": "rzp_…" }
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

const PLAN_NAMES: Record<string, string> = {
  growth: "Growth Plan",
  pro: "Pro Plan",
  estimate_generate: "Estimate Generator Plan",
  support: "Monthly Support Subscription",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Razorpay will not create an order below one rupee. */
const MIN_ORDER_PAISE = 100;

type CallerClient = ReturnType<typeof createClient>;

/**
 * The plan's price, preferring the editable catalogue over the built-in map.
 *
 * `plans` is world-readable, so the caller-scoped client is enough and no
 * service role is needed here.
 */
async function planPriceRupees(client: CallerClient, planId: string): Promise<number | null> {
  if (!planId) return null;
  try {
    const { data, error } = await client
      .from("plans")
      .select("price")
      .eq("id", planId)
      .maybeSingle();
    if (!error && data && typeof (data as { price?: number }).price === "number") {
      const price = (data as { price: number }).price;
      if (price > 0) return price;
    }
  } catch (err) {
    console.warn("[create-order] plans table unavailable, using fallback prices:", err);
  }
  return PLAN_PRICES[planId] ?? null;
}

interface ResolvedCoupon {
  paise: number;
  percentOff: number;
  code: string | null;
  requestedButUnusable: boolean;
  reason?: string;
}

/**
 * Validate a coupon and price the order.
 *
 * Routed through `validate_coupon`, which applies the same per-company limit,
 * plan scope, window and quota the merchant would hit at any other entry point.
 * Duplicating those checks here would be a second implementation free to
 * disagree with the first.
 */
async function resolveCoupon(
  client: CallerClient,
  planId: string,
  priceRupees: number,
  couponCode: string,
  _companyId: string,
): Promise<ResolvedCoupon> {
  const full = priceRupees * 100;
  if (!couponCode) {
    return { paise: full, percentOff: 0, code: null, requestedButUnusable: false };
  }

  try {
    const { data, error } = await client.rpc("validate_coupon", {
      p_code: couponCode,
      p_plan_id: planId,
    });

    if (error) {
      console.warn("[create-order] validate_coupon unavailable:", error.message);
      return {
        paise: full,
        percentOff: 0,
        code: null,
        requestedButUnusable: true,
        reason: "Coupons are not available right now.",
      };
    }

    const result = (data ?? {}) as { valid?: boolean; percent_off?: number; code?: string; reason?: string };
    if (!result.valid) {
      return {
        paise: full,
        percentOff: 0,
        code: null,
        requestedButUnusable: true,
        reason: result.reason ?? "That coupon cannot be used.",
      };
    }

    const percentOff = Number(result.percent_off ?? 0);
    const discounted = Math.round((full * (100 - percentOff)) / 100);

    return {
      // A 100% coupon leaves nothing chargeable. Razorpay cannot create a zero
      // order, so it is floored at one rupee here and the client is expected to
      // take the direct-grant path instead of coming through this function.
      paise: Math.max(discounted, MIN_ORDER_PAISE),
      percentOff,
      code: result.code ?? couponCode.toUpperCase(),
      requestedButUnusable: false,
    };
  } catch (err) {
    console.warn("[create-order] coupon check failed:", err);
    return {
      paise: full,
      percentOff: 0,
      code: null,
      requestedButUnusable: true,
      reason: "Could not check that coupon. Please try again.",
    };
  }
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
      console.error("[create-order] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
      return json({ error: "Payment gateway is not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Caller-scoped client: RLS applies, so the company lookup below can only
    // ever see rows this user owns.
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null) as {
      planId?: string;
      companyId?: string;
      couponCode?: string;
    } | null;
    const planId = body?.planId ?? "";
    const companyId = body?.companyId ?? "";
    const couponCode = String(body?.couponCode ?? "").trim();

    if (!companyId) return json({ error: "companyId is required" }, 400);

    // The `plans` table is the source of truth so a price edited in the admin
    // console takes effect without redeploying this function. PLAN_PRICES is
    // the fallback for a project where that migration has not been applied.
    const priceRupees = await planPriceRupees(supabaseCaller, planId);
    if (!priceRupees) return json({ error: "Unknown plan" }, 400);

    const { data: company, error: companyError } = await supabaseCaller
      .from("companies")
      .select("id, name, email, owner_id")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      console.error("[create-order] company lookup failed:", companyError);
      return json({ error: "Could not load your company" }, 500);
    }
    if (!company || company.owner_id !== user.id) {
      return json({ error: "You do not own this company" }, 403);
    }

    // The discount is computed HERE from the coupon row, never taken from the
    // client. The amount this returns is what Razorpay charges, and
    // verify-razorpay-payment independently recomputes the same number from the
    // same row — a client that could name its own discount could buy any plan
    // for one rupee.
    const discount = await resolveCoupon(supabaseCaller, planId, priceRupees, couponCode, companyId);
    const amount = discount.paise; // paise

    if (discount.requestedButUnusable) {
      // Better to stop than to silently charge full price to someone who
      // believes they applied a coupon.
      return json({ error: discount.reason ?? "That coupon cannot be used." }, 400);
    }

    // Razorpay caps `receipt` at 40 characters.
    const receipt = `cs_${companyId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`.slice(0, 40);

    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        // The notes are the only trustworthy carrier of "what was bought":
        // verify-razorpay-payment reads them back from Razorpay rather than
        // believing the client.
        notes: {
          plan_id: planId,
          plan_name: PLAN_NAMES[planId] ?? planId,
          company_id: companyId,
          user_id: user.id,
          // Read back from Razorpay at verification time, so the discount is
          // re-derived rather than trusted.
          coupon_code: discount.code ?? "",
        },
      }),
    });

    const order = await razorpayResponse.json().catch(() => null);
    if (!razorpayResponse.ok || !order?.id) {
      console.error("[create-order] Razorpay rejected the order:", razorpayResponse.status, order);
      return json({ error: "Could not start the payment. Please try again." }, 502);
    }

    return json({
      orderId: order.id,
      amount: order.amount ?? amount,
      currency: order.currency ?? "INR",
      keyId,
      couponCode: discount.code ?? null,
      percentOff: discount.percentOff,
      originalAmount: priceRupees * 100,
    });
  } catch (err) {
    console.error("[create-order] unexpected failure:", err);
    return json({ error: "Unexpected error" }, 500);
  }
});
