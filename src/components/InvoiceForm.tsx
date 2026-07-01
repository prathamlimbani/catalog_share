import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, FileText, Calendar, Printer, ArrowLeft } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import InvoicePreview from "./InvoicePreview";

type Product = Tables<"products">;

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
  const [notes, setNotes] = useState("");

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
      setItems(
        editingInvoice.items && editingInvoice.items.length > 0
          ? editingInvoice.items.map((item: any) => ({
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
        name: product.name,
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
      items: items.filter((item) => item.product_id && item.name),
      subtotal,
      sgst_percent: applyGst ? sgstPercent : 0,
      sgst_amount: sgstAmount,
      cgst_percent: applyGst ? cgstPercent : 0,
      cgst_amount: cgstAmount,
      discount,
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
    items: items.filter((item) => item.product_id && item.name),
    subtotal,
    sgst_percent: applyGst ? sgstPercent : 0,
    sgst_amount: sgstAmount,
    cgst_percent: applyGst ? cgstPercent : 0,
    cgst_amount: cgstAmount,
    discount,
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
    <div className="space-y-6 max-w-5xl mx-auto print:hidden">
      {/* Header */}
      <div className="mb-4 flex items-center">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>
      <Card className="border-0 shadow-lg bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-100 text-blue-700">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {editingInvoice ? "Edit Estimate" : "New Estimate"}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Fill in the details below to{" "}
                  {editingInvoice ? "update" : "create"} an estimate
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <Label className="text-xs text-slate-500 font-medium">
                  Estimate No.
                </Label>
                <div className="mt-1">
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-32 h-9 text-sm font-semibold bg-blue-50 text-blue-700 border-blue-200 focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <Label
                  htmlFor="invoiceDate"
                  className="text-xs text-slate-500 font-medium flex items-center gap-1"
                >
                  <Calendar className="h-3 w-3" />
                  Date
                </Label>
                <Input
                  id="invoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="mt-1 w-40 text-sm border-slate-200 focus:border-blue-400"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* From & To Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* From (Company Info) */}
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                From
              </h3>
            </div>
            <div className="flex items-start gap-4">
              {company.logo_url && (
                <img
                  src={company.logo_url}
                  alt={company.name}
                  className="h-14 w-14 rounded-xl object-cover border border-slate-200 shadow-sm flex-shrink-0"
                />
              )}
              <div className="space-y-1 min-w-0">
                <p className="font-bold text-lg text-slate-900 truncate">
                  {company.name}
                </p>
                {company.address && (
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {company.address}
                  </p>
                )}
                {company.phone && (
                  <p className="text-sm text-slate-600">📞 {company.phone}</p>
                )}
                {company.email && (
                  <p className="text-sm text-slate-600">✉️ {company.email}</p>
                )}
                {company.gst_number && (
                  <Badge
                    variant="outline"
                    className="mt-2 text-xs font-medium border-amber-300 text-amber-700 bg-amber-50"
                  >
                    GST: {company.gst_number}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* To (Customer Info) */}
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Bill To
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <Label
                  htmlFor="customerName"
                  className="text-xs font-medium text-slate-600"
                >
                  Customer Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="customerName"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 border-slate-200 focus:border-blue-400"
                  required
                />
              </div>
              <div>
                <Label
                  htmlFor="customerPhone"
                  className="text-xs font-medium text-slate-600"
                >
                  Phone
                </Label>
                <Input
                  id="customerPhone"
                  placeholder="Enter phone number"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="mt-1 border-slate-200 focus:border-blue-400"
                />
              </div>
              <div>
                <Label
                  htmlFor="customerAddress"
                  className="text-xs font-medium text-slate-600"
                >
                  Address
                </Label>
                <Textarea
                  id="customerAddress"
                  placeholder="Enter customer address"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  rows={2}
                  className="mt-1 border-slate-200 focus:border-blue-400 resize-none"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items Table */}
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Items
              </h3>
              <Badge variant="secondary" className="text-xs ml-1">
                {items.filter((i) => i.product_id).length} item
                {items.filter((i) => i.product_id).length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          {/* Desktop table header */}
          <div className="hidden md:grid md:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_1fr_0.8fr_1fr_1fr_auto] gap-3 mb-2 px-1">
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Product
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Size
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Qty
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Unit
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Rate (₹)
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Disc (%)
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase">
              Disc (₹)
            </Label>
            <Label className="text-xs font-semibold text-slate-400 uppercase text-right">
              Amount
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
                className="group rounded-xl border border-slate-200 bg-slate-50/50 p-3 transition-all hover:border-slate-300 hover:shadow-sm"
              >
                {/* Desktop layout */}
                <div className="hidden md:grid md:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_1fr_0.8fr_1fr_1fr_auto] gap-3 items-center">
                  <select
                    value={item.product_id}
                    onChange={(e) => handleProductSelect(index, e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-background text-foreground dark:bg-slate-900 px-3 py-2 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
                  >
                    <option value="">Select product...</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                        {product.price > 0
                          ? ` — ₹${product.price}`
                          : ""}
                      </option>
                    ))}
                  </select>
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
                      className="border-slate-200 focus:border-blue-400 text-center"
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
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(index, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="border-slate-200 focus:border-blue-400 text-center"
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
                    className="border-slate-200 focus:border-blue-400 text-center rounded-md border bg-background px-3 py-2 text-sm shadow-sm transition-colors"
                  >
                    <option value="pcs">pcs</option>
                    <option value="sqft">sqft</option>
                    <option value="box">box</option>
                    <option value="kg">kg</option>
                    <option value="meters">meters</option>
                  </select>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.price === 0 ? "" : item.price}
                    onChange={(e) =>
                      updateItem(index, {
                        price: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="border-slate-200 focus:border-blue-400"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={item.discount_percent === undefined ? "" : item.discount_percent}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      updateItem(index, { discount_percent: val });
                    }}
                    className="border-slate-200 focus:border-blue-400"
                    placeholder="%"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.discount === 0 || !item.discount ? "" : item.discount}
                    onChange={(e) =>
                      updateItem(index, {
                        discount: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="border-slate-200 focus:border-blue-400"
                    placeholder="₹"
                  />
                  <div className="text-right font-semibold text-slate-800 dark:text-white text-sm pr-1">
                    {formatCurrency(item.amount)}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
                    className="h-9 w-9 text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Mobile layout */}
                <div className="md:hidden space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={item.product_id}
                      onChange={(e) =>
                        handleProductSelect(index, e.target.value)
                      }
                      className="flex-1 rounded-md border border-slate-200 bg-background text-foreground dark:bg-slate-900 px-3 py-2 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">Select product...</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                          {product.price > 0
                            ? ` — ₹${product.price}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(index)}
                      disabled={items.length <= 1}
                      className="h-9 w-9 text-slate-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-slate-400">Size</Label>
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
                        className="w-full border-slate-200 text-sm"
                        placeholder="Size (e.g. 44x15.5)"
                      />
                      {sizeOptions.length > 0 && (
                        <datalist id={`mobile-size-options-${index}`}>
                          {sizeOptions.map(opt => <option key={opt} value={opt} />)}
                        </datalist>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs text-slate-400">Qty</Label>
                      <Input
                        type="number"
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
                        className="mt-1 border-slate-200 text-center text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Unit</Label>
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
                        className="mt-1 w-full rounded-md border border-slate-200 bg-background text-foreground dark:bg-slate-900 px-3 py-2 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="pcs">pcs</option>
                        <option value="sqft">sqft</option>
                        <option value="box">box</option>
                        <option value="kg">kg</option>
                        <option value="meters">meters</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Price (₹)</Label>
                      <Input
                        type="number"
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
                        className="mt-1 border-slate-200 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-slate-400">Disc (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={item.discount_percent === undefined ? "" : item.discount_percent}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : Number(e.target.value);
                          updateItem(index, { discount_percent: val });
                        }}
                        className="mt-1 border-slate-200 text-sm"
                        placeholder="%"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Disc (₹)</Label>
                      <Input
                        type="number"
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
                        className="mt-1 border-slate-200 text-sm"
                        placeholder="₹"
                      />
                    </div>
                  </div>
                  <div className="text-right font-semibold text-slate-700 dark:text-white text-sm">
                    Amount: {formatCurrency(item.amount)}
                  </div>
                </div>
              </div>
            );
            })}
          </div>

          {/* Table Footer / Totals row */}
          <div className="mt-4 pt-4 border-t border-slate-300">
            {/* Desktop Totals */}
            <div className="hidden md:grid md:grid-cols-[2fr_0.8fr_0.8fr_0.7fr_1fr_0.8fr_1fr_1fr_auto] gap-3 px-1 items-center">
              <div className="col-span-4 text-right text-sm font-bold text-slate-600 uppercase pr-4">
                Totals
              </div>
              <div className="text-sm font-bold text-slate-800 dark:text-white">
                {formatCurrency(totalRate)}
              </div>
              <div className="col-span-2"></div>
              <div className="text-right text-sm font-bold text-slate-800 dark:text-white pr-1">
                {formatCurrency(subtotal)}
              </div>
              <div className="w-9" />
            </div>

            {/* Mobile Totals */}
            <div className="md:hidden flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Rate Total</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">
                  {formatCurrency(totalRate)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Amount Total</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">
                  {formatCurrency(subtotal)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tax & Totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tax Section */}
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Tax
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                <Label
                  htmlFor="applyGst"
                  className="text-sm font-medium text-slate-700 cursor-pointer"
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
                    <div>
                      <Label
                        htmlFor="sgst"
                        className="text-xs font-medium text-slate-600"
                      >
                        SGST %
                      </Label>
                      <Input
                        id="sgst"
                        type="number"
                        min={0}
                        step="0.01"
                        value={sgstPercent}
                        onChange={(e) =>
                          setSgstPercent(
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        className="mt-1 border-slate-200 focus:border-blue-400"
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        {formatCurrency(sgstAmount)}
                      </p>
                    </div>
                    <div>
                      <Label
                        htmlFor="cgst"
                        className="text-xs font-medium text-slate-600"
                      >
                        CGST %
                      </Label>
                      <Input
                        id="cgst"
                        type="number"
                        min={0}
                        step="0.01"
                        value={cgstPercent}
                        onChange={(e) =>
                          setCgstPercent(
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        className="mt-1 border-slate-200 focus:border-blue-400"
                      />
                      <p className="text-xs text-slate-400 mt-1">
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
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Summary
              </h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Gross Total</span>
                <span className="font-medium text-slate-700">
                  {formatCurrency(totalGross)}
                </span>
              </div>
              {totalItemDiscount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Item Discounts</span>
                  <span className="font-medium text-slate-700">
                    - {formatCurrency(totalItemDiscount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm border-t border-slate-200 pt-3">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium text-slate-700">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              {applyGst && sgstPercent > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">
                    SGST ({sgstPercent}%)
                  </span>
                  <span className="font-medium text-slate-700">
                    + {formatCurrency(sgstAmount)}
                  </span>
                </div>
              )}
              {applyGst && cgstPercent > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">
                    CGST ({cgstPercent}%)
                  </span>
                  <span className="font-medium text-slate-700">
                    + {formatCurrency(cgstAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm border-t border-slate-200 pt-3">
                <span className="text-slate-600 dark:text-slate-300 font-medium">Grand Total</span>
                <span className="font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(grandTotal)}
                </span>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm text-slate-500 whitespace-nowrap">
                    Discount
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        placeholder="%"
                        value={discountPercent}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : Number(e.target.value);
                          setDiscountPercent(val);
                        }}
                        className="w-20 border-slate-200 focus:border-blue-400 text-right pr-6"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                    </div>
                    <span className="text-slate-300">- or -</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₹</span>
                      <Input
                        id="discount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={discount === 0 ? "" : discount}
                        onChange={(e) => {
                          setDiscountPercent("");
                          setDiscount(Math.max(0, Number(e.target.value) || 0));
                        }}
                        className="w-28 pl-6 border-slate-200 focus:border-blue-400 text-right"
                      />
                    </div>
                  </div>
                </div>
              </div>
              {discount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-red-500">Discount</span>
                  <span className="font-medium text-red-500">
                    − {formatCurrency(discount)}
                  </span>
                </div>
              )}
              <div className="border-t-2 border-slate-800 dark:border-slate-500 pt-3 mt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-bold text-slate-900 dark:text-white">
                    Final Amount
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₹</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={finalAmount}
                      onChange={(e) => {
                        const newFinal = Math.max(0, Number(e.target.value) || 0);
                        setDiscountPercent("");
                        setDiscount(Math.max(0, grandTotal - newFinal));
                      }}
                      className="w-32 pl-7 border-slate-300 focus:border-emerald-500 text-right text-lg font-extrabold text-emerald-600 bg-emerald-50/50 dark:text-emerald-400 dark:bg-emerald-950/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Notes
            </h3>
            <span className="text-xs text-slate-400">(optional)</span>
          </div>
          <Textarea
            placeholder="Add any additional notes, terms, or payment instructions..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="border-slate-200 focus:border-blue-400 resize-none"
          />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pb-6">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="px-6 border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handlePrint}
          className="px-6 border-slate-300 text-slate-800 hover:bg-slate-100"
        >
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={
            !customerName.trim() ||
            items.filter((i) => i.product_id && i.name).length === 0
          }
          className="px-8 bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          <FileText className="h-4 w-4 mr-2" />
          {editingInvoice ? "Update Estimate" : "Save Estimate"}
        </Button>
      </div>
    </div>
    </>
  );
};

export default InvoiceForm;
