import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Heart, Crown, Clock, FileText } from "lucide-react";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";
import { getEntitlement, type CompanyLike } from "@/lib/entitlement";
import { getPlanPrice } from "@/lib/plans";
import { ensureTrialStarted } from "@/lib/trial";
import { prefGet, prefSet } from "@/native/prefs";

/** How long a dismissal is honoured before the promo may appear again. */
const PROMO_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Delay before the promo slides in, so it never fights the screen's first paint. */
const PROMO_DELAY_MS = 1000;

const promoKey = (companyId: string) => `cs_promo_last_shown_${companyId}`;

function formatRemaining(ms: number): string {
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

type PromoCompany = CompanyLike & { name?: string | null; email?: string | null };

/**
 * Upsell for the estimate plans, shown over the Estimates list.
 *
 * Rules this component must never break again:
 *  - it is ALWAYS dismissable. It used to hide its close button and swallow
 *    Escape/outside taps once the trial expired, which on Android (where the
 *    hardware back button is intercepted) is an inescapable screen and an
 *    automatic Play Store rejection. Enforcement of an expired trial belongs to
 *    the Estimates lock screen, not to a promo dialog.
 *  - a dismissal is remembered for 24h per company, so it is not thrown at the
 *    user on every single load of the screen.
 */
export function SupportPromoDialog({ company }: { company: PromoCompany | null | undefined }) {
    const [open, setOpen] = useState(false);
    const [trialStart, setTrialStart] = useState<number | null>(null);
    // The countdown is derived from this clock instead of from a 1s interval —
    // a per-second timer on a phone is pure battery drain for a display that
    // only ever shows whole minutes.
    const [now, setNow] = useState(() => Date.now());

    const companyId = company?.id ?? "";
    const { subscribe, loading } = useRazorpaySubscription(companyId, company?.name ?? "", company?.email ?? "");

    const entitlement = useMemo(
        () => getEntitlement(company, now, trialStart),
        [company, now, trialStart],
    );

    // A paid plan that already includes estimates has nothing to be sold here.
    const suppressed = entitlement.isPaid && entitlement.estimatesUnlocked;

    useEffect(() => {
        if (!companyId || suppressed) return;
        let active = true;
        // Idempotent: the Estimates screen starts the same clock on mount, this
        // only makes sure the countdown has a value to render if we win the race.
        void ensureTrialStarted(companyId, company?.trial_started_at ?? null).then((start) => {
            if (active) setTrialStart(start || null);
        });
        return () => {
            active = false;
        };
    }, [companyId, company?.trial_started_at, suppressed]);

    // Decide whether the promo is due, honouring the stored dismissal.
    // Waits for the trial clock so the copy never flashes "trial ended" at a
    // user whose trial start has simply not been read back yet.
    useEffect(() => {
        if (!companyId || suppressed || trialStart === null) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        void prefGet(promoKey(companyId)).then((raw) => {
            if (!active) return;
            const lastShown = raw ? parseInt(raw, 10) : 0;
            if (Number.isFinite(lastShown) && Date.now() - lastShown < PROMO_COOLDOWN_MS) return;
            timer = setTimeout(() => {
                if (!active) return;
                setOpen(true);
                void prefSet(promoKey(companyId), String(Date.now()));
            }, PROMO_DELAY_MS);
        });

        return () => {
            active = false;
            if (timer) clearTimeout(timer);
        };
    }, [companyId, suppressed, trialStart]);

    // Only tick while the dialog is actually on screen, and only once a minute.
    useEffect(() => {
        if (!open || !entitlement.trialActive) return;
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, [open, entitlement.trialActive]);

    const dismiss = useCallback(() => {
        setOpen(false);
        if (companyId) void prefSet(promoKey(companyId), String(Date.now()));
    }, [companyId]);

    if (!company || suppressed) return null;

    const trialEnded = !entitlement.trialActive;

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto border-rose-200 shadow-xl shadow-rose-500/10">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-center gap-2 text-2xl font-bold text-rose-600 mb-1">
                        <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
                        {trialEnded ? "Keep Your Estimates" : "Unlock Estimates"}
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm">
                        {trialEnded
                            ? "Your 5-day free trial has ended. Pick a plan to carry on creating estimates."
                            : "Your free trial is running. Subscribe any time to keep Estimates after it ends."}
                    </DialogDescription>
                </DialogHeader>

                {/* Countdown */}
                <div className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border ${trialEnded ? "bg-muted border-border" : "bg-amber-50 border-amber-200"}`}>
                    <Clock className={`h-4 w-4 shrink-0 ${trialEnded ? "text-muted-foreground" : "text-amber-600"}`} />
                    {trialEnded ? (
                        <span className="text-sm font-semibold text-muted-foreground">Free trial finished</span>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-700 font-medium text-sm">Trial ends in</span>
                            <span className="font-mono font-bold text-amber-900 text-sm tracking-wide">
                                {formatRemaining(entitlement.trialMsRemaining)}
                            </span>
                        </div>
                    )}
                </div>

                {/* Plans */}
                <div className="space-y-3 py-1">
                    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-indigo-600" />
                                <span className="font-bold text-indigo-900">Estimate Generator</span>
                            </div>
                            <span className="text-lg font-bold text-indigo-700">
                                ₹{getPlanPrice("estimate_generate")}
                                <span className="text-xs font-normal text-indigo-500">/mo</span>
                            </span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-indigo-800 mb-3">
                            <li>✅ Unlimited Estimates</li>
                            <li>✅ PDF Generation &amp; WhatsApp Sharing</li>
                            <li>✅ Estimate History &amp; Management</li>
                        </ul>
                        <Button
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-500/20"
                            disabled={loading}
                            onClick={() =>
                                subscribe("estimate_generate", "Estimate Generator Plan", getPlanPrice("estimate_generate"), () => setOpen(false))
                            }
                        >
                            <FileText className="h-4 w-4 mr-2" />
                            {loading ? "Processing..." : `Get Estimate Plan — ₹${getPlanPrice("estimate_generate")}/mo`}
                        </Button>
                    </div>

                    <div className="rounded-xl border-2 border-rose-200 bg-rose-50/50 p-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">BEST VALUE</div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Crown className="h-5 w-5 text-rose-600" />
                                <span className="font-bold text-rose-900">Support Plan</span>
                            </div>
                            <span className="text-lg font-bold text-rose-700">
                                ₹{getPlanPrice("support")}
                                <span className="text-xs font-normal text-rose-500">/mo</span>
                            </span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-rose-800 mb-3">
                            <li>✅ Everything in Estimate Plan</li>
                            <li>✅ Priority Support &amp; Call Assistance</li>
                            <li>✅ Unlimited Products &amp; Custom Branding</li>
                            <li>✅ All Pro Features</li>
                        </ul>
                        <Button
                            className="w-full bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-bold shadow-md shadow-rose-500/20"
                            disabled={loading}
                            onClick={() =>
                                subscribe("support", "Monthly Support Subscription", getPlanPrice("support"), () => setOpen(false))
                            }
                        >
                            <Heart className="h-4 w-4 mr-2" />
                            {loading ? "Processing..." : `Get Support Plan — ₹${getPlanPrice("support")}/mo`}
                        </Button>
                    </div>
                </div>

                <DialogFooter className="flex-col gap-2 pt-1">
                    {/* The always-available exit. Never gate, delay or hide this. */}
                    <Button variant="outline" className="w-full text-sm" onClick={dismiss}>
                        Maybe later
                    </Button>
                    <p className="text-[11px] text-center text-muted-foreground">
                        Instant access after payment • 30-day subscription • Your data is always safe
                    </p>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
