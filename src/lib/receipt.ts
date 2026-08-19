/**
 * Payment receipt rendering.
 *
 * This module owns the receipt document end to end so that no page has to.
 * It used to live inside Billing.tsx, which meant MasterAdmin.tsx's
 * `import { downloadInvoice } from "@/pages/Billing"` pulled the whole Billing
 * route — AdminLayout, SubscriptionDialog, Razorpay — into the MasterAdmin
 * chunk. Being React-free, it costs a couple of kB wherever it is imported.
 *
 * Two behaviours here are deliberate and must not be "simplified" away:
 *
 *  1. EVERY interpolated value goes through `escapeHtml`. Company name, GST
 *     number, address and plan id are all owner-editable strings that come back
 *     out of Postgres verbatim; the previous template injected them raw into a
 *     document that then called `window.print()`, which is stored XSS.
 *  2. The output is a real PDF handed to `shareBlob`/`saveBlob`. `blob:` URLs,
 *     `window.open()` and `<a download>` are all inert inside the Android
 *     WebView — the old flow generated a file the user could never receive.
 */

import { toast } from "sonner";
import { isNative } from "@/native/platform";
import { safeFileName, saveBlob, shareBlob } from "@/native/files";
import { PLANS, getPlanName } from "@/lib/plans";
import { pdfErrorMessage } from "@/lib/pdf";

export interface ReceiptData {
  companyName: string;
  companyEmail: string;
  companyPhone?: string;
  companyAddress?: string;
  companyGst?: string;
  planId: string;
  planName: string;
  /** Amount actually charged, in paise — `subscriptions.amount` is stored in paise. */
  amountPaise: number;
  paymentId: string;
  orderId?: string;
  startsAt: string;
  expiresAt?: string | null;
  status: string;
}

const SUPPORT_EMAIL = "catalogshare123@gmail.com";
const SUPPORT_PHONE = "+91 76250 25686";
const WEBSITE = "https://catalogshare.online";

/**
 * HTML-escape an untrusted value.
 *
 * `&` must be replaced first or the ampersands introduced by the later
 * replacements get double-escaped. Quotes are escaped too because some values
 * (the plan id, the status) are also used inside attribute positions.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Coerce a stored amount to a finite number.
 *
 * `subscriptions.amount` is a Postgres numeric, and PostgREST serialises those
 * as JSON *strings* to keep full precision — so a plain `Number.isFinite` check
 * on the raw value rejected every real payment and printed ₹0.00 on the
 * receipt.
 */
function toFiniteNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** ₹ amount with Indian digit grouping, e.g. 1,23,456.00 */
function formatRupees(paise: unknown): string {
  return (toFiniteNumber(paise) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The plan actually paid for.
 *
 * Until the CHECK-constraint migration is applied, `subscriptions.plan` can
 * only hold 'free' | 'growth' | 'pro', so a ₹399 estimate-generator payment is
 * stored as 'growth' and a ₹499 support payment as 'pro'. The amount is never
 * laundered, so when the stored plan's price disagrees with what was charged we
 * trust the money and show the plan the customer actually bought.
 */
export function resolvePaidPlanId(planId: string | null | undefined, amountPaise: unknown): string {
  const stored = planId ?? "free";
  const paidRupees = Math.round(toFiniteNumber(amountPaise) / 100);
  const storedPlan = PLANS.find((p) => p.id === stored);
  if (storedPlan && storedPlan.price === paidRupees) return stored;

  const byPrice = PLANS.find((p) => p.price > 0 && p.price === paidRupees);
  return byPrice ? byPrice.id : stored;
}

/** "CatalogShare-Receipt-pay_abc123.pdf" */
export function receiptFileName(data: ReceiptData): string {
  return safeFileName(`CatalogShare-Receipt-${data?.paymentId || "payment"}`, "pdf");
}

/**
 * Short human-quotable receipt number derived from the Razorpay payment id.
 * `String()` rather than `|| ""` because a legacy row can carry a numeric id,
 * and `.replace` on a number throws.
 */
function receiptNumber(paymentId: unknown): string {
  const tail = String(paymentId ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return tail ? `CS-${tail}` : "CS-RECEIPT";
}

/**
 * A self-contained A4 receipt.
 *
 * Every selector is scoped under `.cs-receipt` because `downloadReceipt`
 * injects this markup into a live div — an unscoped `*` reset or `body` rule
 * would repaint the whole app for the duration of the render. No external
 * fonts or images either: the renderer runs offline and html2canvas silently
 * drops anything that has not finished loading.
 */
export function buildReceiptHtml(data: ReceiptData): string {
  // Every caller but the tests builds this from a raw database row, where any
  // column can be null — so nothing below may assume a field is present.
  const d = (data ?? {}) as Partial<ReceiptData>;

  const name = escapeHtml(d.companyName || "—");
  const email = escapeHtml(d.companyEmail || "—");
  const phone = escapeHtml(d.companyPhone || "");
  const address = escapeHtml(d.companyAddress || "");
  const gst = escapeHtml(d.companyGst || "");

  const planName = escapeHtml(d.planName || getPlanName(d.planId));
  const paymentId = escapeHtml(d.paymentId || "—");
  const orderId = escapeHtml(d.orderId || "");
  const receiptNo = escapeHtml(receiptNumber(d.paymentId));

  const starts = escapeHtml(formatDate(d.startsAt));
  const hasExpiry = formatDate(d.expiresAt) !== "—";
  const expires = escapeHtml(formatDate(d.expiresAt));
  const issued = escapeHtml(formatDate(d.startsAt || new Date().toISOString()));
  const amount = escapeHtml(formatRupees(d.amountPaise));

  const status = String(d.status ?? "");
  const isPaid = status.toLowerCase() !== "failed";
  const statusLabel = escapeHtml((isPaid ? "Paid" : status).toUpperCase() || "PAID");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment Receipt ${receiptNo}</title>
<style>
.cs-receipt, .cs-receipt * { margin: 0; padding: 0; box-sizing: border-box; }
.cs-receipt {
  width: 794px;
  min-height: 1123px;
  background: #ffffff;
  color: #111827;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  padding: 48px 52px 40px;
  display: flex;
  flex-direction: column;
}
.cs-receipt .cs-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 22px;
  border-bottom: 3px solid #f97316;
}
.cs-receipt .cs-brand { display: flex; align-items: center; gap: 14px; }
.cs-receipt .cs-mark {
  width: 52px; height: 52px; border-radius: 14px;
  background: #f97316; color: #ffffff;
  font-size: 21px; font-weight: 700; letter-spacing: 0.5px;
  display: flex; align-items: center; justify-content: center;
}
.cs-receipt .cs-brand-name { font-size: 24px; font-weight: 700; letter-spacing: -0.4px; }
.cs-receipt .cs-brand-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
.cs-receipt .cs-title-block { text-align: right; }
.cs-receipt .cs-title { font-size: 17px; font-weight: 700; letter-spacing: 2px; color: #374151; }
.cs-receipt .cs-badge {
  display: inline-block; margin-top: 10px;
  padding: 5px 14px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 1px;
  background: #dcfce7; color: #15803d; border: 1px solid #86efac;
}
.cs-receipt .cs-badge--void { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.cs-receipt .cs-meta {
  display: flex; flex-wrap: wrap; gap: 10px 40px;
  padding: 22px 0 26px;
}
.cs-receipt .cs-meta-item { min-width: 180px; }
.cs-receipt .cs-k {
  display: block; font-size: 10px; font-weight: 700;
  letter-spacing: 1px; text-transform: uppercase; color: #9ca3af;
}
.cs-receipt .cs-v { display: block; margin-top: 3px; font-size: 13px; font-weight: 600; word-break: break-all; }
.cs-receipt .cs-mono { font-family: "Courier New", Consolas, monospace; letter-spacing: -0.2px; }
.cs-receipt .cs-billed {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 18px 20px; margin-bottom: 26px;
}
.cs-receipt .cs-billed-name { font-size: 16px; font-weight: 700; margin: 6px 0 4px; }
.cs-receipt .cs-billed-line { font-size: 12px; color: #4b5563; }
.cs-receipt table { width: 100%; border-collapse: collapse; }
.cs-receipt thead th {
  text-align: left; font-size: 10px; font-weight: 700;
  letter-spacing: 1px; text-transform: uppercase; color: #6b7280;
  background: #f3f4f6; padding: 11px 14px;
  border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;
}
.cs-receipt thead th.cs-right, .cs-receipt tbody td.cs-right { text-align: right; }
.cs-receipt tbody td { padding: 16px 14px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
.cs-receipt .cs-item-name { font-size: 14px; font-weight: 700; }
.cs-receipt .cs-item-sub { font-size: 11px; color: #6b7280; margin-top: 3px; }
.cs-receipt .cs-totals { display: flex; justify-content: flex-end; margin-top: 18px; }
.cs-receipt .cs-totals-inner { width: 300px; }
.cs-receipt .cs-total-row {
  display: flex; justify-content: space-between;
  padding: 7px 0; font-size: 13px; color: #4b5563;
}
.cs-receipt .cs-total-grand {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 8px; padding: 14px 16px;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px;
}
.cs-receipt .cs-total-grand .cs-label { font-size: 13px; font-weight: 700; color: #7c2d12; }
.cs-receipt .cs-total-grand .cs-amount { font-size: 22px; font-weight: 700; color: #ea580c; }
.cs-receipt .cs-note {
  margin-top: 28px; padding: 14px 16px;
  background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 6px;
  font-size: 11px; color: #6b7280; line-height: 1.6;
}
.cs-receipt .cs-foot {
  margin-top: auto; padding-top: 26px;
  border-top: 1px solid #e5e7eb; text-align: center;
  font-size: 11px; color: #6b7280; line-height: 1.7;
}
.cs-receipt .cs-foot strong { color: #374151; }
</style>
</head>
<body>
<div class="cs-receipt">
  <div class="cs-head">
    <div class="cs-brand">
      <div class="cs-mark">CS</div>
      <div>
        <div class="cs-brand-name">CatalogShare</div>
        <div class="cs-brand-sub">${escapeHtml(WEBSITE.replace(/^https?:\/\//, ""))}</div>
      </div>
    </div>
    <div class="cs-title-block">
      <div class="cs-title">PAYMENT RECEIPT</div>
      <div class="cs-badge${isPaid ? "" : " cs-badge--void"}">${statusLabel}</div>
    </div>
  </div>

  <div class="cs-meta">
    <div class="cs-meta-item">
      <span class="cs-k">Receipt No.</span>
      <span class="cs-v">${receiptNo}</span>
    </div>
    <div class="cs-meta-item">
      <span class="cs-k">Receipt Date</span>
      <span class="cs-v">${issued}</span>
    </div>
    <div class="cs-meta-item">
      <span class="cs-k">Payment ID</span>
      <span class="cs-v cs-mono">${paymentId}</span>
    </div>
    ${orderId
      ? `<div class="cs-meta-item">
      <span class="cs-k">Order ID</span>
      <span class="cs-v cs-mono">${orderId}</span>
    </div>`
      : ""}
  </div>

  <div class="cs-billed">
    <span class="cs-k">Billed To</span>
    <div class="cs-billed-name">${name}</div>
    ${address ? `<div class="cs-billed-line">${address}</div>` : ""}
    <div class="cs-billed-line">${email}${phone ? ` &middot; ${phone}` : ""}</div>
    ${gst ? `<div class="cs-billed-line">GSTIN: ${gst}</div>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Subscription Period</th>
        <th class="cs-right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="cs-item-name">${planName}</div>
          <div class="cs-item-sub">CatalogShare monthly subscription</div>
        </td>
        <td>${hasExpiry ? `${starts} &rarr; ${expires}` : `From ${starts}`}</td>
        <td class="cs-right cs-item-name">&#8377;${amount}</td>
      </tr>
    </tbody>
  </table>

  <div class="cs-totals">
    <div class="cs-totals-inner">
      <div class="cs-total-row"><span>Subtotal</span><span>&#8377;${amount}</span></div>
      <div class="cs-total-row"><span>Taxes</span><span>Inclusive</span></div>
      <div class="cs-total-grand">
        <span class="cs-label">Total Paid</span>
        <span class="cs-amount">&#8377;${amount}</span>
      </div>
    </div>
  </div>

  <div class="cs-note">
    This is a computer-generated receipt and does not require a signature.
    ${hasExpiry ? `Your subscription is valid until ${expires}.` : ""}
    Payments are processed securely through Razorpay.
  </div>

  <div class="cs-foot">
    <div>Questions about this payment? Write to <strong>${escapeHtml(SUPPORT_EMAIL)}</strong> or call <strong>${escapeHtml(SUPPORT_PHONE)}</strong>.</div>
    <div>Thank you for choosing <strong>CatalogShare</strong> &middot; ${escapeHtml(WEBSITE)}</div>
  </div>
</div>
</body>
</html>`;
}

/** A4 at 96dpi. html2canvas rasterises at this width, so it must be fixed. */
const A4_WIDTH_PX = 794;

/**
 * Render the receipt to PDF and hand it to the user.
 *
 * The container is positioned off-screen rather than hidden — `display:none`
 * and `visibility:hidden` both make html2canvas measure zero-height nodes and
 * emit a blank page.
 */
export async function downloadReceipt(data: ReceiptData): Promise<void> {
  const fileName = receiptFileName(data);
  const container = document.createElement("div");

  try {
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = `${A4_WIDTH_PX}px`;
    container.style.background = "#ffffff";
    container.style.zIndex = "-1";
    container.innerHTML = buildReceiptHtml(data);
    document.body.appendChild(container);

    const target = container.querySelector<HTMLElement>(".cs-receipt");
    if (!target) throw new Error("Receipt template failed to render");

    const html2pdf = (await import("html2pdf.js")).default;
    const blob = (await html2pdf()
      .set({
        margin: 0,
        filename: fileName,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      })
      .from(target)
      .output("blob")) as Blob;

    // html2pdf resolves with `undefined` instead of rejecting when the canvas
    // render fails, which would otherwise reach the share sheet as an empty
    // attachment.
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error("The receipt rendered blank. Please try again.");
    }

    const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });

    const result = isNative
      ? await shareBlob(pdf, fileName, {
          title: "CatalogShare receipt",
          text: `Payment receipt ${receiptNumber(data.paymentId)}`,
          dialogTitle: "Save or share receipt",
        })
      : await saveBlob(pdf, fileName);

    // A dismissed share sheet is a deliberate user action, not a failure.
    if (!result.ok && result.error !== "cancelled") {
      throw new Error(result.error || "Could not save the receipt");
    }
    if (result.ok && !isNative) {
      toast.success("Receipt downloaded");
    }
  } catch (err) {
    console.error("[receipt] generation failed:", err);
    // The reason matters: "chunk failed to load" and "storage full" need
    // different things from the merchant, and a single generic line told them
    // nothing they could act on.
    toast.error("Could not generate the receipt", {
      description: `${pdfErrorMessage(err)} If it keeps failing, email ${SUPPORT_EMAIL}.`,
    });
  } finally {
    container.remove();
  }
}

/**
 * Adapter for a raw `subscriptions` row plus a `companies` row.
 *
 * Kept under the old `downloadInvoice` name because MasterAdmin.tsx and
 * Billing.tsx both call it with database rows; new code should build a
 * `ReceiptData` and call `downloadReceipt` directly.
 */
export function receiptDataFromRow(
  payment: Record<string, unknown> | null | undefined,
  company: Record<string, unknown> | null | undefined,
): ReceiptData {
  // Nothing here may assume a column is present or typed: `amount` arrives as a
  // numeric string, `plan` and `status` can be null on rows written before the
  // columns were backfilled, and both ids are optional.
  const amountPaise = toFiniteNumber(payment?.amount);
  const storedPlan = typeof payment?.plan === "string" ? payment.plan : "free";
  const planId = resolvePaidPlanId(storedPlan, amountPaise);

  const str = (value: unknown): string =>
    value === null || value === undefined ? "" : String(value).trim();

  return {
    companyName: str(company?.name) || "—",
    companyEmail: str(company?.email),
    companyPhone: str(company?.phone) || undefined,
    companyAddress: str(company?.address) || undefined,
    companyGst: str(company?.gst_number) || undefined,
    planId,
    planName: getPlanName(planId),
    amountPaise,
    paymentId: str(payment?.razorpay_payment_id) || str(payment?.id),
    orderId: str(payment?.razorpay_order_id) || undefined,
    startsAt: str(payment?.starts_at) || str(payment?.created_at) || new Date().toISOString(),
    expiresAt: str(payment?.expires_at) || null,
    status: str(payment?.status) || "active",
  };
}

export async function downloadInvoice(
  payment: Record<string, unknown> | null | undefined,
  company: Record<string, unknown> | null | undefined,
): Promise<void> {
  return downloadReceipt(receiptDataFromRow(payment, company));
}
