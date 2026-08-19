/**
 * Reproduction for the "typing a name blanks the screen" report.
 *
 * A render-time throw in React 18 unmounts the entire tree, which is exactly
 * what a white screen is. These tests type into the two fields the user named
 * and fail loudly if any keystroke throws.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InvoiceForm from "@/components/InvoiceForm";

// The form renders InvoicePreview for the print path, which lazily pulls in the
// PDF/native stack. None of that is under test here.
vi.mock("@/lib/pdf", () => ({
  exportElementAsPdf: vi.fn(),
  elementToPdfBlob: vi.fn(),
}));

const company = {
  id: "c1",
  name: "Test Traders",
  email: "t@example.com",
  phone: "9999999999",
  address: "Surat",
  gst_number: "24ABCDE1234F1Z5",
  logo_url: null,
};

const products = [
  { id: "p1", name: "Cement Bag", price: 380, quantity_unit: "pcs", company_id: "c1" },
  // A product row whose name never made it into the database. The offline
  // mirror coerces this to "", but a direct Supabase read does not.
  { id: "p2", name: null, price: 120, quantity_unit: "pcs", company_id: "c1" },
] as never[];

function renderForm() {
  return render(
    <InvoiceForm
      company={company}
      products={products}
      nextInvoiceNumber="INV-0001"
      onSave={vi.fn()}
      onCancel={vi.fn()}
      editingInvoice={null}
    />,
  );
}

describe("InvoiceForm — keystrokes must never throw", () => {
  beforeAll(() => {
    // Surface a React render error as a test failure rather than console noise.
    // Surface a React render error as a test failure rather than console noise.
    vi.spyOn(console, "error").mockImplementation((...args) => {
      throw new Error(String(args[0]));
    });
  });

  it("survives typing a customer name", () => {
    renderForm();
    const input = screen.getByLabelText(/customer name/i);
    expect(() => {
      fireEvent.change(input, { target: { value: "R" } });
      fireEvent.change(input, { target: { value: "Ra" } });
      fireEvent.change(input, { target: { value: "Ramesh" } });
    }).not.toThrow();
  });

  it("survives selecting a product whose name is null", () => {
    renderForm();
    const select = screen.getAllByRole("combobox")[0];
    expect(() => {
      fireEvent.change(select, { target: { value: "p2" } });
    }).not.toThrow();
  });

  it("survives typing a custom item name", () => {
    renderForm();
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "__custom__" } });

    const nameInput = screen.getAllByPlaceholderText(/type item name/i)[0];
    expect(() => {
      fireEvent.change(nameInput, { target: { value: "S" } });
      fireEvent.change(nameInput, { target: { value: "Sand" } });
    }).not.toThrow();
  });
});
