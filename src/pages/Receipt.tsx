import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  LayoutDashboard,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentCompany } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPlanName } from "@/lib/plans";
import { SUPPORT_EMAIL } from "@/lib/appInfo";
import { downloadReceipt, receiptDataFromRow, resolvePaidPlanId } from "@/lib/receipt";

// A type alias rather than an interface: only aliases carry an implicit index
// signature, which is what lets the row be handed to `receiptDataFromRow`.
type SubscriptionRow = {
  id: string;
  company_id: string;
  plan: string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  amount: number;
  status: string;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
};

/**
 * Razorpay's handler fires the moment the gateway confirms, but the row can be
 * written by the webhook a beat later. Poll briefly rather than telling a paying
 * customer their payment does not exist.
 */
const POLL_INTERVAL_MS = 2000;
const CONFIRM_TIMEOUT_MS = 15000;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * A subscriptions row is only "active" if it says so AND has not run out.
 *
 * The screen used to render a green PAID badge and "your plan is active" for any
 * row at all, so opening a receipt from three months ago told the merchant a
 * lapsed plan was live. `expires_at` is the authority; `status` alone is not,
 * because the nightly downgrade job is what flips it and it has not necessarily
 * run yet.
 */
function isSubscriptionActive(row: SubscriptionRow | null | undefined): boolean {
  if (!row || row.status !== "active") return false;
  if (!row.expires_at) return false;
  const expiry = new Date(row.expires_at).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Rupee string from a paise amount that may be null, a string, or missing. */
function formatAmount(paise: unknown): string {
  const value = Number(paise);
  return (Number.isFinite(value) ? value / 100 : 0).toLocaleString("en-IN");
}

/** Neutral, accurate word for a row that is not active. */
function describeStatus(row: SubscriptionRow): string {
  // `status` is typed `string` but the row is whatever the table holds, so a
  // null here would take `.toLowerCase()` down mid-render.
  const status = (typeof row.status === "string" ? row.status : "").toLowerCase();
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Expired";
  const expiry = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
  if (Number.isFinite(expiry) && expiry <= Date.now()) return "Expired";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
}

const Receipt = () => {
  const navigate = useNavigate();
  const { paymentId } = useParams<{ paymentId: string }>();
  const { data: company } = useCurrentCompany();

  // A URL with no payment id can never resolve — skip straight to the fallback.
  const [gaveUp, setGaveUp] = useState(!paymentId);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: subscription } = useQuery({
    queryKey: ["receipt-subscription", paymentId],
    enabled: !!paymentId,
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<SubscriptionRow | null> => {
      // Deliberately NOT .maybeSingle(): that throws on more than one row, and a
      // double-submit used to leave two rows for one payment, which made the
      // receipt permanently unopenable. The unique index in migration
      // 20260819000003 prevents new duplicates, but historical rows in an
      // un-migrated database must still render.
      const { data, error } = await (supabase as any)
        .from("subscriptions")
        .select("*")
        .eq("razorpay_payment_id", paymentId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data as SubscriptionRow[] | null)?.[0]) ?? null;
    },
    refetchInterval: (query) => (query.state.data || gaveUp ? false : POLL_INTERVAL_MS),
  });

  useEffect(() => {
    if (subscription || !paymentId) return;
    const timer = setTimeout(() => setGaveUp(true), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [subscription, paymentId]);

  const goToDashboard = () => navigate("/dashboard", { replace: true });

  const copyPaymentId = async () => {
    if (!paymentId) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(paymentId);
      ok = true;
    } catch {
      // Older Android WebViews expose no async clipboard on a non-secure origin.
      const field = document.createElement("textarea");
      field.value = paymentId;
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      } finally {
        field.remove();
      }
    }

    // The id is the only thing support can trace a payment by, so a copy that
    // silently did nothing is worse here than almost anywhere else in the app.
    if (!ok) {
      toast.error("Could not copy. Select the ID above and copy it manually.");
      return;
    }
    setCopied(true);
    toast.success("Payment ID copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    if (!subscription || downloading) return;
    setDownloading(true);
    try {
      await downloadReceipt(receiptDataFromRow(subscription, company));
    } catch {
      toast.error("Could not build the receipt. Check your storage space and try again.");
    } finally {
      setDownloading(false);
    }
  };

  const confirming = !subscription && !gaveUp;

  const planId = subscription ? resolvePaidPlanId(subscription.plan, subscription.amount) : "free";
  const planName = getPlanName(planId);
  const amount = formatAmount(subscription?.amount);

  const isActive = isSubscriptionActive(subscription);
  const statusWord = subscription ? describeStatus(subscription) : "";

  // The company row is untyped and both columns are nullable.
  const companyName = (typeof company?.name === "string" ? company.name.trim() : "") || "";
  const companyEmail = (typeof company?.email === "string" ? company.email.trim() : "") || "";

  // Pre-filled so support gets the payment id without the merchant retyping it.
  const supportMailto =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(`Payment not confirmed — ${paymentId ?? ""}`)}` +
    `&body=${encodeURIComponent(
      `Hello CatalogShare support,\n\n` +
        `My payment has not been confirmed in the app.\n\n` +
        `Payment ID: ${paymentId ?? "(not available)"}\n` +
        `Business: ${companyName}\n` +
        `Account email: ${companyEmail}\n\n` +
        `Please check and activate my plan.`,
    )}`;

  return (
    <div
      className="min-h-dvh bg-background flex flex-col items-center px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
      }}
    >
      <div className="w-full max-w-lg space-y-5">
        {confirming && (
          <Card className="border-border">
            <CardContent className="p-8 sm:p-10 text-center">
              <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin" />
              <h1 className="text-xl sm:text-2xl font-bold mt-5">Confirming your payment…</h1>
              <p className="text-sm text-muted-foreground mt-2">
                This usually takes a few seconds. Please don't close the app.
              </p>
              {paymentId && (
                <p className="text-xs font-mono text-muted-foreground mt-4 break-all">{paymentId}</p>
              )}
            </CardContent>
          </Card>
        )}

        {!confirming && !subscription && (
          <Card className="border-border">
            <CardContent className="p-8 sm:p-10 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Clock className="h-7 w-7 text-muted-foreground" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold mt-5">Payment received</h1>
              {/* No email is promised here: nothing on this branch sends one. The
                  invoice mail only goes out once activation succeeds, and this card
                  is precisely the case where it did not. */}
              <p className="text-sm text-muted-foreground mt-2">
                We haven't been able to confirm it yet. Keep the payment ID below — it is all support
                needs to find your payment and activate your plan.
              </p>
              {paymentId && (
                <div className="mt-5 rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Payment ID
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <span className="font-mono text-xs break-all">{paymentId}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={copyPaymentId}
                      aria-label="Copy payment ID"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-3 mt-6">
                <Button asChild className="w-full font-semibold">
                  <a href={supportMailto}>
                    <Mail className="h-4 w-4 mr-2" /> Email support with this ID
                  </a>
                </Button>
                <Button variant="outline" className="w-full font-semibold" onClick={goToDashboard}>
                  <LayoutDashboard className="h-4 w-4 mr-2" /> Go to dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {subscription && (
          <>
            <div className="text-center pt-2 animate-in fade-in zoom-in-95 duration-500">
              <div
                className={`h-16 w-16 sm:h-20 sm:w-20 rounded-full flex items-center justify-center mx-auto ${
                  isActive ? "bg-emerald-500/10 ring-8 ring-emerald-500/5" : "bg-muted ring-8 ring-muted/40"
                }`}
              >
                {isActive ? (
                  <CheckCircle2 className="h-9 w-9 sm:h-11 sm:w-11 text-emerald-500" />
                ) : (
                  <FileText className="h-9 w-9 sm:h-11 sm:w-11 text-muted-foreground" />
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mt-5">
                {isActive ? "Payment successful" : "Payment receipt"}
              </h1>
              <p className="text-sm text-muted-foreground mt-2 px-2">
                {isActive
                  ? `Your ${planName} is active. Thank you for supporting CatalogShare.`
                  : `This ${planName} subscription is no longer active (${statusWord.toLowerCase()}). The receipt below is kept for your records.`}
              </p>
            </div>

            <Card className="border-border shadow-sm">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Plan
                    </p>
                    <p className="font-bold text-base sm:text-lg leading-tight mt-0.5">{planName}</p>
                  </div>
                  {isActive ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 shrink-0">
                      PAID
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 uppercase">
                      {statusWord}
                    </Badge>
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Amount paid</span>
                  <span className="text-xl sm:text-2xl font-bold">₹{amount}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Valid from</span>
                  <span className="text-sm font-semibold">{formatDate(subscription.starts_at)}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {isActive ? "Valid until" : "Ended on"}
                  </span>
                  <span className="text-sm font-semibold">{formatDate(subscription.expires_at)}</span>
                </div>

                <Separator />

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Payment ID
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="font-mono text-xs sm:text-sm bg-muted rounded-md px-2 py-1.5 break-all flex-1 min-w-0">
                      {subscription.razorpay_payment_id || paymentId || "—"}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={copyPaymentId}
                      aria-label="Copy payment ID"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Button
                className="w-full h-12 font-semibold"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing receipt…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" /> Download receipt
                  </>
                )}
              </Button>
              <Button variant="outline" className="w-full h-12 font-semibold" onClick={goToDashboard}>
                <LayoutDashboard className="h-4 w-4 mr-2" /> Go to dashboard
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>

            {/* Only claimed where it was actually attempted: the invoice mail is sent
                on activation, and only to the address on the company record. */}
            {isActive && companyEmail && (
              <p className="flex items-start justify-center gap-1.5 px-4 text-center text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-anywhere min-w-0">
                  A copy was also emailed to {companyEmail}.
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Receipt;
