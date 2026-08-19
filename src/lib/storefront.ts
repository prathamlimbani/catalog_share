/**
 * Null-safety for the public storefront.
 *
 * The generic product readers live in `productData.ts`; what is here is the
 * handful of guards the four store pages need on top of them — company
 * columns, search and the links a merchant types by hand.
 *
 * The storefront is what a merchant's customers see, so a render-time throw
 * on any of it is a lost sale the merchant never hears about.
 */

import { asText } from "@/lib/productData";
import type { Tables } from "@/integrations/supabase/types";

type ProductLike = Partial<Tables<"products">> | null | undefined;
type CompanyLike = Partial<Tables<"companies">> | null | undefined;

/** Store name for headings, alt text and order messages. */
export function storeName(company: CompanyLike): string {
  return asText(company?.name).trim() || "This store";
}

/** Case-insensitive match over the fields a shopper would actually search by. */
export function productMatchesQuery(product: ProductLike, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    asText(product?.name).toLowerCase().includes(needle) ||
    asText(product?.category).toLowerCase().includes(needle) ||
    asText(product?.description).toLowerCase().includes(needle)
  );
}

/** Sorted, de-duplicated, non-blank category labels for the filter chips. */
export function productCategories(products: ProductLike[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const product of products ?? []) {
    const category = asText(product?.category).trim();
    if (category) seen.add(category);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/**
 * Digits only, for `tel:` and `wa.me`.
 *
 * wa.me happily opens a blank chat for an empty recipient, which looked to the
 * customer like an order that was sent and to the merchant like no order at
 * all — so callers check the length before using the result.
 */
export function phoneDigits(value: unknown): string {
  return asText(value).replace(/\D/g, "");
}

/**
 * An external link a merchant typed, normalised — or null when it cannot be
 * trusted.
 *
 * The value is rendered straight into an `href`, and these fields are free
 * text: a stored `javascript:` URL would execute in the shopper's browser.
 * Only http(s) is handed back, and a bare "maps.google.com/..." (which is what
 * people actually paste) is upgraded rather than dropped.
 */
export function safeExternalUrl(value: unknown): string | null {
  const raw = asText(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return /^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(raw) ? `https://${raw}` : null;
  }
}
