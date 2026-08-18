import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentCompany } from "@/hooks/useCompany";
import { AdminLayout } from "@/components/AdminLayout";
import { toast } from "sonner";
import { Tables } from "@/integrations/supabase/types";
import InvoiceForm from "@/components/InvoiceForm";
import InvoicePreview from "@/components/InvoicePreview";
import InvoiceHistory from "@/components/InvoiceHistory";
import { SupportPromoDialog } from "@/components/SupportPromoDialog";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";
import { Lock, Heart, Clock, FileText, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

type Product = Tables<"products">;

type ViewMode = "list" | "create" | "edit" | "preview";

const TRIAL_DURATION_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function isTrialExpired(companyId: string): boolean {
  const key = `estimate_trial_start_${companyId}`;
  const stored = localStorage.getItem(key);
  if (!stored) return false; // trial hasn't started yet — SupportPromoDialog will init it
  const elapsed = Date.now() - parseInt(stored, 10);
  return elapsed >= TRIAL_DURATION_MS;
}

function hasActiveSubscription(company: any): boolean {
  const plan = company?.subscription_plan;
  if (plan !== "support" && plan !== "pro" && plan !== "estimate_generate" && plan !== "growth") return false;
  const expiresAt = company?.subscription_expires_at;
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}

function getTrialTimeRemaining(companyId: string): { days: number; hours: number; minutes: number; seconds: number } {
  const key = `estimate_trial_start_${companyId}`;
  const stored = localStorage.getItem(key);
  if (!stored) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const remaining = TRIAL_DURATION_MS - (Date.now() - parseInt(stored, 10));
  if (remaining <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
  return { days, hours, minutes, seconds };
}

const Invoices = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading } = useCurrentCompany();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [trialCountdown, setTrialCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [isLocked, setIsLocked] = useState(false);

  const { subscribe, loading: subLoading } = useRazorpaySubscription(
    company?.id || "",
    company?.name || "",
    company?.email || ""
  );

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) navigate("/login");
    };
    checkAuth();
  }, [navigate]);

  // Check trial lock status
  useEffect(() => {
    if (!company) return;
    if (hasActiveSubscription(company)) {
      setIsLocked(false);
      return;
    }

    // Update every second
    const interval = setInterval(() => {
      const expired = isTrialExpired(company.id);
      setIsLocked(expired);
      setTrialCountdown(getTrialTimeRemaining(company.id));
    }, 1000);
    // Initial check
    setIsLocked(isTrialExpired(company.id));
    setTrialCountdown(getTrialTimeRemaining(company.id));
    return () => clearInterval(interval);
  }, [company]);

  // Fetch products for the company
  const { data: products = [] } = useQuery({
    queryKey: ["products", company?.id],
    queryFn: async () => {
      if (!company?.id) return [];
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("in_stock", true)
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!company?.id,
  });

  // Fetch invoices for the company
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["invoices", company?.id],
    queryFn: async () => {
      if (!company?.id) return [];
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const mappedData = data?.map((inv: any) => {
         const advItem = inv.items?.find((i: any) => i.product_id === 'ADVANCE_PAYMENT_METADATA');
         if (advItem) {
            inv.advance_payment = advItem.price;
            inv.items = inv.items.filter((i: any) => i.product_id !== 'ADVANCE_PAYMENT_METADATA');
         }
         return inv;
      });
      return mappedData || [];
    },
    enabled: !!company?.id,
  });

  // Generate next invoice number
  const getNextInvoiceNumber = useCallback(() => {
    if (!invoices || invoices.length === 0) return "INV-0001";
    
    const numbers = invoices
      .map((inv: any) => {
        const match = inv.invoice_number?.match(/INV-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n: number) => !isNaN(n));
    
    const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `INV-${String(maxNum + 1).padStart(4, "0")}`;
  }, [invoices]);

  // Save invoice mutation
  const saveMutation = useMutation({
    mutationFn: async (invoiceData: any) => {
      if (invoiceData.id) {
        // Update existing invoice
        const { id, advance_payment, ...updateData } = invoiceData;
        if (advance_payment !== undefined) {
           updateData.items = [...updateData.items.filter((i: any) => i.product_id !== 'ADVANCE_PAYMENT_METADATA'), { product_id: 'ADVANCE_PAYMENT_METADATA', price: advance_payment, name: 'ADVANCE', quantity: 1, unit: 'pcs', amount: 0 }];
        }
        const { data, error } = await (supabase as any)
          .from("invoices")
          .update(updateData)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        if (data) {
           const advItem = data.items?.find((i: any) => i.product_id === 'ADVANCE_PAYMENT_METADATA');
           if (advItem) {
              data.advance_payment = advItem.price;
              data.items = data.items.filter((i: any) => i.product_id !== 'ADVANCE_PAYMENT_METADATA');
           }
        }
        return data;
      } else {
        // Insert new invoice
        const { advance_payment, ...insertData } = invoiceData;
        if (advance_payment !== undefined) {
           insertData.items = [...insertData.items.filter((i: any) => i.product_id !== 'ADVANCE_PAYMENT_METADATA'), { product_id: 'ADVANCE_PAYMENT_METADATA', price: advance_payment, name: 'ADVANCE', quantity: 1, unit: 'pcs', amount: 0 }];
        }
        const { data, error } = await (supabase as any)
          .from("invoices")
          .insert(insertData)
          .select()
          .single();
        if (error) throw error;
        if (data) {
           const advItem = data.items?.find((i: any) => i.product_id === 'ADVANCE_PAYMENT_METADATA');
           if (advItem) {
              data.advance_payment = advItem.price;
              data.items = data.items.filter((i: any) => i.product_id !== 'ADVANCE_PAYMENT_METADATA');
           }
        }
        return data;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(selectedInvoice ? "Estimate updated!" : "Estimate created!");
      setSelectedInvoice(data);
      setViewMode("preview");
    },
    onError: (error: any) => {
      console.error("Invoice save error:", error);
      toast.error("Failed to save estimate: " + (error.message || "Unknown error"));
    },
  });

  const handleSave = (invoiceData: any) => {
    const payload = {
      ...invoiceData,
      company_id: company!.id,
    };
    if (selectedInvoice?.id && viewMode === "edit") {
      payload.id = selectedInvoice.id;
    }
    saveMutation.mutate(payload);
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Estimate deleted successfully");
    },
    onError: (error: any) => {
      console.error("Delete error:", error);
      toast.error("Failed to delete estimate");
    },
  });

  const handleDelete = (invoice: any) => {
    if (window.confirm("Are you sure you want to delete this estimate?")) {
      deleteMutation.mutate(invoice.id);
    }
  };

  const handleBack = () => {
    setSelectedInvoice(null);
    setViewMode("list");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (companyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No company found. Please register first.</p>
      </div>
    );
  }

  // Full-page lock screen when trial expired and no active subscription
  if (isLocked) {
    return (
      <AdminLayout
        company={company}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogout={handleLogout}
      >
        <div className="flex items-center justify-center min-h-[70vh] px-4">
          <div className="max-w-lg w-full text-center space-y-6">
            {/* Lock Icon */}
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center shadow-lg shadow-rose-200/50">
              <Lock className="h-10 w-10 text-rose-500" />
            </div>

            {/* Title */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Free Trial Ended</h2>
              <p className="text-muted-foreground text-sm">
                Your 5-day free trial for Estimates has expired. Choose a plan below to continue creating and managing estimates. Your existing data is safe.
              </p>
            </div>

            {/* Expired Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 font-medium text-sm">
              <Clock className="h-4 w-4" />
              Trial Expired
            </div>

            {/* Plan Cards */}
            <div className="grid sm:grid-cols-2 gap-4 text-left">
              {/* Estimate Generate Plan */}
              <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  <span className="font-bold text-indigo-900">Estimate Generator</span>
                </div>
                <p className="text-2xl font-bold text-indigo-700 mb-3">₹399<span className="text-xs font-normal text-indigo-500">/month</span></p>
                <ul className="space-y-1.5 text-xs text-indigo-800 mb-4 flex-1">
                  <li>✅ Unlimited Estimates</li>
                  <li>✅ PDF & WhatsApp Sharing</li>
                  <li>✅ Estimate History</li>
                </ul>
                <Button
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                  disabled={subLoading}
                  onClick={() => subscribe("estimate_generate", "Estimate Generator Plan", 399)}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {subLoading ? "Processing..." : "Get for ₹399/mo"}
                </Button>
              </div>

              {/* Support Plan */}
              <div className="rounded-xl border-2 border-rose-200 bg-rose-50/50 p-5 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">BEST VALUE</div>
                <div className="flex items-center gap-2 mb-1">
                  <Crown className="h-5 w-5 text-rose-600" />
                  <span className="font-bold text-rose-900">Support Plan</span>
                </div>
                <p className="text-2xl font-bold text-rose-700 mb-3">₹499<span className="text-xs font-normal text-rose-500">/month</span></p>
                <ul className="space-y-1.5 text-xs text-rose-800 mb-4 flex-1">
                  <li>✅ Everything in Estimate Plan</li>
                  <li>✅ Priority Support & Call</li>
                  <li>✅ Unlimited Products</li>
                  <li>✅ All Pro Features</li>
                </ul>
                <Button
                  className="w-full bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-bold"
                  disabled={subLoading}
                  onClick={() => subscribe("support", "Monthly Support Subscription", 499)}
                >
                  <Heart className="h-4 w-4 mr-2" />
                  {subLoading ? "Processing..." : "Get for ₹499/mo"}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Instant access after payment • 30-day subscription • Your data is always safe
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
    >
      {viewMode === "list" && (
        <InvoiceHistory
          invoices={invoices}
          company={company}
          onCreateNew={handleCreateNew}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={invoicesLoading}
        />
      )}

      {(viewMode === "create" || viewMode === "edit") && (
        <InvoiceForm
          company={company}
          products={products}
          nextInvoiceNumber={viewMode === "create" ? getNextInvoiceNumber() : (selectedInvoice?.invoice_number || "")}
          onSave={handleSave}
          onCancel={handleBack}
          editingInvoice={viewMode === "edit" ? selectedInvoice : null}
        />
      )}

      {viewMode === "preview" && selectedInvoice && (
        <InvoicePreview
          invoice={selectedInvoice}
          company={company}
          onBack={handleBack}
        />
      )}
      
      <SupportPromoDialog company={company} />
    </AdminLayout>
  );
};

export default Invoices;
