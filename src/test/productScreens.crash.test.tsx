/**
 * The product screens read the same nullable columns that blanked the estimate
 * form, plus the `feature_sizes` JSONB, which is whatever an older build wrote.
 * A throw here unmounts the tree and shows a white screen, so these tests render
 * the worst rows the database can hand back and fail if anything throws.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { CartProvider } from "@/contexts/CartContext";
import ProductCard from "@/components/ProductCard";
import ProductListItem from "@/components/ProductListItem";
import { parseFeatureSizes, productImages, splitList, timestampOf } from "@/lib/productData";

/** A row from before the NOT NULL constraints, with junk in every soft column. */
const hostileProduct = {
  id: "p1",
  company_id: "c1",
  name: null,
  description: null,
  category: null,
  size: null,
  price: null,
  features: [null, "", "Red"],
  images: [null, "https://example.com/a.jpg"],
  image_url: null,
  feature_sizes: "not an object",
  in_stock: null,
  is_trending: null,
  allow_custom_quantity: null,
  quantity_unit: null,
  created_at: null,
  updated_at: null,
} as never;

const renderInCart = (ui: React.ReactElement) => render(<CartProvider>{ui}</CartProvider>);

describe("product screens — hostile rows must never throw", () => {
  beforeAll(() => {
    // Surface a React render error as a test failure rather than console noise.
    vi.spyOn(console, "error").mockImplementation((...args) => {
      throw new Error(String(args[0]));
    });
  });

  it("renders a grid card for a row with no name, no price and junk feature_sizes", () => {
    renderInCart(<ProductCard product={hostileProduct} />);
    expect(screen.getByText("Untitled product")).toBeInTheDocument();
  });

  it("renders a list row for the same product", () => {
    renderInCart(<ProductListItem product={hostileProduct} />);
    expect(screen.getByText("Untitled product")).toBeInTheDocument();
  });

  it("renders a product whose feature_sizes holds only a malformed __prices list", () => {
    const product = {
      ...(hostileProduct as object),
      name: "Door Frame",
      size: "81x32, 78x30",
      features: null,
      feature_sizes: { __prices: [null, { price: 500 }, { size: "81x32", price: "7500" }] },
    } as never;

    renderInCart(<ProductCard product={product} />);
    // __prices must not be mistaken for a variant, so the global sizes still show.
    expect(screen.getByText("Door Frame")).toBeInTheDocument();
    expect(screen.getByText("81x32")).toBeInTheDocument();
  });
});

describe("parseFeatureSizes", () => {
  it("returns empty structures for anything that is not an object", () => {
    for (const raw of [null, undefined, 42, "oops", [1, 2, 3], true]) {
      expect(parseFeatureSizes(raw)).toEqual({ byFeature: {}, sizePrices: [] });
    }
  });

  it("keeps __prices out of the variant map and validates every entry", () => {
    const parsed = parseFeatureSizes({
      Red: ["S", null, "  M  "],
      Blue: "not a list",
      __prices: [{ size: "81x32", price: "7500" }, { price: 10 }, null, { size: "  ", price: 1 }],
    });

    expect(parsed.byFeature).toEqual({ Red: ["S", "M"], Blue: [] });
    expect(parsed.sizePrices).toEqual([{ size: "81x32", price: 7500 }]);
  });

  it("parses a row that stored the JSON as a string, and survives broken JSON", () => {
    expect(parseFeatureSizes('{"Red":["S"]}').byFeature).toEqual({ Red: ["S"] });
    expect(parseFeatureSizes("{oops")).toEqual({ byFeature: {}, sizePrices: [] });
  });
});

describe("null-safe product readers", () => {
  it("drops nulls from images and puts the cover first", () => {
    expect(productImages({ image_url: "cover.jpg", images: [null, "cover.jpg", "b.jpg"] }))
      .toEqual(["cover.jpg", "b.jpg"]);
    expect(productImages(null)).toEqual([]);
  });

  it("splits comma lists without touching non-strings", () => {
    expect(splitList("a, ,b ")).toEqual(["a", "b"]);
    expect(splitList(null)).toEqual([]);
  });

  it("never returns NaN for a missing or unparseable date", () => {
    expect(timestampOf(null)).toBe(0);
    expect(timestampOf("not a date")).toBe(0);
    expect(timestampOf("2026-01-01T00:00:00Z")).toBeGreaterThan(0);
  });
});
