import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Zap, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

declare global {
    interface Window {
        Razorpay: any;
    }
}

interface Plan {
    id: string;
    name: string;
    price: number; // in INR
    priceLabel: string;
    productLimit: number;
    features: string[];
    icon: React.ReactNode;
    popular?: boolean;
    gradient: string;
    buttonLabel: string;
    buttonClass: string;
}

const PLANS: Plan[] = [
    {
        id: "free",
        name: "Free Plan",
        price: 0,
        priceLabel: "FREE",
        productLimit: 40,
        features: ["40 Products", "Basic Listing", "Standard Support"],
        icon: <Zap className="h-5 w-5" />,
        gradient: "from-emerald-500/10 to-teal-500/10",
        buttonLabel: "Current Plan",
        buttonClass: "bg-muted text-muted-foreground",
    },
    {
        id: "growth",
        name: "Growth Plan",
        price: 199,
        priceLabel: "₹199/month",
        productLimit: 300,
        features: ["Up to 300 Products", "Better Visibility", "Standard Support"],
        icon: <Sparkles className="h-5 w-5" />,
        gradient: "from-blue-500/10 to-cyan-500/10",
        buttonLabel: "Subscribe",
        buttonClass: "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white",
    },
    {
        id: "pro",
        name: "Pro Plan",
        price: 349,
        priceLabel: "₹349/month",
        productLimit: 9999,
        features: ["500+ Products", "Custom Branding with Logo & Domain", "Priority Support", "Featured Listing"],
        icon: <Crown className="h-5 w-5" />,
        popular: true,
        gradient: "from-purple-500/10 to-pink-500/10",
        buttonLabel: "Upgrade",
        buttonClass: "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white",
    },
];

export function getPlanLimit(plan: string): number {
    const found = PLANS.find((p) => p.id === plan);
    return found?.productLimit || 40;
}

export function getPlanName(plan: string): string {
    const found = PLANS.find((p) => p.id === plan);
    return found?.name || "Free Plan";
}

interface SubscriptionDialogProps {
    companyId: string;
    companyName: string;
    companyEmail: string;
    currentPlan: string;
    children: React.ReactNode;
}

export function SubscriptionDialog({ companyId, companyName, companyEmail, currentPlan, children }: SubscriptionDialogProps) {
    const [open, setOpen] = useState(false);
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

    const handleSubscribe = async (plan: Plan) => {
        if (plan.id === "free" || plan.id === currentPlan) return;

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

        const amountInPaise = plan.price * 100;

        const options = {
            key: razorpayKeyId,
            amount: amountInPaise,
            currency: "INR",
            name: "CatalogShare",
            description: `${plan.name} - Monthly Subscription`,
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

                    // Save subscription record
                    const { error: subError } = await (supabase as any).from("subscriptions").insert({
                        company_id: companyId,
                        plan: plan.id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_order_id: response.razorpay_order_id || null,
                        amount: amountInPaise,
                        status: "active",
                        starts_at: now.toISOString(),
                        expires_at: expiresAt.toISOString(),
                    });

                    if (subError) throw subError;

                    // Update company plan
                    const { error: compError } = await supabase
                        .from("companies")
                        .update({
                            subscription_plan: plan.id,
                            subscription_expires_at: expiresAt.toISOString(),
                        })
                        .eq("id", companyId);

                    if (compError) throw compError;

                    // Send invoice email to the company (fire-and-forget)
                    supabase.functions.invoke("send-emails", {
                        body: {
                            type: "invoice",
                            to: companyEmail,
                            companyName,
                            planName: plan.name,
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
                            planName: plan.name,
                            amount: amountInPaise,
                            expiresAt: expiresAt.toISOString(),
                        },
                    }).catch((e: any) => console.warn("Admin subscription email failed (non-blocking):", e));

                    // Refresh data
                    queryClient.invalidateQueries({ queryKey: ["current-company"] });

                    toast.success(`🎉 Successfully upgraded to ${plan.name}! Invoice sent to your email.`);
                } catch (err: any) {
                    console.error("Failed to record subscription:", err);
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

        // IMPORTANT: Close the Dialog BEFORE opening Razorpay.
        // The Radix UI Dialog overlay captures pointer events (pointer-events: all),
        // which blocks clicks inside the Razorpay iframe popup.
        // Closing the Dialog removes the overlay from the DOM so Razorpay works normally.
        setOpen(false);
        razorpay.open();
        setLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-center text-2xl font-extrabold tracking-tight">
                        Choose Your Plan
                    </DialogTitle>
                    <p className="text-center text-muted-foreground text-sm mt-1">
                        Unlock more products and premium features
                    </p>
                </DialogHeader>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
                    {PLANS.map((plan) => {
                        const isCurrentPlan = plan.id === currentPlan;
                        const isDowngrade =
                            (currentPlan === "pro" && plan.id !== "pro") ||
                            (currentPlan === "growth" && plan.id === "free");

                        return (
                            <Card
                                key={plan.id}
                                className={`relative overflow-hidden transition-all hover:shadow-lg ${plan.popular ? "ring-2 ring-purple-500 shadow-purple-500/10" : ""
                                    } ${isCurrentPlan ? "ring-2 ring-primary" : ""}`}
                            >
                                {plan.popular && (
                                    <div className="absolute top-0 right-0">
                                        <Badge className="rounded-none rounded-bl-lg bg-purple-600 hover:bg-purple-600 text-white text-[10px] font-bold px-2 py-1">
                                            MOST POPULAR
                                        </Badge>
                                    </div>
                                )}
                                {isCurrentPlan && (
                                    <div className="absolute top-0 left-0">
                                        <Badge className="rounded-none rounded-br-lg bg-primary hover:bg-primary text-primary-foreground text-[10px] font-bold px-2 py-1">
                                            CURRENT
                                        </Badge>
                                    </div>
                                )}

                                <CardContent className={`p-5 bg-gradient-to-br ${plan.gradient}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="p-2 rounded-lg bg-background/80 shadow-sm">
                                            {plan.icon}
                                        </div>
                                        <h3 className="font-bold text-lg">{plan.name}</h3>
                                    </div>

                                    <div className="mb-4">
                                        {plan.price === 0 ? (
                                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-lg px-3 py-1">
                                                FREE
                                            </Badge>
                                        ) : (
                                            <p className="text-2xl font-extrabold">
                                                ₹{plan.price}
                                                <span className="text-sm font-normal text-muted-foreground">/month</span>
                                            </p>
                                        )}
                                    </div>

                                    <ul className="space-y-2 mb-5">
                                        {plan.features.map((f, i) => (
                                            <li key={i} className="flex items-center gap-2 text-sm">
                                                <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                                                <span>{f}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <Button
                                        className={`w-full font-bold ${isCurrentPlan ? "bg-muted text-muted-foreground cursor-default" : isDowngrade ? "bg-muted text-muted-foreground" : plan.buttonClass}`}
                                        disabled={isCurrentPlan || isDowngrade || loading}
                                        onClick={() => handleSubscribe(plan)}
                                    >
                                        {isCurrentPlan
                                            ? "✓ Current Plan"
                                            : isDowngrade
                                                ? "Downgrade N/A"
                                                : plan.buttonLabel}
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                <p className="text-center text-xs text-muted-foreground">
                    🔒 Safe & Secure Payments via Razorpay · GPay · Visa · Mastercard
                </p>
            </DialogContent>
        </Dialog>
    );
}
