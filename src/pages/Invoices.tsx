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

type Product = Tables<"products">;

type ViewMode = "list" | "create" | "edit" | "preview";

const Invoices = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading } = useCurrentCompany();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) navigate("/login");
    };
    checkAuth();
  }, [navigate]);

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
      return data || [];
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
        const { id, ...updateData } = invoiceData;
        const { data, error } = await (supabase as any)
          .from("invoices")
          .update(updateData)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        // Insert new invoice
        const { data, error } = await (supabase as any)
          .from("invoices")
          .insert(invoiceData)
          .select()
          .single();
        if (error) throw error;
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
