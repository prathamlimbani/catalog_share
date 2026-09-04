/**
 * Estimate credits — the ad-funded replacement for the 5-day free trial.
 *
 * The old model gave every new account five days of unlimited estimates and
 * then a hard paywall. Two things were wrong with it: the wall arrived at a
 * moment the merchant had no reason to expect, and a merchant who only writes
 * three estimates a month never saw the feature at all before it locked.
 *
 * The model here is a wallet instead of a clock. One watched rewarded ad buys
 * one CREDIT; creating an estimate costs `adsPerEstimate` credits (2) and
 * editing one costs `adsPerEdit` (1). Nothing expires, nothing counts down on
 * its own, and the merchant can always see exactly what they have and exactly
 * what the next estimate costs.
 *
 * Editing costs something on purpose. With a free edit, one credited estimate
 * is an unlimited estimate: save a blank one, then re-edit it into every job
 * for the rest of the month. A cheaper-than-create edit keeps the honest case
 * (a typo, a changed quantity) cheap without leaving that door open.
 *
 * WHICH PLANS PAY
 * Not decided here. `entitlement.estimatesFree` answers that, and it is driven
 * by `plans.unlocks_estimates` in the database — Pro, Estimate Generator and
 * Support are free; Free and Growth are ad-funded. That means moving a plan
 * from one side to the other is a row edit in the admin console, not a release.
 *
 * WHERE THE BALANCE LIVES
 * On the device, in native Preferences (SharedPreferences on Android), per
 * company. Deliberately not on the server, for one reason that matters more
 * than the others: estimates are offline-first, and a credit that could only be
 * spent with a connection would break the shop-floor case the whole feature
 * exists for.
 *
 * The obvious objection is that the device can lie. It can — but note which
 * way. Clearing app data DESTROYS credits, it never mints them, so the trial's
 * old "reinstall for another five days" exploit has no analogue here. What
 * remains is a patched build fabricating a balance, which is already true of
 * every client-side check in this app and is bounded by the fact that credits
 * buy nothing but estimates. Points, which are worth actual money, stay exactly
 * where they were: granted only by the AdMob server-side callback.
 */

import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/native/platform";
import { prefGetJSON, prefSetJSON } from "@/native/prefs";
import { claimCreditGrant, fetchPendingCreditGrants } from "@/lib/rewards";

/**
 * `app_settings` is newer than the checked-in generated types, so the typed
 * client refuses the table name. Same approach the rest of the settings layer
 * takes: describe the shape actually used and cast once.
 */
interface LooseFrom {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

// ---------------------------------------------------------------- config

export interface CreditConfig {
  /**
   * Master switch. False means nobody pays for estimates — the kill switch to
   * reach for if Google Play ever objects to the gate, since it takes effect on
   * every installed copy without a release.
   */
  enabled: boolean;
  /** Ads to watch for one estimate. */
  adsPerEstimate: number;
  /** Ads to watch to edit an estimate that already exists. */
  adsPerEdit: number;
  /** One-time grant on a first visit, so nobody starts at a wall. */
  welcomeCredits: number;
  /** Most ads that may be watched inside `watchWindowHours`. */
  watchLimit: number;
  /** Length of the rolling window the limit applies over. */
  watchWindowHours: number;
}

/**
 * What ships, and what applies when the settings row cannot be read.
 *
 * `enabled: true` with a welcome grant is the honest failure mode: a config
 * outage must not hand out unlimited estimates, but it must not meet a
 * first-time user with a wall either.
 */
export const DEFAULT_CREDIT_CONFIG: CreditConfig = {
  enabled: true,
  adsPerEstimate: 2,
  adsPerEdit: 1,
  // One estimate, free, once. Enough to see what the feature does before being
  // asked to pay attention for it.
  welcomeCredits: 2,
  watchLimit: 20,
  watchWindowHours: 6,
};

let current: CreditConfig = { ...DEFAULT_CREDIT_CONFIG };

type ConfigListener = () => void;
const configListeners = new Set<ConfigListener>();

export function onCreditConfigChange(fn: ConfigListener): () => void {
  configListeners.add(fn);
  return () => configListeners.delete(fn);
}

/** The terms as last loaded. Synchronous, for render paths. */
export function creditConfig(): CreditConfig {
  return current;
}

/**
 * A value that must be a positive count, or the shipped fallback.
 *
 * Zero is rejected rather than clamped for the same reason the trial config
 * rejected it: an `ads_per_estimate` of 0 typed into the console would silently
 * make the whole economy free, and a 0 in `watch_limit` would lock every
 * merchant out of earning at all.
 */
function positiveOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Same, but zero is a legitimate answer (a welcome grant of nothing). */
function countOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function coerce(raw: unknown): CreditConfig {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_CREDIT_CONFIG.enabled,
    adsPerEstimate: positiveOr(v.ads_per_estimate, DEFAULT_CREDIT_CONFIG.adsPerEstimate),
    adsPerEdit: positiveOr(v.ads_per_edit, DEFAULT_CREDIT_CONFIG.adsPerEdit),
    welcomeCredits: countOr(v.welcome_credits, DEFAULT_CREDIT_CONFIG.welcomeCredits),
    watchLimit: positiveOr(v.watch_limit, DEFAULT_CREDIT_CONFIG.watchLimit),
    watchWindowHours: positiveOr(v.watch_window_hours, DEFAULT_CREDIT_CONFIG.watchWindowHours),
  };
}

/** Install a config. Ignores nothing-shaped input rather than blanking the terms. */
export function applyCreditConfig(raw: unknown): void {
  if (raw === null || raw === undefined) return;
  const next = coerce(raw);
  const changed = (Object.keys(next) as (keyof CreditConfig)[]).some((k) => next[k] !== current[k]);
  current = next;
  if (!changed) return;
  configListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the credit ledger */
    }
  });
}

let loaded = false;

/**
 * Fetch the terms once per session.
 *
 * `force` is for the admin console and the focus refetch, which must see an
 * edit reflected without a reload.
 */
export async function loadCreditConfig(force = false): Promise<CreditConfig> {
  if (loaded && !force) return current;
  loaded = true;
  try {
    const { data, error } = await (supabase as unknown as LooseFrom)
      .from("app_settings")
      .select("value")
      .eq("key", "estimate_credits")
      .maybeSingle();
    if (error) throw error;
    applyCreditConfig((data as { value?: unknown } | null)?.value);
  } catch (err) {
    console.warn("[credits] terms unavailable, using the built-in defaults:", err);
  }
  return current;
}

// ----------------------------------------------------------------- state

export type CreditAction = "create" | "edit";

/** What one wallet holds. Persisted verbatim. */
export interface CreditState {
  /** Credits in hand. One watched ad = one credit. */
  balance: number;
  /** Whether the one-time welcome grant has been given. */
  welcomed: boolean;
  /** Epoch ms of every ad watched inside the rolling window. */
  watches: number[];
  /** Lifetime totals, for the summary line on the Estimates screen. */
  watchedTotal: number;
  spentTotal: number;
  /**
   * `reward_redemptions` ids already banked into `balance` on this device.
   *
   * The server marks a grant applied too, and that is what stops a reinstall
   * claiming the same purchase twice. This list is the other half: it is
   * written in the SAME persisted record as the balance it paid for, so a
   * stamp that never reached the server cannot make this device double-credit
   * itself on the next launch.
   */
  grants: string[];
}

const EMPTY_STATE: CreditState = {
  balance: 0,
  welcomed: false,
  watches: [],
  watchedTotal: 0,
  spentTotal: 0,
  grants: [],
};

const stateKey = (companyId: string) => `cs_estimate_credits_${companyId}`;

/**
 * In-memory mirror of what is on disk.
 *
 * Preferences is async, and the gate has to answer "can this save go ahead"
 * inside a tap handler. Every write goes through `save()`, which updates this
 * first and persists after, so a read never races a write that has already
 * logically happened.
 */
const mirror = new Map<string, CreditState>();

type CreditListener = () => void;
const creditListeners = new Set<CreditListener>();

/** Subscribe to balance changes for any company. Cheap enough not to key it. */
export function onCreditsChange(fn: CreditListener): () => void {
  creditListeners.add(fn);
  return () => creditListeners.delete(fn);
}

function notifyCredits(): void {
  creditListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the credit ledger */
    }
  });
}

/** Drop watch stamps that have fallen out of the window, and any from the future. */
function pruneWatches(watches: number[], now: number, windowMs: number): number[] {
  return watches.filter((t) => Number.isFinite(t) && t <= now + 60_000 && now - t < windowMs);
}

function sanitize(raw: unknown): CreditState {
  const v = (raw ?? {}) as Partial<CreditState>;
  return {
    balance: Math.max(0, Number(v.balance) || 0),
    welcomed: v.welcomed === true,
    watches: Array.isArray(v.watches) ? v.watches.map(Number).filter(Number.isFinite) : [],
    watchedTotal: Math.max(0, Number(v.watchedTotal) || 0),
    spentTotal: Math.max(0, Number(v.spentTotal) || 0),
    // Bounded: a wallet written before grants existed has none, and the list
    // only ever grows by one per purchase.
    grants: Array.isArray(v.grants)
      ? v.grants.map(String).filter((id) => id.length > 0).slice(-500)
      : [],
  };
}

async function load(companyId: string): Promise<CreditState> {
  const cached = mirror.get(companyId);
  if (cached) return cached;
  const stored = sanitize(await prefGetJSON<unknown>(stateKey(companyId), null));
  // Only take the read if nothing landed in the mirror while we were awaiting —
  // a concurrent noteAdWatched must not be overwritten by this slower path.
  const landed = mirror.get(companyId);
  if (landed) return landed;
  mirror.set(companyId, stored);
  return stored;
}

async function save(companyId: string, next: CreditState): Promise<CreditState> {
  mirror.set(companyId, next);
  notifyCredits();
  await prefSetJSON(stateKey(companyId), next);
  return next;
}

/**
 * Forget everything cached in memory. Called on sign-out so the next account on
 * this device does not read the previous balance out of the mirror. The
 * persisted rows are per-company and are left alone: signing back in on the
 * same account must find the credits it earned.
 */
export function resetCreditCache(): void {
  mirror.clear();
  loaded = false;
  notifyCredits();
}

// ------------------------------------------------------------- the rules

/**
 * Whether the gate applies at all right now.
 *
 * NATIVE ONLY, and this is not a detail. A rewarded ad cannot be played in a
 * browser — `showRewarded()` answers `unavailable` there — so charging for
 * estimates on the web build would not be a paywall, it would be a dead end: no
 * ad can ever be watched, so no credit can ever be earned, so no estimate can
 * ever be saved. That would strand a paying Growth subscriber working from a
 * desktop with nothing to click.
 *
 * Every other ad decision in this app draws the same line — `loadAdPolicy`
 * returns NO_ADS off-native — so the web build keeps saving estimates freely,
 * exactly as it did before this feature existed.
 *
 * The trade-off is real and worth stating: the web app is a way to create
 * estimates without watching anything. Closing that means either locking the
 * web build out of estimates or moving the wallet server-side; both are product
 * decisions, not accidents.
 */
export function creditsEnforced(config: CreditConfig = current): boolean {
  return isNative && config.enabled;
}

/** What an action costs, in credits. */
export function costOf(action: CreditAction, config: CreditConfig = current): number {
  return action === "edit" ? config.adsPerEdit : config.adsPerEstimate;
}

/** Whole estimates a balance is worth, for the number the merchant reads. */
export function estimatesFrom(balance: number, config: CreditConfig = current): number {
  const per = Math.max(1, config.adsPerEstimate);
  return Math.floor(Math.max(0, balance) / per);
}

export interface WatchAllowance {
  /** Whether another ad may be watched right now. */
  allowed: boolean;
  /** Ads watched inside the current window. */
  used: number;
  /** Ads still available inside the current window. */
  remaining: number;
  /** Epoch ms at which the next slot frees up. 0 while slots remain. */
  resetsAt: number;
}

/**
 * How much of the rolling watch limit is left.
 *
 * A ROLLING window, not a fixed 6-hour bucket, because a bucket punishes the
 * wrong person: a merchant who watches their 20th ad one minute before the
 * bucket rolls gets 20 more immediately, while one who starts a minute after a
 * roll waits nearly six hours. Rolling means the answer to "when can I watch
 * another" is always the honest one — when the oldest of the 20 ages out.
 */
export function watchAllowance(
  state: CreditState,
  config: CreditConfig = current,
  now: number = Date.now(),
): WatchAllowance {
  const windowMs = Math.max(1, config.watchWindowHours) * 3_600_000;
  const recent = pruneWatches(state.watches, now, windowMs);
  const used = recent.length;
  const remaining = Math.max(0, config.watchLimit - used);
  return {
    allowed: remaining > 0,
    used,
    remaining,
    resetsAt: remaining > 0 ? 0 : Math.min(...recent) + windowMs,
  };
}

/** Everything a screen needs to render the gate, in one read. */
export interface CreditSnapshot {
  /** Credits in hand. */
  balance: number;
  /** Whole estimates that buys. */
  estimates: number;
  /** Credits left over above those whole estimates. */
  spare: number;
  watch: WatchAllowance;
  config: CreditConfig;
  watchedTotal: number;
  spentTotal: number;
}

export function snapshotOf(
  state: CreditState,
  config: CreditConfig = current,
  now: number = Date.now(),
): CreditSnapshot {
  return {
    balance: state.balance,
    estimates: estimatesFrom(state.balance, config),
    spare: state.balance % Math.max(1, config.adsPerEstimate),
    watch: watchAllowance(state, config, now),
    config,
    watchedTotal: state.watchedTotal,
    spentTotal: state.spentTotal,
  };
}

export const EMPTY_SNAPSHOT: CreditSnapshot = snapshotOf(EMPTY_STATE, DEFAULT_CREDIT_CONFIG, 0);

// ------------------------------------------------------------ operations

/**
 * Read the wallet, applying the one-time welcome grant if it is owed.
 *
 * The grant is applied on READ rather than at signup because signup is not the
 * moment it is needed and not a moment this module can hook. Applying it the
 * first time the Estimates screen asks means it reaches accounts that existed
 * before this shipped — including everyone whose trial is being removed out
 * from under them — without a backfill.
 */
export async function readCredits(companyId: string | null | undefined): Promise<CreditState> {
  if (!companyId) return { ...EMPTY_STATE };
  const state = await load(companyId);
  if (state.welcomed) return state;

  const grant = Math.max(0, current.welcomeCredits);
  return save(companyId, {
    ...state,
    welcomed: true,
    balance: state.balance + grant,
  });
}

/** The wallet as it stands, with no side effects. Null-safe for render paths. */
export function peekCredits(companyId: string | null | undefined): CreditState {
  if (!companyId) return { ...EMPTY_STATE };
  return mirror.get(companyId) ?? { ...EMPTY_STATE };
}

/**
 * Record a rewarded ad the merchant actually finished, crediting one estimate
 * credit and consuming one slot of the rolling watch limit.
 *
 * Call this ONLY on `earned: true` from `showRewarded()` — a dismissed ad pays
 * for nothing and must not consume a slot either.
 */
export async function noteAdWatched(companyId: string | null | undefined): Promise<CreditState> {
  if (!companyId) return { ...EMPTY_STATE };
  const state = await load(companyId);
  const now = Date.now();
  const windowMs = Math.max(1, current.watchWindowHours) * 3_600_000;
  return save(companyId, {
    ...state,
    balance: state.balance + 1,
    watches: [...pruneWatches(state.watches, now, windowMs), now],
    watchedTotal: state.watchedTotal + 1,
  });
}

/**
 * Record an ad that was watched for POINTS on the Earn screen.
 *
 * It consumes a slot of the same rolling limit — the limit is on watching ads,
 * not on which pocket the reward lands in — but pays no estimate credit, so the
 * two economies stay separate.
 */
export async function noteAdWatchedForPoints(
  companyId: string | null | undefined,
): Promise<CreditState> {
  if (!companyId) return { ...EMPTY_STATE };
  const state = await load(companyId);
  const now = Date.now();
  const windowMs = Math.max(1, current.watchWindowHours) * 3_600_000;
  return save(companyId, {
    ...state,
    watches: [...pruneWatches(state.watches, now, windowMs), now],
    watchedTotal: state.watchedTotal + 1,
  });
}

/**
 * Spend credits on an action.
 *
 * Returns false and spends nothing when the balance will not cover it, so the
 * caller can never half-charge. Call it AFTER the estimate is safely written,
 * not before: a save that fails must not cost the merchant two ads.
 */
export async function spendCredits(
  companyId: string | null | undefined,
  action: CreditAction,
): Promise<boolean> {
  if (!companyId) return false;
  const cost = costOf(action);
  if (cost <= 0) return true;

  const state = await load(companyId);
  if (state.balance < cost) return false;

  await save(companyId, {
    ...state,
    balance: state.balance - cost,
    spentTotal: state.spentTotal + cost,
  });
  return true;
}

/**
 * Give credits directly — the admin apology path, and the hook a future
 * server-side grant would use. Never called by the ad flow, which goes through
 * `noteAdWatched` so the watch limit sees it.
 */
export async function grantCredits(
  companyId: string | null | undefined,
  amount: number,
): Promise<CreditState> {
  if (!companyId || !Number.isFinite(amount) || amount <= 0) return peekCredits(companyId);
  const state = await load(companyId);
  return save(companyId, { ...state, balance: state.balance + Math.round(amount) });
}

/** What one call to `syncCreditGrants` actually banked. */
export interface GrantSyncResult {
  /** Wallet credits added by this call. 0 when there was nothing new. */
  credited: number;
  /** Estimates those credits are worth, in the unit the merchant was sold. */
  estimates: number;
}

export const NO_GRANTS: GrantSyncResult = { credited: 0, estimates: 0 };

/**
 * Bank estimates bought with points, and tell the server they landed.
 *
 * Points are spent on the SERVER (`redeem_reward_offer`), but the credit wallet
 * lives on the DEVICE, so a purchase cannot be handed over directly. The server
 * writes a `reward_redemptions` row with `applied_at` NULL and this collects
 * it. Called on every Estimates screen open, so a redemption made on the web
 * still reaches the phone, and one made while offline reaches it late rather
 * than never.
 *
 * NATIVE ONLY, for the same reason the whole gate is (`creditsEnforced`): a
 * browser never spends credits, so banking them there would stamp the grant
 * applied and quietly destroy something the merchant paid points for. On the
 * web the row simply stays pending until the phone asks.
 *
 * ORDER MATTERS. Credits are written to the device FIRST and stamped applied
 * after, never the other way round:
 *
 *   - crash between the two -> the grant is still unapplied, and the next call
 *     sees it in `state.grants`, banks nothing, and re-stamps it. Self-healing.
 *   - stamp first, crash second -> the merchant paid 100 points for credits
 *     that no longer exist anywhere, with nothing left to replay.
 *
 * The second is unrecoverable, so the retry loop is built around the first.
 * That is also why the stamp runs over EVERY pending grant rather than only
 * the ones banked just now.
 */
export async function syncCreditGrants(
  companyId: string | null | undefined,
): Promise<GrantSyncResult> {
  if (!companyId || !isNative) return NO_GRANTS;

  const pending = await fetchPendingCreditGrants(companyId);
  if (pending.length === 0) return NO_GRANTS;

  const state = await load(companyId);
  const banked = new Set(state.grants);
  const fresh = pending.filter((g) => !banked.has(g.id));

  let result = NO_GRANTS;
  if (fresh.length > 0) {
    const credited = fresh.reduce((sum, g) => sum + Math.max(0, g.credits), 0);
    const estimates = fresh.reduce((sum, g) => sum + Math.max(0, g.amount), 0);
    // One write: the balance and the receipt for it cannot land separately.
    await save(companyId, {
      ...state,
      balance: state.balance + credited,
      grants: [...state.grants, ...fresh.map((g) => g.id)].slice(-500),
    });
    result = { credited, estimates };
  }

  for (const grant of pending) {
    // Best effort, one at a time. A failure leaves the row pending, which is
    // the state the retry above is written for.
    await claimCreditGrant(grant.id);
  }

  return result;
}

/** Whether an action can go ahead right now without watching anything. */
export function canAfford(state: CreditState, action: CreditAction): boolean {
  return state.balance >= costOf(action);
}

/** How many more ads must be watched before `action` is affordable. */
export function adsStillNeeded(state: CreditState, action: CreditAction): number {
  return Math.max(0, costOf(action) - state.balance);
}

/**
 * "2h 10m" / "14 min", for the moment the watch limit frees up again.
 *
 * Rounded UP to the next whole minute so the countdown never reads "0 min" over
 * a button that is still disabled — a merchant who taps that concludes the app
 * is broken rather than that they are eleven seconds early.
 */
export function formatUntil(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
