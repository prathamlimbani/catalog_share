import { useState, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Eye, Pencil, FileText, Search, Trash2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import InvoicePreview from "@/components/InvoicePreview";
import { elementToPdfBlob } from "@/lib/pdf";
import { shareBlob, safeFileName, openWhatsApp, writeToCache } from "@/native/files";
import { sendEstimateToNumber } from "@/native/whatsapp";
import { isNative } from "@/native/platform";

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

/* Every estimate column this list reads is nullable, and `final_amount` comes
   back from PostgREST as a numeric string. Coerce, never dereference. */

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (value: unknown, fallback = ""): string => {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
};

const formatAmount = (value: unknown) =>
  num(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (value: unknown) => `₹${formatAmount(value)}`;

const formatDate = (value: unknown) => {
  // `new Date(null)` is the epoch, not an error — reject the empty cases first.
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/** Sort key. A missing or unparseable timestamp sorts last instead of poisoning
 *  the comparator with NaN, which makes the whole list order arbitrary. */
const timeOf = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const t = new Date(value as string).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Best-effort default for the WhatsApp box.
 *
 * Stored numbers arrive as "98765 43210", "+91 98765 43210" and
 * "919876543210" in roughly equal measure. The old code prefixed +91 to
 * anything that did not already start with it, so a number that carried the
 * country code without the plus became +9191…, i.e. someone else entirely.
 */
const defaultWhatsappNumber = (phone: unknown): string => {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "+91";
  return digits.length > 10 ? `+${digits}` : `+91${digits}`;
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

  // The off-screen render used for the PDF. Scoping the lookup to this host
  // stops `getElementById` picking up a different #invoice-print-area if one is
  // ever mounted alongside the list.
  const captureHostRef = useRef<HTMLDivElement>(null);

  const whatsappDigits = whatsappNumber.replace(/\D/g, "");
  const isWhatsappNumberValid = whatsappDigits.length >= 10 && whatsappDigits.length <= 15;

  const handleOpenWhatsapp = (invoice: any) => {
    setSelectedInvoiceForWhatsapp(invoice);
    setWhatsappNumber(defaultWhatsappNumber(invoice?.customer_phone));
    setWhatsappDialogOpen(true);
  };

  /** Closing also drops the hidden capture render, which would otherwise stay
   *  mounted on every screen for the rest of the session. */
  const closeWhatsappDialog = () => {
    setWhatsappDialogOpen(false);
    setSelectedInvoiceForWhatsapp(null);
  };

  /**
   * Send the estimate to a customer on WhatsApp.
   *
   * On device the PDF is attached directly through the Android share sheet.
   * The previous flow uploaded every estimate — customer name, phone, address
   * and prices — to a PUBLIC storage bucket and shared the raw link, which left
   * that data permanently readable by anyone who guessed the URL. Nothing is
   * uploaded now.
   *
   * The browser keeps the upload-and-link path, because there is no other way
   * to attach a file to a WhatsApp web message.
   */
  const handleSendWhatsapp = async () => {
    if (!selectedInvoiceForWhatsapp || !isWhatsappNumberValid) return;

    // Digits only: the old `replace("+","")` left spaces, dashes and brackets
    // in the wa.me path, which WhatsApp rejects as an invalid number.
    const cleanNumber = whatsappDigits;
    const amount = formatAmount(selectedInvoiceForWhatsapp.final_amount);
    const customerName = str(selectedInvoiceForWhatsapp.customer_name, "there");

    setIsGeneratingLink(true);

    try {
      const element =
        captureHostRef.current?.querySelector<HTMLElement>("#invoice-print-area") ?? null;
      if (!element) throw new Error("Could not prepare the estimate. Please reopen this screen.");

      const number = str(selectedInvoiceForWhatsapp.invoice_number, "Estimate");
      const message =
        `Hello ${customerName},\n\n` +
        `Please find your estimate ${number} for ₹${amount} attached.\n\n` +
        `Thank you!\n${str(company?.name)}`;

      const pdfBlob = await elementToPdfBlob(element, { name: number });

      if (isNative) {
        // Send to the number the merchant actually typed. The plain share sheet
        // ignores it and asks them to find the customer again by hand, which is
        // the whole complaint this replaces.
        const fileUri = await writeToCache(pdfBlob, safeFileName(number));
        const sent = await sendEstimateToNumber({
          phone: cleanNumber,
          text: message,
          fileUri: fileUri ?? undefined,
        });

        if (sent.ok) {
          if (sent.mode === "chat_without_file") {
            // The chat opened but WhatsApp refused the attachment, so say so
            // rather than let the merchant assume the PDF went with it.
            toast.warning("Opened the chat, but the PDF could not be attached", {
              description: "Send it from the estimate's Share button if you need the file.",
            });
          } else if (sent.mode === "picker_with_file") {
            toast.info("Pick the contact in WhatsApp to finish sending.");
          }
          closeWhatsappDialog();
          return;
        }

        // WhatsApp missing or the intent refused: fall back to the share sheet
        // rather than losing the estimate the merchant just prepared.
        const result = await shareBlob(pdfBlob, safeFileName(number), {
          title: `Estimate ${number}`,
          text: message,
          dialogTitle: "Send estimate",
        });

        if (!result.ok && result.error && result.error !== "cancelled") {
          throw new Error(sent.error ?? result.error);
        }
        closeWhatsappDialog();
        return;
      }

      // ---- web fallback: upload, then hand WhatsApp a link ----
      toast.loading("Preparing your estimate...", { id: "pdf-gen" });
      const fileName = `estimates/${str(selectedInvoiceForWhatsapp.id, "estimate")}-${Date.now()}.pdf`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (error) throw error;

      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
      toast.dismiss("pdf-gen");

      const linkMessage =
        `Hello ${customerName},\n\n` +
        `Please find your estimate (${number}) for ₹${amount} here: ${urlData.publicUrl}\n\nThank you!`;

      await openWhatsApp(cleanNumber, linkMessage);
      closeWhatsappDialog();
    } catch (err) {
      console.error("WhatsApp share failed:", err);
      toast.dismiss("pdf-gen");
      toast.error("Could not send the estimate", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  // The prop is `any[]`, and an offline read that fails resolves to undefined.
  const rows: any[] = Array.isArray(invoices) ? invoices : [];

  const sortedInvoices = useMemo(() => {
    // Newest first, falling back to the estimate date when the row predates the
    // created_at column.
    return [...rows].sort(
      (a, b) =>
        timeOf(b?.created_at ?? b?.invoice_date) - timeOf(a?.created_at ?? a?.invoice_date)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return sortedInvoices;
    const query = searchQuery.toLowerCase().trim();
    return sortedInvoices.filter(
      (inv) =>
        str(inv?.customer_name).toLowerCase().includes(query) ||
        str(inv?.invoice_number).toLowerCase().includes(query)
    );
  }, [sortedInvoices, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-5 sm:space-y-6">
        {/* Header skeleton */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-11 w-full sm:w-52" />
        </div>
        {/* Search skeleton */}
        <Skeleton className="h-11 w-full" />
        {/* Row skeletons */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Skeleton className="h-5 w-20" />
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
    <div className="space-y-5 sm:space-y-6">
      {/* Header — stacks on a phone so the title never fights the action button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Estimates
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage and view all your estimates
          </p>
        </div>
        <Button
          onClick={onCreateNew}
          className="h-11 w-full shrink-0 rounded-full px-5 shadow-md transition-all sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create New Estimate
        </Button>
      </div>

      {/* Search — the only search left on this screen, so it takes the full width */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          inputMode="search"
          placeholder="Search customer or estimate no."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search estimates"
          className="h-11 w-full pl-10 text-base"
        />
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center px-4 py-16 sm:py-20">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 sm:h-24 sm:w-24">
            <FileText className="h-9 w-9 text-primary sm:h-10 sm:w-10" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-foreground sm:text-xl">
            No estimates yet
          </h3>
          <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
            Create your first estimate to start tracking your sales and managing
            your billing.
          </p>
          <Button onClick={onCreateNew} className="h-11 gap-2 px-5 shadow-md">
            <Plus className="h-4 w-4" />
            Create First Estimate
          </Button>
        </div>
      )}

      {/* No search results */}
      {rows.length > 0 && filteredInvoices.length === 0 && (
        <div className="px-4 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground">No results found</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            No estimate matches “{searchQuery.trim()}”. Try a customer name or an estimate number.
          </p>
          <Button
            variant="outline"
            onClick={() => setSearchQuery("")}
            className="mt-4 h-11 px-5"
          >
            Clear search
          </Button>
        </div>
      )}

      {/* Desktop table (md and up) */}
      {filteredInvoices.length > 0 && (
        <div className="hidden md:block">
          <Card className="overflow-hidden border-border shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estimate #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Final Amount
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredInvoices.map((invoice, index) => (
                    <tr
                      // A row that never synced has no id yet; a duplicated key
                      // makes React reuse the wrong row on the next render.
                      key={str(invoice?.id, `row-${index}`)}
                      className="transition-colors duration-150 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {str(invoice?.invoice_number, "—")}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatDate(invoice?.invoice_date)}
                      </td>
                      <td className="px-4 py-3 font-medium text-card-foreground">
                        {str(invoice?.customer_name, "Unnamed customer")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {str(invoice?.customer_phone, "—")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="font-semibold tabular-nums text-card-foreground">
                          {formatCurrency(invoice?.final_amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            onClick={() => onView(invoice)}
                            title="View estimate"
                            aria-label={`View estimate ${str(invoice?.invoice_number, "")}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
                            onClick={() => handleOpenWhatsapp(invoice)}
                            title="Send via WhatsApp"
                            aria-label={`Send estimate ${str(invoice?.invoice_number, "")} on WhatsApp`}
                          >
                            <WhatsappIcon className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                            onClick={() => onEdit(invoice)}
                            title="Edit estimate"
                            aria-label={`Edit estimate ${str(invoice?.invoice_number, "")}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onDelete(invoice)}
                            title="Delete estimate"
                            aria-label={`Delete estimate ${str(invoice?.invoice_number, "")}`}
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

      {/* Mobile cards (below md). The summary block is itself the "view" tap
          target, so the action row only has to carry the four real actions. */}
      {filteredInvoices.length > 0 && (
        <div className="space-y-3 md:hidden">
          {filteredInvoices.map((invoice, index) => (
            <Card
              key={str(invoice?.id, `row-${index}`)}
              className="overflow-hidden border-border shadow-sm"
            >
              <button
                type="button"
                onClick={() => onView(invoice)}
                aria-label={`View estimate ${str(invoice?.invoice_number, "")} for ${str(
                  invoice?.customer_name,
                  "unnamed customer",
                )}`}
                className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted"
              >
                {/* min-w-0 is what actually lets the long names truncate */}
                <div className="min-w-0 flex-1">
                  <Badge variant="secondary" className="mb-1.5 font-mono text-xs">
                    {str(invoice?.invoice_number, "—")}
                  </Badge>
                  <p className="truncate text-sm font-semibold text-card-foreground">
                    {str(invoice?.customer_name, "Unnamed customer")}
                  </p>
                  {invoice?.customer_phone && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {str(invoice.customer_phone)}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(invoice?.invoice_date)}
                  </p>
                  <p className="mt-1 whitespace-nowrap text-base font-bold tabular-nums text-card-foreground">
                    {formatCurrency(invoice?.final_amount)}
                  </p>
                </div>
              </button>

              {/* Four equal columns: every target stays ~80x48px even at 320px */}
              <div className="grid grid-cols-4 divide-x divide-border border-t border-border">
                <button
                  type="button"
                  onClick={() => onView(invoice)}
                  aria-label="View"
                  className="flex h-12 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  View
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenWhatsapp(invoice)}
                  aria-label="Send via WhatsApp"
                  className="flex h-12 items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 active:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 dark:active:bg-emerald-950/40"
                >
                  <WhatsappIcon className="h-4 w-4 shrink-0" />
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(invoice)}
                  aria-label="Edit"
                  className="flex h-12 items-center justify-center gap-1.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50 active:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 dark:active:bg-amber-950/40"
                >
                  <Pencil className="h-4 w-4 shrink-0" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(invoice)}
                  aria-label="Delete"
                  className="flex h-12 items-center justify-center gap-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 active:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* WhatsApp Dialog */}
      <Dialog
        open={whatsappDialogOpen}
        onOpenChange={(open) => {
          // Never yank the capture host out from under an in-flight render.
          if (isGeneratingLink) return;
          if (!open) closeWhatsappDialog();
        }}
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:w-[425px] sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left">
              <WhatsappIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Send via WhatsApp
            </DialogTitle>
            <DialogDescription className="text-left">
              Check the number before sending — the estimate goes to whoever owns it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-number" className="text-sm font-medium">
                WhatsApp Number
              </Label>
              <Input
                id="whatsapp-number"
                type="tel"
                inputMode="tel"
                value={whatsappNumber}
                onChange={(e) => {
                  let val = e.target.value;
                  // Ensure +91 remains at the start if user tries to delete it
                  if (!val.startsWith("+91")) {
                    val = "+91" + val.replace("+91", "").trim();
                  }
                  setWhatsappNumber(val);
                }}
                aria-invalid={!isWhatsappNumberValid}
                aria-describedby="whatsapp-number-hint"
                className="h-11 w-full text-base"
                placeholder="+91 XXXXXXXXXX"
              />
              <p
                id="whatsapp-number-hint"
                className={`mt-2 text-xs leading-relaxed ${
                  isWhatsappNumberValid ? "text-muted-foreground" : "text-destructive"
                }`}
              >
                {isWhatsappNumberValid
                  ? // The two paths really do differ: on device the PDF is
                    // attached and nothing leaves the phone, on the web it has
                    // to be uploaded first because WhatsApp Web takes no file.
                    isNative
                    ? "The estimate is attached to the message as a PDF. Nothing is uploaded."
                    : "A link to the PDF is generated and added to the message automatically."
                  : "Enter the full number including the country code, e.g. +91 98765 43210."}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={closeWhatsappDialog}
              disabled={isGeneratingLink}
            >
              Cancel
            </Button>
            <Button
              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={handleSendWhatsapp}
              disabled={isGeneratingLink || !isWhatsappNumberValid}
            >
              {isGeneratingLink ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing PDF...
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
        <div className="pdf-capture-host" aria-hidden="true" ref={captureHostRef}>
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
