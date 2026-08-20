import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Crown, FileText, Heart, Lock, RotateCcw, Timer, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
import { useCurrentCompany } from "@/hooks/useCompany";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useNetwork } from "@/hooks/useNetwork";
import { useSyncState } from "@/hooks/useSync";
import { AdminLayout } from "@/components/AdminLayout";
import InvoiceForm from "@/components/InvoiceForm";
import InvoicePreview from "@/components/InvoicePreview";
import InvoiceHistory from "@/components/InvoiceHistory";
import { SupportPromoDialog } from "@/components/SupportPromoDialog";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";
import { Button } from "@/components/ui/button";

import {
  deleteEstimate,
  listEstimates,
  nextEstimateNumber,
  saveEstimate,
  type SaveEstimateInput,
} from "@/lib/offline/estimates";
import { getMirroredProducts } from "@/lib/offline/mirror";
import { syncNow } from "@/lib/sync/syncEngine";
import { getPlanPrice } from "@/lib/plans";
import { ensureTrialStarted } from "@/lib/trial";
import { hideBanner, maybeShowInterstitial, showBanner } from "@/native/ads";
import { notify } from "@/native/files";

type ViewMode = "list" | "create" | "edit" | "preview";

/**
 * How much trial is left, in the coarsest unit that is still true.
 *
 * The entitlement clock is re-read on a boundary timer and a ten-minute safety
 * net, not every second, so a "43 minutes left" here could be eight minutes out
 * of date. Under an hour it therefore stops counting and says so — vague and
 * correct beats precise and wrong on a countdown someone is trusting.
 */
function formatTrialRemaining(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  return "less than an hour left";
}

/**
 * Estimates — the app's offline-first surface.
 *
 * Everything on this screen reads from and writes to the local IndexedDB store
 * first, and the sync engine reconciles with Supabase whenever there is a
 * connection. That inversion is what makes the feature usable on a shop floor
 * with no signal; previously every read and write went straight to the network,
 * so with no connection the screen rendered "No company found. Please register
 * first." and the Save button could not even be enabled.
 */
const Invoices = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading, isError: companyError } = useCurrentCompany();
  const { entitlement, resolved: entitlementResolved } = useEntitlement();
  const { offline } = useNetwork();
  const { lastSyncAt } = useSyncState();

  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [nextNumber, setNextNumber] = useState("INV-0001");

  const companyId = company?.id as string | undefined;

  const { subscribe, loading: subLoading } = useRazorpaySubscription(
    companyId || "",
    company?.name || "",
    company?.email || "",
  );

  // Opening this screen is what starts the 5-day trial clock.
  useEffect(() => {
    if (!companyId) return;
    void ensureTrialStarted(companyId, company?.trial_started_at ?? null);
  }, [companyId, company?.trial_started_at]);

  // Session check. Deliberately does NOT bounce to /login on a network failure —
  // only when there is definitively no session — otherwise a flaky connection
  // logs the user out of an app that would otherwise work fine offline.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active || error) return;
        if (!data.session && !offline) navigate("/login");
      } catch {
        /* offline: keep the user where they are */
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, offline]);

  // ---------------------------------------------------------------- data

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery({
    queryKey: ["offline-estimates", companyId],
    queryFn: () => (companyId ? listEstimates(companyId) : Promise.resolve([])),
    enabled: !!companyId,
    staleTime: 0,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["offline-products", companyId],
    queryFn: () => (companyId ? getMirroredProducts(companyId) : Promise.resolve([])),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // Refresh the list whenever a sync cycle finishes writing to the store.
  useEffect(() => {
    if (!companyId) return;
    void queryClient.invalidateQueries({ queryKey: ["offline-estimates", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["offline-products", companyId] });
  }, [lastSyncAt, companyId, queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["offline-estimates", companyId] });
  }, [queryClient, companyId]);

  // Allocate the next number when the user opens a blank form.
  useEffect(() => {
    if (viewMode !== "create" || !companyId) return;
    let active = true;
    void nextEstimateNumber(companyId, { offline }).then((num) => {
      if (active) setNextNumber(num);
    });
    return () => {
      active = false;
    };
  }, [viewMode, companyId, offline]);

  // ----------------------------------------------------------------- ads
  // Ads never appear on the preview/PDF screen or on the trial lock screen.
  // Never lock before we know the answer. The plan and the trial clock both
  // load asynchronously, and treating "not loaded yet" as "no access" is what
  // showed a brand-new user "Free trial ended" on a trial that had just begun.
  const estimatesLocked = entitlementResolved && !entitlement.estimatesUnlocked;
  useEffect(() => {
    const suppress = viewMode === "preview" || estimatesLocked;
    if (suppress || !entitlement.adsEnabled) {
      void hideBanner();
    } else {
      void showBanner();
    }
    // The banner belongs to this screen only. Without this teardown it outlived
    // the Estimates tab and sat on top of Billing and the Razorpay checkout.
    return () => {
      void hideBanner();
    };
  }, [viewMode, estimatesLocked, entitlement.adsEnabled]);

  /**
   * Trial over, no plan, and no connection to buy one.
   *
   * We keep the screen reachable — never hard-lock a merchant out of work they
   * already have — but read-only: the list and the preview stay available so
   * existing estimates can be re-shared, while create/edit stay behind the
   * paywall. Skipping the gate entirely offline made airplane mode an unlimited
   * bypass of the trial.
   */
  const lockedOffline = estimatesLocked && offline;

  useEffect(() => {
    if (lockedOffline && (viewMode === "create" || viewMode === "edit")) setViewMode("list");
  }, [lockedOffline, viewMode]);

  const notifyLocked = useCallback(() => {
    toast.info("Your trial has ended — reconnect to choose a plan.");
  }, []);

  // --------------------------------------------------------------- actions

  const handleSave = async (invoiceData: Record<string, any>) => {
    if (!companyId || saving) return;
    if (lockedOffline) {
      notifyLocked();
      return;
    }
    setSaving(true);

    try {
      const payload: SaveEstimateInput = {
        ...(selectedInvoice?.id && viewMode === "edit" ? { id: selectedInvoice.id } : {}),
        company_id: companyId,
        invoice_number: invoiceData.invoice_number,
        invoice_date: invoiceData.invoice_date,
        customer_name: invoiceData.customer_name,
        customer_phone: invoiceData.customer_phone ?? null,
        customer_address: invoiceData.customer_address ?? null,
        items: invoiceData.items ?? [],
        subtotal: invoiceData.subtotal ?? 0,
        sgst_percent: invoiceData.sgst_percent ?? 0,
        sgst_amount: invoiceData.sgst_amount ?? 0,
        cgst_percent: invoiceData.cgst_percent ?? 0,
        cgst_amount: invoiceData.cgst_amount ?? 0,
        discount: invoiceData.discount ?? 0,
        advance_payment: invoiceData.advance_payment ?? 0,
        grand_total: invoiceData.grand_total ?? 0,
        final_amount: invoiceData.final_amount ?? 0,
        notes: invoiceData.notes ?? null,
      };

      const saved = await saveEstimate(payload);

      refresh();
      setSelectedInvoice(saved);
      setViewMode("preview");

      toast.success(
        selectedInvoice && viewMode === "edit" ? "Estimate updated" : "Estimate saved",
        {
          description: offline
            ? "Saved on this device — it will sync when you're back online."
            : undefined,
        },
      );

      // Push immediately when possible so the estimate is safe off-device.
      if (!offline) void syncNow(companyId).then(refresh);

      // No interstitial here: the app has just switched to the PDF preview, one
      // of the screens declared ad-free. It fires on the way OUT of the preview
      // instead — see handleBack.
    } catch (err) {
      console.error("Estimate save failed:", err);
      toast.error("Could not save the estimate", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (invoice: any) => {
    if (!invoice?.id) return;
    if (!window.confirm("Delete this estimate? This cannot be undone.")) return;

    try {
      await deleteEstimate(invoice.id);
      refresh();
      void notify("Estimate deleted");
      if (!offline) void syncNow(companyId).then(refresh);
    } catch (err) {
      console.error("Estimate delete failed:", err);
      toast.error("Could not delete the estimate");
    }
  };

  const handleCreateNew = () => {
    setSelectedInvoice(null);
    setViewMode("create");
  };

  const handleView = (invoice: any) => {
    setSelectedInvoice(invoice);
    setViewMode("preview");
  };

  const handleEdit = (invoice: any) => {
    setSelectedInvoice(invoice);
    setViewMode("edit");
  };

  const handleBack = () => {
    const leavingPreview = viewMode === "preview";
    setSelectedInvoice(null);
    setViewMode("list");

    // The one moment an interstitial is acceptable: the task is finished and
    // the user is back between screens, not on top of the preview they came to
    // read. Free tier only, and heavily rate limited (see native/adsConfig.ts).
    if (leavingPreview && entitlement.adsEnabled) void maybeShowInterstitial();
  };

  const handleLogout = async () => {
    beginUserSignOut();
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const filteredEstimates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return estimates;
    return estimates.filter((e: any) =>
      [e.invoice_number, e.customer_name, e.customer_phone]
        .filter(Boolean)
        .some((field: string) => String(field).toLowerCase().includes(q)),
    );
  }, [estimates, searchQuery]);

  // ------------------------------------------------------------- rendering

  if (companyLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // A missing company and a failed fetch are different problems and must not
  // share a message — the old code told offline users to "register first".
  if (!company) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        {companyError || offline ? (
          <>
            <WifiOff className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Can&apos;t reach your account</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Check your connection and try again. Nothing has been lost.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              No business profile yet. Set one up to start creating estimates.
            </p>
            <Button onClick={() => navigate("/register")}>Complete setup</Button>
          </>
        )}
      </div>
    );
  }

  // Trial expired with no active plan. The full paywall only renders when the
  // user can actually act on it — offline there is nothing to buy, so the
  // screen degrades to read-only instead (see `lockedOffline` below) rather
  // than dead-ending a merchant who cannot pay from where they are standing.
  if (estimatesLocked && !offline) {
    return (
      <AdminLayout
        company={company}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogout={handleLogout}
        showSearch={false}
        title="Estimates"
      >
        <div className="flex min-h-[70vh] items-center justify-center px-2">
          <div className="w-full max-w-lg space-y-6 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-rose-100 to-pink-100 shadow-lg shadow-rose-200/50 dark:from-rose-950 dark:to-pink-950">
              <Lock className="h-10 w-10 text-rose-500" />
            </div>

            <div>
              <h2 className="mb-2 text-2xl font-bold text-foreground">Free trial ended</h2>
              <p className="text-sm text-muted-foreground">
                Your 5-day free trial for Estimates has expired. Choose a plan to keep creating and
                sharing estimates. Everything you&apos;ve already made is safe.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              <Clock className="h-4 w-4" />
              Trial expired
            </div>

            <div className="grid gap-4 text-left sm:grid-cols-2">
              <div className="flex flex-col rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900 dark:bg-indigo-950/30">
                <div className="mb-1 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-indigo-900 dark:text-indigo-200">
                    Estimate Generator
                  </span>
                </div>
                <p className="mb-3 text-2xl font-bold text-indigo-700 dark:text-indigo-300">
                  ₹{getPlanPrice("estimate_generate")}
                  <span className="text-xs font-normal text-indigo-500">/month</span>
                </p>
                <ul className="mb-4 flex-1 space-y-1.5 text-xs text-indigo-800 dark:text-indigo-300">
                  <li>✅ Unlimited estimates</li>
                  <li>✅ Works fully offline</li>
                  <li>✅ PDF & WhatsApp sharing</li>
                  <li>✅ No ads</li>
                </ul>
                <Button
                  className="w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700"
                  disabled={subLoading}
                  onClick={() =>
                    subscribe(
                      "estimate_generate",
                      "Estimate Generator Plan",
                      getPlanPrice("estimate_generate"),
                      undefined,
                      (id) => navigate(`/billing/receipt/${id}`),
                    )
                  }
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {subLoading ? "Processing..." : `Get for ₹${getPlanPrice("estimate_generate")}/mo`}
                </Button>
              </div>

              <div className="relative flex flex-col overflow-hidden rounded-xl border-2 border-rose-200 bg-rose-50/50 p-5 dark:border-rose-900 dark:bg-rose-950/30">
                <div className="absolute right-0 top-0 rounded-bl-lg bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  BEST VALUE
                </div>
                <div className="mb-1 flex items-center gap-2">
                  <Crown className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  <span className="font-bold text-rose-900 dark:text-rose-200">Support Plan</span>
                </div>
                <p className="mb-3 text-2xl font-bold text-rose-700 dark:text-rose-300">
                  ₹{getPlanPrice("support")}
                  <span className="text-xs font-normal text-rose-500">/month</span>
                </p>
                <ul className="mb-4 flex-1 space-y-1.5 text-xs text-rose-800 dark:text-rose-300">
                  <li>✅ Everything in Estimate plan</li>
                  <li>✅ Priority & call support</li>
                  <li>✅ Unlimited products</li>
                  <li>✅ Premium themes & skins</li>
                </ul>
                <Button
                  className="w-full bg-gradient-to-r from-rose-600 to-pink-600 font-bold text-white hover:from-rose-700 hover:to-pink-700"
                  disabled={subLoading}
                  onClick={() =>
                    subscribe(
                      "support",
                      "Monthly Support Subscription",
                      getPlanPrice("support"),
                      undefined,
                      (id) => navigate(`/billing/receipt/${id}`),
                    )
                  }
                >
                  <Heart className="mr-2 h-4 w-4" />
                  {subLoading ? "Processing..." : `Get for ₹${getPlanPrice("support")}/mo`}
                </Button>
              </div>
            </div>

            {/* Someone who has already been debited must never have to guess.
                Restore lives on Billing, so send them there rather than making
                a second payment look like the only way forward. */}
            <Button
              variant="ghost"
              className="h-11 w-full font-semibold sm:w-auto"
              onClick={() => navigate("/billing")}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Already paid? Restore purchase
            </Button>

            <p className="text-xs text-muted-foreground">
              Instant access after payment • 30-day plan, no auto-debit • Your data is always safe
            </p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      company={company}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onLogout={handleLogout}
      showSearch={false}
      title="Estimates"
    >
      {/* The trial is otherwise invisible between promo dialogs, which appear at
          most once a day — a merchant deserves to know how long they have
          without being sold to. Paid plans never see it. */}
      {viewMode === "list" && entitlement.trialActive && !entitlement.isPaid && (
        <div className="mx-auto mb-3 flex w-full max-w-2xl flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/40 sm:flex-row sm:items-center sm:gap-3">
          <Timer className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Free Estimates trial</span> —{" "}
            {formatTrialRemaining(entitlement.trialMsRemaining)}. Subscribe any time to keep going.
          </p>
          <Button
            variant="outline"
            className="h-11 w-full shrink-0 text-xs font-semibold sm:w-auto"
            onClick={() => navigate("/billing")}
          >
            See plans
          </Button>
        </div>
      )}

      {lockedOffline && viewMode === "list" && (
        <div className="mx-auto mb-3 flex w-full max-w-2xl items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/40">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Your trial has ended</span> — reconnect to choose a
            plan. You can still open and share the estimates you already have.
          </p>
        </div>
      )}

      {viewMode === "list" && (
        <InvoiceHistory
          invoices={filteredEstimates}
          company={company}
          onCreateNew={lockedOffline ? notifyLocked : handleCreateNew}
          onView={handleView}
          onEdit={lockedOffline ? notifyLocked : handleEdit}
          onDelete={handleDelete}
          isLoading={estimatesLoading}
        />
      )}

      {(viewMode === "create" || viewMode === "edit") && !lockedOffline && (
        <InvoiceForm
          company={company}
          products={products as any}
          nextInvoiceNumber={
            viewMode === "create" ? nextNumber : selectedInvoice?.invoice_number || nextNumber
          }
          onSave={handleSave}
          onCancel={handleBack}
          editingInvoice={viewMode === "edit" ? selectedInvoice : null}
        />
      )}

      {viewMode === "preview" && selectedInvoice && (
        <InvoicePreview invoice={selectedInvoice} company={company} onBack={handleBack} />
      )}

      {viewMode === "list" && <SupportPromoDialog company={company} />}
    </AdminLayout>
  );
};

export default Invoices;
