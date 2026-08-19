import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, FileText, Calendar, Printer, ArrowLeft, X, PencilLine } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import InvoicePreview, { asItemArray } from "./InvoicePreview";

type Product = Tables<"products">;

/**
 * Sentinel product_id for a row the merchant typed by hand.
 *
 * Required for offline use: the product mirror can be empty (or simply not
 * contain what is being quoted), and before this the Save button was gated on
 * every row having a real product_id — so an offline user literally could not
 * save an estimate.
 */
export const CUSTOM_ITEM = "__custom__";

interface InvoiceItem {
  product_id: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discount: number;
  discount_percent?: number | "";
  amount: number;
  size?: string;
}

interface InvoiceFormProps {
  company: any;
  products: Product[];
  nextInvoiceNumber: string;
  onSave: (invoice: any) => void;
  onCancel: () => void;
  editingInvoice?: any | null;
}

const emptyItem = (): InvoiceItem => ({
  product_id: "",
  name: "",
  quantity: 1,
  unit: "pcs",
  price: 0,
  discount: 0,
  discount_percent: "",
  amount: 0,
  size: "",
});

/**
 * Does this row carry a usable item name?
 *
 * Deliberately null-safe. `products.name` is nullable in the database, so a
 * product row saved without one put `null` into `item.name`, and a bare
 * `item.name.trim()` threw during render — which in React 18 unmounts the whole
 * tree and shows the user a blank screen on their next keystroke.
 */
const hasItemName = (item: { name?: string | null }): boolean =>
  typeof item?.name === "string" && item.name.trim().length > 0;

const calculateSqft = (sizeString: string): number | null => {
  const match = sizeString.match(/^\s*([\d.]+)\s*[xX*]\s*([\d.]+)(?:\s*[xX*]\s*([\d.]+))?\s*$/);
  if (match) {
    const l = parseFloat(match[1]);
    const w = parseFloat(match[2]);
    const n = match[3] ? parseFloat(match[3]) : 1;
    if (!isNaN(l) && !isNaN(w) && !isNaN(n)) {
      return Number((((l * w) / 144) * n).toFixed(2));
    }
  }
  return null;
};

const InvoiceForm = ({
  company,
  products,
  nextInvoiceNumber,
  onSave,
  onCancel,
  editingInvoice,
}: InvoiceFormProps) => {
  const today = new Date().toISOString().split("T")[0];

  const [invoiceNumber, setInvoiceNumber] = useState(nextInvoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [applyGst, setApplyGst] = useState(false);
  const [sgstPercent, setSgstPercent] = useState(0);
  const [cgstPercent, setCgstPercent] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [discountPercent, setDiscountPercent] = useState<number | "">("");
  const [advancePayment, setAdvancePayment] = useState<number>(0);
  const [notes, setNotes] = useState("");

  // The offline mirror keeps the logo as a data URI because a remote <img>
  // renders blank with no connection; prefer it so the "From" block is branded
  // whether or not the device is online.
  const companyLogo: string | undefined =
    company?.logo_data_uri || company?.logo_url || undefined;

  // Pre-fill when editing
  useEffect(() => {
    if (editingInvoice) {
      setInvoiceNumber(editingInvoice.invoice_number || nextInvoiceNumber);
      setInvoiceDate(
        editingInvoice.invoice_date
          ? editingInvoice.invoice_date.split("T")[0]
          : today
      );
      setCustomerName(editingInvoice.customer_name || "");
      setCustomerPhone(editingInvoice.customer_phone || "");
      setCustomerAddress(editingInvoice.customer_address || "");
      const editingItems = asItemArray(editingInvoice.items);
      setItems(
        editingItems.length > 0
          ? editingItems.map((item: any) => ({
              product_id: item.product_id || "",
              name: item.name || "",
              quantity: item.quantity || 1,
              unit: item.unit || "pcs",
              price: item.price || 0,
              discount: item.discount || 0,
              discount_percent: item.discount_percent || "",
              amount: item.amount || 0,
              size: item.size || "",
            }))
          : [emptyItem()]
      );
      const hasGst =
        (editingInvoice.sgst_percent > 0 || editingInvoice.cgst_percent > 0);
      setApplyGst(hasGst);
      setSgstPercent(editingInvoice.sgst_percent || 0);
      setCgstPercent(editingInvoice.cgst_percent || 0);
      setDiscount(editingInvoice.discount || 0);
      setAdvancePayment(editingInvoice.advance_payment || 0);
      setNotes(editingInvoice.notes || "");
    }
  }, [editingInvoice]);

  // Calculations
  const totalGross = useMemo(
    () => items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    [items]
  );

  const totalItemDiscount = useMemo(
    () => items.reduce((sum, item) => sum + (item.discount || 0), 0),
    [items]
  );

  const totalRate = useMemo(
    () => items.reduce((sum, item) => {
      const val = item.unit === 'sqft' ? (item.price * item.quantity) : (item.price || 0);
      return sum + val;
    }, 0),
    [items]
  );

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.amount, 0),
    [items]
  );

  const sgstAmount = useMemo(
    () => (applyGst ? (subtotal * sgstPercent) / 100 : 0),
    [subtotal, sgstPercent, applyGst]
  );

  const cgstAmount = useMemo(
    () => (applyGst ? (subtotal * cgstPercent) / 100 : 0),
    [subtotal, cgstPercent, applyGst]
  );

  const grandTotal = useMemo(
    () => subtotal + sgstAmount + cgstAmount,
    [subtotal, sgstAmount, cgstAmount]
  );

  useEffect(() => {
    if (discountPercent !== "") {
      setDiscount(grandTotal * (Number(discountPercent) / 100));
    }
  }, [discountPercent, grandTotal]);

  const finalAmount = useMemo(
    () => Math.max(0, grandTotal - discount),
    [grandTotal, discount]
  );

  // Item handlers
  const updateItem = (index: number, updates: Partial<InvoiceItem>) => {
    setItems((prev) => {
      const updated = [...prev];
      const current = updated[index];
      
      let newDiscount = current.discount || 0;
      let newDiscountPercent = current.discount_percent;

      if ('discount_percent' in updates) {
        newDiscountPercent = updates.discount_percent;
        if (newDiscountPercent !== "") {
          newDiscount = (current.price * current.quantity * Number(newDiscountPercent)) / 100;
        } else {
          newDiscount = 0;
        }
        updates.discount = newDiscount;
      } else if ('discount' in updates) {
        newDiscount = updates.discount || 0;
        newDiscountPercent = "";
        updates.discount_percent = newDiscountPercent;
      } else if ('price' in updates || 'quantity' in updates) {
        const tempPrice = 'price' in updates ? updates.price! : current.price;
        const tempQty = 'quantity' in updates ? updates.quantity! : current.quantity;
        if (newDiscountPercent !== "" && newDiscountPercent !== undefined) {
          newDiscount = (tempPrice * tempQty * Number(newDiscountPercent)) / 100;
          updates.discount = newDiscount;
        }
      }

      updated[index] = { ...current, ...updates };
      
      // Recalculate amount
      const itemDiscount = updated[index].discount || 0;
      updated[index].amount = Math.max(0, (updated[index].price * updated[index].quantity) - itemDiscount);
      return updated;
    });
  };

  const handleProductSelect = (index: number, productId: string) => {
    if (productId === CUSTOM_ITEM) {
      updateItem(index, {
        product_id: CUSTOM_ITEM,
        name: "",
        price: 0,
        unit: "pcs",
        quantity: 1,
        size: "",
      });
      return;
    }
    if (!productId) {
      updateItem(index, {
        product_id: "",
        name: "",
        price: 0,
        unit: "pcs",
        quantity: 1,
        size: "",
      });
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product) {
      updateItem(index, {
        product_id: product.id,
        name: product.name ?? "",
        price: product.price,
        unit: product.quantity_unit || "pcs",
      });
    }
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const invoiceData = {
      ...(editingInvoice?.id ? { id: editingInvoice.id } : {}),
      company_id: company.id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      customer_name: customerName,
      customer_phone: customerPhone || null,
      customer_address: customerAddress || null,
      items: items.filter(hasItemName),
      subtotal,
      sgst_percent: applyGst ? sgstPercent : 0,
      sgst_amount: sgstAmount,
      cgst_percent: applyGst ? cgstPercent : 0,
      cgst_amount: cgstAmount,
      discount,
      advance_payment: advancePayment,
      grand_total: grandTotal,
      final_amount: finalAmount,
      notes: notes || null,
    };
    onSave(invoiceData);
  };

  const formatCurrency = (amount: number) =>
    `₹${amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const currentInvoiceData = {
    company_id: company.id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    customer_name: customerName || "Customer Name",
    customer_phone: customerPhone || null,
    customer_address: customerAddress || null,
    items: items.filter(hasItemName),
    subtotal,
    sgst_percent: applyGst ? sgstPercent : 0,
    sgst_amount: sgstAmount,
    cgst_percent: applyGst ? cgstPercent : 0,
    cgst_amount: cgstAmount,
    discount,
    advance_payment: advancePayment,
    grand_total: grandTotal,
    final_amount: finalAmount,
    notes: notes || null,
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
    <div className="hidden print:block">
      <InvoicePreview invoice={currentInvoiceData} company={company} onBack={() => {}} />
    </div>
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto print:hidden">
      {/* Header */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="-ml-2 h-11 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <Card className="border border-border bg-card shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-card-foreground sm:text-2xl">
                  {editingInvoice ? "Edit Estimate" : "New Estimate"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  Fill in the details below to{" "}
                  {editingInvoice ? "update" : "create"} an estimate
                </p>
              </div>
            </div>
            {/* Both fields are short, so they stay side by side even at 360px —
                stacking them pushed the form itself below the fold. */}
            <div className="grid grid-cols-2 gap-3 lg:flex lg:shrink-0 lg:items-end">
              <div className="min-w-0">
                <Label
                  htmlFor="invoiceNumber"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Estimate No.
                </Label>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="mt-1 h-11 w-full font-semibold lg:w-32"
                />
              </div>
              <div className="min-w-0">
                <Label
                  htmlFor="invoiceDate"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
                >
                  <Calendar className="h-3 w-3" />
                  Date
                </Label>
                {/* color-scheme makes the native date picker (and its icon)
                    render dark rather than black-on-black. */}
                <Input
                  id="invoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="mt-1 h-11 w-full dark:[color-scheme:dark] lg:w-40"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* From & To Sections */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
        {/* From (Company Info) */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
                From
              </h3>
            </div>
            <div className="flex items-start gap-3 sm:gap-4">
              {companyLogo && (
                <img
                  src={companyLogo}
                  alt={company.name}
                  className="h-14 w-14 flex-shrink-0 rounded-xl border border-border object-cover shadow-sm"
                />
              )}
              <div className="min-w-0 space-y-1">
                <p className="truncate text-lg font-bold text-card-foreground">
                  {company.name}
                </p>
                {company.address && (
                  <p className="break-words text-sm leading-relaxed text-muted-foreground">
                    {company.address}
                  </p>
                )}
                {company.phone && (
                  <p className="text-sm text-muted-foreground">📞 {company.phone}</p>
                )}
                {company.email && (
                  <p className="break-all text-sm text-muted-foreground">
                    ✉️ {company.email}
                  </p>
                )}
                {company.gst_number && (
                  <Badge
                    variant="outline"
                    className="mt-2 max-w-full whitespace-normal break-all border-amber-300 bg-amber-50 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    GST: {company.gst_number}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* To (Customer Info) */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
                Bill To
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <Label
                  htmlFor="customerName"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Customer Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="customerName"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 h-11"
                  required
                />
              </div>
              <div>
                <Label
                  htmlFor="customerPhone"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Phone
                </Label>
                <Input
                  id="customerPhone"
                  inputMode="tel"
                  placeholder="Enter phone number"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="mt-1 h-11"
                />
              </div>
              <div>
                <Label
                  htmlFor="customerAddress"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Address
                </Label>
                <Textarea
                  id="customerAddress"
                  placeholder="Enter customer address"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  rows={2}
                  className="mt-1 resize-none text-base sm:text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items Table */}
      <Card className="border border-border shadow-sm">
        <CardContent className="p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
                Items
              </h3>
              <Badge variant="secondary" className="ml-1 text-xs">
                {items.filter(hasItemName).length} item
                {items.filter(hasItemName).length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="h-10 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          {/* Desktop table header.
              Ten columns need roughly 950px of content width, and from lg the
              sidebar already takes 16rem of the viewport — so xl, not md, is
              the first width where the table form is genuinely usable. Every
              width below it gets the stacked card layout. */}
          <div className="mb-2 hidden gap-3 px-1 xl:grid xl:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_0.9fr_1fr_0.7fr_0.9fr_1fr_auto]">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Product
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Size
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Qty
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Unit
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Rate (₹)
            </Label>
            <Label className="text-right text-xs font-semibold uppercase text-muted-foreground">
              Amount
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Disc (%)
            </Label>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Disc (₹)
            </Label>
            <Label className="text-right text-xs font-semibold uppercase text-muted-foreground">
              Total
            </Label>
            <div className="w-9" />
          </div>

          <div className="space-y-3">
            {items.map((item, index) => {
              const product = products.find(p => p.id === item.product_id);
              const featureSizes = product ? (product as any).feature_sizes as Record<string, any> | null : null;
              let sizeOptions: string[] = [];
              if (featureSizes) {
                const { __prices, ...rest } = featureSizes;
                const regularSizes = Array.from(new Set(Object.values(rest).flat())).filter(val => typeof val === 'string') as string[];
                const priceSizes = Array.isArray(__prices) ? __prices.map((sp: any) => sp.size) : [];
                sizeOptions = Array.from(new Set([...regularSizes, ...priceSizes]));
              }

              return (
              <div
                key={index}
                className="group rounded-xl border border-border bg-muted/40 p-3 transition-colors hover:border-primary/40 hover:bg-muted/60"
              >
                {/* Desktop layout */}
                <div className="hidden items-center gap-3 xl:grid xl:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_0.9fr_1fr_0.7fr_0.9fr_1fr_auto]">
                  <div className="w-full min-w-0">
                    {item.product_id === CUSTOM_ITEM ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={item.name ?? ""}
                          onChange={(e) => updateItem(index, { name: e.target.value })}
                          placeholder="Type item name"
                          className="h-9 min-w-0 flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleProductSelect(index, "")}
                          title="Pick from catalogue instead"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <select
                        value={item.product_id}
                        onChange={(e) => handleProductSelect(index, e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring dark:[color-scheme:dark]"
                      >
                        <option value="">Select product...</option>
                        <option value={CUSTOM_ITEM}>✏️ Custom item — type your own</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                            {product.price > 0
                              ? ` — ₹${product.price}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      value={item.size || ""}
                      onChange={(e) => {
                        const newSize = e.target.value;
                        const updates: any = { size: newSize };
                        if (product && featureSizes && Array.isArray(featureSizes.__prices)) {
                          const match = featureSizes.__prices.find((sp: any) => sp.size === newSize);
                          if (match && typeof match.price === 'number') {
                            updates.price = match.price;
                          }
                        }
                        if (item.unit === 'sqft') {
                          const sqft = calculateSqft(newSize);
                          if (sqft !== null) {
                            updates.quantity = sqft;
                          }
                        }
                        updateItem(index, updates);
                      }}
                      list={`size-options-${index}`}
                      className="text-center"
                      placeholder="e.g. M, L"
                    />
                    {sizeOptions.length > 0 && (
                      <datalist id={`size-options-${index}`}>
                        {sizeOptions.map(opt => <option key={opt} value={opt} />)}
                      </datalist>
                    )}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(index, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="text-center"
                  />
                  <select
                    value={item.unit || "pcs"}
                    onChange={(e) => {
                      const newUnit = e.target.value;
                      const updates: any = { unit: newUnit };
                      if (newUnit === 'sqft') {
                        const sqft = calculateSqft(item.size || "");
                        if (sqft !== null) {
                          updates.quantity = sqft;
                        }
                      }
                      updateItem(index, updates);
                    }}
                    className="h-10 rounded-md border border-input bg-background px-2 text-center text-sm text-foreground shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring dark:[color-scheme:dark]"
                  >
                    <option value="pcs">pcs</option>
                    <option value="sqft">sqft</option>
                    <option value="box">box</option>
                    <option value="kg">kg</option>
                    <option value="meters">meters</option>
                  </select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={item.price === 0 ? "" : item.price}
                    onChange={(e) =>
                      updateItem(index, {
                        price: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                  <div className="pr-1 text-right text-sm font-medium text-muted-foreground">
                    {formatCurrency(item.price * item.quantity)}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={item.discount_percent === undefined ? "" : item.discount_percent}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      updateItem(index, { discount_percent: val });
                    }}
                    placeholder="%"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={item.discount === 0 || !item.discount ? "" : item.discount}
                    onChange={(e) =>
                      updateItem(index, {
                        discount: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    placeholder="₹"
                  />
                  <div className="pr-1 text-right text-sm font-semibold text-foreground">
                    {formatCurrency(item.amount)}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
                    aria-label={`Remove item ${index + 1}`}
                    className="h-9 w-9 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Mobile / tablet layout */}
                <div className="space-y-3 xl:hidden">
                  {/* Row number and delete get their own line so the product
                      picker below can use the full 360px width. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(index)}
                      disabled={items.length <= 1}
                      aria-label={`Remove item ${index + 1}`}
                      className="-mr-1 h-11 w-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {item.product_id === CUSTOM_ITEM ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={item.name ?? ""}
                        onChange={(e) => updateItem(index, { name: e.target.value })}
                        placeholder="Type item name"
                        className="h-11 min-w-0 flex-1 text-base"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleProductSelect(index, "")}
                        title="Pick from catalogue instead"
                        aria-label="Pick from catalogue instead"
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <select
                      value={item.product_id}
                      onChange={(e) =>
                        handleProductSelect(index, e.target.value)
                      }
                      className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring dark:[color-scheme:dark]"
                    >
                      <option value="">Select product...</option>
                      <option value={CUSTOM_ITEM}>✏️ Custom item — type your own</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                          {product.price > 0
                            ? ` — ₹${product.price}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  )}

                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      Size
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        value={item.size || ""}
                        onChange={(e) => {
                          const newSize = e.target.value;
                          const updates: any = { size: newSize };
                          if (product && featureSizes && Array.isArray(featureSizes.__prices)) {
                            const match = featureSizes.__prices.find((sp: any) => sp.size === newSize);
                            if (match && typeof match.price === 'number') {
                              updates.price = match.price;
                            }
                          }
                          if (item.unit === 'sqft') {
                            const sqft = calculateSqft(newSize);
                            if (sqft !== null) {
                              updates.quantity = sqft;
                            }
                          }
                          updateItem(index, updates);
                        }}
                        list={`mobile-size-options-${index}`}
                        className="h-11 w-full text-base"
                        placeholder="Size (e.g. 44x15.5)"
                      />
                      {sizeOptions.length > 0 && (
                        <datalist id={`mobile-size-options-${index}`}>
                          {sizeOptions.map(opt => <option key={opt} value={opt} />)}
                        </datalist>
                      )}
                    </div>
                  </div>

                  {/* Two columns at 360px, three from 400px up: the rate is the
                      longest value, so it keeps a full row on the narrowest
                      phones instead of being squeezed into a third. */}
                  <div className="grid grid-cols-2 gap-2 xs:grid-cols-3">
                    <div className="min-w-0">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Qty
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(index, {
                            quantity: Math.max(
                              1,
                              Number(e.target.value) || 1
                            ),
                          })
                        }
                        className="mt-1 h-11 text-center text-base"
                      />
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Unit
                      </Label>
                      <select
                        value={item.unit || "pcs"}
                        onChange={(e) => {
                          const newUnit = e.target.value;
                          const updates: any = { unit: newUnit };
                          if (newUnit === 'sqft') {
                            const sqft = calculateSqft(item.size || "");
                            if (sqft !== null) {
                              updates.quantity = sqft;
                            }
                          }
                          updateItem(index, updates);
                        }}
                        className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring dark:[color-scheme:dark]"
                      >
                        <option value="pcs">pcs</option>
                        <option value="sqft">sqft</option>
                        <option value="box">box</option>
                        <option value="kg">kg</option>
                        <option value="meters">meters</option>
                      </select>
                    </div>
                    <div className="col-span-2 min-w-0 xs:col-span-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Rate (₹)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={item.price === 0 ? "" : item.price}
                        onChange={(e) =>
                          updateItem(index, {
                            price: Math.max(
                              0,
                              Number(e.target.value) || 0
                            ),
                          })
                        }
                        className="mt-1 h-11 text-base"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Disc (%)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        value={item.discount_percent === undefined ? "" : item.discount_percent}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : Number(e.target.value);
                          updateItem(index, { discount_percent: val });
                        }}
                        className="mt-1 h-11 text-base"
                        placeholder="%"
                      />
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Disc (₹)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={item.discount === 0 || !item.discount ? "" : item.discount}
                        onChange={(e) =>
                          updateItem(index, {
                            discount: Math.max(
                              0,
                              Number(e.target.value) || 0
                            ),
                          })
                        }
                        className="mt-1 h-11 text-base"
                        placeholder="₹"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 border-t border-border pt-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 font-semibold text-foreground">
                      <span>Total</span>
                      <span>{formatCurrency(item.amount)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
            })}
          </div>

          {/* Table Footer / Totals row */}
          <div className="mt-4 border-t border-border pt-4">
            {/* Desktop Totals */}
            <div className="hidden items-center gap-3 px-1 xl:grid xl:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_0.9fr_1fr_0.7fr_0.9fr_1fr_auto]">
              <div className="col-span-4 pr-4 text-right text-sm font-bold uppercase text-muted-foreground">
                Totals
              </div>
              <div></div>
              <div className="pr-1 text-right text-sm font-bold text-foreground">
                {formatCurrency(totalGross)}
              </div>
              <div className="col-span-2"></div>
              <div className="pr-1 text-right text-sm font-bold text-foreground">
                {formatCurrency(subtotal)}
              </div>
              <div className="w-9" />
            </div>

            {/* Mobile Totals */}
            <div className="flex flex-col gap-2 xl:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-muted-foreground">
                  Amount Total
                </span>
                <span className="text-sm font-bold text-foreground">
                  {formatCurrency(totalGross)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-muted-foreground">
                  Subtotal
                </span>
                <span className="text-sm font-bold text-foreground">
                  {formatCurrency(subtotal)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tax & Totals */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
        {/* Tax Section */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
                Tax
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3">
                <Label
                  htmlFor="applyGst"
                  className="cursor-pointer text-sm font-medium text-foreground"
                >
                  Apply GST
                </Label>
                <Switch
                  id="applyGst"
                  checked={applyGst}
                  onCheckedChange={setApplyGst}
                />
              </div>

              {applyGst && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <Label
                        htmlFor="sgst"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        SGST %
                      </Label>
                      <Input
                        id="sgst"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={sgstPercent}
                        onChange={(e) =>
                          setSgstPercent(
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        className="mt-1 h-11"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCurrency(sgstAmount)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <Label
                        htmlFor="cgst"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        CGST %
                      </Label>
                      <Input
                        id="cgst"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={cgstPercent}
                        onChange={(e) =>
                          setCgstPercent(
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        className="mt-1 h-11"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCurrency(cgstAmount)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Totals Section */}
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
                Summary
              </h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Gross Total</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(totalGross)}
                </span>
              </div>
              {totalItemDiscount > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Item Discounts</span>
                  <span className="font-medium text-foreground">
                    - {formatCurrency(totalItemDiscount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              {applyGst && sgstPercent > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    SGST ({sgstPercent}%)
                  </span>
                  <span className="font-medium text-foreground">
                    + {formatCurrency(sgstAmount)}
                  </span>
                </div>
              )}
              {applyGst && cgstPercent > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    CGST ({cgstPercent}%)
                  </span>
                  <span className="font-medium text-foreground">
                    + {formatCurrency(cgstAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                <span className="font-medium text-muted-foreground">Grand Total</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(grandTotal)}
                </span>
              </div>

              {/* The two discount fields share the row width instead of sitting
                  at fixed widths, which overflowed a 360px card. */}
              <div className="mt-2 space-y-2">
                <Label className="text-sm text-muted-foreground">Discount</Label>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.1"
                      placeholder="%"
                      value={discountPercent}
                      onChange={(e) => {
                        const val = e.target.value === "" ? "" : Number(e.target.value);
                        setDiscountPercent(val);
                      }}
                      className="h-11 w-full pr-7 text-right"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">or</span>
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      ₹
                    </span>
                    <Input
                      id="discount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={discount === 0 ? "" : discount}
                      onChange={(e) => {
                        setDiscountPercent("");
                        setDiscount(Math.max(0, Number(e.target.value) || 0));
                      }}
                      className="h-11 w-full pl-6 text-right"
                    />
                  </div>
                </div>
              </div>

              {discount > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-rose-600 dark:text-rose-400">Discount</span>
                  <span className="font-medium text-rose-600 dark:text-rose-400">
                    − {formatCurrency(discount)}
                  </span>
                </div>
              )}

              <div className="mt-2 border-t-2 border-foreground/70 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="min-w-0 text-base font-bold text-foreground">
                    Final Amount
                  </Label>
                  <div className="relative shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
                      ₹
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={finalAmount}
                      onChange={(e) => {
                        const newFinal = Math.max(0, Number(e.target.value) || 0);
                        setDiscountPercent("");
                        setDiscount(Math.max(0, grandTotal - newFinal));
                      }}
                      className="h-12 w-32 border-emerald-300 bg-emerald-50/60 pl-7 text-right text-lg font-extrabold text-emerald-700 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 sm:w-36"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="min-w-0 text-sm font-medium text-foreground">
                    Advance Payment Received
                  </Label>
                  <div className="relative shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      ₹
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={advancePayment === 0 ? "" : advancePayment}
                      onChange={(e) => setAdvancePayment(Math.max(0, Number(e.target.value) || 0))}
                      className="h-11 w-32 pl-7 text-right sm:w-36"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              {advancePayment > 0 && (
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                  <span className="font-bold text-foreground">Balance to be Paid</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    {formatCurrency(Math.max(0, finalAmount - advancePayment))}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card className="border border-border shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
              Notes
            </h3>
            <span className="text-xs text-muted-foreground">(optional)</span>
          </div>
          <Textarea
            placeholder="Add any additional notes, terms, or payment instructions..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="resize-none text-base sm:text-sm"
          />
        </CardContent>
      </Card>

      {/* Action bar.
          Sticky, because Save used to sit at the end of a very long form. The
          bottom offset clears the fixed tab bar (h-16 + safe area + ad banner);
          from lg the tab bar is gone so it can sit flush. `keyboard-aware`
          lifts it above the soft keyboard on the native shell. */}
      <div className="keyboard-aware sticky bottom-[calc(env(safe-area-inset-bottom)_+_var(--tabbar-height)_+_var(--banner-height))] z-20 rounded-xl border border-border bg-card px-3 pt-3 shadow-lg pb-safe lg:bottom-0">
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          {/* Save is first in the DOM so it lands on top on a phone and at the
              right-hand end of the row from sm up. */}
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              !customerName.trim() ||
              items.filter(hasItemName).length === 0
            }
            className="order-first h-12 w-full shadow-md transition-all hover:shadow-lg disabled:opacity-50 sm:order-last sm:h-11 sm:w-auto sm:px-8"
          >
            <FileText className="h-4 w-4 mr-2" />
            {editingInvoice ? "Update Estimate" : "Save Estimate"}
          </Button>
          <div className="flex gap-2 sm:contents">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="h-12 flex-1 sm:h-11 sm:flex-none sm:px-6"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              className="h-12 flex-1 sm:h-11 sm:flex-none sm:px-6"
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default InvoiceForm;
