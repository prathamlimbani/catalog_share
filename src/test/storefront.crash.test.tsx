/**
 * The storefront is the page a merchant's customers see, and a render-time
 * throw there is a lost sale nobody ever reports. Two inputs are outside our
 * control: a company row where the merchant filled in almost nothing, and the
 * persisted cart, which is whatever an older build wrote to localStorage and
 * survives every app update.
 *
 * These tests hand both of those to the real screens and fail if anything
 * throws or leaks an unrenderable value into the DOM.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import StoreCart from "@/pages/StoreCart";
import StoreAbout from "@/pages/StoreAbout";
import { phoneDigits, productCategories, productMatchesQuery, safeExternalUrl, storeName } from "@/lib/storefront";

/** A company whose owner saved the name and nothing else. */
const bareCompany = {
  id: "c1",
  name: "Half Filled Traders",
  slug: "demo",
  phone: null,
  email: null,
  address: null,
  gst_number: null,
  logo_url: null,
  theme_primary: null,
  theme_accent: null,
  contact_name_1: null,
  contact_phone_1: null,
  contact_name_2: null,
  contact_phone_2: null,
  google_maps_url: null,
  upi_id: null,
  upi_qr_url: null,
};

vi.mock("@/hooks/useCompany", () => ({
  useCompanyBySlug: () => ({ data: bareCompany, isLoading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: () => Promise.resolve({ error: null }) }) },
}));

vi.mock("@/native/files", () => ({
  openWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

const CART_KEY = "catalogshare.carts.v1";

const renderAt = (path: string, pattern: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CartProvider>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );

describe("storefront — hostile data must never blank the page", () => {
  beforeAll(() => {
    // Surface a React render error as a test failure rather than console noise.
    vi.spyOn(console, "error").mockImplementation((...args) => {
      throw new Error(String(args[0]));
    });
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("recovers a cart written by an older build without throwing", () => {
    localStorage.setItem(
      CART_KEY,
      JSON.stringify({
        demo: [
          // A product row from before `name` was NOT NULL, and a size that is
          // an object — React throws outright on an object child.
          { product: { id: "p1", name: null }, quantity: 2, selectedSize: { label: "L" }, selectedFeature: "Red" },
          // Quantity persisted as a string by an older build.
          { product: { id: "p2", name: "Steel Hinge" }, quantity: "3", selectedSize: null, selectedFeature: null },
          // Entries that cannot be repaired at all.
          { product: null, quantity: 1 },
          { quantity: 5 },
          "nonsense",
          { product: { id: "p3" }, quantity: 0 },
          { product: { id: "p4" }, quantity: "abc" },
        ],
        legacyBucket: "not an array",
      }),
    );

    renderAt("/store/demo/cart", "/store/:slug/cart", <StoreCart />);

    expect(screen.getByText("Untitled product")).toBeInTheDocument();
    expect(screen.getByText("Steel Hinge")).toBeInTheDocument();
    // The unrenderable size is dropped rather than stringified.
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
    // Two survivors, quantities 2 and 3.
    expect(screen.getByText(/2 items · 5 units total/)).toBeInTheDocument();
  });

  it("treats a corrupted cart blob as an empty cart", () => {
    localStorage.setItem(CART_KEY, "{not json at all");

    renderAt("/store/demo/cart", "/store/:slug/cart", <StoreCart />);

    expect(screen.getByText("Your cart is empty")).toBeInTheDocument();
  });

  it("renders the about page for a company with only a name", () => {
    renderAt("/store/demo/about", "/store/:slug/about", <StoreAbout />);

    expect(screen.getByText("About Half Filled Traders")).toBeInTheDocument();
    expect(screen.getByText("No contact details yet")).toBeInTheDocument();
  });
});

describe("storefront helpers", () => {
  it("matches products whose searchable columns are all null", () => {
    const hostile = { id: "p1", name: null, category: null, description: null } as never;
    expect(productMatchesQuery(hostile, "anything")).toBe(false);
    // An empty query matches everything, so a blank search box shows the shop.
    expect(productMatchesQuery(hostile, "   ")).toBe(true);
    expect(productMatchesQuery({ name: "Cement Bag" }, "cement")).toBe(true);
  });

  it("drops blank and duplicate categories", () => {
    expect(
      productCategories([{ category: "Tiles" }, { category: "  " }, { category: null }, { category: "Tiles" }, null]),
    ).toEqual(["Tiles"]);
    expect(productCategories(undefined)).toEqual([]);
  });

  it("falls back to a readable store name", () => {
    expect(storeName(null)).toBe("This store");
    expect(storeName({ name: "   " })).toBe("This store");
    expect(storeName({ name: "Kumar Steel" })).toBe("Kumar Steel");
  });

  it("keeps only digits in a phone number", () => {
    expect(phoneDigits("+91 98765-43210")).toBe("919876543210");
    expect(phoneDigits(null)).toBe("");
  });

  it("refuses a link that is not http(s)", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl("https://maps.google.com/?q=1")).toBe("https://maps.google.com/?q=1");
    // Merchants paste the host without a scheme far more often than not.
    expect(safeExternalUrl("maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
  });
});
