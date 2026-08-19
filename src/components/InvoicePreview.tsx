import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Printer, Download, FileText, Share2, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { exportElementAsPdf } from "@/lib/pdf";
import { isNative } from "@/native/platform";

interface InvoicePreviewProps {
  invoice: any;
  company: any;
  onBack: () => void;
}

/* --------------------------------------------------------------------------
 * Reading an estimate safely.
 *
 * `invoices.items` is a JSONB column written by several past builds of this
 * app: entries can be null, can be missing every field, and can carry numbers
 * as strings. The invoice-level columns are nullable too. Because a throw
 * during render unmounts the whole React tree — the blank-screen bug — nothing
 * below dereferences a stored value directly; every cell is derived from a
 * coerced copy instead.
 * -------------------------------------------------------------------------- */

/** A stored number — possibly a string, possibly absent — as a finite number. */
const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A stored string — possibly null — trimmed, or the fallback. */
const str = (value: unknown, fallback = ""): string => {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
};

/**
 * A stored amount, falling back to a computed one only when the column is
 * genuinely absent — a legitimate zero must stay zero.
 */
const amountOr = (value: unknown, fallback: number): number =>
  value === null || value === undefined || value === "" ? fallback : num(value);

const formatAmount = (value: unknown) =>
  num(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (value: unknown) => `₹${formatAmount(value)}`;

const formatDate = (value: unknown) => {
  // `new Date(null)` is the epoch rather than an error, so the empty cases have
  // to be rejected before the Date is built.
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

interface PreviewItem {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discount: number;
  amount: number;
  size: string;
}

/** Coerce whatever is in the `items` column into a list we can iterate. */
export const asItemArray = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  // A jsonb column holds a JSON *string* if an older build stringified before
  // writing. Anything else is not a line-item list and is treated as empty.
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* an unreadable payload shows as an empty document, never a blank app */
    }
  }
  return [];
};

const normaliseItems = (raw: unknown): PreviewItem[] =>
  asItemArray(raw).map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const price = num(item.price);
    const quantity = num(item.quantity);
    const discount = num(item.discount);
    return {
      name: str(item.name, "Item"),
      quantity,
      unit: str(item.unit, "pcs"),
      price,
      discount,
      // Rows saved before the line total was stored still have to show one, so
      // it falls back to the same arithmetic the form uses.
      amount: amountOr(item.amount, Math.max(0, price * quantity - discount)),
      size: str(item.size),
    };
  });

const InvoicePreview = ({ invoice, company, onBack }: InvoicePreviewProps) => {
  // `str()` and not the raw column: `value={null}` flips a controlled input to
  // uncontrolled, React warns, and the field stops accepting edits.
  const [isInvoiceMode, setIsInvoiceMode] = useState(false);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState(() =>
    str(invoice?.invoice_number),
  );
  const [vehicleNumber, setVehicleNumber] = useState("");

  const [busy, setBusy] = useState<null | "pdf" | "share">(null);

  // The mirrored data URI comes first: html2canvas cannot rasterise a remote
  // <img> with no connection — it renders blank and stalls the capture — so an
  // offline PDF would otherwise ship without the merchant's branding.
  const companyLogo: string | undefined = company?.logo_data_uri || company?.logo_url || undefined;

  // ---- everything the document renders, derived once and coerced ----
  const items = normaliseItems(invoice?.items);
  const hasSizeColumn = items.some((item) => item.size !== "");

  const grossTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const itemDiscountTotal = items.reduce((sum, item) => sum + item.discount, 0);

  // Each invoice-level column falls back to the figure the line items imply, so
  // an estimate saved before a column existed still adds up instead of showing
  // ₹0.00 next to a populated table.
  const subtotal = amountOr(invoice?.subtotal, itemsTotal);
  const sgstAmount = num(invoice?.sgst_amount);
  const cgstAmount = num(invoice?.cgst_amount);
  const grandTotal = amountOr(invoice?.grand_total, subtotal + sgstAmount + cgstAmount);
  const discount = num(invoice?.discount);
  const finalAmount = amountOr(invoice?.final_amount, Math.max(0, grandTotal - discount));
  const advancePayment = num(invoice?.advance_payment);
  const totalSaved = itemDiscountTotal + discount;

  const customerName = str(invoice?.customer_name, "Customer");
  const invoiceNumber = str(invoice?.invoice_number, "—");
  const companyName = str(company?.name, "Company");

  // window.print() is a no-op inside an Android WebView (printing requires
  // wiring PrintManager natively), so on device the Print button produces the
  // same PDF the user would otherwise have printed.
  const handlePrint = () => {
    if (isNative) {
      void handleExport("share");
      return;
    }
    window.print();
  };

  const handleOpenInvoiceDialog = () => {
    setCustomInvoiceNumber(str(invoice?.invoice_number)); // Reset to default on open
    setIsInvoiceDialogOpen(true);
  };

  const handleConfirmInvoice = () => {
    setIsInvoiceDialogOpen(false);
    setIsInvoiceMode(true);
    // Let React repaint in invoice mode before capturing/printing.
    setTimeout(() => {
      if (isNative) {
        void handleExport("share");
      } else {
        window.print();
      }
    }, 500);
  };

  /**
   * Produce the PDF and hand it to the user.
   *
   * The old implementation had no try/catch at all, so any failure surfaced as
   * an unhandled rejection and the button simply appeared to do nothing.
   */
  const handleExport = async (mode: "pdf" | "share") => {
    if (busy) return;
    const element = document.getElementById("invoice-print-area");
    if (!element) {
      toast.error("Nothing to export yet");
      return;
    }

    setBusy(mode);
    try {
      const label = isInvoiceMode ? "Invoice" : "Estimate";
      const number = str(isInvoiceMode ? customInvoiceNumber : invoice?.invoice_number, "estimate");
      const companyName = str(company?.name);
      const result = await exportElementAsPdf(element, {
        name: `${companyName ? companyName + "-" : ""}${number}`,
        title: `${label} ${number}`,
        text: `${label} ${number} from ${companyName || "us"}${
          finalAmount > 0 ? ` — ${formatCurrency(finalAmount)}` : ""
        }`,
      });

      if (!result.ok && result.error && result.error !== "cancelled") {
        toast.error("Could not create the PDF", { description: result.error });
      }
    } catch (err) {
      console.error("PDF export failed:", err);
      toast.error("Could not create the PDF", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPDF = () => handleExport("pdf");

  // Opening a deleted or half-synced estimate used to render an empty document
  // with live Print/Share buttons. Say so instead, and keep the way back.
  if (!invoice) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <FileWarning className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Estimate not available</h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            This estimate could not be loaded. It may have been deleted, or it has not finished
            syncing to this device yet.
          </p>
        </div>
        <Button onClick={onBack} className="h-11 gap-2 px-5">
          <ArrowLeft className="h-4 w-4" />
          Back to estimates
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10 print:bg-white print:pb-0 print:min-h-0">
      {/* Action Bar — app chrome, so it follows the theme. Wraps rather than
          overflows on a narrow phone; labels collapse to icons below `xs`. */}
      <div className="print:hidden relative z-10 border-b border-border bg-card/90 backdrop-blur-md shadow-sm supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-11 gap-2 px-3 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => { setIsInvoiceMode(false); handlePrint(); }}
              disabled={busy !== null}
              className="h-11 min-w-11 gap-2 px-3"
              title="Print"
              aria-label="Print"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden xs:inline">Print</span>
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenInvoiceDialog}
              className="h-11 min-w-11 gap-2 border-emerald-200 px-3 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
              title="Convert to invoice"
              aria-label="Convert to invoice"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden xs:inline">Invoice</span>
            </Button>
            <Button
              onClick={() => void handleDownloadPDF()}
              disabled={busy !== null}
              className="h-11 min-w-11 gap-2 px-3"
              title={isNative ? "Share PDF" : "Download PDF"}
              aria-label={isNative ? "Share PDF" : "Download PDF"}
            >
              {isNative ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              <span className="hidden xs:inline">
                {busy ? "Preparing..." : isNative ? "Share PDF" : "Download PDF"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Invoice Content
          ------------------------------------------------------------------
          EVERYTHING inside #invoice-print-area stays on a LIGHT palette on
          purpose — white paper, dark ink — and must NOT be given dark:
          variants. html2canvas rasterises this exact node into the PDF, so a
          theme-aware document would produce a black page in dark mode. Only
          the chrome around it (bar above, page background) follows the theme.
          ------------------------------------------------------------------ */}
      <div className="mx-auto mt-4 max-w-4xl px-3 sm:mt-6 sm:px-4 print:mt-0 print:px-0">
        <div
          id="invoice-print-area"
          className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden print:shadow-none print:border-none print:rounded-none"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-4 sm:px-8 py-5 sm:py-6 print:bg-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                {companyLogo && (
                  <img
                    src={companyLogo}
                    alt={`${companyName} logo`}
                    className="h-12 w-12 sm:h-16 sm:w-16 shrink-0 rounded-lg object-cover bg-white p-1"
                  />
                )}
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold tracking-tight break-words">
                    {companyName}
                  </h1>
                  {isInvoiceMode && company?.gst_number && (
                    <p className="text-slate-300 text-xs sm:text-sm mt-0.5 break-all">
                      GSTIN: {company.gst_number}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-left sm:text-right shrink-0">
                <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight opacity-90">
                  {isInvoiceMode ? "BILL OF SUPPLY" : "ESTIMATE"}
                </h2>
                <p className="text-slate-300 text-xs sm:text-sm font-medium mt-1 break-all">
                  {isInvoiceMode ? str(customInvoiceNumber, "—") : invoiceNumber}
                </p>
                <p className="text-slate-400 text-xs sm:text-sm">
                  {formatDate(invoice.invoice_date)}
                </p>
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-gray-100">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Bill To
              </h3>
              <p className="text-sm font-semibold text-gray-900 break-words">
                {customerName}
              </p>
              {invoice.customer_phone && (
                <p className="text-sm text-gray-600 mt-1">
                  Phone: {invoice.customer_phone}
                </p>
              )}
              {isInvoiceMode && vehicleNumber && (
                <p className="text-sm text-gray-600 mt-1">
                  Vehicle No: {vehicleNumber}
                </p>
              )}
              {invoice.customer_address && (
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-line break-words">
                  {invoice.customer_address}
                </p>
              )}
            </div>
          </div>

          {/* Items Table.
              The 600px floor and the fixed column widths only kick in from md
              up, which covers both print and the 794px html2canvas capture; on
              a phone the columns auto-size instead of forcing a sideways
              scroll through the document. The overflow-x-auto wrapper stays as
              a safety net so a wide table can never widen the page itself. */}
          <div className="px-3 sm:px-8 py-5 sm:py-6 overflow-x-auto">
            <table className="w-full text-[11px] sm:text-sm md:min-w-[600px]">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-10">
                    #
                  </th>
                  <th className="text-left py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800">
                    Item
                  </th>
                  {hasSizeColumn && (
                    <th className="text-center py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-20">
                      Size
                    </th>
                  )}
                  <th className="text-center py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-16">
                    Qty
                  </th>
                  <th className="text-center py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-16">
                    Unit
                  </th>
                  <th className="text-right py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-28">
                    Rate (₹)
                  </th>
                  <th className="text-right py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-28">
                    Amount (₹)
                  </th>
                  <th className="text-right py-2 px-1 sm:py-3 sm:px-2 font-bold text-gray-800 md:w-32">
                    Total (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr className="border-b border-gray-100">
                    <td
                      colSpan={hasSizeColumn ? 8 : 7}
                      className="py-8 px-2 text-center text-gray-500"
                    >
                      No items were saved on this estimate.
                    </td>
                  </tr>
                )}
                {items.map((item, index) => (
                  <tr
                    key={index}
                    className={`border-b border-gray-100 ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50/60"
                    }`}
                  >
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-gray-500">{index + 1}</td>
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-gray-900 font-medium break-words">
                      {item.name}
                    </td>
                    {hasSizeColumn && (
                      <td className="py-2 px-1 sm:py-3 sm:px-2 text-center text-gray-700 break-words">
                        {item.size || "-"}
                      </td>
                    )}
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-center text-gray-700">
                      {item.quantity}
                    </td>
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-center text-gray-500">
                      {item.unit}
                    </td>
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-700 whitespace-nowrap">
                      {formatAmount(item.price)}
                      {item.unit === "sqft" && <>/sqft</>}
                    </td>
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-800 font-medium whitespace-nowrap">
                      {formatAmount(item.price * item.quantity)}
                    </td>
                    <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-900 font-bold whitespace-nowrap">
                      {formatAmount(item.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-800 bg-gray-50/80">
                  <td colSpan={hasSizeColumn ? 5 : 4} className="py-2 px-1 sm:py-3 sm:px-2 text-right font-bold text-gray-800 uppercase text-[10px] sm:text-xs tracking-wider">
                    Totals
                  </td>
                  <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-900 font-bold">
                  </td>
                  <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-900 font-bold whitespace-nowrap">
                    {formatAmount(grossTotal)}
                  </td>
                  <td className="py-2 px-1 sm:py-3 sm:px-2 text-right text-gray-900 font-bold whitespace-nowrap">
                    {formatAmount(subtotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-4 sm:px-8 pb-6">
            <div className="flex justify-end">
              <div className="w-full sm:w-72">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3 py-1">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-gray-900 font-medium whitespace-nowrap">
                      {formatCurrency(subtotal)}
                    </span>
                  </div>

                  {sgstAmount > 0 && (
                    <div className="flex justify-between gap-3 py-1">
                      <span className="text-gray-600">
                        SGST @ {num(invoice.sgst_percent)}%
                      </span>
                      <span className="text-gray-900 font-medium whitespace-nowrap">
                        {formatCurrency(sgstAmount)}
                      </span>
                    </div>
                  )}

                  {cgstAmount > 0 && (
                    <div className="flex justify-between gap-3 py-1">
                      <span className="text-gray-600">
                        CGST @ {num(invoice.cgst_percent)}%
                      </span>
                      <span className="text-gray-900 font-medium whitespace-nowrap">
                        {formatCurrency(cgstAmount)}
                      </span>
                    </div>
                  )}

                  {(sgstAmount > 0 || cgstAmount > 0) && (
                    <div className="flex justify-between gap-3 py-1 border-t border-gray-200 pt-2">
                      <span className="text-gray-700 font-semibold">
                        Grand Total
                      </span>
                      <span className="text-gray-900 font-semibold whitespace-nowrap">
                        {formatCurrency(grandTotal)}
                      </span>
                    </div>
                  )}

                  {discount > 0 && (
                    <div className="flex justify-between gap-3 py-1">
                      <span className="text-green-700">Discount</span>
                      <span className="text-green-700 font-medium whitespace-nowrap">
                        − {formatCurrency(discount)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between gap-3 py-3 mt-1 bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-lg px-4">
                    <span className="font-bold text-sm sm:text-base">Final Amount</span>
                    <span className="font-extrabold text-base sm:text-lg whitespace-nowrap">
                      {formatCurrency(finalAmount)}
                    </span>
                  </div>

                  {totalSaved > 0 && (
                    <div className="flex justify-between gap-3 py-2 text-green-700 bg-green-50 rounded-md px-3 mt-2 border border-green-100">
                      <span className="font-medium">You saved</span>
                      <span className="font-bold whitespace-nowrap">
                        {formatCurrency(totalSaved)}
                      </span>
                    </div>
                  )}

                  {advancePayment > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-300">
                      <div className="flex justify-between gap-3 py-1 text-gray-700">
                        <span>Advance Amount Received</span>
                        <span className="font-medium text-gray-900 whitespace-nowrap">
                          {formatCurrency(advancePayment)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 py-2 mt-1">
                        <span className="font-bold text-gray-800">Balance to be Paid</span>
                        <span className="font-bold text-gray-900 text-base sm:text-lg whitespace-nowrap">
                          {formatCurrency(Math.max(0, finalAmount - advancePayment))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-4 sm:px-8 pb-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-1">
                  Notes
                </h4>
                <p className="text-sm text-amber-900 whitespace-pre-line break-words">
                  {invoice.notes}
                </p>
              </div>
            </div>
          )}

          {/* Authorized Signature & Seal */}
          {isInvoiceMode && (
            <div className="px-4 sm:px-8 mt-8 mb-4 flex justify-end">
              <div className="text-center">
                <div className="w-40 sm:w-48 h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center mb-2">
                  <span className="text-gray-400 text-sm">Seal & Signature</span>
                </div>
                <p className="text-sm font-semibold text-gray-800">Authorized Signatory</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center px-4 sm:px-8 pb-6">
            <p className="text-xs text-gray-400 mt-1">
              This is a computer-generated estimate and does not require a
              signature.
            </p>
            {company?.upi_id && (
              <p className="text-xs text-gray-500 mt-2 break-all">
                UPI: <span className="font-medium">{company.upi_id}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Invoice Details Dialog */}
      <Dialog open={isInvoiceDialogOpen} onOpenChange={setIsInvoiceDialogOpen}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:w-[425px] sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-left">Invoice Details</DialogTitle>
            <DialogDescription className="text-left">
              These details appear on the invoice copy. The estimate itself is not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Label above the field on a phone; the 4-column split only makes
                sense once there is room for it. */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-4 sm:gap-4">
              <Label htmlFor="invoice-number" className="sm:text-right">
                Invoice No.
              </Label>
              <Input
                id="invoice-number"
                value={customInvoiceNumber}
                onChange={(e) => setCustomInvoiceNumber(e.target.value)}
                className="h-11 text-base sm:col-span-3"
              />
            </div>
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-4 sm:gap-4">
              <Label htmlFor="vehicle-number" className="sm:text-right">
                Vehicle No.
              </Label>
              <Input
                id="vehicle-number"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="Optional"
                className="h-11 text-base sm:col-span-3"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setIsInvoiceDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="h-11" onClick={handleConfirmInvoice}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicePreview;
