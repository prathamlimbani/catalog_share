import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, CreditCard, Download, CalendarClock, RefreshCw, Receipt, CheckCircle2, XCircle, Clock, FileText, Loader2, Mail, Phone, Heart, WifiOff, RotateCcw, AlertTriangle, Ticket } from "lucide-react";
import { SubscriptionDialog } from "@/components/SubscriptionDialog";
import { restorePurchase, type RestoreOutcome } from "@/hooks/useRazorpaySubscription";
import { getPlanLimit, getPlanName } from "@/lib/plans";
import { downloadInvoice, resolvePaidPlanId } from "@/lib/receipt";
import { useNetwork } from "@/hooks/useNetwork";
import { useEntitlement } from "@/hooks/useEntitlement";
import { SUPPORT_EMAIL, SUPPORT_PHONE } from "@/lib/appInfo";
import { beginUserSignOut } from "@/native/bootstrap";

// Re-exported so MasterAdmin.tsx's historical `import { downloadInvoice } from "@/pages/Billing"`
// keeps compiling. New call sites must import it from "@/lib/receipt" directly — importing it
// from here drags this whole page (AdminLayout, SubscriptionDialog, Razorpay) into their chunk.
export { downloadInvoice };

/**
 * Every value on this screen comes out of an untyped `subscriptions` row, where
 * `status`, `plan`, `amount` and the dates are all nullable. These four helpers
 * are the only places that touch them, so a null can never reach a `.toUpperCase()`
 * or a `new Date()` during render.
 */
const parseTs = (value: unknown): number => {
    if (typeof value !== "string" && typeof value !== "number") return NaN;
    return new Date(value).getTime();
};

const formatDate = (value: unknown): string => {
    const ts = parseTs(value);
    return Number.isNaN(ts)
        ? "—"
        : new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Paise -> "1,299". Anything unparseable is zero, never "NaN". */
const formatPaise = (paise: unknown): string => {
    const value = Number(paise);
    return (Number.isFinite(value) ? value / 100 : 0).toLocaleString("en-IN");
};

const normalizeStatus = (status: unknown): string =>
    typeof status === "string" ? status.trim().toLowerCase() : "";

/** Trimmed string, or "" for null / undefined / anything that is not one. */
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Stable identity for a payment row, for React keys and the busy button. */
const paymentKey = (payment: Record<string, unknown>): string =>
    str(payment.id) || str(payment.razorpay_payment_id);

const statusLabel = (status: unknown): string => normalizeStatus(status).toUpperCase() || "UNKNOWN";

/** What the restore control is currently reporting. */
type RestoreState = RestoreOutcome;

const Billing = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { offline } = useNetwork();
    const { entitlement } = useEntitlement();
    // Which receipt is being rendered right now. A PDF build takes a few seconds
    // on a mid-range phone, and without this the button looked inert.
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreResult, setRestoreResult] = useState<RestoreState | null>(null);

    // Get current user
    const { data: session } = useQuery({
        queryKey: ["billing-session"],
        queryFn: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session;
        },
    });

    // Get company. The key carries the user id so a second account on the same
    // device cannot read the previous owner's plan out of the cache.
    const { data: company, isLoading: companyLoading } = useQuery({
        queryKey: ["billing-company", session?.user?.id ?? "anon"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase.from("companies").select("*").eq("owner_id", user.id).maybeSingle();
            return data;
        },
        enabled: !!session,
    });

    // Get payment history
    const { data: payments, isLoading: paymentsLoading } = useQuery({
        queryKey: ["billing-payments", company?.id],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from("subscriptions")
                .select("*")
                .eq("company_id", company!.id)
                .order("created_at", { ascending: false });
            if (error) throw error;
            return data || [];
        },
        enabled: !!company?.id,
    });

    // Get product count
    const { data: productCount } = useQuery({
        queryKey: ["billing-product-count", company?.id],
        queryFn: async () => {
            const { count } = await supabase
                .from("products")
                .select("*", { count: "exact", head: true })
                .eq("company_id", company!.id);
            return count || 0;
        },
        enabled: !!company?.id,
    });

    // Bounce to /login only when we KNOW there is no session. Offline, or when
    // the session lookup itself fails, /login is a dead end — the user cannot
    // sign in without a connection — so the offline placeholder below is shown
    // instead. Mirrors the guard on the Estimates screen.
    useEffect(() => {
        let cancelled = false;
        supabase.auth.getSession().then(({ data, error }) => {
            if (cancelled || error || offline) return;
            if (!data.session) navigate("/login", { replace: true });
        });
        return () => {
            cancelled = true;
        };
    }, [navigate, offline]);

    const handleLogout = async () => {
        // Tells the auth listener this SIGNED_OUT is deliberate, so wiping the
        // offline store is correct here (an expired token must not wipe it).
        beginUserSignOut();
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
    };

    // "payment made -> receipt shown": the moment the plan is active, the user
    // lands on their receipt rather than back on a stale billing page. The plan
    // itself has already been re-read and pushed into every cache by the payment
    // hook before this runs, so only the history list is left to refresh.
    const goToReceipt = (paymentId: string) => {
        queryClient.invalidateQueries({ queryKey: ["billing-payments"] });
        navigate(`/billing/receipt/${paymentId}`);
    };

    // The generated Supabase types predate the subscription columns, so the row
    // is read as an untyped bag — but through `str`, never with a bare cast, so
    // a null column cannot reach a string method during render.
    const companyRow = (company ?? null) as Record<string, unknown> | null;
    const currentPlan = str(companyRow?.subscription_plan) || "free";
    const planLimit = getPlanLimit(currentPlan);
    const expiresAt = companyRow?.subscription_expires_at;
    const expiryTs = parseTs(expiresAt);
    const isExpired = !Number.isNaN(expiryTs) && expiryTs < Date.now();
    const companyId = str(companyRow?.id);
    const companyName = str(companyRow?.name);
    const companyEmail = str(companyRow?.email);

    /**
     * Re-check and repair entitlement.
     *
     * Idempotent by construction — it only ever asks the server to re-verify a
     * payment it can prove, and never writes the plan itself — so hammering the
     * button is harmless. The guard below is purely so the spinner means
     * something.
     */
    const handleRestore = async () => {
        if (restoring || !companyId) return;
        setRestoring(true);
        setRestoreResult(null);
        try {
            const outcome = await restorePurchase(queryClient, companyId);
            setRestoreResult(outcome);

            if (outcome.kind === "restored") {
                toast.success(`${outcome.planName} restored — everything you paid for is unlocked.`);
            } else if (outcome.kind === "already_active") {
                toast.success(`You are already on the ${outcome.planName}. Nothing needed repairing.`);
            } else if (outcome.kind === "unverified") {
                toast.warning("We found your payment but could not confirm it automatically.", { duration: 10000 });
            } else if (outcome.kind === "error") {
                toast.error("Could not reach the server. Check your connection and try again.");
            } else {
                toast.info("No completed payment found on this account.");
            }

            void queryClient.invalidateQueries({ queryKey: ["billing-payments"] });
        } catch (err) {
            console.error("[billing] restore failed:", err);
            setRestoreResult({ kind: "error" });
            toast.error("Could not reach the server. Check your connection and try again.");
        } finally {
            setRestoring(false);
        }
    };

    /** Support mail with the one detail they will ask for already filled in. */
    const restoreMailto = (paymentId: string) =>
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Payment not activated - ${paymentId}`)}` +
        `&body=${encodeURIComponent(
            `Hello CatalogShare support,\n\nMy payment went through but my plan is not active.\n\n` +
            `Razorpay payment ID: ${paymentId}\nBusiness: ${companyName || "-"}\nAccount email: ${companyEmail || "-"}\n\nThank you.`,
        )}`;

    const handleDownload = async (payment: Record<string, unknown>) => {
        if (downloadingId) return;
        setDownloadingId(paymentKey(payment));
        try {
            await downloadInvoice(payment, companyRow);
        } catch {
            toast.error("Could not build that receipt. Check your storage space and try again.");
        } finally {
            setDownloadingId(null);
        }
    };

    const getStatusIcon = (status: unknown) => {
        const value = normalizeStatus(status);
        if (value === "active") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
        if (value === "expired") return <XCircle className="h-4 w-4 text-destructive" />;
        return <Clock className="h-4 w-4 text-amber-500" />;
    };

    const getStatusColor = (status: unknown) => {
        const value = normalizeStatus(status);
        if (value === "active") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
        if (value === "expired") return "bg-destructive/15 text-destructive";
        return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    };

    return (
        <AdminLayout
            company={company}
            searchQuery=""
            onSearchChange={() => { }}
            onLogout={handleLogout}
        >
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <CreditCard className="h-6 w-6 shrink-0 text-primary" />
                        Payment &amp; Billing
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">Manage your subscription, view payment history, and download receipts.</p>
                </div>

                {/* Plan and history both come from the server; with no connection
                    there is nothing truthful to show, and an empty history would
                    read as "you never paid us". */}
                {offline && !company ? (
                    <Card className="border-dashed bg-muted/30">
                        <CardContent className="p-6 sm:p-8 text-center">
                            <WifiOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-60" />
                            <h2 className="font-semibold">You are offline</h2>
                            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                                Your plan, payment history and receipts load as soon as you are
                                back online. Creating and sharing estimates keeps working meanwhile.
                            </p>
                            <Button asChild className="mt-5 h-11 w-full sm:w-auto">
                                <Link to="/invoices">
                                    <FileText className="h-4 w-4 mr-2" /> Open Estimates
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                  <>
                {/* Current Plan Card */}
                {companyLoading ? (
                    <Skeleton className="h-40 w-full" />
                ) : company && (
                    <Card className={`border-0 shadow-md overflow-hidden ${currentPlan === 'support' ? 'bg-gradient-to-r from-rose-500/5 to-pink-500/5 ring-1 ring-rose-500/20' : currentPlan === 'pro' ? 'bg-gradient-to-r from-purple-500/5 to-pink-500/5 ring-1 ring-purple-500/20' : currentPlan === 'growth' ? 'bg-gradient-to-r from-blue-500/5 to-cyan-500/5 ring-1 ring-blue-500/20' : 'bg-gradient-to-r from-emerald-500/5 to-teal-500/5 ring-1 ring-emerald-500/20'}`}>
                        <CardContent className="p-4 sm:p-6">
                            {/* Column first, row from sm: at 360px the plan name and
                                the action button cannot share a line without one of
                                them being clipped. */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                                    <div className={`shrink-0 p-3 rounded-xl ${currentPlan === 'support' ? 'bg-rose-500/10' : currentPlan === 'pro' ? 'bg-purple-500/10' : currentPlan === 'growth' ? 'bg-blue-500/10' : 'bg-emerald-500/10'}`}>
                                        {currentPlan === 'support' ? <Heart className="h-7 w-7 text-rose-500" /> : <Crown className={`h-7 w-7 ${currentPlan === 'pro' ? 'text-purple-500' : currentPlan === 'growth' ? 'text-blue-500' : 'text-emerald-500'}`} />}
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-lg sm:text-xl font-bold break-anywhere">{getPlanName(currentPlan)}</h2>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                            <Badge className={getStatusColor(isExpired ? "expired" : "active")}>
                                                {isExpired ? "EXPIRED" : "ACTIVE"}
                                            </Badge>
                                            <span className="text-sm text-muted-foreground">
                                                {productCount ?? "—"}/{planLimit === 9999 ? '∞' : planLimit} products used
                                            </span>
                                        </div>
                                        {/* What a free-tier merchant most needs to
                                            know on this screen: estimates still
                                            work, they are just paid for with ads
                                            until a plan is bought. */}
                                        {!entitlement.estimatesFree && (
                                            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                                                <Ticket className="h-3 w-3 shrink-0" />
                                                Estimates are ad-funded on this plan
                                            </p>
                                        )}
                                        {expiresAt && currentPlan !== 'free' && (
                                            <p className={`text-xs mt-1 ${isExpired ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                                                <CalendarClock className="h-3 w-3 inline mr-1" />
                                                {isExpired ? 'Expired on' : 'Renews on'} {formatDate(expiresAt)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
                                    {/* Renewal / Upgrade */}
                                    {currentPlan !== 'free' && isExpired && (
                                        <SubscriptionDialog
                                            companyId={companyId}
                                            companyName={companyName}
                                            companyEmail={companyEmail}
                                            onPaymentSuccess={goToReceipt}
                                            currentPlan="free"
                                        >
                                            <Button className="h-11 w-full sm:w-auto bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-sm">
                                                <RefreshCw className="h-4 w-4 mr-2" /> Renew Plan
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                    {currentPlan !== 'support' && !isExpired && (
                                        <SubscriptionDialog
                                            companyId={companyId}
                                            companyName={companyName}
                                            companyEmail={companyEmail}
                                            onPaymentSuccess={goToReceipt}
                                            currentPlan={currentPlan}
                                        >
                                            <Button className="h-11 w-full sm:w-auto bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold shadow-sm">
                                                <Crown className="h-4 w-4 mr-2" /> Upgrade Plan
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                    {currentPlan !== 'free' && !isExpired && (
                                        <SubscriptionDialog
                                            companyId={companyId}
                                            companyName={companyName}
                                            companyEmail={companyEmail}
                                            onPaymentSuccess={goToReceipt}
                                            currentPlan="free"
                                        >
                                            <Button variant="outline" className="h-11 w-full sm:w-auto font-bold">
                                                <RefreshCw className="h-4 w-4 mr-2" /> Renew
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Restore purchase.
                    Activation can fail after the money has moved: the edge
                    function is redeploying, the radio drops between the charge
                    and the grant, or the capture webhook arrives late. This is
                    the merchant's own way out of that instead of an email and a
                    wait. It asks the SERVER to re-verify the payment — the plan
                    is never written from here, which the guard trigger would
                    reject anyway. */}
                {companyId && (
                    <Card className="border-dashed">
                        <CardContent className="p-4 sm:p-6">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <h2 className="font-semibold flex items-center gap-2">
                                        <RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        Paid but still locked?
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                                        Re-checks your payments with our server and re-applies your plan.
                                        You will never be charged again for tapping this.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    className="h-11 w-full font-semibold sm:w-auto sm:shrink-0"
                                    disabled={restoring || offline}
                                    onClick={() => void handleRestore()}
                                >
                                    {restoring ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking…
                                        </>
                                    ) : (
                                        <>
                                            <RotateCcw className="h-4 w-4 mr-2" /> Restore purchase
                                        </>
                                    )}
                                </Button>
                            </div>

                            {offline && (
                                <p className="mt-3 text-xs text-muted-foreground">
                                    Restoring needs a connection — reconnect and try again.
                                </p>
                            )}

                            {restoreResult?.kind === "restored" && (
                                <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>
                                        Your {restoreResult.planName} is active again. Estimates are unlocked
                                        right now — no restart needed.
                                    </span>
                                </div>
                            )}

                            {restoreResult?.kind === "already_active" && (
                                <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>
                                        Nothing needed repairing — your {restoreResult.planName} was already
                                        up to date.
                                    </span>
                                </div>
                            )}

                            {restoreResult?.kind === "unverified" && (
                                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>
                                            We found a payment on this account but your bank has not
                                            confirmed it yet. Try again in a few minutes — if it still
                                            will not go through, support can finish it off with this ID.
                                        </span>
                                    </div>
                                    <p className="break-anywhere mt-2 font-mono text-xs">
                                        {restoreResult.paymentId}
                                    </p>
                                    <Button asChild variant="outline" className="mt-3 h-11 w-full font-semibold sm:w-auto">
                                        <a href={restoreMailto(restoreResult.paymentId)}>
                                            <Mail className="h-4 w-4 mr-2" /> Email support with this ID
                                        </a>
                                    </Button>
                                </div>
                            )}

                            {restoreResult?.kind === "none" && (
                                <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                                    <Receipt className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>
                                        No completed payment found on this account. If you paid while signed
                                        in as someone else, sign in with that account and try again.
                                    </span>
                                </div>
                            )}

                            {restoreResult?.kind === "error" && (
                                <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>We could not reach the server. Check your connection and try again.</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Payment History */}
                <div>
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-muted-foreground" />
                        Payment History
                    </h2>
                    {paymentsLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                        </div>
                    ) : payments && payments.length > 0 ? (
                        <div className="space-y-3">
                            {payments.map((payment: Record<string, unknown>) => {
                                const key = paymentKey(payment);
                                const razorpayId = str(payment.razorpay_payment_id);
                                const planLabel = getPlanName(
                                    resolvePaidPlanId(str(payment.plan), Number(payment.amount) || 0),
                                );
                                const expiresOn = payment.expires_at ? formatDate(payment.expires_at) : "";

                                return (
                                    <Card key={key} className="hover:shadow-md transition-shadow">
                                        <CardContent className="p-3 sm:p-4">
                                            {/* One column at 360px: the amount rides the title
                                                line, the actions get a row of their own. The old
                                                single row put a date range, a payment id and two
                                                buttons on one line and pushed the page sideways. */}
                                            <div className="flex items-start gap-3">
                                                <span className="mt-0.5 shrink-0">{getStatusIcon(payment.status)}</span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-sm break-anywhere">{planLabel}</span>
                                                        <Badge className={`text-[10px] ${getStatusColor(payment.status)}`}>{statusLabel(payment.status)}</Badge>
                                                        <span className="ml-auto font-bold text-base sm:text-lg">₹{formatPaise(payment.amount)}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        {formatDate(payment.created_at)}
                                                        {expiresOn && ` → ${expiresOn}`}
                                                    </p>
                                                    {razorpayId && (
                                                        <p className="break-anywhere text-[10px] text-muted-foreground font-mono mt-0.5">
                                                            ID: {razorpayId}
                                                        </p>
                                                    )}
                                                    <div className="flex flex-wrap gap-2 mt-3">
                                                        {razorpayId && (
                                                            <Button variant="ghost" className="h-11 flex-1 text-xs sm:flex-none sm:px-4" asChild>
                                                                <Link to={`/billing/receipt/${razorpayId}`}>
                                                                    <Receipt className="h-3.5 w-3.5 mr-1" /> View
                                                                </Link>
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="outline"
                                                            className="h-11 flex-1 text-xs sm:flex-none sm:px-4"
                                                            disabled={downloadingId !== null}
                                                            onClick={() => void handleDownload(payment)}
                                                        >
                                                            {downloadingId === key ? (
                                                                <>
                                                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Preparing…
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Download className="h-3.5 w-3.5 mr-1" /> Receipt
                                                                </>
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <Card className="bg-muted/30">
                            <CardContent className="p-6 sm:p-8 text-center">
                                <Receipt className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                                <h3 className="font-semibold">No payments yet</h3>
                                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                                    You are on the {getPlanName(currentPlan)}. Pick a paid plan to remove ads,
                                    raise your product limit and unlock estimates — every receipt then shows up here.
                                </p>
                                {companyId && (
                                    <SubscriptionDialog
                                        companyId={companyId}
                                        companyName={companyName}
                                        companyEmail={companyEmail}
                                        onPaymentSuccess={goToReceipt}
                                        currentPlan={currentPlan}
                                    >
                                        <Button className="mt-5 h-11 w-full sm:w-auto font-semibold">
                                            <Crown className="h-4 w-4 mr-2" /> See plans
                                        </Button>
                                    </SubscriptionDialog>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
                  </>
                )}

                {/* Customer Care Section */}
                {/* The contact pills used to be `inline-flex` with the support
                    address as one unbreakable child, so at 360px the widest of
                    them stuck ~30px past the card and took the whole page
                    sideways with it. They are block-level and breakable now, and
                    the card's padding starts small instead of at 32px. */}
                <div className="bg-primary/5 rounded-2xl p-5 sm:p-8 md:p-12 border border-primary/10 text-center mt-8">
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-3">Customer Care Support</h2>
                    <p className="text-muted-foreground text-sm sm:text-base mb-6 max-w-xl mx-auto">
                        Need assistance or have any queries? Our dedicated support team is here to help you out. Click below to reach out directly to us!
                    </p>
                    <Button asChild size="lg" className="h-12 w-full sm:w-auto rounded-full gap-2 sm:px-8">
                        <a href={`mailto:${SUPPORT_EMAIL}?subject=Customer%20care%20support`}>
                            <Mail className="h-5 w-5" />
                            Contact Customer Care
                        </a>
                    </Button>
                    <div className="mt-6 flex flex-col items-stretch gap-3 sm:items-center">
                        <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border bg-background px-4 py-2.5 text-sm text-muted-foreground shadow-sm sm:flex-row sm:gap-2 sm:rounded-full">
                            <span className="shrink-0">Direct email</span>
                            <a
                                href={`mailto:${SUPPORT_EMAIL}`}
                                className="break-anywhere min-w-0 font-semibold text-foreground"
                            >
                                {SUPPORT_EMAIL}
                            </a>
                        </div>
                        {/* Gated on the entitlement, not on `plan === 'pro'`: the ₹499
                            Support plan pays for the phone line too and was being told
                            it does not exist. */}
                        {entitlement.supportPhoneUnlocked && (
                            <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-muted-foreground shadow-sm sm:flex-row sm:gap-2 sm:rounded-full">
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <Phone className="h-4 w-4" />
                                    Call support
                                </span>
                                <a
                                    href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`}
                                    className="break-anywhere min-w-0 font-semibold text-foreground"
                                >
                                    {SUPPORT_PHONE}
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
};

export default Billing;
