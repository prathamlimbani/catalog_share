import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, FileText, Zap, Sparkles, Heart } from "lucide-react";
import { PLANS, PLAN_RANK, type PlanDef, type PlanId } from "@/lib/plans";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";
import CouponField, { type AppliedCoupon } from "@/components/CouponField";
import { claimFullCoupon } from "@/lib/rewards";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

// MasterAdmin.tsx imports these from here. They are thin re-exports of the
// catalogue so there is exactly one definition of what a plan is; new code
// should import from "@/lib/plans" directly.
export { getPlanLimit, getPlanName } from "@/lib/plans";

/**
 * Card chrome only — every fact about a plan (name, price, limit, features)
 * comes from the catalogue.
 *
 * This file used to carry its own PLANS array, and it had drifted: it never
 * listed `estimate_generate`, the ₹399 SKU sold from the Estimates lock screen.
 * A merchant on that plan therefore saw no card marked CURRENT, and every card
 * — including the ₹199 Growth plan they had already outgrown — was offered as an
 * upgrade.
 */
interface PlanPresentation {
    icon: React.ReactNode;
    gradient: string;
    buttonLabel: string;
    buttonClass: string;
}

const PRESENTATION: Record<PlanId, PlanPresentation> = {
    free: {
        icon: <Zap className="h-5 w-5" />,
        gradient: "from-emerald-500/10 to-teal-500/10",
        buttonLabel: "Current Plan",
        buttonClass: "bg-muted text-muted-foreground",
    },
    growth: {
        icon: <Sparkles className="h-5 w-5" />,
        gradient: "from-blue-500/10 to-cyan-500/10",
        buttonLabel: "Subscribe",
        buttonClass: "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white",
    },
    pro: {
        icon: <Crown className="h-5 w-5" />,
        gradient: "from-purple-500/10 to-pink-500/10",
        buttonLabel: "Upgrade",
        buttonClass: "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white",
    },
    estimate_generate: {
        icon: <FileText className="h-5 w-5" />,
        gradient: "from-indigo-500/10 to-blue-500/10",
        buttonLabel: "Get Estimates",
        buttonClass: "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white",
    },
    support: {
        icon: <Heart className="h-5 w-5 text-rose-500" />,
        gradient: "from-rose-500/10 to-pink-500/10",
        buttonLabel: "Support Us",
        buttonClass: "bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white",
    },
};

/**
 * Cheapest first. The catalogue is ordered by entitlement rank, where
 * estimate_generate outranks pro despite costing more — correct for the upgrade
 * check below, confusing as a price list.
 */
const DISPLAY_PLANS: PlanDef[] = [...PLANS].sort((a, b) => a.price - b.price);

interface SubscriptionDialogProps {
    companyId: string;
    companyName: string;
    companyEmail: string;
    currentPlan: string;
    /** Fired with the Razorpay payment id once the plan is active — used to open the receipt screen. */
    onPaymentSuccess?: (paymentId: string) => void;
    children: React.ReactNode;
}

export function SubscriptionDialog({ companyId, companyName, companyEmail, currentPlan, onPaymentSuccess, children }: SubscriptionDialogProps) {
    const [open, setOpen] = useState(false);
    const { subscribe, loading } = useRazorpaySubscription(companyId, companyName, companyEmail);

    /**
     * The confirm step.
     *
     * A coupon has to be checked against a SPECIFIC plan - codes can be scoped
     * to one - so there is no correct planId for a single field floating above a
     * grid of five. Picking a plan first gives the coupon something to be valid
     * against, and gives the merchant a price to look at before they pay.
     */
    const [selected, setSelected] = useState<PlanDef | null>(null);
    const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
    const [claiming, setClaiming] = useState(false);

    const currentRank = PLAN_RANK[currentPlan as PlanId] ?? 0;

    const closeAll = () => {
        setOpen(false);
        setSelected(null);
        setCoupon(null);
    };

    const handleSubscribe = (plan: PlanDef) => {
        if (plan.price <= 0 || plan.id === currentPlan) return;
        setCoupon(null);
        setSelected(plan);
    };

    const handlePay = async () => {
        if (!selected || loading || claiming) return;

        // A 100% coupon has nothing to charge, and Razorpay cannot create an
        // order below one rupee. Charging a token rupee would be a lie on the
        // receipt and would leave a real payment to refund, so this takes a
        // separate server path that grants the plan directly.
        if (coupon?.isFullDiscount) {
            setClaiming(true);
            try {
                const result = await claimFullCoupon(coupon.code, selected.id);
                if (!result.ok) {
                    toast.error(result.reason ?? "Could not apply that coupon.");
                    return;
                }
                toast.success(selected.name + " activated", {
                    description: result.until
                        ? "Active until " + new Date(result.until).toLocaleDateString() + "."
                        : undefined,
                });
                closeAll();
                onPaymentSuccess?.("coupon");
            } finally {
                setClaiming(false);
            }
            return;
        }

        // The code travels as text only; the discount is derived server-side
        // twice - once to create the order, once to verify the payment.
        subscribe(
            selected.id,
            selected.name,
            selected.price,
            closeAll,
            onPaymentSuccess,
            coupon?.code ?? null,
        );
    };

    /** Price to display and charge, in rupees, honouring any applied coupon. */
    const payableRupees = (plan: PlanDef): string => {
        if (!coupon) return String(plan.price);
        const rupees = coupon.finalPaise / 100;
        return coupon.finalPaise % 100 === 0 ? String(rupees) : rupees.toFixed(2);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setSelected(null); setCoupon(null); } }}>
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

                {selected ? (
                    <div className="space-y-4 py-4">
                        <button
                            type="button"
                            onClick={() => { setSelected(null); setCoupon(null); }}
                            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            All plans
                        </button>

                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="text-lg font-bold">{selected.name}</h3>
                                    <p className="text-2xl font-extrabold tabular-nums">
                                        &#8377;{payableRupees(selected)}
                                        <span className="text-sm font-normal text-muted-foreground">/month</span>
                                    </p>
                                </div>
                                {coupon && (
                                    <p className="mt-1 text-right text-sm text-muted-foreground">
                                        <span className="line-through">&#8377;{selected.price}</span>{" "}
                                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                            {coupon.percentOff}% off
                                        </span>
                                    </p>
                                )}

                                <ul className="mt-4 space-y-2">
                                    {selected.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm">
                                            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>

                        <CouponField
                            planId={selected.id}
                            priceRupees={selected.price}
                            onChange={setCoupon}
                            disabled={loading || claiming}
                        />

                        <Button
                            className="h-12 w-full font-bold"
                            onClick={handlePay}
                            disabled={loading || claiming}
                        >
                            {claiming
                                ? "Activating..."
                                : loading
                                    ? "Processing..."
                                    : coupon?.isFullDiscount
                                        ? "Activate " + selected.name + " free"
                                        : "Pay \u20B9" + payableRupees(selected)}
                        </Button>
                    </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
                    {DISPLAY_PLANS.map((plan) => {
                        const look = PRESENTATION[plan.id];
                        const isCurrentPlan = plan.id === currentPlan;
                        const isDowngrade = PLAN_RANK[plan.id] < currentRank;

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

                                <CardContent className={`p-5 bg-gradient-to-br ${look.gradient}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="p-2 rounded-lg bg-background/80 shadow-sm">
                                            {look.icon}
                                        </div>
                                        <h3 className="font-bold text-lg leading-tight">{plan.name}</h3>
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
                                        className={`w-full font-bold ${isCurrentPlan ? "bg-muted text-muted-foreground cursor-default" : isDowngrade ? "bg-muted text-muted-foreground" : look.buttonClass}`}
                                        disabled={isCurrentPlan || isDowngrade || loading}
                                        onClick={() => handleSubscribe(plan)}
                                    >
                                        {isCurrentPlan
                                            ? "✓ Current Plan"
                                            : isDowngrade
                                                ? "Downgrade N/A"
                                                : look.buttonLabel}
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
                )}

                <p className="text-center text-xs text-muted-foreground">
                    🔒 Safe & Secure Payments via Razorpay · GPay · Visa · Mastercard
                </p>
            </DialogContent>
        </Dialog>
    );
}
