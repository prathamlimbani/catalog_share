/**
 * Rewards and ads console for the platform owner.
 *
 * Everything the monetization migration made tunable, in one screen: the points
 * economy, the ad policy, the per-plan ad formats, coupons, and what points buy.
 *
 * Unlike plans there are no admin RPCs for any of this, so the writes go
 * straight at the tables. RLS is the whole gate — every table here carries an
 * `Admins manage …` policy checking `has_role(auth.uid(), 'admin')`, and a
 * non-admin session gets nothing back from these queries.
 *
 * The monetization tables are newer than the shipped client, so "not applied
 * yet" is a normal state and gets an explanation rather than a database error.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Coins,
  Gift,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { applyCreditConfig, DEFAULT_CREDIT_CONFIG } from "@/lib/estimateCredits";
import { invalidateAdPolicy } from "@/lib/adPolicy";
import { offerKindOf, type OfferKind } from "@/lib/rewards";

/** The generated types predate these tables; describe what we use and cast. */
type Loose = {
  from(table: string): any;
};

/**
 * EVERY number an operator types is held as a string, drafts included.
 *
 * A number input bound to a number cannot be emptied: clearing it yields
 * Number("") === 0, so the box snaps to 0 while they are still typing. That is
 * merely irritating for "per ad", but the caps are dangerous, because 0 is a
 * real value in all of them (no daily cap, unlimited estimates) and a
 * half-typed field is indistinguishable from a deliberate one. The strings are
 * parsed and range-checked once, on save.
 */
interface RewardsForm {
  enabled: boolean;
  pointsPerAd: string;
  dailyAdCap: string;
  pointsLabel: string;
}

interface AdsForm {
  enabled: boolean;
  rewardedPrompt: boolean;
}

/** A policy row as the table returns it. */
interface PolicyRow {
  plan_id: string;
  show_banner: boolean;
  show_interstitial: boolean;
  show_rewarded: boolean;
  daily_estimates: number;
}

/** The same row while it is being edited. Each one saves on its own. */
interface PolicyDraft extends Omit<PolicyRow, "daily_estimates"> {
  daily_estimates: string;
}

interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  percent_off: number;
  applies_to_plans: string[] | null;
  max_redemptions: number | null;
  redeemed_count: number;
  per_company_limit: number;
  expires_at: string | null;
  active: boolean;
}

interface OfferRow {
  id: string;
  label: string;
  /** Missing on a database without 20260829000000; read as plan days. */
  kind: string | null;
  /** Estimates or product slots granted. Ignored for plan days. */
  amount: number | null;
  plan_id: string | null;
  days: number | null;
  points_cost: number;
  active: boolean;
  sort_order: number;
}

interface CouponDraft {
  /** Blank for a coupon that does not exist yet. */
  id: string;
  code: string;
  description: string;
  percent_off: string;
  /** Comma-separated plan ids. Blank means every plan. */
  plans: string;
  max_redemptions: string;
  per_company_limit: string;
  /** yyyy-mm-dd, blank for no expiry. */
  expires_at: string;
  active: boolean;
  redeemed_count: number;
}

interface OfferDraft {
  id: string;
  label: string;
  kind: OfferKind;
  /** Estimates, or product slots. Only read for the two non-plan kinds. */
  amount: string;
  plan_id: string;
  days: string;
  points_cost: string;
  active: boolean;
  sort_order: string;
}

/** What each kind is called on this screen, and what its amount counts. */
const OFFER_KIND_COPY: Record<OfferKind, { title: string; unit: string; hint: string }> = {
  estimate_credits: {
    title: "Estimates",
    unit: "Estimates granted",
    hint: "Banked in the merchant's estimate wallet, on their phone. They never expire.",
  },
  product_slots: {
    title: "Product slots",
    unit: "Extra products",
    hint: "Added to whatever the plan allows, permanently. It survives a downgrade.",
  },
  plan_days: {
    title: "Plan days",
    unit: "Days granted",
    hint: "Retired. It grants a subscription that expires, and the merchant is left where they started.",
  },
};

/** What one saved offer hands over, in a line. */
function describeOfferRow(row: OfferRow, planNames: Record<string, string>): string {
  const amount = Number(row.amount) || 0;
  switch (offerKindOf(row.kind)) {
    case "estimate_credits":
      return `${amount} estimate${amount === 1 ? "" : "s"}`;
    case "product_slots":
      return `+${amount} product${amount === 1 ? "" : "s"}, permanently`;
    default: {
      const days = Number(row.days) || 0;
      const plan = row.plan_id ? (planNames[row.plan_id] ?? row.plan_id) : "an unnamed plan";
      return `${days} day${days === 1 ? "" : "s"} of ${plan}`;
    }
  }
}

interface PendingDelete {
  title: string;
  body: string;
  run: () => Promise<void>;
}

/** Mirrors the seed in 20260821000000_monetization.sql. */
const DEFAULT_REWARDS = {
  enabled: true,
  pointsPerAd: 10,
  dailyAdCap: 10,
  pointsLabel: "Coins",
};

/**
 * The estimate-credit terms, editable here rather than compiled into the app.
 *
 * These mirror `app_settings.estimate_credits` and the defaults in
 * src/lib/estimateCredits.ts; both sides fall back to the same numbers when the
 * row is missing, so a console that cannot reach the database still shows the
 * terms the app is actually running.
 */
const DEFAULT_CREDIT_FORM = {
  enabled: DEFAULT_CREDIT_CONFIG.enabled,
  adsPerEstimate: String(DEFAULT_CREDIT_CONFIG.adsPerEstimate),
  adsPerEdit: String(DEFAULT_CREDIT_CONFIG.adsPerEdit),
  welcomeCredits: String(DEFAULT_CREDIT_CONFIG.welcomeCredits),
  watchLimit: String(DEFAULT_CREDIT_CONFIG.watchLimit),
  watchWindowHours: String(DEFAULT_CREDIT_CONFIG.watchWindowHours),
};

const DEFAULT_ADS = {
  enabled: true,
  rewardedPrompt: true,
};

/** What the form shows before anything has been read back. */
const BLANK_REWARDS: RewardsForm = {
  enabled: DEFAULT_REWARDS.enabled,
  pointsPerAd: String(DEFAULT_REWARDS.pointsPerAd),
  dailyAdCap: String(DEFAULT_REWARDS.dailyAdCap),
  pointsLabel: DEFAULT_REWARDS.pointsLabel,
};

const BLANK_ADS: AdsForm = {
  enabled: DEFAULT_ADS.enabled,
  rewardedPrompt: DEFAULT_ADS.rewardedPrompt,
};

const BLANK_COUPON: CouponDraft = {
  id: "",
  code: "",
  description: "",
  percent_off: "20",
  plans: "",
  max_redemptions: "",
  per_company_limit: "1",
  expires_at: "",
  active: true,
  redeemed_count: 0,
};

const BLANK_OFFER: OfferDraft = {
  id: "",
  label: "",
  // Estimates, not plan days: a new offer should default to the shape that
  // actually works. Plan days are still selectable, and still carry the guard
  // exemption, but nothing new should be built on them.
  kind: "estimate_credits",
  amount: "5",
  plan_id: "",
  days: "3",
  points_cost: "100",
  active: true,
  sort_order: "0",
};

/**
 * Read an integer setting.
 *
 * Not `Number(x) || fallback`: zero is a real value in most of these fields (no
 * daily cap, no estimate quota) and the shorthand would silently rewrite it to
 * the default every time the form loaded.
 */
function intOr(value: unknown, fallback: number): number {
  // NULL and "" have to be caught before Number() sees them: both coerce to 0,
  // which for these fields would read a missing setting as "no cap at all".
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Parse a field the operator typed.
 *
 * Returns null instead of a fallback because the caller has to decide: a blank
 * cap and a cap of zero mean opposite things on this screen, and quietly
 * picking one of them is how an economy ends up uncapped by accident.
 */
function parseIntField(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toPolicyDraft(row: PolicyRow): PolicyDraft {
  return { ...row, daily_estimates: String(intOr(row.daily_estimates, 0)) };
}

/**
 * What to put under a failed write.
 *
 * This console is the platform owner's, so the raw Postgres message is usually
 * the most useful thing there is and it stays. The three that are routine get
 * translated instead: a re-used coupon code is a typo, and it should not read
 * like an incident report.
 */
function describeError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = String(e?.code ?? "");
  if (code === "23505") return "That code is already in use. Codes are unique, ignoring case.";
  if (code === "42501") return "This account is not an admin, so the write was refused.";
  if (code === "42P01") return "That table does not exist yet. Run the monetization migration.";
  return typeof e?.message === "string" && e.message
    ? e.message
    : "The write did not go through.";
}

/**
 * A date field is a day, not an instant.
 *
 * Expiry lands at the END of the chosen day in the operator's own timezone.
 * Storing midnight instead would kill a coupon dated the 30th as the 30th
 * begins, which is never what anyone means by "valid until the 30th".
 *
 * undefined means the text could not be read at all, which the caller refuses.
 * Returning null there — the same value as "no expiry" — would turn a typo on
 * a browser that renders type=date as a text box into a coupon that never dies.
 */
function dayToExpiry(day: string): string | null | undefined {
  if (!day.trim()) return null;
  const d = new Date(`${day}T23:59:59`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function expiryToDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleDateString();
}

export function RewardsAdmin() {
  const db = supabase as unknown as Loose;

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [rewards, setRewards] = useState<RewardsForm>(BLANK_REWARDS);
  const [savingRewards, setSavingRewards] = useState(false);

  const [ads, setAds] = useState<AdsForm>(BLANK_ADS);
  const [savingAds, setSavingAds] = useState(false);
  const [creditForm, setCreditForm] = useState({ ...DEFAULT_CREDIT_FORM });
  const [savingCredits, setSavingCredits] = useState(false);

  const [policies, setPolicies] = useState<PolicyDraft[]>([]);
  const [planNames, setPlanNames] = useState<Record<string, string>>({});
  const [savingPolicy, setSavingPolicy] = useState<string | null>(null);

  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponDraft, setCouponDraft] = useState<CouponDraft | null>(null);
  const [savingCoupon, setSavingCoupon] = useState(false);

  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [offerDraft, setOfferDraft] = useState<OfferDraft | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);

  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  /**
   * The JSONB exactly as it was read, so a save rewrites only the keys this
   * screen owns. The column holds one document per key: writing a fresh object
   * would delete any tunable a later migration adds and this build cannot see.
   */
  const rawSettings = useRef<Record<string, Record<string, unknown>>>({});

  /**
   * Plans whose row has been edited but not saved.
   *
   * Every save on this page ends in a silent refetch, and the refetch used to
   * replace the whole policy table — so saving row A discarded the toggles
   * already flipped on rows B and C, with no warning and nothing on screen to
   * say it had happened. Dirty rows survive a refetch until their own save.
   */
  const dirtyPolicies = useRef<Set<string>>(new Set());

  /**
   * The real double-submit lock. `disabled` only bites once React has
   * re-rendered, and on a slow device two taps can both land before that; for
   * an INSERT that is two coupons. The saving flags just drive the spinners.
   */
  const inFlight = useRef(false);

  const alive = useRef(true);
  /** Which load is current, so a slow one cannot land on top of a newer one. */
  const loadSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * `silent` refetches without blanking the screen. Every save ends with one,
   * and a full-page spinner between "Saved" and the new values reads as though
   * something went wrong.
   */
  const refresh = useCallback(
    async (silent = false) => {
      const seq = (loadSeq.current += 1);
      if (!silent) setLoading(true);
      try {
        const [settingsRes, policyRes, couponRes, offerRes, planRes] = await Promise.all([
          db.from("app_settings").select("key, value").in("key", ["rewards", "ads", "estimate_credits"]),
          db.from("plan_ad_policy").select("*").order("plan_id", { ascending: true }),
          db.from("coupons").select("*").order("created_at", { ascending: false }),
          db.from("reward_offers").select("*").order("sort_order", { ascending: true }),
          db.from("plans").select("id, name").order("sort_order", { ascending: true }),
        ]);

        // A newer load started while this one was in flight — every save fires
        // one — so this answer is already stale. The same check covers a
        // component that has been unmounted meanwhile.
        if (!alive.current || seq !== loadSeq.current) return;
        setLoadError(false);

        // app_settings is the probe: it is created first by the migration, so
        // if it is not there none of the rest is either.
        if (settingsRes.error) {
          setMissing(true);
          return;
        }
        setMissing(false);

        const rows = (settingsRes.data ?? []) as Array<{ key: string; value: unknown }>;
        const raw: Record<string, Record<string, unknown>> = {};
        for (const r of rows) {
          // JSONB holds a scalar or null as happily as an object, and only an
          // object can be read as settings or merged back into on save.
          if (r?.value && typeof r.value === "object" && !Array.isArray(r.value)) {
            raw[r.key] = r.value as Record<string, unknown>;
          }
        }
        rawSettings.current = raw;

        const rewardsValue = raw.rewards ?? {};
        const adsValue = raw.ads ?? {};
        const creditValue = raw.estimate_credits ?? {};

        setCreditForm({
          enabled: creditValue.enabled !== false,
          adsPerEstimate: String(
            intOr(creditValue.ads_per_estimate, DEFAULT_CREDIT_CONFIG.adsPerEstimate),
          ),
          adsPerEdit: String(intOr(creditValue.ads_per_edit, DEFAULT_CREDIT_CONFIG.adsPerEdit)),
          welcomeCredits: String(
            intOr(creditValue.welcome_credits, DEFAULT_CREDIT_CONFIG.welcomeCredits),
          ),
          watchLimit: String(intOr(creditValue.watch_limit, DEFAULT_CREDIT_CONFIG.watchLimit)),
          watchWindowHours: String(
            intOr(creditValue.watch_window_hours, DEFAULT_CREDIT_CONFIG.watchWindowHours),
          ),
        });

        setRewards({
          enabled: rewardsValue.enabled !== false,
          pointsPerAd: String(intOr(rewardsValue.points_per_ad, DEFAULT_REWARDS.pointsPerAd)),
          dailyAdCap: String(intOr(rewardsValue.daily_ad_cap, DEFAULT_REWARDS.dailyAdCap)),
          pointsLabel: String(rewardsValue.points_label ?? DEFAULT_REWARDS.pointsLabel),
        });

        setAds({
          enabled: adsValue.enabled !== false,
          rewardedPrompt: adsValue.rewarded_prompt !== false,
        });

        const fresh = ((policyRes.data ?? []) as PolicyRow[]).map(toPolicyDraft);
        setPolicies((prev) => {
          if (dirtyPolicies.current.size === 0) return fresh;
          const edited = new Map(prev.map((p) => [p.plan_id, p]));
          return fresh.map((row) =>
            dirtyPolicies.current.has(row.plan_id) ? edited.get(row.plan_id) ?? row : row,
          );
        });
        setCoupons((couponRes.data ?? []) as CouponRow[]);
        setOffers((offerRes.data ?? []) as OfferRow[]);

        const names: Record<string, string> = {};
        for (const p of (planRes.data ?? []) as Array<{ id: string; name: string }>) {
          names[p.id] = p.name;
        }
        setPlanNames(names);
      } catch (err) {
        // A missing table does not land here — Postgrest reports that in
        // `error`. Reaching this means the request never completed at all, and
        // showing the defaults would put an economy on screen that is not the
        // live one, which the operator could then Save straight over the top of.
        if (!alive.current || seq !== loadSeq.current) return;
        console.warn("[rewards-admin] could not read the settings:", err);
        // Only the blocking load becomes the error card. A silent refetch that
        // fails follows a save that already succeeded, so the form on screen is
        // still what was just written — tearing it down there would be alarming
        // and would lose the operator's place mid-edit.
        if (!silent) {
          setLoadError(true);
        } else {
          toast.error("Saved, but this page could not be reloaded", {
            description: "What you see may be out of date until you reopen it.",
          });
        }
      } finally {
        if (!silent && alive.current && seq === loadSeq.current) setLoading(false);
      }
    },
    [db],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Declared up here rather than with the other derived values because the save
  // handlers below quote it back to the operator.
  const pointsLabel = rewards.pointsLabel.trim() || DEFAULT_REWARDS.pointsLabel;

  /**
   * Write one tunable.
   *
   * Merged into the document that was read, not written over it: the value is
   * one JSONB blob per key, so sending only the fields this screen renders
   * would silently delete every other key in it. app_settings also records who
   * last touched a tunable; keep that column honest.
   */
  const writeSetting = async (key: string, value: Record<string, unknown>) => {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await db.from("app_settings").upsert(
      {
        key,
        value: { ...(rawSettings.current[key] ?? {}), ...value },
        updated_at: new Date().toISOString(),
        updated_by: auth?.user?.id ?? null,
      },
      { onConflict: "key" },
    );
    if (error) throw error;
  };

  const saveRewards = async () => {
    // Clamping silently is not good enough for these two. An unreadable "per
    // ad" clamped to 1 devalues every future ad by 90%, and an unreadable cap
    // clamped to 0 removes the only thing stopping a scripted device from
    // farming points all day. Refuse and say which field is wrong.
    const perAd = parseIntField(rewards.pointsPerAd);
    if (perAd === null || perAd < 1) {
      toast.error(`A watched ad has to be worth at least one ${pointsLabel.toLowerCase()}.`);
      return;
    }

    const cap = parseIntField(rewards.dailyAdCap);
    if (cap === null || cap < 0) {
      toast.error("Ads per day must be a whole number. 0 removes the cap.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingRewards(true);
    try {
      await writeSetting("rewards", {
        enabled: rewards.enabled,
        points_per_ad: perAd,
        daily_ad_cap: cap,
        points_label: pointsLabel,
      });
      toast.success("Rewards economy saved");
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the rewards economy", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingRewards(false);
    }
  };

  const saveCredits = async () => {
    const perEstimate = parseIntField(creditForm.adsPerEstimate);
    if (perEstimate === null || perEstimate < 1 || perEstimate > 20) {
      toast.error("Ads per estimate must be a whole number from 1 to 20.");
      return;
    }
    const perEdit = parseIntField(creditForm.adsPerEdit);
    if (perEdit === null || perEdit < 1 || perEdit > 20) {
      toast.error("Ads per edit must be a whole number from 1 to 20.");
      return;
    }
    const welcome = parseIntField(creditForm.welcomeCredits);
    if (welcome === null || welcome < 0) {
      toast.error("The welcome grant must be a whole number. 0 means none.");
      return;
    }
    const limit = parseIntField(creditForm.watchLimit);
    if (limit === null || limit < 1) {
      toast.error("The watch limit must be at least 1 ad.");
      return;
    }
    const hours = parseIntField(creditForm.watchWindowHours);
    if (hours === null || hours < 1 || hours > 24) {
      toast.error("The watch window must be a whole number of hours, from 1 to 24.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingCredits(true);
    const payload = {
      enabled: creditForm.enabled,
      ads_per_estimate: perEstimate,
      ads_per_edit: perEdit,
      welcome_credits: welcome,
      watch_limit: limit,
      watch_window_hours: hours,
    };
    try {
      await writeSetting("estimate_credits", payload);
      // Push it into this session as well, so the console reflects the terms it
      // just wrote rather than the ones it loaded with.
      applyCreditConfig(payload);
      toast.success("Estimate credits saved", {
        description: creditForm.enabled
          ? `An estimate now costs ${perEstimate} ad${perEstimate === 1 ? "" : "s"}, an edit ${perEdit}.`
          : "Estimates are free for every plan until this is switched back on.",
      });
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the estimate credits", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingCredits(false);
    }
  };

  const saveAds = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSavingAds(true);
    try {
      await writeSetting("ads", {
        enabled: ads.enabled,
        rewarded_prompt: ads.rewardedPrompt,
      });
      toast.success("Ad settings saved");
      // The policy is cached per plan; drop it so this session sees the change
      // now instead of on the next cold start.
      invalidateAdPolicy();
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the ad settings", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingAds(false);
    }
  };

  const savePolicy = async (row: PolicyDraft) => {
    const daily = parseIntField(row.daily_estimates);
    if (daily === null || daily < 0) {
      toast.error("Estimates per day must be a whole number. 0 means unlimited.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingPolicy(row.plan_id);
    try {
      const { error } = await db
        .from("plan_ad_policy")
        .update({
          show_banner: row.show_banner,
          show_interstitial: row.show_interstitial,
          show_rewarded: row.show_rewarded,
          daily_estimates: daily,
          updated_at: new Date().toISOString(),
        })
        .eq("plan_id", row.plan_id);
      if (error) throw error;
      // Cleared only on success, so a failed save leaves the operator's edit on
      // screen instead of the refetch reverting it under an error toast.
      dirtyPolicies.current.delete(row.plan_id);
      toast.success(`Saved the ad policy for ${planNames[row.plan_id] ?? row.plan_id}`);
      invalidateAdPolicy();
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the ad policy", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingPolicy(null);
    }
  };

  // ------------------------------------------------------------- coupons

  const editCoupon = (row: CouponRow) =>
    setCouponDraft({
      id: row.id,
      code: row.code,
      description: row.description ?? "",
      percent_off: String(row.percent_off),
      plans: (row.applies_to_plans ?? []).join(", "),
      max_redemptions: row.max_redemptions === null ? "" : String(row.max_redemptions),
      per_company_limit: String(row.per_company_limit),
      expires_at: expiryToDay(row.expires_at),
      active: row.active,
      redeemed_count: row.redeemed_count,
    });

  const saveCoupon = async () => {
    if (!couponDraft) return;

    const code = couponDraft.code.trim().toUpperCase();
    if (!code) {
      toast.error("A coupon needs a code.");
      return;
    }

    // Every numeric field is refused rather than defaulted, because the
    // fallback for an unreadable value is never harmless here: a blank discount
    // would save as 0% off, and a blank cap as a coupon nobody can redeem.
    const percent = parseIntField(couponDraft.percent_off);
    if (percent === null || percent < 0 || percent > 100) {
      toast.error("The discount must be a whole number between 0 and 100.");
      return;
    }

    const plans = couponDraft.plans
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const maxText = couponDraft.max_redemptions.trim();
    const maxRedemptions = maxText === "" ? null : parseIntField(maxText);
    if (maxText !== "" && (maxRedemptions === null || maxRedemptions < 0)) {
      toast.error("Total uses must be a whole number, or blank for unlimited.");
      return;
    }

    const perCompany = parseIntField(couponDraft.per_company_limit);
    if (perCompany === null || perCompany < 0) {
      toast.error("Uses per merchant must be a whole number. 0 means no limit.");
      return;
    }

    const expiresAt = dayToExpiry(couponDraft.expires_at);
    if (expiresAt === undefined) {
      toast.error("That expiry date could not be read. Pick one, or clear the field.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingCoupon(true);
    try {
      const payload = {
        // Stored upper-case to match the unique index on upper(code), so two
        // codes cannot differ by capitalisation alone.
        code,
        description: couponDraft.description.trim() || null,
        percent_off: percent,
        // NULL rather than an empty array: the validator reads NULL as "every
        // plan", while an empty array would match no plan at all.
        applies_to_plans: plans.length > 0 ? plans : null,
        max_redemptions: maxRedemptions,
        per_company_limit: perCompany,
        expires_at: expiresAt,
        active: couponDraft.active,
      };

      const { error } = couponDraft.id
        ? await db.from("coupons").update(payload).eq("id", couponDraft.id)
        : await db.from("coupons").insert(payload);
      if (error) throw error;

      toast.success(`Saved ${code}`);
      setCouponDraft(null);
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the coupon", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingCoupon(false);
    }
  };

  const removeCoupon = (row: CouponRow) =>
    setPending({
      title: `Delete ${row.code}?`,
      // coupon_redemptions cascades from this row, so a used coupon takes its
      // own history with it. Turning it off keeps both the record and the code.
      body:
        row.redeemed_count > 0
          ? `${row.code} has been redeemed ${row.redeemed_count} time(s) and deleting it removes those redemption records too. Switching it off instead keeps the history and stops new use.`
          : "Merchants who type this code will be told it does not exist.",
      run: async () => {
        try {
          const { error } = await db.from("coupons").delete().eq("id", row.id);
          if (error) throw error;
          toast.success(`Deleted ${row.code}`);
          await refresh(true);
        } catch (err: any) {
          toast.error("Could not delete the coupon", { description: describeError(err) });
        }
      },
    });

  // -------------------------------------------------------------- offers

  const editOffer = (row: OfferRow) =>
    setOfferDraft({
      id: row.id,
      label: row.label,
      kind: offerKindOf(row.kind),
      amount: String(row.amount ?? 5),
      plan_id: row.plan_id ?? "",
      days: String(row.days ?? 3),
      points_cost: String(row.points_cost),
      active: row.active,
      sort_order: String(row.sort_order),
    });

  const saveOffer = async () => {
    if (!offerDraft) return;

    const label = offerDraft.label.trim();
    if (!label) {
      toast.error("An offer needs a label — it is what the merchant reads.");
      return;
    }

    const kind = offerDraft.kind;
    const planDays = kind === "plan_days";
    const planId = offerDraft.plan_id.trim();

    // `reward_offers_shape_check` enforces all of this. Catching it here names
    // the field that is wrong instead of surfacing a constraint name.
    if (planDays && !planId) {
      toast.error("A plan-days offer needs a plan id.");
      return;
    }

    const days = parseIntField(offerDraft.days);
    if (planDays && (days === null || days < 1)) {
      toast.error("A plan-days offer must grant at least one day.");
      return;
    }

    const amount = parseIntField(offerDraft.amount);
    if (!planDays && (amount === null || amount < 1)) {
      toast.error(`Set ${OFFER_KIND_COPY[kind].unit.toLowerCase()} to at least 1.`);
      return;
    }

    const cost = parseIntField(offerDraft.points_cost);
    if (cost === null || cost < 1) {
      // Worded around the label rather than through it: pointsLabel is whatever
      // the operator typed and is plural by default, so "at least one Coins".
      toast.error("An offer has to cost something. Set the cost above zero.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingOffer(true);
    try {
      // The columns the chosen kind does not use are written as NULL / 0 rather
      // than left at whatever the form last held. An estimate offer carrying a
      // stale plan_id would satisfy the CHECK and then print "Growth" on the
      // card for something that grants no plan at all.
      const payload = {
        label,
        kind,
        amount: planDays ? 0 : amount,
        plan_id: planDays ? planId : null,
        days: planDays ? days : null,
        points_cost: cost,
        active: offerDraft.active,
        sort_order: parseIntField(offerDraft.sort_order) ?? 0,
      };

      const { error } = offerDraft.id
        ? await db.from("reward_offers").update(payload).eq("id", offerDraft.id)
        : await db.from("reward_offers").insert(payload);
      if (error) throw error;

      toast.success(`Saved ${label}`);
      setOfferDraft(null);
      await refresh(true);
    } catch (err: any) {
      toast.error("Could not save the offer", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingOffer(false);
    }
  };

  const removeOffer = (row: OfferRow) =>
    setPending({
      title: `Delete "${row.label}"?`,
      // reward_redemptions.offer_id is ON DELETE SET NULL, so what merchants
      // already bought is untouched.
      body: "Merchants keep everything they already redeemed with it. It simply stops being offered.",
      run: async () => {
        try {
          const { error } = await db.from("reward_offers").delete().eq("id", row.id);
          if (error) throw error;
          toast.success(`Deleted ${row.label}`);
          await refresh(true);
        } catch (err: any) {
          toast.error("Could not delete the offer", { description: describeError(err) });
        }
      },
    });

  const runPending = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setPendingBusy(true);
    try {
      await pending.run();
    } catch (err) {
      // run() reports its own failures. This is only here so an unexpected
      // throw cannot escape an onClick as an unhandled rejection.
      console.warn("[rewards-admin] delete failed:", err);
    } finally {
      inFlight.current = false;
      setPendingBusy(false);
      // Closed either way: the list has been refetched, and leaving the dialog
      // open over a failed delete invites a second attempt at the same row.
      setPending(null);
    }
  };

  const knownPlanIds = Object.keys(planNames);

  // The "that is N ads" hint under the cost field, from the unsaved economy
  // above it, so the operator can price an offer before committing either.
  const perAdForHint = Math.max(
    1,
    parseIntField(rewards.pointsPerAd) ?? DEFAULT_REWARDS.pointsPerAd,
  );
  const adsForOffer = offerDraft
    ? Math.ceil(Math.max(1, parseIntField(offerDraft.points_cost) ?? 1) / perAdForHint)
    : 0;

  // What an estimates offer will cost the merchant's wallet. Read from the
  // unsaved credit form above, for the same reason `adsForOffer` reads the
  // unsaved economy: the operator is pricing both at once.
  const creditsForOffer =
    Math.max(0, parseIntField(offerDraft?.amount ?? "") ?? 0) *
    Math.max(1, parseIntField(creditForm.adsPerEstimate) ?? DEFAULT_CREDIT_CONFIG.adsPerEstimate);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading rewards settings…
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-semibold">Could not read the rewards settings</p>
            <p className="mt-1 text-muted-foreground">
              The request never completed, so nothing here would be the live
              configuration. The form stays hidden rather than showing defaults
              that could be saved over the real values.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void refresh()}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (missing) {
    // Report what is ACTUALLY in force rather than only what is absent. The
    // effective behaviour here is not "nothing" - rewards are off and saving is
    // ungated, which is a real configuration an operator needs to know about,
    // and the difference between a broken page and a read-only one.
    const effective: Array<[string, string]> = [
      ["Rewarded ads", "Off - no points can be earned"],
      ["Save gate", "Off - every estimate saves, no ad"],
      ["Banner and interstitial ads", "Free tier only, as built into the app"],
      ["Coupons", "Unavailable - codes report themselves as not available"],
      ["Points wallet", "Hidden - the Earn entry does not appear"],
    ];

    return (
      <div className="space-y-4">
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Monetization is read-only until the database is migrated
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                The app is running with the safe defaults below. Nothing is
                broken - rewards simply fail closed, which is deliberate: an Earn
                screen that cannot credit anything would have merchants watching
                ads for nothing.
              </p>
              <p className="mt-2 text-amber-800 dark:text-amber-300">
                To make these editable, apply{" "}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                  supabase/migrations/20260821000000_monetization.sql
                </code>{" "}
                and{" "}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                  20260822000000_coupon_seed.sql
                </code>{" "}
                to whichever database this app points at, then reload.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="mb-3 font-semibold">What is in force right now</h3>
            <div className="divide-y divide-border">
              {effective.map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Once migrated, the defaults become {DEFAULT_REWARDS.pointsPerAd}{" "}
              {DEFAULT_REWARDS.pointsLabel} per ad, a cap of{" "}
              {DEFAULT_REWARDS.dailyAdCap} ads per day, and{" "}
              {DEFAULT_CREDIT_FORM.adsPerEstimate} ads per estimate.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Rewards economy ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Rewards economy</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            What a watched ad is worth. The server-side verification callback reads
            these values, so a change applies to the very next ad — no release.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="rw-enabled" className="cursor-pointer text-sm">
                Rewards are live
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Off means the callback credits nothing. Merchants can still spend
                what they already hold.
              </p>
            </div>
            <Switch
              id="rw-enabled"
              checked={rewards.enabled}
              onCheckedChange={(v) => setRewards({ ...rewards, enabled: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rw-per-ad">{pointsLabel} per ad</Label>
              <Input
                id="rw-per-ad"
                type="number"
                inputMode="numeric"
                min={1}
                value={rewards.pointsPerAd}
                onChange={(e) => setRewards({ ...rewards, pointsPerAd: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Granted per verified impression. What the ad itself reports is
                ignored, so a tampered client buys nothing.
              </p>
            </div>

            <div>
              <Label htmlFor="rw-cap">Ads per day, per merchant</Label>
              <Input
                id="rw-cap"
                type="number"
                inputMode="numeric"
                min={0}
                value={rewards.dailyAdCap}
                onChange={(e) => setRewards({ ...rewards, dailyAdCap: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Counted per UTC day. 0 removes the cap entirely.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="rw-label">What to call a point</Label>
              <Input
                id="rw-label"
                value={rewards.pointsLabel}
                onChange={(e) => setRewards({ ...rewards, pointsLabel: e.target.value })}
                placeholder="Coins"
                // It is rendered inline in tight places on the Earn screen, so a
                // long one wraps a button rather than being merely odd.
                maxLength={24}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used everywhere the merchant sees a balance.
              </p>
            </div>
          </div>

          <Button onClick={saveRewards} disabled={savingRewards}>
            {savingRewards ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save economy
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Ads ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Ads</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="ad-enabled" className="cursor-pointer text-sm">
                Ads are on
              </Label>
              <Switch
                id="ad-enabled"
                checked={ads.enabled}
                onCheckedChange={(v) => setAds({ ...ads, enabled: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="ad-prompt" className="cursor-pointer text-sm">
                Ask before a rewarded ad
              </Label>
              <Switch
                id="ad-prompt"
                checked={ads.rewardedPrompt}
                onCheckedChange={(v) => setAds({ ...ads, rewardedPrompt: v })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This governs ads shown AT a merchant &mdash; banners and interstitials.
            What an estimate costs in rewarded ads is set separately, below.
          </p>

          <Button onClick={saveAds} disabled={savingAds}>
            {savingAds ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save ad settings
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Estimate credits ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Estimate credits</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            What an estimate costs on a plan that does not include them outright.
            One finished rewarded ad buys one credit; credits never expire. Which
            plans pay is NOT set here &mdash; it follows &ldquo;Unlocks estimates&rdquo;
            on the Plans tab, so Pro and Estimate Generator create freely while
            Free and Growth pay in ads.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="credits-enabled" className="cursor-pointer text-sm">
              Estimates cost credits
            </Label>
            <Switch
              id="credits-enabled"
              checked={creditForm.enabled}
              onCheckedChange={(v) => setCreditForm({ ...creditForm, enabled: v })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="credits-per-estimate" className="text-sm">
                Ads to create an estimate
              </Label>
              <Input
                id="credits-per-estimate"
                inputMode="numeric"
                value={creditForm.adsPerEstimate}
                onChange={(e) => setCreditForm({ ...creditForm, adsPerEstimate: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="credits-per-edit" className="text-sm">
                Ads to edit one
              </Label>
              <Input
                id="credits-per-edit"
                inputMode="numeric"
                value={creditForm.adsPerEdit}
                onChange={(e) => setCreditForm({ ...creditForm, adsPerEdit: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Never leave this at 0. A free edit turns one credited estimate into an
                unlimited one &mdash; save a blank, then re-edit it into every job.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="credits-welcome" className="text-sm">
                Welcome credits, once per account
              </Label>
              <Input
                id="credits-welcome"
                inputMode="numeric"
                value={creditForm.welcomeCredits}
                onChange={(e) => setCreditForm({ ...creditForm, welcomeCredits: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Granted the first time a merchant opens Estimates, so nobody meets a
                wall on their first visit. Raising it later does NOT top up accounts
                that already took the grant.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="credits-limit" className="text-sm">
                  Ad limit
                </Label>
                <Input
                  id="credits-limit"
                  inputMode="numeric"
                  value={creditForm.watchLimit}
                  onChange={(e) => setCreditForm({ ...creditForm, watchLimit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="credits-window" className="text-sm">
                  per (hours)
                </Label>
                <Input
                  id="credits-window"
                  inputMode="numeric"
                  value={creditForm.watchWindowHours}
                  onChange={(e) =>
                    setCreditForm({ ...creditForm, watchWindowHours: e.target.value })
                  }
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                A rolling window, not a fixed bucket: a slot frees up{" "}
                {creditForm.watchWindowHours} hours after the ad that filled it, not at
                a clock boundary.
              </p>
            </div>
          </div>

          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Making an estimate cost ads is the pattern Google Play&rsquo;s Ads policy
            treats as interfering with app functionality. If a review is ever rejected
            on it, turn &ldquo;Estimates cost credits&rdquo; off here: it takes effect on
            every installed copy immediately, with no release and no review. Balances
            already banked are untouched and spend again the moment it is switched
            back on.
          </p>

          <Button onClick={saveCredits} disabled={savingCredits}>
            {savingCredits ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save estimate credits
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Per-plan ad policy ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">What each plan sees</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            A plan with no row here gets no quota and no gate: its merchants save
            freely and see whatever the global ad settings allow.
          </p>

          {policies.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No plan has an ad policy yet. The migration seeds one per plan, so
              an empty table means the seed was skipped or the rows were removed.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-center">Banner</TableHead>
                  <TableHead className="text-center">Interstitial</TableHead>
                  <TableHead className="text-center">Rewarded</TableHead>
                  <TableHead>Estimates/day</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((row) => {
                  const update = (patch: Partial<PolicyDraft>) => {
                    dirtyPolicies.current.add(row.plan_id);
                    setPolicies((list) =>
                      list.map((p) => (p.plan_id === row.plan_id ? { ...p, ...patch } : p)),
                    );
                  };

                  return (
                    <TableRow key={row.plan_id}>
                      <TableCell>
                        <div className="font-medium">{planNames[row.plan_id] ?? row.plan_id}</div>
                        <code className="font-mono text-xs text-muted-foreground">
                          {row.plan_id}
                        </code>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={row.show_banner}
                          onCheckedChange={(v) => update({ show_banner: v })}
                          aria-label={`Banner ads for ${row.plan_id}`}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={row.show_interstitial}
                          onCheckedChange={(v) => update({ show_interstitial: v })}
                          aria-label={`Interstitial ads for ${row.plan_id}`}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={row.show_rewarded}
                          onCheckedChange={(v) => update({ show_rewarded: v })}
                          aria-label={`Rewarded ads for ${row.plan_id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="w-20"
                          value={row.daily_estimates}
                          onChange={(e) => update({ daily_estimates: e.target.value })}
                          aria-label={`Estimates per day for ${row.plan_id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => savePolicy(row)}
                          // Every row is disabled while any row is saving: the
                          // in-flight lock would swallow a second click without
                          // saving anything, which looks like a dead button.
                          disabled={savingPolicy !== null}
                          aria-label={`Save the ad policy for ${planNames[row.plan_id] ?? row.plan_id}`}
                        >
                          {savingPolicy === row.plan_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            0 estimates per day means unlimited. Each row saves on its own.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- Coupons ---------------- */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Coupons</h2>
        <Button size="sm" onClick={() => setCouponDraft({ ...BLANK_COUPON })}>
          <Plus className="mr-2 h-4 w-4" /> New coupon
        </Button>
      </div>

      {coupons.length === 0 && !couponDraft && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No coupons yet. A code discounts the checkout price by a percentage.
        </p>
      )}

      <div className="grid gap-3">
        {coupons.map((row) => (
          <Card key={row.id} className={row.active ? "" : "opacity-60"}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold">
                    {row.code}
                  </code>
                  <Badge variant="secondary">{row.percent_off}% off</Badge>
                  {!row.active && <Badge variant="outline">Off</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.description || "No description"} · used {row.redeemed_count}
                  {row.max_redemptions === null ? "" : ` of ${row.max_redemptions}`} · expires{" "}
                  {formatDay(row.expires_at)}
                  {row.applies_to_plans?.length
                    ? ` · ${row.applies_to_plans.join(", ")} only`
                    : " · any plan"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => editCoupon(row)}
                  aria-label={`Edit coupon ${row.code}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeCoupon(row)}
                  aria-label={`Delete coupon ${row.code}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {couponDraft && (
        <Card className="border-primary/40">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {couponDraft.id ? "Edit coupon" : "New coupon"}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCouponDraft(null)}
                disabled={savingCoupon}
                aria-label="Close the coupon editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cp-code">Code</Label>
                <Input
                  id="cp-code"
                  value={couponDraft.code}
                  onChange={(e) => setCouponDraft({ ...couponDraft, code: e.target.value })}
                  placeholder="DIWALI50"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved upper-case. Merchants can type it however they like.
                </p>
              </div>

              <div>
                <Label htmlFor="cp-percent">Discount (%)</Label>
                <Input
                  id="cp-percent"
                  type="number"
                  min={0}
                  max={100}
                  value={couponDraft.percent_off}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, percent_off: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  100 leaves nothing to charge, so checkout grants the plan outright
                  rather than sending Razorpay an order it would reject.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="cp-desc">Description</Label>
                <Input
                  id="cp-desc"
                  value={couponDraft.description}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, description: e.target.value })
                  }
                  placeholder="Diwali offer"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shown to the merchant when the code is accepted.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="cp-plans">Valid for plans</Label>
                <Input
                  id="cp-plans"
                  value={couponDraft.plans}
                  onChange={(e) => setCouponDraft({ ...couponDraft, plans: e.target.value })}
                  placeholder="growth, pro"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Plan ids separated by commas. Leave blank for every plan.
                  {knownPlanIds.length > 0 && ` Known ids: ${knownPlanIds.join(", ")}.`}
                </p>
              </div>

              <div>
                <Label htmlFor="cp-max">Total uses</Label>
                <Input
                  id="cp-max"
                  type="number"
                  min={0}
                  value={couponDraft.max_redemptions}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, max_redemptions: e.target.value })
                  }
                  placeholder="Unlimited"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Blank means unlimited. Used {couponDraft.redeemed_count} time(s) so
                  far.
                </p>
              </div>

              <div>
                <Label htmlFor="cp-per-company">Uses per merchant</Label>
                <Input
                  id="cp-per-company"
                  type="number"
                  min={0}
                  value={couponDraft.per_company_limit}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, per_company_limit: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">0 means no limit.</p>
              </div>

              <div>
                <Label htmlFor="cp-expires">Expires</Label>
                <Input
                  id="cp-expires"
                  type="date"
                  value={couponDraft.expires_at}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, expires_at: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Valid to the end of that day. Blank never expires.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="cp-active" className="cursor-pointer text-sm">
                  Accepting this code
                </Label>
                <Switch
                  id="cp-active"
                  checked={couponDraft.active}
                  onCheckedChange={(v) => setCouponDraft({ ...couponDraft, active: v })}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveCoupon} disabled={savingCoupon}>
                {savingCoupon ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Save coupon
              </Button>
              <Button
                variant="outline"
                onClick={() => setCouponDraft(null)}
                disabled={savingCoupon}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Reward offers ---------------- */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">What {pointsLabel.toLowerCase()} buy</h2>
        <Button size="sm" onClick={() => setOfferDraft({ ...BLANK_OFFER })}>
          <Plus className="mr-2 h-4 w-4" /> New offer
        </Button>
      </div>

      {offers.length === 0 && !offerDraft && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nothing to redeem yet. Without an offer, {pointsLabel.toLowerCase()} pile up
          and cannot be spent.
        </p>
      )}

      <div className="grid gap-3">
        {offers.map((row) => (
          <Card key={row.id} className={row.active ? "" : "opacity-60"}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Gift className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-semibold">{row.label}</span>
                  {!row.active && <Badge variant="outline">Hidden</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.points_cost} {pointsLabel} · {describeOfferRow(row, planNames)} · order{" "}
                  {row.sort_order}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => editOffer(row)}
                  aria-label={`Edit the offer ${row.label}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeOffer(row)}
                  aria-label={`Delete the offer ${row.label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {offerDraft && (
        <Card className="border-primary/40">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{offerDraft.id ? "Edit offer" : "New offer"}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOfferDraft(null)}
                disabled={savingOffer}
                aria-label="Close the offer editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="of-label">Label</Label>
                <Input
                  id="of-label"
                  value={offerDraft.label}
                  onChange={(e) => setOfferDraft({ ...offerDraft, label: e.target.value })}
                  placeholder="5 estimates"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  The merchant reads this on the Earn screen and on their ledger.
                </p>
              </div>

              <div>
                <Label htmlFor="of-kind">What it gives</Label>
                <Select
                  value={offerDraft.kind}
                  onValueChange={(v) =>
                    setOfferDraft({ ...offerDraft, kind: offerKindOf(v) })
                  }
                >
                  <SelectTrigger id="of-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estimate_credits">
                      {OFFER_KIND_COPY.estimate_credits.title}
                    </SelectItem>
                    <SelectItem value="product_slots">
                      {OFFER_KIND_COPY.product_slots.title}
                    </SelectItem>
                    <SelectItem value="plan_days">{OFFER_KIND_COPY.plan_days.title}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {OFFER_KIND_COPY[offerDraft.kind].hint}
                </p>
              </div>

              {offerDraft.kind === "plan_days" ? (
                <>
                  <div>
                    <Label htmlFor="of-plan">Plan id</Label>
                    <Input
                      id="of-plan"
                      value={offerDraft.plan_id}
                      onChange={(e) => setOfferDraft({ ...offerDraft, plan_id: e.target.value })}
                      placeholder="growth"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {knownPlanIds.length > 0
                        ? `Known ids: ${knownPlanIds.join(", ")}.`
                        : "Must match a plan id exactly."}
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="of-days">Days granted</Label>
                    <Input
                      id="of-days"
                      type="number"
                      min={1}
                      value={offerDraft.days}
                      onChange={(e) => setOfferDraft({ ...offerDraft, days: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Added to whatever time the merchant already has, never replacing it.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <Label htmlFor="of-amount">{OFFER_KIND_COPY[offerDraft.kind].unit}</Label>
                  <Input
                    id="of-amount"
                    type="number"
                    min={1}
                    value={offerDraft.amount}
                    onChange={(e) => setOfferDraft({ ...offerDraft, amount: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {offerDraft.kind === "estimate_credits"
                      ? `Costs ${creditsForOffer} credit${creditsForOffer === 1 ? "" : "s"} in the wallet at today's ${creditForm.adsPerEstimate} ads per estimate — frozen into the grant when it is bought.`
                      : "Added on top of the plan's limit, and kept if the plan lapses."}
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="of-cost">Cost in {pointsLabel.toLowerCase()}</Label>
                <Input
                  id="of-cost"
                  type="number"
                  min={1}
                  value={offerDraft.points_cost}
                  onChange={(e) =>
                    setOfferDraft({ ...offerDraft, points_cost: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  At {perAdForHint} per ad, that is {adsForOffer} ad
                  {adsForOffer === 1 ? "" : "s"}.
                </p>
              </div>

              <div>
                <Label htmlFor="of-sort">Display order</Label>
                <Input
                  id="of-sort"
                  type="number"
                  value={offerDraft.sort_order}
                  onChange={(e) =>
                    setOfferDraft({ ...offerDraft, sort_order: e.target.value })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="of-active" className="cursor-pointer text-sm">
                  Offered to merchants
                </Label>
                <Switch
                  id="of-active"
                  checked={offerDraft.active}
                  onCheckedChange={(v) => setOfferDraft({ ...offerDraft, active: v })}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveOffer} disabled={savingOffer}>
                {savingOffer ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Save offer
              </Button>
              <Button
                variant="outline"
                onClick={() => setOfferDraft(null)}
                disabled={savingOffer}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pending !== null}
        // Escape and the overlay dismiss it, but not while the delete is in
        // flight — closing then would leave the list showing a row that is
        // already gone.
        onOpenChange={(open) => {
          if (!open && !pendingBusy) setPending(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingBusy} onClick={() => setPending(null)}>
              Keep it
            </AlertDialogCancel>
            <Button variant="destructive" onClick={runPending} disabled={pendingBusy}>
              {pendingBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RewardsAdmin;
