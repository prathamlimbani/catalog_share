/**
 * Connectivity.
 *
 * The whole app reads online/offline state from here so there is exactly one
 * answer at any moment. On native this is @capacitor/network (which reports the
 * real radio state); on web it falls back to navigator.onLine.
 */

import { Network, type ConnectionStatus } from "@capacitor/network";
import { isNative } from "./platform";

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let online = true;
let started = false;

function emit(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch (err) {
      console.warn("[net] listener threw:", err);
    }
  });
}

/** Begin watching connectivity. Idempotent. */
export async function startNetworkWatch(): Promise<void> {
  if (started) return;
  started = true;

  if (isNative) {
    try {
      const status: ConnectionStatus = await Network.getStatus();
      online = status.connected;
      await Network.addListener("networkStatusChange", (s) => emit(s.connected));
      return;
    } catch (err) {
      console.warn("[net] native watch failed, using navigator.onLine:", err);
    }
  }

  online = typeof navigator === "undefined" ? true : navigator.onLine;
  window.addEventListener("online", () => emit(true));
  window.addEventListener("offline", () => emit(false));
}

export function isOnline(): boolean {
  return online;
}

export function onNetworkChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Truthful connectivity check.
 *
 * `navigator.onLine` and the Android radio state both report "connected" on a
 * captive-portal wifi that cannot actually reach Supabase, so anything that is
 * about to do real work (sync push, payment) asks this instead.
 */
export async function canReachServer(timeoutMs = 5000): Promise<boolean> {
  if (!online) return false;
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return online;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
