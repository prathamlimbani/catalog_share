import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Tables } from "@/integrations/supabase/types";

type Product = Tables<"products">;

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize: string | null;
  selectedFeature: string | null;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity: number, selectedSize: string | null, selectedFeature: string | null) => void;
  removeFromCart: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
}

// Unique key per product+size+feature combo
const getCartKey = (productId: string, size: string | null, feature: string | null) =>
  `${productId}__${size || ""}__${feature || ""}`;

/** One basket per storefront, all of them persisted under a single key. */
type CartsBySlug = Record<string, CartItem[]>;

const STORAGE_KEY = "catalogshare.carts.v1";

/** Bucket for pages that are not under /store/:slug (the legacy /cart page). */
const NO_STORE = "__none__";

// Stable identity so a store with no cart yet does not re-render its consumers.
const EMPTY_ITEMS: CartItem[] = [];

/**
 * The provider is mounted above <BrowserRouter> in App.tsx, so the active store
 * cannot come from useParams() — it is read off the path instead. Scoping is
 * the whole point: a shared cart meant a customer who browsed store A and then
 * opened store B sent A's items to B's WhatsApp number.
 */
function slugFromPath(pathname: string): string {
  const match = pathname.match(/^\/store\/([^/?#]+)/);
  if (!match) return NO_STORE;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Nobody orders more than this, and a persisted 1e9 only breaks the layout. */
const MAX_QUANTITY = 9999;

/** A quantity that is safe to store, render and add up. */
function clampQuantity(value: unknown): number {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.min(quantity, MAX_QUANTITY);
}

/**
 * The chosen size/feature is rendered straight into a <Badge>, and React throws
 * on an object child — which unmounts the whole tree, i.e. a blank cart. Only
 * values that can actually be displayed survive.
 */
function optionLabel(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Rebuild one persisted entry into a trustworthy CartItem, or discard it.
 *
 * The stored blob is whatever an older build wrote, and it survives app
 * updates — so every field is treated as missing or wrong until proven
 * otherwise, and the parts that are kept are coerced into the shape the rest
 * of the app is typed against rather than merely type-tested.
 */
function normalizeCartItem(value: unknown): CartItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const product = raw.product;
  if (!product || typeof product !== "object") return null;
  const id = (product as Record<string, unknown>).id;
  if (typeof id !== "string" || !id) return null;

  const quantity = clampQuantity(raw.quantity);
  if (quantity === 0) return null;

  return {
    // `name` is typed non-null but rows written before that constraint carry
    // null, and the cart screen calls string methods on it.
    product: {
      ...(product as Product),
      id,
      name: typeof (product as Product).name === "string" ? (product as Product).name : "",
    },
    quantity,
    selectedSize: optionLabel(raw.selectedSize),
    selectedFeature: optionLabel(raw.selectedFeature),
  };
}

/** localStorage throws outright in some privacy modes, hence every access is guarded. */
function readStoredCarts(): CartsBySlug {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const carts: CartsBySlug = {};
    for (const [slug, items] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      // Drop anything that no longer matches the shape — a stale entry from an
      // older build must not crash the cart screen.
      const valid = items.map(normalizeCartItem).filter((item): item is CartItem => item !== null);
      if (valid.length > 0) carts[slug] = valid;
    }
    return carts;
  } catch {
    return {};
  }
}

function writeStoredCarts(carts: CartsBySlug) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(carts));
  } catch {
    /* private mode or quota exceeded — the cart still works for this session */
  }
}

interface CartStore {
  carts: CartsBySlug;
  addToCart: (
    slug: string,
    product: Product,
    quantity: number,
    selectedSize: string | null,
    selectedFeature: string | null,
  ) => void;
  removeFromCart: (slug: string, cartKey: string) => void;
  updateQuantity: (slug: string, cartKey: string, quantity: number) => void;
  clearCart: (slug: string) => void;
}

const CartContext = createContext<CartStore | undefined>(undefined);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [carts, setCarts] = useState<CartsBySlug>(readStoredCarts);

  useEffect(() => {
    writeStoredCarts(carts);
  }, [carts]);

  /** Apply a transform to one store's basket; an emptied basket is dropped so
   *  the persisted blob does not grow with every store the customer visits. */
  const mutate = useCallback((slug: string, fn: (items: CartItem[]) => CartItem[]) => {
    setCarts((prev) => {
      const next = fn(prev[slug] ?? EMPTY_ITEMS);
      if (next.length === 0) {
        if (!(slug in prev)) return prev;
        const rest = { ...prev };
        delete rest[slug];
        return rest;
      }
      return { ...prev, [slug]: next };
    });
  }, []);

  const addToCart = useCallback(
    (slug: string, product: Product, quantity: number, selectedSize: string | null, selectedFeature: string | null) => {
      const key = getCartKey(product.id, selectedSize, selectedFeature);
      // A free-text quantity field can hand us NaN; adding that once poisons the
      // basket total for good, since NaN survives every later arithmetic.
      const added = clampQuantity(quantity) || 1;
      mutate(slug, (items) => {
        const existing = items.find(
          (i) => getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === key
        );
        if (existing) {
          return items.map((i) =>
            getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === key
              ? { ...i, quantity: clampQuantity(i.quantity + added) || 1 }
              : i
          );
        }
        return [...items, { product, quantity: added, selectedSize, selectedFeature }];
      });
    },
    [mutate]
  );

  const removeFromCart = useCallback(
    (slug: string, cartKey: string) => {
      mutate(slug, (items) =>
        items.filter((i) => getCartKey(i.product.id, i.selectedSize, i.selectedFeature) !== cartKey)
      );
    },
    [mutate]
  );

  const updateQuantity = useCallback(
    (slug: string, cartKey: string, quantity: number) => {
      const next = clampQuantity(quantity);
      mutate(slug, (items) => {
        if (next === 0) {
          return items.filter((i) => getCartKey(i.product.id, i.selectedSize, i.selectedFeature) !== cartKey);
        }
        return items.map((i) =>
          getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === cartKey ? { ...i, quantity: next } : i
        );
      });
    },
    [mutate]
  );

  const clearCart = useCallback((slug: string) => mutate(slug, () => []), [mutate]);

  const value = useMemo<CartStore>(
    () => ({ carts, addToCart, removeFromCart, updateQuantity, clearCart }),
    [carts, addToCart, removeFromCart, updateQuantity, clearCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export { getCartKey };

/**
 * Basket for the store currently being browsed.
 *
 * The API is unchanged for callers; `storeSlug` is only for screens that
 * already hold the slug (from useParams) and should not depend on the URL
 * still pointing at that store when a callback finally runs.
 */
export const useCart = (storeSlug?: string): CartContextType => {
  const store = useContext(CartContext);
  if (!store) throw new Error("useCart must be used within CartProvider");

  const slug = storeSlug || slugFromPath(window.location.pathname);
  const items = store.carts[slug] ?? EMPTY_ITEMS;

  return useMemo<CartContextType>(
    () => ({
      items,
      addToCart: (product, quantity, selectedSize, selectedFeature) =>
        store.addToCart(slug, product, quantity, selectedSize, selectedFeature),
      removeFromCart: (cartKey) => store.removeFromCart(slug, cartKey),
      updateQuantity: (cartKey, quantity) => store.updateQuantity(slug, cartKey, quantity),
      clearCart: () => store.clearCart(slug),
      totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    [items, slug, store]
  );
};
