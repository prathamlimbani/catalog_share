import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
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
import { maybeShowInterstitial, prepareRewarded } from "@/native/ads";
import { useSuppressAds } from "@/hooks/useAdSurface";
import { adPolicy } from "@/lib/adPolicy";
import { useEstimateCredits } from "@/hooks/useEstimateCredits";
import { costOf, creditsEnforced, spendCredits, type CreditAction } from "@/lib/estimateCredits";
import EstimateCreditsCard from "@/components/estimates/EstimateCreditsCard";
import EstimateCreditsDialog from "@/components/estimates/EstimateCreditsDialog";
import { notify } from "@/native/files";

type ViewMode = "list" | "create" | "edit" | "preview";

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
  const companyId = company?.id as string | undefined;
  const { credits, resolved: creditsResolved, watchForCredit } = useEstimateCredits(companyId);

  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * The credit gate, held open across an await.
   *
   * `resolve` is the continuation of handleSave: the dialog calls it with true
   * once the balance covers the save and false to go back to the form. Keeping
   * it here rather than threading callbacks keeps the save path readable as one
   * sequence.
   */
  const [gate, setGate] = useState<
    | null
    | { action: CreditAction; resolve: (proceed: boolean) => void }
  >(null);
  const [nextNumber, setNextNumber] = useState("INV-0001");

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

  // --------------------------------------------------------------- credits
  /**
   * Whether this account pays for estimates with ads.
   *
   * Gated on `entitlementResolved` in the SAFE direction: until the plan is
   * known we assume it is free, so a Pro subscriber is never briefly shown an ad
   * prompt during a cold start. The save path re-checks before charging
   * anything, so nothing is given away by being generous here.
   */
  const adFunded = entitlementResolved && !entitlement.estimatesFree;

  // The shell owns the banner (see useAdSurface.ts); this screen only declares
  // the state in which it must not be there. The PDF preview is a document the
  // merchant is about to send a customer — a banner on it is noise on top of
  // the message.
  useSuppressAds("estimate-preview", viewMode === "preview");

  // --------------------------------------------------------------- actions

  // Preload while the merchant is typing. By the time they hit Save the ad is
  // usually already in memory, which is the difference between a prompt that
  // feels instant and one that looks broken.
  useEffect(() => {
    if (!adFunded) return;
    if (viewMode !== "create" && viewMode !== "edit") return;
    void prepareRewarded();
  }, [viewMode, adFunded]);

  const handleSave = async (invoiceData: Record<string, any>) => {
    if (!companyId || saving) return;

    const action: CreditAction = selectedInvoice?.id && viewMode === "edit" ? "edit" : "create";
    // Charged only when the plan is ad-funded AND the wallet has actually been
    // read. `creditsResolved` matters: a balance that has not loaded yet reads
    // as zero, and charging off that would demand ads from someone who has
    // credits in hand.
    const mustPay = adFunded && creditsEnforced(credits.config) && creditsResolved;

    // The gate runs BEFORE `saving` is set: the dialog can sit open for the
    // length of two videos, and a spinner on the Save button for a minute reads
    // as a hang.
    if (mustPay && credits.balance < costOf(action, credits.config)) {
      // Ads need a network. Say that plainly rather than opening a dialog whose
      // only button cannot work — a merchant on a shop floor with no signal and
      // no banked credits needs to know what to do, not watch a load spinner.
      if (offline) {
        toast.error("You need a connection to watch an ad", {
          description:
            "Nothing you typed is lost. Credits never expire, so it is worth banking a few next time you are online.",
        });
        return;
      }

      const proceed = await new Promise<boolean>((resolve) => {
        setGate({ action, resolve });
      });
      setGate(null);
      // "Back to the estimate" — the form still holds everything they typed.
      if (!proceed) return;
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

      // Charged only AFTER the estimate is safely on the device. A save that
      // throws must never cost the merchant ads they have already watched.
      if (mustPay) await spendCredits(companyId, action);

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
    if (leavingPreview && entitlement.adsEnabled && adPolicy().interstitial) {
      void maybeShowInterstitial();
    }
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

  return (
    <AdminLayout
      company={company}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onLogout={handleLogout}
      showSearch={false}
      title="Estimates"
    >
      {/* The price is stated before the form is opened, never only inside the
          gate dialog. A merchant who learns what an estimate costs at the
          moment they try to save one has been ambushed; one who saw it on the
          way in is making a choice. Paid plans that include estimates never see
          this at all. */}
      {viewMode === "list" && adFunded && creditsEnforced(credits.config) && (
        <EstimateCreditsCard
          credits={credits}
          onWatch={watchForCredit}
          onUpgrade={() => navigate("/billing")}
        />
      )}

      {viewMode === "list" && (
        <InvoiceHistory
          invoices={filteredEstimates}
          company={company}
          onCreateNew={handleCreateNew}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={estimatesLoading}
        />
      )}

      {(viewMode === "create" || viewMode === "edit") && (
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

      {/* The credit gate. `gate` is non-null only while handleSave is waiting
          on the merchant's answer, and the dialog reads the live balance — so
          the moment an ad tips it over the price, its button becomes Save. */}
      {gate && (
        <EstimateCreditsDialog
          open
          action={gate.action}
          credits={credits}
          onWatch={watchForCredit}
          onProceed={() => gate.resolve(true)}
          onCancel={() => gate.resolve(false)}
          onUpgrade={() => {
            gate.resolve(false);
            navigate("/billing");
          }}
        />
      )}
    </AdminLayout>
  );
};

export default Invoices;
