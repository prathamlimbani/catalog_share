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
  /** Unlocks the estimate/invoice generator without a trial. */
  unlocksEstimates: boolean;
  /** Unlocks the premium skins (gold / wooden / midnight aurora). */
  unlocksPremiumSkins: boolean;
  /** Unlocks the phone support line. */
  unlocksCallSupport: boolean;
  /** Shown as the headline plan in the upgrade sheet. */
  popular?: boolean;
}

export const PLANS: PlanDef[] = [
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
      "Estimates & Invoices",
      "Better Visibility",
      "Premium Themes",
      "No ads",
      "Standard Support",
    ],
    // Growth has always included the estimate generator — the pre-app code
    // explicitly allowed it. Leaving this false silently locked every paying
    // ₹199 customer out of the feature they were already using.
    unlocksEstimates: true,
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

/** Plans that represent a paid entitlement. `free` is deliberately absent. */
export const PAID_PLANS: PlanId[] = ["growth", "pro", "estimate_generate", "support"];

const PLAN_BY_ID = new Map<string, PlanDef>(PLANS.map((p) => [p.id, p]));

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
export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  growth: 1,
  pro: 2,
  estimate_generate: 3,
  support: 4,
};

export function isPaidPlanId(planId: string | null | undefined): boolean {
  return PAID_PLANS.includes((planId ?? "free") as PlanId);
}
