import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Eye, Pencil, FileText, Search, IndianRupee, Trash2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import InvoicePreview from "@/components/InvoicePreview";

const WhatsappIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="currentColor"
    className={className}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
  </svg>
);

interface InvoiceHistoryProps {
  invoices: any[];
  company: any;
  onCreateNew: () => void;
  onView: (invoice: any) => void;
  onEdit: (invoice: any) => void;
  onDelete: (invoice: any) => void;
  isLoading: boolean;
}

const formatCurrency = (amount: number) => {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const InvoiceHistory = ({
  invoices,
  company,
  onCreateNew,
  onView,
  onEdit,
  onDelete,
  isLoading,
}: InvoiceHistoryProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("+91");
  const [selectedInvoiceForWhatsapp, setSelectedInvoiceForWhatsapp] = useState<any | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  const handleOpenWhatsapp = (invoice: any) => {
    setSelectedInvoiceForWhatsapp(invoice);
    let defaultNumber = "+91";
    if (invoice.customer_phone) {
      const phone = invoice.customer_phone.trim();
      if (phone.startsWith("+91")) {
        defaultNumber = phone;
      } else if (phone.length === 10) {
        defaultNumber = `+91${phone}`;
      } else {
        defaultNumber = `+91${phone}`;
      }
    }
    setWhatsappNumber(defaultNumber);
    setWhatsappDialogOpen(true);
  };

  const handleSendWhatsapp = async () => {
    if (!selectedInvoiceForWhatsapp || !whatsappNumber.trim()) return;
    
    const cleanNumber = whatsappNumber.replace(/\s+/g, "").replace("+", "");
    const amount = selectedInvoiceForWhatsapp.final_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 });
    
    setIsGeneratingLink(true);
    toast.loading("Generating secure PDF link...", { id: "pdf-gen" });

    try {
      const element = document.getElementById("invoice-print-area");
      if (!element) throw new Error("Could not find invoice element to generate PDF");
      
      const html2pdf = (await import("html2pdf.js")).default;
      
      const pdfBlob = await html2pdf()
        .set({
          margin: 0.5,
          filename: `${selectedInvoiceForWhatsapp.invoice_number}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        })
        .from(element)
        .output('blob');
        
      const fileName = `estimates/${selectedInvoiceForWhatsapp.id}-${Date.now()}.pdf`;
      const { data, error } = await supabase.storage.from("product-images").upload(fileName, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });
      
      if (error) throw error;
      
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      toast.dismiss("pdf-gen");
      toast.success("Link generated!");

      const text = `Hello ${selectedInvoiceForWhatsapp.customer_name},\n\nPlease find your estimate (${selectedInvoiceForWhatsapp.invoice_number}) for ₹${amount} here: ${publicUrl}\n\nThank you!`;
      
      const url = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank");
      setWhatsappDialogOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.dismiss("pdf-gen");
      toast.error("Failed to generate PDF link");
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return sortedInvoices;
    const query = searchQuery.toLowerCase().trim();
    return sortedInvoices.filter(
      (inv) =>
        inv.customer_name?.toLowerCase().includes(query) ||
        inv.invoice_number?.toLowerCase().includes(query)
    );
  }, [sortedInvoices, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-44" />
        </div>
        {/* Search skeleton */}
        <Skeleton className="h-10 w-full" />
        {/* Table skeletons */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Estimates
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage and view all your estimates
          </p>
        </div>
        <Button
          onClick={onCreateNew}
          className="bg-blue-600 hover:bg-blue-700 shadow-md transition-all rounded-full px-5"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create New Estimate
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by customer or estimate number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-white dark:bg-slate-800 dark:text-white dark:border-slate-700 border-slate-200 focus:border-blue-400 focus:ring-blue-400/20"
        />
      </div>

      {/* Empty state */}
      {invoices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="h-24 w-24 rounded-full bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center mb-6">
            <FileText className="h-10 w-10 text-blue-500" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            No estimates yet
          </h3>
          <p className="text-gray-500 text-sm text-center max-w-sm mb-6">
            Create your first estimate to start tracking your sales and managing
            your billing.
          </p>
          <Button
            onClick={onCreateNew}
            className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-500/20"
          >
            <Plus className="h-4 w-4" />
            Create First Estimate
          </Button>
        </div>
      )}

      {/* No search results */}
      {invoices.length > 0 && filteredInvoices.length === 0 && (
        <div className="text-center py-10">
          <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
            <Search className="h-6 w-6 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-900">No results found</h3>
          <p className="text-slate-500 mt-1">No estimates match your search criteria.</p>
        </div>
      )}

      {/* Desktop Table */}
      {filteredInvoices.length > 0 && (
        <div className="hidden md:block">
          <Card className="overflow-hidden border-gray-200 dark:border-slate-800 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700">
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Estimate #
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Final Amount
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-blue-50/40 dark:hover:bg-slate-800/50 transition-colors duration-150"
                    >
                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className="font-mono text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {invoice.invoice_number}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                        {formatDate(invoice.invoice_date)}
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {invoice.customer_name}
                      </td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400">
                        {invoice.customer_phone || "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(invoice.final_amount)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            onClick={() => onView(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
                            onClick={() => handleOpenWhatsapp(invoice)}
                            title="Send via WhatsApp"
                          >
                            <WhatsappIcon className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                            onClick={() => onEdit(invoice)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                            onClick={() => onDelete(invoice)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Mobile Cards */}
      {filteredInvoices.length > 0 && (
        <div className="md:hidden space-y-3">
          {filteredInvoices.map((invoice) => (
            <Card
              key={invoice.id}
              className="overflow-hidden border-gray-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow duration-200"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Badge
                      variant="secondary"
                      className="font-mono text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 mb-1.5"
                    >
                      {invoice.invoice_number}
                    </Badge>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {invoice.customer_name}
                    </p>
                    {invoice.customer_phone && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {invoice.customer_phone}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(invoice.invoice_date)}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <IndianRupee className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {invoice.final_amount.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-8 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                    onClick={() => onView(invoice)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-8 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/30"
                    onClick={() => handleOpenWhatsapp(invoice)}
                  >
                    <WhatsappIcon className="h-3.5 w-3.5" />
                    Send
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-8 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                    onClick={() => onEdit(invoice)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-8 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30"
                    onClick={() => onDelete(invoice)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* WhatsApp Dialog */}
      <Dialog open={whatsappDialogOpen} onOpenChange={setWhatsappDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WhatsappIcon className="h-5 w-5 text-green-600" />
              Send via WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-number" className="text-sm font-medium">
                WhatsApp Number
              </Label>
              <Input
                id="whatsapp-number"
                value={whatsappNumber}
                onChange={(e) => {
                  let val = e.target.value;
                  // Ensure +91 remains at the start if user tries to delete it
                  if (!val.startsWith("+91")) {
                    val = "+91" + val.replace("+91", "").trim();
                  }
                  setWhatsappNumber(val);
                }}
                className="w-full"
                placeholder="+91 XXXXXXXXXX"
              />
              <p className="text-xs text-slate-500 mt-2">
                Note: This will generate a secure online link to your PDF and include it in the WhatsApp message automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhatsappDialogOpen(false)} disabled={isGeneratingLink}>
              Cancel
            </Button>
            <Button 
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleSendWhatsapp}
              disabled={isGeneratingLink}
            >
              {isGeneratingLink ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Send via WhatsApp"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden Invoice Preview for PDF Generation */}
      {selectedInvoiceForWhatsapp && (
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }} aria-hidden="true">
          <InvoicePreview 
            invoice={selectedInvoiceForWhatsapp} 
            company={company} 
            onBack={() => {}} 
          />
        </div>
      )}
    </div>
  );
};

export default InvoiceHistory;
