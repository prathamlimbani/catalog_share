/**
 * The rewards data layer — wallet, config, offers, coupons.
 *
 * One module so every screen agrees on what a point is worth and what the rules
 * are. React-free, like plans.ts, so the ad controller and the sync layer can
 * use it without dragging a page chunk along.
 *
 * EVERY read here degrades. The monetization tables are newer than the shipped
 * client, so a missing table is a NORMAL state, not an error: each function
 * returns a safe empty value and logs once. Nothing in the app may break
 * because rewards are not provisioned yet.
 */

import { supabase } from "@/integrations/supabase/client";

/** The generated types predate these tables; describe what we use and cast. */
type Loose = {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};

const db = () => supabase as unknown as Loose;

// ------------------------------------------------------------------ config

export interface RewardsConfig {
  enabled: boolean;
  pointsPerAd: number;
  dailyAdCap: number;
  pointsLabel: string;
}

export const DEFAULT_REWARDS_CONFIG: RewardsConfig = {
  // Fail CLOSED for earning: showing an Earn screen that cannot credit anything
  // is worse than not showing one, because the user watches ads for nothing.
  enabled: false,
  pointsPerAd: 10,
  dailyAdCap: 10,
  pointsLabel: "Coins",
};

export async function fetchRewardsConfig(): Promise<RewardsConfig> {
  try {
    const { data, error } = await db()
      .from("app_settings")
      .select("value")
      .eq("key", "rewards")
      .maybeSingle();

    if (error || !data?.value) return DEFAULT_REWARDS_CONFIG;
    const v = data.value as Record<string, unknown>;
    return {
      enabled: v.enabled !== false,
      pointsPerAd: Number(v.points_per_ad ?? 10) || 10,
      dailyAdCap: Number(v.daily_ad_cap ?? 10) || 10,
      pointsLabel: String(v.points_label ?? "Coins"),
    };
  } catch {
    return DEFAULT_REWARDS_CONFIG;
  }
}

// ------------------------------------------------------------------ wallet

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
}

export interface Wallet {
  balance: number;
  entries: LedgerEntry[];
  /** Ads credited today, for the daily-cap meter. */
  earnedToday: number;
}

export const EMPTY_WALLET: Wallet = { balance: 0, entries: [], earnedToday: 0 };

/**
 * Read the wallet.
 *
 * The balance is summed from the ledger rather than read from a column: there
 * is no balance column, deliberately (see the migration). Summing the page we
 * fetched would be wrong for a long history, so the sum comes from the
 * `wallet_balances` view and the entries are only the recent ones shown in the
 * list.
 */
export async function fetchWallet(companyId: string | null | undefined): Promise<Wallet> {
  if (!companyId) return EMPTY_WALLET;

  try {
    const [balanceRes, entriesRes, todayRes] = await Promise.all([
      db().from("wallet_balances").select("balance").eq("company_id", companyId).maybeSingle(),
      db()
        .from("points_ledger")
        .select("id, delta, reason, note, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
      db()
        .from("ad_reward_events")
        .select("transaction_id")
        .eq("company_id", companyId)
        .gt("credited_points", 0)
        .gte("created_at", startOfUtcDay()),
    ]);

    if (balanceRes.error && entriesRes.error) return EMPTY_WALLET;

    return {
      balance: Number(balanceRes.data?.balance ?? 0) || 0,
      entries: (entriesRes.data ?? []) as LedgerEntry[],
      earnedToday: Array.isArray(todayRes.data) ? todayRes.data.length : 0,
    };
  } catch (err) {
    console.warn("[rewards] wallet unavailable:", err);
    return EMPTY_WALLET;
  }
}

function startOfUtcDay(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

// ------------------------------------------------------------------ offers

export interface RewardOffer {
  id: string;
  label: string;
  plan_id: string;
  days: number;
  points_cost: number;
  active: boolean;
  sort_order: number;
}

export async function fetchRewardOffers(): Promise<RewardOffer[]> {
  try {
    const { data, error } = await db()
      .from("reward_offers")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) return [];
    return (data ?? []) as RewardOffer[];
  } catch {
    return [];
  }
}

export interface RedeemResult {
  ok: boolean;
  reason?: string;
  plan?: string;
  days?: number;
  until?: string;
  balance?: number;
}

/**
 * Spend points on plan days.
 *
 * All the rules — sufficient balance, not downgrading a live paid plan, the row
 * lock that stops a double tap spending twice — are in `redeem_reward_offer`.
 * This is a thin call on purpose: re-checking them here would be a second
 * implementation that can disagree with the first.
 */
export async function redeemOffer(offerId: string): Promise<RedeemResult> {
  try {
    const { data, error } = await db().rpc("redeem_reward_offer", { p_offer_id: offerId });
    if (error) {
      // The RPC writes its own user-facing reasons ("Not enough points."); a
      // PostgREST transport error is not one of them, and printing it puts
      // "relation does not exist" in front of a merchant.
      console.warn("[rewards] redeem_reward_offer failed:", error.message);
      return { ok: false, reason: "Could not redeem right now. Please try again." };
    }
    if (!data) return { ok: false, reason: "No response from the server." };
    return data as RedeemResult;
  } catch (err) {
    console.warn("[rewards] redeem threw:", err);
    return { ok: false, reason: "Could not redeem right now. Please try again." };
  }
}

// ----------------------------------------------------------------- coupons

export interface CouponCheck {
  valid: boolean;
  code?: string;
  percent_off?: number;
  description?: string;
  reason?: string;
}

/**
 * Check a coupon code.
 *
 * Goes through `validate_coupon` rather than selecting from `coupons`, because
 * the table has no public read policy — publishing one coupon must not publish
 * every coupon.
 */
export async function checkCoupon(code: string, planId: string): Promise<CouponCheck> {
  const trimmed = code.trim();
  if (!trimmed) return { valid: false, reason: "Enter a coupon code." };

  try {
    const { data, error } = await db().rpc("validate_coupon", {
      p_code: trimmed,
      p_plan_id: planId,
    });
    if (error) {
      // The function does not exist yet — treat as "no coupons available"
      // rather than showing the merchant a database error.
      console.warn("[rewards] validate_coupon unavailable:", error.message);
      return { valid: false, reason: "Coupons are not available right now." };
    }
    return (data ?? { valid: false, reason: "Could not check that code." }) as CouponCheck;
  } catch (err) {
    console.warn("[rewards] coupon check threw:", err);
    return { valid: false, reason: "Could not check that code. Check your connection and try again." };
  }
}

/**
 * Apply a percentage discount to a rupee price.
 *
 * Rounds to whole paise and never returns less than ₹1: Razorpay rejects an
 * order below that, so a 100% coupon has to be handled as a direct grant rather
 * than as a zero-rupee payment. Callers must check for that case.
 */
export function discountedPaise(priceRupees: number, percentOff: number): number {
  const full = Math.round(priceRupees * 100);
  const discounted = Math.round((full * (100 - percentOff)) / 100);
  return Math.max(discounted, 100);
}

/** True when the discount leaves nothing to charge. */
export function isFullDiscount(percentOff: number): boolean {
  return percentOff >= 100;
}

/**
 * Claim a 100%-off coupon, which has no payment to verify.
 *
 * Razorpay cannot create an order below one rupee, so a full-discount code
 * cannot go through checkout at all — charging a token rupee instead would be a
 * lie on the receipt and would leave a real payment to refund. The grant and
 * every eligibility check happen in `claim_full_coupon`, because this hands out
 * a plan with no money involved and is the most attractive thing in the schema
 * to attack.
 */
export async function claimFullCoupon(code: string, planId: string): Promise<RedeemResult> {
  try {
    const { data, error } = await db().rpc("claim_full_coupon", {
      p_code: code.trim(),
      p_plan_id: planId,
    });
    if (error) {
      console.warn("[rewards] claim_full_coupon failed:", error.message);
      return { ok: false, reason: "Could not apply that coupon. Please try again." };
    }
    return (data ?? { ok: false, reason: "No response from the server." }) as RedeemResult;
  } catch (err) {
    console.warn("[rewards] claim threw:", err);
    return { ok: false, reason: "Could not apply that coupon. Please try again." };
  }
}
