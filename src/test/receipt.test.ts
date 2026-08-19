import { describe, it, expect } from "vitest";
import { buildReceiptHtml, escapeHtml, receiptFileName, resolvePaidPlanId, type ReceiptData } from "@/lib/receipt";

const base: ReceiptData = {
  companyName: "Sharma Traders",
  companyEmail: "owner@example.com",
  companyPhone: "+91 98765 43210",
  companyAddress: "12 MG Road, Surat",
  companyGst: "24AAAAA0000A1Z5",
  planId: "estimate_generate",
  planName: "Estimate Generator Plan",
  amountPaise: 39900,
  paymentId: "pay_abc123",
  orderId: "order_xyz789",
  startsAt: "2026-08-19T06:00:00.000Z",
  expiresAt: "2026-09-18T06:00:00.000Z",
  status: "active",
};

describe("escapeHtml", () => {
  it("neutralises markup without double-escaping ampersands", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml("Tools & Dies")).toBe("Tools &amp; Dies");
  });
});

describe("buildReceiptHtml", () => {
  it("escapes owner-controlled fields — the stored-XSS fix", () => {
    const html = buildReceiptHtml({
      ...base,
      companyName: '<img src=x onerror="alert(1)">',
      companyGst: "</style><script>alert(2)</script>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;img src=x");
  });

  it("renders the amount with Indian digit grouping", () => {
    expect(buildReceiptHtml({ ...base, amountPaise: 12345600 })).toContain("1,23,456.00");
  });

  it("keeps the receipt self-contained — no remote assets", () => {
    const html = buildReceiptHtml(base);
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("catalogshare123@gmail.com");
  });
});

describe("receiptFileName", () => {
  it("names the file after the payment", () => {
    expect(receiptFileName(base)).toBe("CatalogShare-Receipt-pay_abc123.pdf");
  });
});

describe("resolvePaidPlanId", () => {
  it("recovers the real plan when the DB stored a legacy id", () => {
    // ₹399 written as 'growth' by the CHECK-constraint fallback.
    expect(resolvePaidPlanId("growth", 39900)).toBe("estimate_generate");
    expect(resolvePaidPlanId("pro", 49900)).toBe("support");
  });

  it("leaves a consistent row alone", () => {
    expect(resolvePaidPlanId("growth", 19900)).toBe("growth");
    expect(resolvePaidPlanId("pro", 34900)).toBe("pro");
  });
});
