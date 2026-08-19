/**
 * Platform detection. Every native-only branch in the app goes through this
 * module — never a user-agent sniff, which breaks on tablets and foldables.
 */

import { Capacitor } from "@capacitor/core";

/** True inside the Android app shell, false in any browser (including mobile web). */
export const isNative = Capacitor.isNativePlatform();

export const isAndroid = Capacitor.getPlatform() === "android";
export const isIOS = Capacitor.getPlatform() === "ios";
export const isWeb = Capacitor.getPlatform() === "web";

/** "android" | "ios" | "web" */
export const platform = Capacitor.getPlatform();

/**
 * Build target. `app` strips the marketing landing page and the master-admin
 * console from the bundle entirely (see vite.config.ts / App.tsx).
 */
export const isAppBuild = import.meta.env.VITE_TARGET === "app";

/** Whether a plugin is actually available before calling into it. */
export function hasPlugin(name: string): boolean {
  try {
    return Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}

/**
 * Run a native call, swallowing failures.
 *
 * Native bridges throw for a long tail of device-specific reasons (missing
 * Play Services, OEM permission quirks). None of them should ever take a
 * screen down, so callers get a fallback value instead of an exception.
 */
export async function safeNative<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!isNative) return fallback;
  try {
    return await fn();
  } catch (err) {
    console.warn("[native] call failed:", err);
    return fallback;
  }
}
