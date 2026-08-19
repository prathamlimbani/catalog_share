/**
 * InvoicePreview against deliberately hostile data.
 *
 * `invoices.items` is a JSONB column that several past builds of the app have
 * written to, so a row can contain literally anything: entries that are `null`,
 * entries missing every field, numbers stored as strings, and an `items` value
 * that is not an array at all. A throw while rendering unmounts the whole React
 * tree — that is the blank screen the merchant reported — so these tests assert
 * two things at once: that no shape throws, and that none of them leaks "NaN",
 * "undefined" or "Invalid Date" onto a document a customer is shown.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InvoicePreview from "@/components/InvoicePreview";

// The export path lazily pulls in html2pdf and the Capacitor bridge; neither is
// under test here and neither works in jsdom.
vi.mock("@/lib/pdf", () => ({
  exportElementAsPdf: vi.fn().mockResolvedValue({ ok: true, fileName: "x.pdf" }),
  elementToPdfBlob: vi.fn(),
}));

const company = {
  id: "c1",
  name: "Test Traders",
  gst_number: null,
  logo_url: null,
  upi_id: null,
};

/** Every garbage shape we have actually seen in the column, in one estimate. */
const hostileInvoice = {
  invoice_number: null,
  invoice_date: null,
  customer_name: null,
  customer_phone: null,
  customer_address: null,
  items: [
    {},
    null,
    { name: null, quantity: null, unit: null, price: null, amount: null },
    // Numbers written as strings by an older build.
    { name: "Cement Bag", quantity: "2", unit: "pcs", price: "380.5", amount: "761" },
    // A line with a size but no amount — the total has to be derived.
    { name: "Marble Slab", size: "24x24", quantity: 3, unit: "sqft", price: 90 },
    // Junk in the numeric fields.
    { name: "Broken", quantity: "abc", price: {}, amount: undefined, discount: "x" },
  ],
  subtotal: null,
  sgst_amount: null,
  cgst_amount: null,
  discount: null,
  advance_payment: null,
  grand_total: null,
  final_amount: null,
  notes: null,
};

/** What the document must never show a paying customer. */
function expectNoGarbage() {
  const rendered = document.body.textContent ?? "";
  expect(rendered).not.toMatch(/NaN/);
  expect(rendered).not.toMatch(/undefined/);
  expect(rendered).not.toMatch(/Invalid Date/);
  expect(rendered).not.toMatch(/\bnull\b/);
}

afterEach(cleanup);

describe("InvoicePreview — hostile invoice data", () => {
  it("renders every broken item shape without throwing", () => {
    expect(() =>
      render(<InvoicePreview invoice={hostileInvoice} company={company} onBack={vi.fn()} />),
    ).not.toThrow();

    // The rows that carry a usable name still made it onto the document.
    expect(screen.getByText("Cement Bag")).toBeInTheDocument();
    expect(screen.getByText("Marble Slab")).toBeInTheDocument();
  });

  it("never prints NaN, undefined, null or Invalid Date", () => {
    render(<InvoicePreview invoice={hostileInvoice} company={company} onBack={vi.fn()} />);
    expectNoGarbage();
  });

  it("shows a real total instead of ₹NaN", () => {
    render(<InvoicePreview invoice={hostileInvoice} company={company} onBack={vi.fn()} />);
    // 761 (stored) + 270 (3 x 90, derived) = 1,031.00 — the merchant's figure,
    // not a NaN and not a silent zero.
    expect(screen.getAllByText("₹1,031.00").length).toBeGreaterThan(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an object", { 0: "not-an-array" }],
    ["a plain string", "corrupted"],
    ["a JSON string", '[{"name":"Sand","quantity":"2","price":"50"}]'],
  ])("survives items being %s", (_label, items) => {
    expect(() =>
      render(
        <InvoicePreview
          invoice={{ ...hostileInvoice, items }}
          company={company}
          onBack={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expectNoGarbage();
  });

  it("adds up tax, discount and advance when they arrive as strings", () => {
    // PostgREST serialises numeric columns as strings, so these branches ran on
    // string operands: "10" - "5" is fine but "10" + "5" is "105", and any of
    // them against a null column produced ₹NaN on the balance line.
    render(
      <InvoicePreview
        invoice={{
          ...hostileInvoice,
          items: [{ name: "Paint", quantity: "2", unit: "ltr", price: "500", amount: "1000" }],
          subtotal: "1000",
          sgst_percent: "9",
          sgst_amount: "90",
          cgst_percent: "9",
          cgst_amount: "90",
          grand_total: "1180",
          discount: "80",
          final_amount: "1100",
          advance_payment: "400",
        }}
        company={company}
        onBack={vi.fn()}
      />,
    );

    expectNoGarbage();
    expect(screen.getByText("SGST @ 9%")).toBeInTheDocument();
    expect(screen.getAllByText("₹1,180.00").length).toBeGreaterThan(0); // grand total
    expect(screen.getAllByText("₹1,100.00").length).toBeGreaterThan(0); // final amount
    expect(screen.getAllByText("₹700.00").length).toBeGreaterThan(0); // balance after advance
  });

  it("tells the user when there are no items rather than showing an empty table", () => {
    render(
      <InvoicePreview invoice={{ ...hostileInvoice, items: [] }} company={company} onBack={vi.fn()} />,
    );
    expect(screen.getByText(/no items were saved/i)).toBeInTheDocument();
  });

  it("keeps the invoice-number field controlled when the column is null", () => {
    // A `value={null}` input silently flips to uncontrolled: React warns and the
    // field stops accepting edits.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<InvoicePreview invoice={hostileInvoice} company={company} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /convert to invoice/i }));
    const field = screen.getByLabelText(/invoice no/i) as HTMLInputElement;
    expect(field.value).toBe("");

    fireEvent.change(field, { target: { value: "INV-77" } });
    expect(field.value).toBe("INV-77");

    const uncontrolled = warn.mock.calls.filter((call) =>
      /uncontrolled|controlled input/i.test(String(call[0])),
    );
    expect(uncontrolled).toHaveLength(0);
    warn.mockRestore();
  });

  it("degrades to a readable screen when the estimate is missing entirely", () => {
    const onBack = vi.fn();
    render(<InvoicePreview invoice={null} company={company} onBack={onBack} />);

    expect(screen.getByText(/estimate not available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to estimates/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
