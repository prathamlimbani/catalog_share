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

/**
 * What an offer hands over.
 *
 *   plan_days        days of a subscription plan   (retired, still supported)
 *   estimate_credits estimates, banked on the device
 *   product_slots    a permanent rise in the product limit
 *
 * `plan_days` is the historical shape and stays the fallback for any row
 * written before the column existed — a database that has not had
 * 20260829000000 applied returns rows with no `kind` at all, and reading those
 * as plan days is what they are.
 */
export type OfferKind = "plan_days" | "estimate_credits" | "product_slots";

const OFFER_KINDS: OfferKind[] = ["plan_days", "estimate_credits", "product_slots"];

/** Never trust the column: it is admin-editable text with a CHECK behind it. */
export function offerKindOf(raw: unknown): OfferKind {
  const value = String(raw ?? "").trim() as OfferKind;
  return OFFER_KINDS.includes(value) ? value : "plan_days";
}

export interface RewardOffer {
  id: string;
  label: string;
  kind: OfferKind;
  /** Estimates or product slots granted. Meaningless for `plan_days`. */
  amount: number;
  /** Only for `plan_days`. Null on the other kinds. */
  plan_id: string | null;
  /** Only for `plan_days`. Null on the other kinds. */
  days: number | null;
  points_cost: number;
  active: boolean;
  sort_order: number;
}

/** A whole count, or 0. Offer rows are admin-typed and arrive as anything. */
function count(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function fetchRewardOffers(): Promise<RewardOffer[]> {
  try {
    const { data, error } = await db()
      .from("reward_offers")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) return [];
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      kind: offerKindOf(row.kind),
      amount: count(row.amount),
      plan_id: row.plan_id == null ? null : String(row.plan_id),
      days: row.days == null ? null : count(row.days),
      points_cost: count(row.points_cost),
      active: row.active !== false,
      sort_order: Math.floor(Number(row.sort_order)) || 0,
    })) as RewardOffer[];
  } catch {
    return [];
  }
}

export interface RedeemResult {
  ok: boolean;
  reason?: string;
  /** Which branch of `redeem_reward_offer` ran. Absent on an older database. */
  kind?: OfferKind;
  /** Estimates or product slots granted, in the unit the merchant was sold. */
  amount?: number;
  /** Wallet credits owed for an `estimate_credits` grant. */
  credits?: number;
  /** The reward_redemptions row a device has to bank and then stamp. */
  grant_id?: string;
  /** The company's product-slot bonus after a `product_slots` grant. */
  bonus_product_limit?: number;
  plan?: string;
  days?: number;
  until?: string;
  balance?: number;
  /** SQLSTATE, when the call failed below the function. Lets support name it. */
  code?: string;
}

/**
 * Turn a PostgREST failure into something a merchant can act on.
 *
 * The reasons the RPC returns in its JSON are already merchant-readable and are
 * rendered verbatim; this is for the layer BELOW that, where the call never
 * reached the RETURN at all. Those used to collapse into one generic apology,
 * which is exactly why "points arrive but redeem does nothing" survived in the
 * field for days: the database was raising a specific, nameable error every
 * single time and nobody could see it.
 *
 * Every case here rolls the whole function back, so no points were spent. Say
 * so — a merchant who thinks they have been debited will not try again.
 */
export function redeemFailureReason(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "P0001":
      // guard_company_subscription_columns() raised. Until migration
      // 20260825000000 is applied, every merchant redemption dies here.
      return "Your points are safe, but the plan could not be switched on. Nothing was charged. Please tell support: redeem blocked by the subscription guard.";
    case "23514":
      // check_violation — the offer's plan id is not in the CHECK list built
      // from the plans table.
      return "This reward points at a plan this app cannot grant yet. Nothing was charged.";
    // undefined_function / undefined_table, and PGRST202 — PostgREST's own
    // code, not a SQLSTATE — for the call that never reached Postgres because
    // the function is not in the schema cache. All three mean the same thing to
    // a merchant: this database has not had the rewards migrations applied.
    case "42883":
    case "42P01":
    case "PGRST202":
      return "Rewards are not switched on for this account yet. Nothing was charged.";
    case "42501":
      return "This account is not allowed to redeem rewards. Nothing was charged.";
    case "PGRST301":
      // JWT missing, expired or rejected. Retrying cannot help; signing in can.
      return "Your session has expired. Please sign in again — nothing was charged.";
    default:
      // Deliberately action-neutral: both the points redeem and the 100%-off
      // coupon claim fail through here.
      return "That did not go through. Nothing was charged — please try again.";
  }
}

export const GENERIC_FAILURE = "That did not go through. Please try again.";
export const OFFLINE_FAILURE = "Could not reach the server. Check your connection and try again.";

/**
 * The last filter before a `reason` is printed on a merchant's screen.
 *
 * `redeem_reward_offer` writes merchant-facing sentences. But when the function
 * is not deployed yet, or a policy refuses the call, or the socket dies, some
 * caller may still pass PostgREST's own text through untouched — "Could not
 * find the function public.redeem_reward_offer(p_offer_id) in the schema
 * cache". A shopkeeper shown that has been handed a stack trace and has no idea
 * whether their points were spent, so anything carrying a database or transport
 * fingerprint is swapped for plain words and logged for us instead.
 *
 * This lives beside `redeemFailureReason` rather than in the screen that calls
 * it because the two have to agree: a message written up there that trips a
 * fingerprint down here is silently replaced by "That did not go through",
 * which is how a nameable database error stayed nameless in the field.
 */
const TRANSPORT_FINGERPRINT =
  /failed to fetch|networkerror|network request failed|load failed|timed? ?out|aborted/i;
const DATABASE_FINGERPRINT =
  /schema cache|pgrst|postgrest|supabase|relation |column |function |permission denied|row-level security|violates|duplicate key|null value|syntax error|jwt|invalid input|[{}\n]|^\w+error:/i;

export function merchantReason(raw: string | undefined): string {
  const reason = (raw ?? "").trim();
  if (!reason) return GENERIC_FAILURE;
  if (TRANSPORT_FINGERPRINT.test(reason)) return OFFLINE_FAILURE;
  if (DATABASE_FINGERPRINT.test(reason) || reason.length > 240) return GENERIC_FAILURE;
  return reason;
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
      // PostgREST transport error is not one of them, and printing it raw puts
      // "relation does not exist" in front of a merchant. The SQLSTATE is what
      // distinguishes a blocked grant from an unprovisioned database, so it is
      // logged in full and named — vaguely — in what the merchant reads.
      console.warn(
        `[rewards] redeem_reward_offer failed (${error.code ?? "no code"}):`,
        error.message,
        error.details ?? "",
        error.hint ?? "",
      );
      return { ok: false, reason: redeemFailureReason(error), code: error.code };
    }
    if (!data) return { ok: false, reason: "No response from the server." };
    return data as RedeemResult;
  } catch (err) {
    console.warn("[rewards] redeem threw:", err);
    return { ok: false, reason: "Could not redeem right now. Please try again." };
  }
}

// ------------------------------------------------------------ credit grants

/**
 * An `estimate_credits` redemption the server has recorded and no device has
 * banked yet.
 */
export interface CreditGrant {
  id: string;
  /** Estimates sold — what the merchant read on the card. */
  amount: number;
  /** Wallet credits owed, priced when the grant was bought. */
  credits: number;
  created_at: string;
}

/**
 * Grants this company has bought and not yet banked.
 *
 * A plain SELECT rather than an RPC: "Owners read own redemptions" already
 * covers it, and a merchant reading their own receipts needs no privilege.
 * Writing is the part that needs a function — see `claimCreditGrant`.
 *
 * Degrades to an empty list like every other read here. A database without
 * 20260829000000 has no `kind` column, so this query 400s, and the correct
 * answer to "what have I bought" on such a database is "nothing".
 */
export async function fetchPendingCreditGrants(
  companyId: string | null | undefined,
): Promise<CreditGrant[]> {
  if (!companyId) return [];
  try {
    const { data, error } = await db()
      .from("reward_redemptions")
      .select("id, amount, credits, created_at")
      .eq("company_id", companyId)
      .eq("kind", "estimate_credits")
      .is("applied_at", null)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.warn("[rewards] credit grants unavailable:", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        amount: count(row.amount),
        credits: count(row.credits),
        created_at: String(row.created_at ?? ""),
      }))
      .filter((g: CreditGrant) => g.id && g.credits > 0);
  } catch (err) {
    console.warn("[rewards] credit grants threw:", err);
    return [];
  }
}

/**
 * Stamp a grant as banked.
 *
 * Returns false on ANY failure, including a network one, so the caller keeps
 * the grant on its retry list. The RPC is idempotent, so retrying a stamp that
 * actually landed costs nothing.
 */
export async function claimCreditGrant(grantId: string): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("claim_reward_credit_grant", {
      p_grant_id: grantId,
    });
    if (error) {
      console.warn(`[rewards] claim grant failed (${error.code ?? "no code"}):`, error.message);
      return false;
    }
    return (data as { ok?: boolean } | null)?.ok === true;
  } catch (err) {
    console.warn("[rewards] claim grant threw:", err);
    return false;
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
      // Same guard, same blindness: claim_full_coupon also updates the
      // subscription columns as the merchant, so it fails the same way.
      console.warn(
        `[rewards] claim_full_coupon failed (${error.code ?? "no code"}):`,
        error.message,
        error.details ?? "",
        error.hint ?? "",
      );
      return { ok: false, reason: redeemFailureReason(error), code: error.code };
    }
    return (data ?? { ok: false, reason: "No response from the server." }) as RedeemResult;
  } catch (err) {
    console.warn("[rewards] claim threw:", err);
    return { ok: false, reason: "Could not apply that coupon. Please try again." };
  }
}
