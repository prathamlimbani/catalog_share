import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download } from "lucide-react";

interface InvoicePreviewProps {
  invoice: any;
  company: any;
  onBack: () => void;
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

const InvoicePreview = ({ invoice, company, onBack }: InvoicePreviewProps) => {
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById("invoice-print-area");
    if (!element) return;
    const html2pdf = (await import("html2pdf.js")).default;
    html2pdf()
      .set({
        margin: 0.5,
        filename: `${invoice.invoice_number}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      })
      .from(element)
      .save();
  };

  const items: {
    product_id: string;
    name: string;
    quantity: number;
    unit: string;
    price: number;
    amount: number;
  }[] = invoice.items || [];

  return (
    <div className="min-h-screen bg-gray-100 pb-10 print:bg-white print:pb-0 print:min-h-0">
      {/* Action Bar */}
      <div className="print:hidden sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button
              size="sm"
              onClick={handleDownloadPDF}
              className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Invoice Content */}
      <div className="max-w-4xl mx-auto mt-6 px-4 print:mt-0 print:px-0">
        <div
          id="invoice-print-area"
          className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden print:shadow-none print:border-none print:rounded-none"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-8 py-6 print:bg-slate-800">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {company?.logo_url && (
                  <img
                    src={company.logo_url}
                    alt={company.name}
                    className="h-16 w-16 rounded-lg object-cover bg-white p-1"
                  />
                )}
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    {company?.name || "Company"}
                  </h1>
                  {company?.gst_number && (
                    <p className="text-slate-300 text-sm mt-0.5">
                      GSTIN: {company.gst_number}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-extrabold tracking-tight opacity-90">
                  ESTIMATE
                </h2>
                <p className="text-slate-300 text-sm font-medium mt-1">
                  {invoice.invoice_number}
                </p>
                <p className="text-slate-400 text-sm">
                  {formatDate(invoice.invoice_date)}
                </p>
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="px-8 py-6 border-b border-gray-100">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Bill To
              </h3>
              <p className="text-sm font-semibold text-gray-900">
                {invoice.customer_name}
              </p>
              {invoice.customer_phone && (
                <p className="text-sm text-gray-600 mt-1">
                  Phone: {invoice.customer_phone}
                </p>
              )}
              {invoice.customer_address && (
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">
                  {invoice.customer_address}
                </p>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="px-8 py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-3 px-2 font-bold text-gray-800 w-10">
                    #
                  </th>
                  <th className="text-left py-3 px-2 font-bold text-gray-800">
                    Item
                  </th>
                  {items.some(item => !!item.size) && (
                    <th className="text-center py-3 px-2 font-bold text-gray-800 w-20">
                      Size
                    </th>
                  )}
                  <th className="text-center py-3 px-2 font-bold text-gray-800 w-16">
                    Qty
                  </th>
                  <th className="text-center py-3 px-2 font-bold text-gray-800 w-16">
                    Unit
                  </th>
                  <th className="text-right py-3 px-2 font-bold text-gray-800 w-28">
                    Rate (₹)
                  </th>
                  <th className="text-right py-3 px-2 font-bold text-gray-800 w-32">
                    Amount (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={index}
                    className={`border-b border-gray-100 ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50/60"
                    }`}
                  >
                    <td className="py-3 px-2 text-gray-500">{index + 1}</td>
                    <td className="py-3 px-2 text-gray-900 font-medium">
                      {item.name}
                    </td>
                    {items.some(i => !!i.size) && (
                      <td className="py-3 px-2 text-center text-gray-700">
                        {item.size || "-"}
                      </td>
                    )}
                    <td className="py-3 px-2 text-center text-gray-700">
                      {item.quantity}
                    </td>
                    <td className="py-3 px-2 text-center text-gray-500">
                      {item.unit}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-700">
                      {item.price.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-900 font-medium">
                      {item.amount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 pb-6">
            <div className="flex justify-end">
              <div className="w-72">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-gray-900 font-medium">
                      {formatCurrency(invoice.subtotal)}
                    </span>
                  </div>

                  {invoice.sgst_amount > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">
                        SGST @ {invoice.sgst_percent}%
                      </span>
                      <span className="text-gray-900 font-medium">
                        {formatCurrency(invoice.sgst_amount)}
                      </span>
                    </div>
                  )}

                  {invoice.cgst_amount > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">
                        CGST @ {invoice.cgst_percent}%
                      </span>
                      <span className="text-gray-900 font-medium">
                        {formatCurrency(invoice.cgst_amount)}
                      </span>
                    </div>
                  )}

                  {(invoice.sgst_amount > 0 || invoice.cgst_amount > 0) && (
                    <div className="flex justify-between py-1 border-t border-gray-200 pt-2">
                      <span className="text-gray-700 font-semibold">
                        Grand Total
                      </span>
                      <span className="text-gray-900 font-semibold">
                        {formatCurrency(invoice.grand_total)}
                      </span>
                    </div>
                  )}

                  {invoice.discount > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-green-700">Discount</span>
                      <span className="text-green-700 font-medium">
                        − {formatCurrency(invoice.discount)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between py-3 mt-1 bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-lg px-4 -mx-2">
                    <span className="font-bold text-base">Final Amount</span>
                    <span className="font-extrabold text-lg">
                      {formatCurrency(invoice.final_amount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-8 pb-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-1">
                  Notes
                </h4>
                <p className="text-sm text-amber-900 whitespace-pre-line">
                  {invoice.notes}
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center px-8">
            <p className="text-xs text-gray-400 mt-1">
              This is a computer-generated estimate and does not require a
              signature.
            </p>
            {company?.upi_id && (
              <p className="text-xs text-gray-500 mt-2">
                UPI: <span className="font-medium">{company.upi_id}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePreview;
