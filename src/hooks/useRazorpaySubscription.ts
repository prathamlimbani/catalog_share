import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPlanName, getPlanPrice } from "@/lib/plans";

declare global {
    interface Window {
        Razorpay: any;
    }
}

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Postgres check_violation — the plan id is not in the column's CHECK list. */
const CHECK_VIOLATION = "23514";

/**
 * plpgsql `RAISE EXCEPTION` maps to SQLSTATE P0001, NOT to 23514.
 *
 * `guard_company_subscription_columns()` (migration 20260819000001) raises, so a
 * blocked client write arrives here as P0001. Treating that as a generic failure
 * told a merchant who had just been debited that their payment had not worked,
 * when in fact the guard was doing its job and the edge function is simply the
 * only thing allowed to grant the plan.
 */
const GUARD_VIOLATION = "P0001";

/**
 * Plan ids the *unmigrated* database still accepts.
 *
 * This is a compatibility shim, not the intended behaviour: the real fix is the
 * migration in supabase/migrations/ that widens the CHECK constraints on
 * `subscriptions.plan` and `companies.subscription_plan`. Until it is applied,
 * writing the true plan id fails and the customer is charged with nothing
 * activated — so we retry with the legacy id and shout about it in the console.
 *
 * Both paid-but-unknown ids map to `pro`, never `growth`: growth has
 * unlocksEstimates false (see src/lib/plans.ts), so laundering a 399-rupee
 * estimate_generate payment into it dropped the merchant straight back onto the
 * Estimates lock screen they had just paid to get past. `pro` is the cheapest
 * legacy id carrying both unlocksEstimates and unlocksPremiumSkins, so nobody
 * loses a feature they paid for.
 */
const LEGACY_PLAN_FALLBACK: Record<string, string> = {
    estimate_generate: "pro",
    support: "pro",
};

function warnMigrationMissing(planId: string, fallback: string, where: string) {
    console.warn(
        `[razorpay] ${where}: the database rejected plan "${planId}" (CHECK constraint). ` +
        `Stored "${fallback}" so the payment still activates — APPLY THE MIGRATION IN ` +
        `supabase/migrations/ that allows the estimate_generate and support ids, or these ` +
        `customers keep showing up on the wrong plan.`,
    );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let scriptPromise: Promise<boolean> | null = null;

/**
 * Load checkout.js.
 *
 * Called once at module import so the script is already parsed by the time the
 * user taps Subscribe. Injecting it inside the click handler meant the tap
 * gesture had expired by the time `razorpay.open()` ran, which is why checkout
 * intermittently refused to open on Android.
 */
function loadRazorpayScript(): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(false);
    if (window.Razorpay) return Promise.resolve(true);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<boolean>((resolve) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
        const script = existing ?? document.createElement("script");

        script.addEventListener("load", () => resolve(true));
        script.addEventListener("error", () => {
            // Allow a later retry — the first attempt may simply have been offline.
            scriptPromise = null;
            resolve(false);
        });

        if (!existing) {
            script.src = RAZORPAY_SCRIPT_SRC;
            script.async = true;
            document.head.appendChild(script);
        }
    });

    return scriptPromise;
}

// Warm the gateway as soon as any screen that can sell a plan is loaded.
void loadRazorpayScript();

export type SubscribeSuccessHandler = (paymentId: string) => void;

/** What `create-razorpay-order` hands back. `amount` is in paise. */
interface CreatedOrder {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
}

/**
 * Ask the edge function for a real Razorpay order.
 *
 * Every verifiable payment hangs off this call. Razorpay only returns
 * `razorpay_order_id` and `razorpay_signature` to the checkout handler when
 * checkout was opened WITH an `order_id`; without one there is nothing to HMAC,
 * so `verify-razorpay-payment` can never grant the plan and the charge lands
 * with no activation behind it.
 *
 * Returns null rather than throwing when the function is not deployed yet, so
 * the caller can decide whether to continue in the unverifiable legacy mode.
 */
async function createOrder(planId: string, companyId: string): Promise<CreatedOrder | null> {
    try {
        const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
            body: { planId, companyId },
        });
        if (error || !data?.orderId) {
            console.warn("[billing] create-razorpay-order failed:", error ?? data);
            return null;
        }
        return data as CreatedOrder;
    } catch (err) {
        console.warn("[billing] create-razorpay-order threw:", err);
        return null;
    }
}

/**
 * granted — the server wrote the grant and the plan is live.
 * pending — the payment exists but is not captured yet; nothing may be granted.
 * failed  — the function is unreachable or rejected the call.
 */
type VerifyOutcome = "granted" | "pending" | "failed";

export function useRazorpaySubscription(companyId: string, companyName: string, companyEmail: string) {
    const [loading, setLoading] = useState(false);
    const queryClient = useQueryClient();

    /**
     * `planPrice` is accepted for call-site compatibility but never trusted —
     * the charge always comes from the plan catalogue, so a tampered prop (or a
     * stale hard-coded price in a dialog) cannot change what a customer pays.
     */
    const subscribe = async (
        planId: string,
        planName: string,
        planPrice: number,
        onDialogCloseRequest?: () => void,
        onSuccess?: SubscribeSuccessHandler,
    ) => {
        setLoading(true);

        const canonicalPrice = getPlanPrice(planId);
        if (canonicalPrice <= 0) {
            toast.error("This plan cannot be purchased.");
            setLoading(false);
            return;
        }
        if (planPrice && planPrice !== canonicalPrice) {
            console.warn(
                `[razorpay] caller passed ${planPrice} for "${planId}" but the catalogue says ${canonicalPrice}. Charging the catalogue price.`,
            );
        }

        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
            toast.error("Failed to load payment gateway. Please check your connection and try again.");
            setLoading(false);
            return;
        }

        const createdOrder = await createOrder(planId, companyId);
        if (!createdOrder) {
            // Loud on purpose. The documented rollout gate is "make a test payment,
            // confirm it activates, THEN apply the lock migration". A fallback that
            // only whispered into console.warn turned that gate into a false green
            // light: the client-side write silently succeeds before the migration
            // and silently fails for every customer after it.
            toast.warning(
                "Secure checkout could not be prepared — continuing in unverified mode. Deploy create-razorpay-order before locking the database.",
                { duration: 10000 },
            );
        }

        // The server's key id wins: it is the key the order was actually created
        // under, and paying against a different key is rejected at the gateway.
        const razorpayKeyId = createdOrder?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID;
        if (!razorpayKeyId) {
            toast.error("Payment configuration error.");
            setLoading(false);
            return;
        }

        // Server truth when there is an order; the catalogue price otherwise.
        const amountInPaise = createdOrder?.amount ?? canonicalPrice * 100;
        const displayName = planName || getPlanName(planId);

        /** One verification attempt. Never throws. */
        const runVerify = async (
            paymentId: string | null,
            orderId: string | null,
            signature: string | null,
        ): Promise<VerifyOutcome> => {
            try {
                const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", {
                    body: {
                        razorpay_payment_id: paymentId,
                        razorpay_order_id: orderId,
                        razorpay_signature: signature,
                        plan_id: planId,
                        company_id: companyId,
                    },
                });

                if (error) {
                    console.warn(
                        "[billing] verify-razorpay-payment unavailable. Deploy it with:  " +
                            "supabase functions deploy verify-razorpay-payment",
                        error,
                    );
                    return "failed";
                }
                // 202 is a 2xx, so it arrives as data rather than as an error: the
                // payment is authorised but not captured and must not grant a month.
                if (data?.pending === true) return "pending";
                return data?.ok === true ? "granted" : "failed";
            } catch (err) {
                console.warn("[billing] verify-razorpay-payment threw:", err);
                return "failed";
            }
        };

        const options: Record<string, unknown> = {
            key: razorpayKeyId,
            amount: amountInPaise,
            currency: createdOrder?.currency ?? "INR",
            name: "CatalogShare",
            description: `${displayName} - Monthly Subscription`,
            // Without this the handler receives no order id and no signature, and
            // nothing downstream can prove the payment ever happened.
            ...(createdOrder ? { order_id: createdOrder.orderId } : {}),
            prefill: {
                name: companyName,
                email: companyEmail,
            },
            theme: {
                // Brand orange — hsl(25 95% 53%).
                color: "#f97316",
            },
            handler: async (response: any) => {
                const paymentId: string | null = response?.razorpay_payment_id ?? null;
                // Razorpay echoes the order id back; fall back to the one we created
                // so a trimmed response still verifies.
                const orderId: string | null = response?.razorpay_order_id ?? createdOrder?.orderId ?? null;
                const signature: string | null = response?.razorpay_signature ?? null;

                // 30 days from now.
                const now = new Date();
                const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                /** Emails, cache refresh and navigation. Only once the plan is really live. */
                const announceActivation = () => {
                    // Send invoice email to the company (fire-and-forget)
                    supabase.functions.invoke("send-emails", {
                        body: {
                            type: "invoice",
                            to: companyEmail,
                            companyName,
                            planName: displayName,
                            amount: amountInPaise,
                            paymentId,
                            startsAt: now.toISOString(),
                            expiresAt: expiresAt.toISOString(),
                        },
                    }).catch((e: any) => console.warn("Invoice email failed (non-blocking):", e));

                    // Send admin notification to catalogshare123@gmail.com
                    supabase.functions.invoke("send-emails", {
                        body: {
                            type: "admin_new_subscription",
                            to: companyEmail,
                            companyName,
                            companyEmail,
                            planName: displayName,
                            amount: amountInPaise,
                            expiresAt: expiresAt.toISOString(),
                        },
                    }).catch((e: any) => console.warn("Admin subscription email failed (non-blocking):", e));

                    queryClient.invalidateQueries({ queryKey: ["current-company"] });
                    toast.success(`🎉 Successfully upgraded to ${displayName}!`);
                    if (paymentId) onSuccess?.(paymentId);
                };

                /**
                 * The plan is not live yet but the money is real. Send the merchant to
                 * the receipt screen — it polls for the row — instead of telling them
                 * the payment failed.
                 */
                const announcePending = () => {
                    queryClient.invalidateQueries({ queryKey: ["current-company"] });
                    toast.info("Payment received — your plan is being activated, this can take a moment.", {
                        duration: 8000,
                    });
                    if (paymentId) onSuccess?.(paymentId);
                };

                try {
                    // ---------------------------------------------------------
                    // ACTIVATION
                    //
                    // Server-side first. `verify-razorpay-payment` re-checks the
                    // HMAC signature and re-reads the order from Razorpay before
                    // granting anything, so the plan cannot be self-assigned from
                    // a browser console. The database migration installs a trigger
                    // that REJECTS client writes to subscription_plan, which makes
                    // this path mandatory once the migration has been applied.
                    //
                    // The client-side fallback below exists only so that an install
                    // which has not yet deployed the edge function keeps working.
                    // It is expected to disappear once both are rolled out.
                    // ---------------------------------------------------------
                    const outcome = await runVerify(paymentId, orderId, signature);

                    if (outcome === "granted") {
                        announceActivation();
                        return;
                    }
                    if (outcome === "pending") {
                        // Authorised but not captured. Granting a month here would be
                        // handing over a plan for money that may never arrive.
                        announcePending();
                        return;
                    }

                    const baseRow = {
                        company_id: companyId,
                        razorpay_payment_id: paymentId,
                        razorpay_order_id: orderId,
                        amount: amountInPaise,
                        status: "active",
                        starts_at: now.toISOString(),
                        expires_at: expiresAt.toISOString(),
                    };

                    // Try the real plan id first; only fall back if the DB refuses it.
                    let storedPlan = planId;
                    try {
                        let { error: subError } = await (supabase as any)
                            .from("subscriptions")
                            .insert({ ...baseRow, plan: planId });

                        if (subError?.code === CHECK_VIOLATION && LEGACY_PLAN_FALLBACK[planId]) {
                            storedPlan = LEGACY_PLAN_FALLBACK[planId];
                            warnMigrationMissing(planId, storedPlan, "subscriptions.plan");
                            ({ error: subError } = await (supabase as any)
                                .from("subscriptions")
                                .insert({ ...baseRow, plan: storedPlan }));
                        }

                        if (subError) {
                            console.warn("Subscription record insert failed (non-blocking):", subError);
                        }
                    } catch (subErr: any) {
                        console.warn("Subscription record insert exception (non-blocking):", subErr);
                    }

                    let { error: compError } = await supabase
                        .from("companies")
                        .update({
                            subscription_plan: storedPlan,
                            subscription_expires_at: expiresAt.toISOString(),
                        })
                        .eq("id", companyId);

                    if (compError?.code === CHECK_VIOLATION && LEGACY_PLAN_FALLBACK[storedPlan]) {
                        const legacy = LEGACY_PLAN_FALLBACK[storedPlan];
                        warnMigrationMissing(storedPlan, legacy, "companies.subscription_plan");
                        storedPlan = legacy;
                        ({ error: compError } = await supabase
                            .from("companies")
                            .update({
                                subscription_plan: legacy,
                                subscription_expires_at: expiresAt.toISOString(),
                            })
                            .eq("id", companyId));
                    }

                    if (compError?.code === GUARD_VIOLATION) {
                        // The lock migration is live, so this write was *supposed* to
                        // fail: the edge function is the only thing allowed to grant.
                        // The first verify attempt most likely lost a race with the
                        // gateway (the payment is often still 'authorized' the instant
                        // this handler fires), so retry before saying anything.
                        console.warn(
                            "[billing] client activation is blocked by guard_company_subscription_columns; " +
                            "retrying verify-razorpay-payment.",
                            compError,
                        );
                        for (const delayMs of [1500, 4000]) {
                            await sleep(delayMs);
                            const retry = await runVerify(paymentId, orderId, signature);
                            if (retry === "granted") {
                                announceActivation();
                                return;
                            }
                            // 'pending' will not become 'granted' on the next poll either —
                            // capture happens on Razorpay's clock, not ours.
                            if (retry === "pending") break;
                        }
                        announcePending();
                        return;
                    }

                    if (compError) {
                        console.error("Company plan update failed:", compError);
                        throw compError;
                    }

                    announceActivation();
                } catch (err: any) {
                    console.error("Failed to activate plan:", err);
                    toast.error(
                        paymentId
                            ? `Payment ${paymentId} received but the plan could not be activated. Please contact support with this ID.`
                            : "Payment received but failed to activate plan. Please contact support.",
                        { duration: 12000 },
                    );
                    // Still open the receipt screen: it polls for the row and gives the
                    // merchant a copyable payment id to quote at support.
                    if (paymentId) onSuccess?.(paymentId);
                }
            },
            modal: {
                ondismiss: () => {
                    setLoading(false);
                },
            },
        };

        const razorpay = new window.Razorpay(options);
        razorpay.on("payment.failed", (response: any) => {
            toast.error(`Payment failed: ${response.error.description}`);
            setLoading(false);
        });

        // IMPORTANT: Close any open Radix UI dialog BEFORE opening Razorpay
        if (onDialogCloseRequest) {
            onDialogCloseRequest();
        }

        razorpay.open();
        setLoading(false);
    };

    return { subscribe, loading };
}
