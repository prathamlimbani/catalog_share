/**
 * Null-safe readers for the `products` table.
 *
 * Product rows predate several of the constraints the generated types promise,
 * and `feature_sizes` is JSONB written by builds that no longer exist — it can
 * hold a null, an array, a JSON string, or objects with missing keys. Reading
 * any of that straight into `.trim()`, `.join()` or `Object.entries()` throws
 * during render, which unmounts the whole tree and shows a blank screen. Every
 * product screen reads the columns through the helpers below instead.
 */

/** The key `feature_sizes` reserves for the size→price list. Never a variant. */
export const SIZE_PRICES_KEY = "__prices";

export interface SizePrice {
  size: string;
  price: number;
}

export interface FeatureSizes {
  /** Variant name → its size labels. `__prices` is never one of the keys. */
  byFeature: Record<string, string[]>;
  /** Contents of `__prices`, with every entry shape-checked. */
  sizePrices: SizePrice[];
}

/** Anything → a string. null/undefined become "", other values stringify. */
export const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

/** Anything → a finite number. NaN, Infinity and null all become 0. */
export const asNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Keeps only the entries that are actually usable, non-blank strings. */
export const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim())
    : [];

/** `"a, b, ,c"` → `["a","b","c"]`. Anything that is not a string yields []. */
export const splitList = (value: unknown): string[] =>
  asText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** A display name that is never blank, so a row with no name is still clickable. */
export const productName = (product: { name?: unknown } | null | undefined): string =>
  asText(product?.name).trim() || "Untitled product";

/** The variant list, with nulls and blanks from older rows removed. */
export const productFeatures = (product: { features?: unknown } | null | undefined): string[] =>
  textList(product?.features);

/** Every usable image for a product: the cover first, then the gallery, deduped. */
export const productImages = (
  product: { image_url?: unknown; images?: unknown } | null | undefined,
): string[] => {
  const cover = asText(product?.image_url).trim();
  const gallery = textList(product?.images);
  return Array.from(new Set(cover ? [cover, ...gallery] : gallery));
};

/**
 * Reads the `feature_sizes` JSONB into a shape the UI can trust.
 *
 * `__prices` is validated entry by entry rather than cast, because a bad entry
 * there used to reach `sp.size.trim()` and take the screen down.
 */
export const parseFeatureSizes = (raw: unknown): FeatureSizes => {
  const empty: FeatureSizes = { byFeature: {}, sizePrices: [] };

  // Some older rows stored the JSON encoded as a string rather than as JSONB.
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return empty;
    }
  }

  // Arrays and primitives survive Object.entries but mean nothing here.
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;

  const byFeature: Record<string, string[]> = {};
  let sizePrices: SizePrice[] = [];

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === SIZE_PRICES_KEY) {
      sizePrices = Array.isArray(entry)
        ? entry
            .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
            .map((row) => ({ size: asText(row.size).trim(), price: asNumber(row.price) }))
            .filter((row) => row.size !== "")
        : [];
      continue;
    }
    byFeature[key] = textList(entry);
  }

  return { byFeature, sizePrices };
};

/** A size wrapped in `~` is sold out, e.g. `"~XL~"`. */
export const isSizeSoldOut = (size: string): boolean => asText(size).startsWith("~") || asText(size).endsWith("~");

/** The label to show for a size, with the sold-out markers stripped. */
export const sizeLabel = (size: string): string => asText(size).replace(/~/g, "").trim();

/** `1234.5` → `"1,234.5"`, formatted the way Indian pricing is read. */
export const formatPrice = (value: unknown): string => asNumber(value).toLocaleString("en-IN");

/** A date column → a locale date string, or null when it is missing or unparseable. */
export const formatDate = (value: unknown): string | null => {
  const text = asText(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

/** A date column → epoch ms for sorting. Unparseable dates sort last, never NaN. */
export const timestampOf = (value: unknown): number => {
  const text = asText(value).trim();
  if (!text) return 0;
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? 0 : time;
};
