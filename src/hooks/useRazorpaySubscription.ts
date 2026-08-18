import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

declare global {
    interface Window {
        Razorpay: any;
    }
}

export function useRazorpaySubscription(companyId: string, companyName: string, companyEmail: string) {
    const [loading, setLoading] = useState(false);
    const queryClient = useQueryClient();

    const loadRazorpayScript = (): Promise<boolean> => {
        return new Promise((resolve) => {
            if (window.Razorpay) {
                resolve(true);
                return;
            }
            const script = document.createElement("script");
            script.src = "https://checkout.razorpay.com/v1/checkout.js";
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.body.appendChild(script);
        });
    };

    const subscribe = async (planId: string, planName: string, planPrice: number, onDialogCloseRequest?: () => void) => {
        setLoading(true);

        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
            toast.error("Failed to load payment gateway. Please try again.");
            setLoading(false);
            return;
        }

        const razorpayKeyId = import.meta.env.VITE_RAZORPAY_KEY_ID;
        if (!razorpayKeyId) {
            toast.error("Payment configuration error.");
            setLoading(false);
            return;
        }

        const amountInPaise = planPrice * 100;

        const options = {
            key: razorpayKeyId,
            amount: amountInPaise,
            currency: "INR",
            name: "CatalogShare",
            description: `${planName} - Monthly Subscription`,
            prefill: {
                name: companyName,
                email: companyEmail,
            },
            theme: {
                color: "#6366f1",
            },
            handler: async (response: any) => {
                try {
                    // Calculate expiry (30 days from now)
                    const now = new Date();
                    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                    // Database has a strict CHECK constraint for subscription_plan: 'free', 'growth', 'pro'
                    // We map our new plans to the existing DB ENUM values so payment successfully saves.
                    let dbPlanId = planId;
                    if (planId === "estimate_generate") dbPlanId = "growth";
                    if (planId === "support") dbPlanId = "pro";

                    // Save subscription record (non-blocking - don't let this fail the whole flow)
                    try {
                        const { error: subError } = await (supabase as any).from("subscriptions").insert({
                            company_id: companyId,
                            plan: dbPlanId,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_order_id: response.razorpay_order_id || null,
                            amount: amountInPaise,
                            status: "active",
                            starts_at: now.toISOString(),
                            expires_at: expiresAt.toISOString(),
                        });
                        if (subError) {
                            console.warn("Subscription record insert failed (non-blocking):", subError);
                        }
                    } catch (subErr: any) {
                        console.warn("Subscription record insert exception (non-blocking):", subErr);
                    }

                    // Update company plan — this is the critical step
                    const { error: compError } = await supabase
                        .from("companies")
                        .update({
                            subscription_plan: dbPlanId,
                            subscription_expires_at: expiresAt.toISOString(),
                        })
                        .eq("id", companyId);

                    if (compError) {
                        console.error("Company plan update failed:", compError);
                        throw compError;
                    }

                    // Send invoice email to the company (fire-and-forget)
                    supabase.functions.invoke("send-emails", {
                        body: {
                            type: "invoice",
                            to: companyEmail,
                            companyName,
                            planName,
                            amount: amountInPaise,
                            paymentId: response.razorpay_payment_id || null,
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
                            planName,
                            amount: amountInPaise,
                            expiresAt: expiresAt.toISOString(),
                        },
                    }).catch((e: any) => console.warn("Admin subscription email failed (non-blocking):", e));

                    // Refresh data
                    queryClient.invalidateQueries({ queryKey: ["current-company"] });

                    toast.success(`🎉 Successfully upgraded to ${planName}! Invoice sent to your email.`);
                } catch (err: any) {
                    console.error("Failed to activate plan:", err);
                    toast.error("Payment received but failed to activate plan. Please contact support.");
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
