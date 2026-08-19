/**
 * Durable key/value storage.
 *
 * On Android this is SharedPreferences via @capacitor/preferences, which
 * survives the WebView clearing its storage quota — unlike localStorage, which
 * Android may evict under memory pressure and would silently sign the user out
 * and drop their offline estimates.
 *
 * On web it transparently falls back to localStorage so the same code runs in
 * the browser build.
 */

import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform";

/** Last-resort store when both native prefs and localStorage are unavailable. */
const memory = new Map<string, string>();

export const PREF_KEYS = {
  /** Supabase auth session (see supabaseStorageAdapter). */
  authPrefix: "sb_auth_",
  /** Cached plan/expiry so entitlement is known offline. */
  entitlement: "cs_entitlement",
  /** Monotonic local counter for offline estimate numbering. */
  invoiceSeq: "cs_invoice_seq",
  /** Stable 3-char device tag that keeps offline numbers collision-free. */
  deviceSuffix: "cs_device_suffix",
  /** Epoch ms of the last successful sync. */
  lastSync: "cs_last_sync",
  /** Interstitial ad frequency-cap state. */
  adState: "cs_ad_state",
  /** Whether the user has been through onboarding. */
  onboarded: "cs_onboarded",
  /** "1" when the biometric app lock is armed (see @/native/biometrics). */
  appLock: "cs_app_lock",
} as const;

export async function prefGet(key: string): Promise<string | null> {
  try {
    if (isNative) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function prefSet(key: string, value: string): Promise<void> {
  memory.set(key, value);
  try {
    if (isNative) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  } catch (err) {
    console.warn("[prefs] write failed, kept in memory:", key, err);
  }
}

export async function prefRemove(key: string): Promise<void> {
  memory.delete(key);
  try {
    if (isNative) {
      await Preferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* already gone */
  }
}

export async function prefGetJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await prefGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function prefSetJSON(key: string, value: unknown): Promise<void> {
  await prefSet(key, JSON.stringify(value));
}

/**
 * A stable per-install tag used to namespace offline estimate numbers
 * (`EST-K3F-0007`) so two devices on the same account cannot mint the same
 * number while both are offline.
 */
export async function getDeviceSuffix(): Promise<string> {
  const existing = await prefGet(PREF_KEYS.deviceSuffix);
  if (existing) return existing;

  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map((b) => b.toString(36).toUpperCase())
    .join("")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");

  await prefSet(PREF_KEYS.deviceSuffix, suffix);
  return suffix;
}

/**
 * Storage adapter handed to supabase-js.
 *
 * supabase-js expects a synchronous-looking API but tolerates promises, which
 * is exactly what the native bridge gives us. A synchronous mirror is kept so
 * the very first read after a cold start is not a race.
 */
const authMirror = new Map<string, string>();

export const supabaseStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (authMirror.has(key)) return authMirror.get(key)!;
    const value = await prefGet(PREF_KEYS.authPrefix + key);
    if (value !== null) authMirror.set(key, value);
    return value;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    authMirror.set(key, value);
    await prefSet(PREF_KEYS.authPrefix + key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    authMirror.delete(key);
    await prefRemove(PREF_KEYS.authPrefix + key);
  },
};

/**
 * Wipe every app-owned preference. Called on sign-out so the next account on
 * this device cannot inherit the previous one's plan or estimate counter.
 * The auth keys are cleared by supabase-js itself.
 */
export async function clearAppPrefs(): Promise<void> {
  authMirror.clear();
  await Promise.all([
    prefRemove(PREF_KEYS.entitlement),
    prefRemove(PREF_KEYS.invoiceSeq),
    prefRemove(PREF_KEYS.lastSync),
    prefRemove(PREF_KEYS.adState),
    // The app lock goes with the account that armed it. An explicit sign-out
    // has already wiped the data it guarded, so leaving it on would only meet
    // the next person with a prompt their finger cannot pass.
    prefRemove(PREF_KEYS.appLock),
  ]);
}
