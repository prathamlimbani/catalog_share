import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, Crown, Clock, Lock, FileText } from "lucide-react";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";

const TRIAL_DURATION_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function getTrialStartTime(companyId: string): number {
    const key = `estimate_trial_start_${companyId}`;
    const stored = localStorage.getItem(key);
    if (stored) return parseInt(stored, 10);
    const now = Date.now();
    localStorage.setItem(key, String(now));
    return now;
}

function getTimeRemaining(trialStart: number): { days: number; hours: number; minutes: number; seconds: number; expired: boolean } {
    const elapsed = Date.now() - trialStart;
    const remaining = TRIAL_DURATION_MS - elapsed;

    if (remaining <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
}

function hasActiveEstimatePlan(company: any): boolean {
    const plan = company?.subscription_plan;
    if (plan !== "support" && plan !== "pro" && plan !== "estimate_generate") return false;
    const expiresAt = company?.subscription_expires_at;
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now();
}

export function SupportPromoDialog({ company }: { company: any }) {
    const [open, setOpen] = useState(false);
    const [canClose, setCanClose] = useState(false);
    const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: false });
    const [closeTimer, setCloseTimer] = useState(5);
    const closeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { subscribe, loading } = useRazorpaySubscription(
        company?.id || "",
        company?.name || "",
        company?.email || ""
    );

    // Start trial timer on mount & update countdown every second
    useEffect(() => {
        if (!company) return;
        if (hasActiveEstimatePlan(company)) return;

        const trialStart = getTrialStartTime(company.id);

        const interval = setInterval(() => {
            setCountdown(getTimeRemaining(trialStart));
        }, 1000);

        setCountdown(getTimeRemaining(trialStart));

        return () => clearInterval(interval);
    }, [company]);

    // Show dialog logic
    useEffect(() => {
        if (!company) return;
        if (hasActiveEstimatePlan(company)) return;

        // If trial expired, always show and lock
        if (countdown.expired) {
            setOpen(true);
            setCanClose(false);
            return;
        }

        // Otherwise, show once per day
        const lastPopupDate = localStorage.getItem("lastSupportPopupDate");
        const today = new Date().toISOString().split("T")[0];

        if (lastPopupDate !== today) {
            const timer = setTimeout(() => {
                setOpen(true);
                localStorage.setItem("lastSupportPopupDate", today);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [company, countdown.expired]);

    // 5-second close button timer — only when trial is still active
    useEffect(() => {
        if (open && !countdown.expired) {
            setCanClose(false);
            setCloseTimer(5);

            closeTimerRef.current = setInterval(() => {
                setCloseTimer((prev) => {
                    if (prev <= 1) {
                        setCanClose(true);
                        if (closeTimerRef.current) clearInterval(closeTimerRef.current);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            return () => {
                if (closeTimerRef.current) clearInterval(closeTimerRef.current);
            };
        }
    }, [open, countdown.expired]);

    if (!company) return null;
    if (hasActiveEstimatePlan(company)) return null;

    const isExpired = countdown.expired;

    const handleOpenChange = (val: boolean) => {
        if (isExpired) return;
        if (!canClose) return;
        setOpen(val);
    };

    const timerDisplay = `${countdown.days}d ${String(countdown.hours).padStart(2, "0")}h ${String(countdown.minutes).padStart(2, "0")}m ${String(countdown.seconds).padStart(2, "0")}s`;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={`sm:max-w-md border-rose-200 shadow-xl shadow-rose-500/10 ${isExpired ? "[&>button]:hidden" : ""}`}
                onPointerDownOutside={(e) => { if (isExpired || !canClose) e.preventDefault(); }}
                onEscapeKeyDown={(e) => { if (isExpired || !canClose) e.preventDefault(); }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-center gap-2 text-2xl font-bold text-rose-600 mb-1">
                        {isExpired ? (
                            <>
                                <Lock className="h-6 w-6 text-rose-500" />
                                Free Trial Ended
                            </>
                        ) : (
                            <>
                                <Heart className="h-6 w-6 fill-rose-500 text-rose-500 animate-pulse" />
                                Unlock Estimates
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm">
                        {isExpired
                            ? "Your 5-day free trial has ended. Choose a plan to continue using Estimates."
                            : "Your free trial is running! Subscribe anytime to keep using Estimates after it ends."
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* Countdown Timer */}
                <div className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border ${isExpired ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                    <Clock className={`h-4 w-4 shrink-0 ${isExpired ? "text-red-500" : "text-amber-600"}`} />
                    {isExpired ? (
                        <span className="text-red-700 font-semibold text-sm">Trial expired — subscribe to unlock</span>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-700 font-medium text-sm">Trial ends in</span>
                            <span className="font-mono font-bold text-amber-900 text-sm tracking-wide">{timerDisplay}</span>
                        </div>
                    )}
                </div>

                {/* Plans */}
                <div className="space-y-3 py-1">
                    {/* Estimate Generate Plan */}
                    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-indigo-600" />
                                <span className="font-bold text-indigo-900">Estimate Generator</span>
                            </div>
                            <span className="text-lg font-bold text-indigo-700">₹399<span className="text-xs font-normal text-indigo-500">/mo</span></span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-indigo-800 mb-3">
                            <li className="flex items-center gap-1.5">✅ Unlimited Estimates</li>
                            <li className="flex items-center gap-1.5">✅ PDF Generation & WhatsApp Sharing</li>
                            <li className="flex items-center gap-1.5">✅ Estimate History & Management</li>
                        </ul>
                        <Button
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-500/20"
                            disabled={loading}
                            onClick={() => subscribe("estimate_generate", "Estimate Generator Plan", 399, () => setOpen(false))}
                        >
                            <FileText className="h-4 w-4 mr-2" />
                            {loading ? "Processing..." : "Get Estimate Plan — ₹399/mo"}
                        </Button>
                    </div>

                    {/* Support Plan */}
                    <div className="rounded-xl border-2 border-rose-200 bg-rose-50/50 p-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">BEST VALUE</div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Crown className="h-5 w-5 text-rose-600" />
                                <span className="font-bold text-rose-900">Support Plan</span>
                            </div>
                            <span className="text-lg font-bold text-rose-700">₹499<span className="text-xs font-normal text-rose-500">/mo</span></span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-rose-800 mb-3">
                            <li className="flex items-center gap-1.5">✅ Everything in Estimate Plan</li>
                            <li className="flex items-center gap-1.5">✅ Priority Support & Call Assistance</li>
                            <li className="flex items-center gap-1.5">✅ Unlimited Products & Custom Branding</li>
                            <li className="flex items-center gap-1.5">✅ All Pro Features</li>
                        </ul>
                        <Button
                            className="w-full bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-bold shadow-md shadow-rose-500/20"
                            disabled={loading}
                            onClick={() => subscribe("support", "Monthly Support Subscription", 499, () => setOpen(false))}
                        >
                            <Heart className="h-4 w-4 mr-2" />
                            {loading ? "Processing..." : "Get Support Plan — ₹499/mo"}
                        </Button>
                    </div>
                </div>

                {/* Footer */}
                <DialogFooter className="flex-col gap-2 pt-1">
                    {!isExpired && (
                        canClose ? (
                            <Button variant="ghost" className="w-full text-muted-foreground text-sm" onClick={() => setOpen(false)} disabled={loading}>
                                Maybe Later
                            </Button>
                        ) : (
                            <Button variant="ghost" className="w-full text-muted-foreground text-sm cursor-not-allowed opacity-50" disabled>
                                <Clock className="h-3.5 w-3.5 mr-1.5" /> Wait {closeTimer}s...
                            </Button>
                        )
                    )}
                    <p className="text-[11px] text-center text-muted-foreground">
                        Instant access after payment • 30-day subscription • Your data is always safe
                    </p>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
