/**
 * The plan catalogue — the ONE place plan ids, prices and limits are defined.
 *
 * This module is deliberately React-free so that it can be imported by the
 * entitlement engine, the native ad controller and the sync worker without
 * dragging a page chunk along with it (SubscriptionDialog.tsx used to own this
 * data, which is why MasterAdmin ended up bundling the whole Billing page).
 */

export type PlanId = "free" | "growth" | "pro" | "estimate_generate" | "support";

export interface PlanDef {
  id: PlanId;
  /** Customer-facing name. Used in receipts and emails — keep it exact. */
  name: string;
  /** Price in whole rupees. Server-side price lookup must agree with this. */
  price: number;
  priceLabel: string;
  productLimit: number;
  features: string[];
  /**
   * The plan includes the estimate generator OUTRIGHT.
   *
   * False does not mean locked out: those plans reach the same screen and fund
   * each estimate with rewarded ads instead (see src/lib/estimateCredits.ts).
   * This is the flag `entitlement.estimatesFree` is built from.
   */
  unlocksEstimates: boolean;
  /** Unlocks the premium skins (gold / wooden / midnight aurora). */
  unlocksPremiumSkins: boolean;
  /** Unlocks the phone support line. */
  unlocksCallSupport: boolean;
  /** Shown as the headline plan in the upgrade sheet. */
  popular?: boolean;
}

const BUILT_IN_PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free Plan",
    price: 0,
    priceLabel: "FREE",
    productLimit: 40,
    features: ["40 Products", "Basic Listing", "Standard Support", "Ads supported"],
    unlocksEstimates: false,
    unlocksPremiumSkins: false,
    unlocksCallSupport: false,
  },
  {
    id: "growth",
    name: "Growth Plan",
    price: 199,
    priceLabel: "₹199/month",
    productLimit: 300,
    features: [
      "Up to 300 Products",
      "Estimates (ad-funded)",
      "Better Visibility",
      "Premium Themes",
      "No banner ads",
      "Standard Support",
    ],
    // Growth is the ad-funded estimate tier: the generator is reachable, but
    // each estimate is paid for with rewarded ads through the credit wallet
    // (see src/lib/estimateCredits.ts) rather than included outright. This flag
    // means "included outright", which is why it is false. The live value comes
    // from `plans.unlocks_estimates` in the database, so which side of the line
    // Growth sits on is a console edit, not a release.
    unlocksEstimates: false,
    unlocksPremiumSkins: false,
    unlocksCallSupport: false,
  },
  {
    id: "estimate_generate",
    name: "Estimate Generator Plan",
    price: 399,
    priceLabel: "₹399/month",
    productLimit: 300,
    features: [
      "Unlimited Estimates & Invoices",
      "Works fully offline",
      "PDF download & WhatsApp share",
      "Up to 300 Products",
      "No ads",
    ],
    unlocksEstimates: true,
    unlocksPremiumSkins: false,
    unlocksCallSupport: false,
    popular: true,
  },
  {
    id: "pro",
    name: "Pro Plan",
    price: 349,
    priceLabel: "₹349/month",
    productLimit: 9999,
    features: [
      "500+ Products",
      "Custom Branding with Logo",
      "Premium Themes & Skins",
      "Priority & Call Support",
      "No ads",
      "Featured Listing",
    ],
    unlocksEstimates: true,
    unlocksPremiumSkins: true,
    unlocksCallSupport: true,
  },
  {
    id: "support",
    name: "Monthly Support Subscription",
    price: 499,
    priceLabel: "₹499/month",
    productLimit: 9999,
    features: [
      "Everything in Pro",
      "Unlimited Estimates & Invoices",
      "Premium Themes & Skins",
      "Priority & Call Support",
      "No ads",
      "Helps us keep improving CatalogShare",
    ],
    unlocksEstimates: true,
    unlocksPremiumSkins: true,
    unlocksCallSupport: true,
  },
];

/**
 * The live catalogue.
 *
 * Seeded from BUILT_IN_PLANS and replaced IN PLACE by `applyPlanCatalogue()`
 * when the database has its own. In place, because ten modules import this
 * array directly — reassigning the binding would leave every one of them
 * holding the stale one, and the bug would only show up as prices that update
 * on some screens and not others.
 */
export const PLANS: PlanDef[] = [...BUILT_IN_PLANS];

/** Plans that represent a paid entitlement. `free` is deliberately absent. */
export const PAID_PLANS: PlanId[] = ["growth", "pro", "estimate_generate", "support"];

let PLAN_BY_ID = new Map<string, PlanDef>(PLANS.map((p) => [p.id, p]));

type CatalogueListener = () => void;
const catalogueListeners = new Set<CatalogueListener>();

/** Re-render hook for components rendering prices. */
export function onPlanCatalogueChange(fn: CatalogueListener): () => void {
  catalogueListeners.add(fn);
  return () => catalogueListeners.delete(fn);
}

/** A row from the `plans` table, in its database shape. */
export interface PlanRow {
  id: string;
  name: string | null;
  price: number | null;
  price_label: string | null;
  product_limit: number | null;
  features: string[] | null;
  unlocks_estimates: boolean | null;
  unlocks_premium_skins: boolean | null;
  unlocks_call_support: boolean | null;
  popular: boolean | null;
  rank: number | null;
  active: boolean | null;
  sort_order: number | null;
}

/**
 * Replace the catalogue with rows from the database.
 *
 * Ignores an empty list rather than emptying the catalogue: a failed query, a
 * table that does not exist yet, or RLS hiding everything must leave the app on
 * the built-in plans, not on no plans at all. A merchant with no plan
 * definitions cannot be told what they are entitled to.
 */
export function applyPlanCatalogue(rows: PlanRow[] | null | undefined): boolean {
  if (!rows || rows.length === 0) return false;

  const mapped: PlanDef[] = rows
    .filter((r) => r && typeof r.id === "string" && r.id)
    .map((r) => ({
      id: r.id as PlanId,
      name: r.name ?? r.id,
      price: Number(r.price ?? 0),
      priceLabel: r.price_label ?? (Number(r.price ?? 0) > 0 ? `₹${r.price}/month` : "FREE"),
      productLimit: Number(r.product_limit ?? 40),
      features: Array.isArray(r.features) ? r.features : [],
      unlocksEstimates: Boolean(r.unlocks_estimates),
      unlocksPremiumSkins: Boolean(r.unlocks_premium_skins),
      unlocksCallSupport: Boolean(r.unlocks_call_support),
      popular: Boolean(r.popular),
    }));

  if (!mapped.some((p) => p.id === "free")) {
    // Everything falls back to `free`; a catalogue without it would resolve
    // every unknown plan to undefined and crash getPlan().
    const builtInFree = BUILT_IN_PLANS.find((p) => p.id === "free");
    if (builtInFree) mapped.unshift(builtInFree);
  }

  const ordered = [...rows]
    .filter((r) => mapped.some((m) => m.id === r.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => mapped.find((m) => m.id === r.id)!)
    .filter(Boolean);

  const finalList = ordered.length ? ordered : mapped;

  PLANS.length = 0;
  PLANS.push(...finalList);
  PLAN_BY_ID = new Map(finalList.map((p) => [p.id, p]));

  // Rank drives upgrade/downgrade comparisons, so it follows the table too.
  for (const row of rows) {
    if (row?.id) PLAN_RANK[row.id as PlanId] = Number(row.rank ?? 0);
  }

  // Keep PAID_PLANS in step: anything priced above zero is a paid entitlement.
  PAID_PLANS.length = 0;
  PAID_PLANS.push(...finalList.filter((p) => p.price > 0).map((p) => p.id));

  catalogueListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the catalogue */
    }
  });
  return true;
}

/** Plans offered for purchase, in display order. `free` is never sold. */
export function purchasablePlans(): PlanDef[] {
  return PLANS.filter((p) => p.id !== "free" && p.price > 0);
}

export function getPlan(planId: string | null | undefined): PlanDef {
  return PLAN_BY_ID.get(planId ?? "free") ?? PLAN_BY_ID.get("free")!;
}

export function getPlanLimit(planId: string | null | undefined): number {
  return getPlan(planId).productLimit;
}

export function getPlanName(planId: string | null | undefined): string {
  return getPlan(planId).name;
}

export function getPlanPrice(planId: string | null | undefined): number {
  return getPlan(planId).price;
}

/** Ordering used to decide whether a plan change is an upgrade or a downgrade. */
export const PLAN_RANK: Record<string, number> = {
  free: 0,
  growth: 1,
  pro: 2,
  estimate_generate: 3,
  support: 4,
};

export function isPaidPlanId(planId: string | null | undefined): boolean {
  return PAID_PLANS.includes((planId ?? "free") as PlanId);
}
