import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPlanName, getPlanPrice } from "@/lib/plans";
import { getEntitlement, type CompanyLike } from "@/lib/entitlement";
import { cacheEntitlementSnapshot } from "@/hooks/useEntitlement";
import { companyKey } from "@/hooks/useCompany";
import { mirrorCompany } from "@/lib/offline/mirror";
import { prefGetJSON, prefSetJSON } from "@/native/prefs";

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

// ---------------------------------------------------------------------------
// Replayable proof of payment
// ---------------------------------------------------------------------------

/**
 * Razorpay hands the signed triple (payment id, order id, signature) to the
 * checkout handler exactly once, in memory. If the edge function is down, the
 * radio drops or the user kills the app in the next second, that proof is gone
 * for good and the merchant is left with a debit and no plan — which is the
 * whole reason "Restore purchase" used to be a support email.
 *
 * So the triple is written to durable storage BEFORE the first verify attempt
 * and only cleared once the server has actually granted the plan. Restore
 * replays it, and the server re-checks the HMAC and the order ownership exactly
 * as it does during checkout: the client still cannot grant itself anything.
 */
export interface VerifyTicket {
    paymentId: string;
    orderId: string;
    signature: string;
    planId: string;
    /** Epoch ms the payment was made, so the newest is replayed first. */
    at: number;
}

/** Newest first; enough to cover a retry storm without growing without bound. */
const TICKET_LIMIT = 5;

const ticketsKey = (companyId: string) => `cs_verify_tickets_${companyId}`;

export async function readVerifyTickets(companyId: string): Promise<VerifyTicket[]> {
    if (!companyId) return [];
    const raw = await prefGetJSON<VerifyTicket[]>(ticketsKey(companyId), []);
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((t) => t && typeof t.paymentId === "string" && typeof t.signature === "string")
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

async function rememberVerifyTicket(companyId: string, ticket: VerifyTicket): Promise<void> {
    if (!companyId) return;
    const existing = await readVerifyTickets(companyId);
    const next = [ticket, ...existing.filter((t) => t.paymentId !== ticket.paymentId)].slice(0, TICKET_LIMIT);
    await prefSetJSON(ticketsKey(companyId), next);
}

async function forgetVerifyTicket(companyId: string, paymentId: string): Promise<void> {
    if (!companyId || !paymentId) return;
    const existing = await readVerifyTickets(companyId);
    await prefSetJSON(ticketsKey(companyId), existing.filter((t) => t.paymentId !== paymentId));
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * granted — the server wrote the grant and the plan is live.
 * pending — the payment exists but is not captured yet; nothing may be granted.
 * failed  — the function is unreachable or rejected the call.
 */
export type VerifyOutcome = "granted" | "pending" | "failed";

interface VerifyArgs {
    paymentId: string | null;
    orderId: string | null;
    signature: string | null;
    planId: string;
    companyId: string;
}

/** One verification attempt against the edge function. Never throws. */
export async function invokeVerify(args: VerifyArgs): Promise<VerifyOutcome> {
    try {
        const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", {
            body: {
                razorpay_payment_id: args.paymentId,
                razorpay_order_id: args.orderId,
                razorpay_signature: args.signature,
                plan_id: args.planId,
                company_id: args.companyId,
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
}

// ---------------------------------------------------------------------------
// Making the unlock instant
// ---------------------------------------------------------------------------

/** Read the company row straight from Postgres, bypassing every cache. */
async function fetchCompanyRow(companyId: string): Promise<Record<string, any> | null> {
    try {
        const { data, error } = await supabase
            .from("companies")
            .select("*")
            .eq("id", companyId)
            .maybeSingle();
        if (error) throw error;
        return (data as Record<string, any> | null) ?? null;
    } catch (err) {
        console.warn("[billing] could not re-read the company row:", err);
        return null;
    }
}

function rowIsPaid(row: Record<string, any> | null | undefined): boolean {
    return getEntitlement((row ?? null) as CompanyLike | null).isPaid;
}

/**
 * Push a freshly granted plan into every place the app reads entitlement from,
 * synchronously enough that the paywall is gone before the success toast lands.
 *
 * This is what "instant unlock" actually means. The company row is cached by
 * react-query with a five minute staleTime, so simply marking it invalid left a
 * paying merchant staring at the lock screen until the cache aged out. The row
 * is therefore re-read once and WRITTEN INTO the cache (both the scoped
 * `["current-company", userId]` key that useEntitlement reads and the
 * `["billing-company", userId]` key the Billing page reads), mirrored for
 * offline, and snapshotted into Preferences — after which every mounted
 * `useEntitlement` recomputes, the paywall unmounts and `applyEntitlement`
 * tears the ad banner down, all off the same value.
 *
 * Returns the fresh row, or null when it could not be read.
 */
export async function activateEntitlementNow(
    queryClient: QueryClient,
    companyId: string,
): Promise<Record<string, any> | null> {
    if (!companyId) return null;

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id ?? null;

    const row = await fetchCompanyRow(companyId);

    if (row) {
        // Seed rather than invalidate: an invalidation only schedules a refetch,
        // and the UI has to keep rendering the stale plan until it returns.
        queryClient.setQueryData(companyKey(userId), row);
        queryClient.setQueryData(["billing-company", userId ?? "anon"], row);
        await cacheEntitlementSnapshot(row as CompanyLike);
        void mirrorCompany(row);
    }

    // Prefix invalidation covers observers we did not seed by hand (a second
    // account's key, the payment history, the product allowance).
    void queryClient.invalidateQueries({ queryKey: ["current-company"] });
    void queryClient.invalidateQueries({ queryKey: ["billing-company"] });
    void queryClient.invalidateQueries({ queryKey: ["billing-payments"] });
    void queryClient.invalidateQueries({ queryKey: ["billing-product-count"] });

    return row;
}

/**
 * Backoff for an authorised-but-uncaptured payment.
 *
 * Capture happens on Razorpay's clock — usually within seconds, occasionally
 * after a bank round trip — so a single retry is not enough and a tight loop is
 * rude to both the gateway and the battery. Roughly half a minute in total,
 * after which the merchant is told the truth and pointed at Restore purchase.
 */
const ACTIVATION_POLL_DELAYS_MS = [2000, 4000, 8000, 15000];

/**
 * Wait for a pending payment to become a live plan.
 *
 * Each round re-runs verification (which is what notices the capture) and then
 * re-reads the company row (which is what notices a webhook that got there
 * first). Resolves true the moment the plan is live, with every cache already
 * refreshed.
 */
export async function pollForActivation(
    queryClient: QueryClient,
    companyId: string,
    retryVerify?: () => Promise<VerifyOutcome>,
): Promise<boolean> {
    for (const delayMs of ACTIVATION_POLL_DELAYS_MS) {
        await sleep(delayMs);

        if (retryVerify) {
            const outcome = await retryVerify();
            if (outcome === "granted") {
                const row = await activateEntitlementNow(queryClient, companyId);
                if (rowIsPaid(row)) return true;
            }
        }

        // A webhook or a concurrent tab may have granted it in the meantime.
        const row = await fetchCompanyRow(companyId);
        if (rowIsPaid(row)) {
            await activateEntitlementNow(queryClient, companyId);
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Restore purchase
// ---------------------------------------------------------------------------

/**
 * What a restore attempt found. Each case is reported to the merchant
 * differently — "nothing found" and "we found your payment but cannot verify
 * it" are very different messages to receive after being charged.
 */
export type RestoreOutcome =
    | { kind: "restored"; planName: string }
    | { kind: "already_active"; planName: string }
    | { kind: "unverified"; paymentId: string }
    | { kind: "none" }
    /** The account itself could not be read — a connection problem, not a payment one. */
    | { kind: "error" };

/** The most recent still-valid subscription row, if the server has one. */
async function findActiveSubscription(
    companyId: string,
): Promise<{ paymentId: string; orderId: string } | null> {
    try {
        const { data, error } = await (supabase as any)
            .from("subscriptions")
            .select("razorpay_payment_id, razorpay_order_id, status, expires_at, created_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(10);
        if (error) throw error;

        const now = Date.now();
        const row = ((data ?? []) as Record<string, any>[]).find((r) => {
            const status = String(r.status ?? "").trim().toLowerCase();
            const expires = Date.parse(String(r.expires_at ?? ""));
            return status === "active" && Number.isFinite(expires) && expires > now;
        });
        if (!row) return null;

        return {
            paymentId: String(row.razorpay_payment_id ?? ""),
            orderId: String(row.razorpay_order_id ?? ""),
        };
    } catch (err) {
        console.warn("[billing] could not read the subscription history:", err);
        return null;
    }
}

/**
 * Re-check and repair this account's entitlement.
 *
 * Safe to run repeatedly: it never writes the plan itself. Where the company
 * row and the subscription history disagree it replays the signed proof of
 * payment through `verify-razorpay-payment`, so the SERVER re-checks the HMAC
 * and re-reads the order from Razorpay before granting anything. Writing
 * `companies.subscription_plan` from here would be rejected by the guard
 * trigger anyway — and that guard is exactly the hole the server flow closes.
 */
export async function restorePurchase(
    queryClient: QueryClient,
    companyId: string,
): Promise<RestoreOutcome> {
    if (!companyId) return { kind: "none" };

    // What the app believed before we looked, so "restored" can be told apart
    // from "you were already up to date".
    const previous =
        queryClient
            .getQueriesData<Record<string, any> | null>({ queryKey: ["current-company"] })
            .map(([, row]) => row)
            .find((row) => row && row.id === companyId) ?? null;
    const wasPaid = rowIsPaid(previous);

    // 1. The row may simply have been stale on this device.
    let row = await activateEntitlementNow(queryClient, companyId);
    // No row at all means we never reached the account, so "no payment found"
    // would be a lie — and the worst possible lie to tell someone who has just
    // been debited.
    if (!row) return { kind: "error" };
    if (rowIsPaid(row)) {
        const planName = getPlanName(String(row?.subscription_plan ?? ""));
        return wasPaid ? { kind: "already_active", planName } : { kind: "restored", planName };
    }

    // 2. Replay whatever signed proof this device still holds, newest first.
    const tickets = await readVerifyTickets(companyId);
    /** A payment the gateway has authorised but not captured yet. */
    let pendingPaymentId = "";

    for (const ticket of tickets) {
        const outcome = await invokeVerify({
            paymentId: ticket.paymentId,
            orderId: ticket.orderId,
            signature: ticket.signature,
            planId: ticket.planId,
            companyId,
        });

        if (outcome === "pending" && !pendingPaymentId) pendingPaymentId = ticket.paymentId;
        if (outcome !== "granted") continue;

        row = await activateEntitlementNow(queryClient, companyId);
        if (rowIsPaid(row)) {
            void forgetVerifyTicket(companyId, ticket.paymentId);
            return { kind: "restored", planName: getPlanName(String(row?.subscription_plan ?? "")) };
        }
    }

    // The freshest fact wins: a payment still waiting on capture is a better
    // thing to show than an older one nobody can verify.
    if (pendingPaymentId) return { kind: "unverified", paymentId: pendingPaymentId };

    // 3. The server has a paid subscription the company row does not reflect,
    //    but this device holds no signature to replay (a reinstall, or the
    //    payment was made on another phone). Only support can repair that, so
    //    hand over the id they will be asked for.
    const active = await findActiveSubscription(companyId);
    if (active?.paymentId) return { kind: "unverified", paymentId: active.paymentId };
    if (tickets.length > 0) return { kind: "unverified", paymentId: tickets[0].paymentId };

    return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

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

export function useRazorpaySubscription(companyId: string, companyName: string, companyEmail: string) {
    const [loading, setLoading] = useState(false);
    /** True from the moment checkout returns until the plan is live (or given up on). */
    const [verifying, setVerifying] = useState(false);
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

                setVerifying(true);

                // Durable proof BEFORE the first attempt — see VerifyTicket. If the
                // next line is where the network dies, this is what Restore replays.
                if (paymentId && orderId && signature) {
                    await rememberVerifyTicket(companyId, {
                        paymentId,
                        orderId,
                        signature,
                        planId,
                        at: Date.now(),
                    });
                }

                const runVerify = () =>
                    invokeVerify({ paymentId, orderId, signature, planId, companyId });

                // 30 days from now.
                const now = new Date();
                const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                /** Emails, cache refresh and navigation. Only once the plan is really live. */
                const announceActivation = async () => {
                    // The unlock comes FIRST. Awaiting it here is what guarantees the
                    // paywall is already gone by the time the toast is on screen.
                    await activateEntitlementNow(queryClient, companyId);
                    if (paymentId) void forgetVerifyTicket(companyId, paymentId);

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

                    toast.success(`🎉 ${displayName} is active — Estimates are unlocked.`);
                    if (paymentId) onSuccess?.(paymentId);
                };

                /**
                 * The plan is not live yet but the money is real. Keep working at it
                 * with a backoff instead of telling the merchant the payment failed,
                 * and be honest about the state if it is still not settled.
                 */
                const announcePending = async () => {
                    toast.info("Payment received — confirming it with your bank…", { duration: 6000 });

                    if (await pollForActivation(queryClient, companyId, runVerify)) {
                        await announceActivation();
                        return;
                    }

                    toast.warning(
                        "Payment received. Your bank has not confirmed it yet, so the plan is not live " +
                        "at this moment. It usually clears within a few minutes — open Billing and tap " +
                        "Restore purchase to finish it off.",
                        { duration: 12000 },
                    );
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
                    const outcome = await runVerify();

                    if (outcome === "granted") {
                        await announceActivation();
                        return;
                    }
                    if (outcome === "pending") {
                        // Authorised but not captured. Granting a month here would be
                        // handing over a plan for money that may never arrive.
                        await announcePending();
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
                            const retry = await runVerify();
                            if (retry === "granted") {
                                await announceActivation();
                                return;
                            }
                            // 'pending' will not become 'granted' on the next poll either —
                            // capture happens on Razorpay's clock, not ours.
                            if (retry === "pending") break;
                        }
                        await announcePending();
                        return;
                    }

                    if (compError) {
                        console.error("Company plan update failed:", compError);
                        throw compError;
                    }

                    await announceActivation();
                } catch (err: any) {
                    console.error("Failed to activate plan:", err);
                    toast.error(
                        paymentId
                            ? `Payment ${paymentId} received but the plan could not be activated. Open Billing and tap Restore purchase, or contact support with this ID.`
                            : "Payment received but failed to activate plan. Open Billing and tap Restore purchase.",
                        { duration: 12000 },
                    );
                    // Still open the receipt screen: it polls for the row and gives the
                    // merchant a copyable payment id to quote at support.
                    if (paymentId) onSuccess?.(paymentId);
                } finally {
                    setVerifying(false);
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

    // `loading` folds in the post-checkout verification so a Subscribe button
    // cannot be tapped a second time while the first payment is still settling.
    return { subscribe, loading: loading || verifying, verifying };
}
