import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Fingerprint, Lock, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  authenticate,
  disableLockLocally,
  isBiometricAvailable,
  isLockEnabled,
  shouldLockNow,
} from "@/native/biometrics";
import { beginUserSignOut } from "@/native/bootstrap";
import { isNative } from "@/native/platform";

type Phase = "checking" | "locked" | "unlocked";

/**
 * The biometric app lock.
 *
 * While locked it renders the lock screen INSTEAD of its children, so nothing —
 * not a customer name, not a total — is on screen behind it.
 *
 * It lives inside React, after the native splash has handed over, and it is a
 * no-op on the web build: `isNative` false means the children render on the
 * first paint with no async check in the way.
 */
export default function AppLockGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>(isNative ? "checking" : "unlocked");
  const [method, setMethod] = useState("your fingerprint");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A prompt is on screen. The system sheet backgrounds us, so this gates the
   *  lifecycle listeners below as well. */
  const prompting = useRef(false);
  /** When our own prompt last closed. Android delivers `resume` AFTER
   *  verifyIdentity() has already resolved, so `prompting` is back to false by
   *  the time the listener runs — this timestamp is what keeps that resume from
   *  being mistaken for the user returning to the app. */
  const promptEndedAt = useRef(0);
  /** When the user actually left the app; null while we are in the foreground. */
  const pausedAt = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** True for a moment after our own prompt closed. Android's ordering of
   *  verifyIdentity()'s resolution vs the resume event is not guaranteed, so a
   *  short settling window covers the case where resume arrives late. */
  const isSettlingPrompt = () => Date.now() - promptEndedAt.current < 1500;

  const runPrompt = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setBusy(true);
    setError(null);

    const ok = await authenticate("Unlock CatalogShare");

    prompting.current = false;
    promptEndedAt.current = Date.now();
    // Our own sheet closing must not read as "the user came back".
    pausedAt.current = null;
    if (!mounted.current) return;

    setBusy(false);
    if (ok) {
      setPhase("unlocked");
      setError(null);
    } else {
      setError("We couldn't verify it's you.");
    }
  }, []);

  // ---- arm on cold start ------------------------------------------------
  useEffect(() => {
    if (!isNative) return;

    void (async () => {
      const enabled = await isLockEnabled();
      if (!mounted.current) return;

      if (!enabled) {
        setPhase("unlocked");
        return;
      }

      const status = await isBiometricAvailable();
      if (!mounted.current) return;

      // The user removed their screen lock in system settings after arming
      // this. There is now nothing to verify against, so holding the screen
      // would lock them out of their own estimates for good — fail open and
      // forget the setting so the More screen tells the truth. A device that
      // still has a PIN keeps the lock: the PIN can pass it.
      if (!status.available && !status.deviceSecure) {
        await disableLockLocally();
        if (!mounted.current) return;
        setPhase("unlocked");
        return;
      }

      setMethod(status.type.toLowerCase());
      setPhase("locked");
      void runPrompt();
    })();
  }, [runPrompt]);

  // ---- re-arm on resume -------------------------------------------------
  const handleResume = useCallback(async () => {
    // No pause was recorded, so we never actually went to the background — this
    // is the biometric sheet handing control back after a SUCCESSFUL unlock.
    // Re-locking here is what produced the loop the user hit: fingerprint
    // accepted, app unlocked, resume fires, app locks again, prompt reappears.
    // The cold-start lock is armed by the mount effect, not by this handler, so
    // ignoring an unpaired resume costs nothing.
    if (pausedAt.current === null) return;

    if (!(await isLockEnabled())) return;
    if (!shouldLockNow(pausedAt.current)) {
      // A quick trip to WhatsApp. Stay open, but forget the timestamp so the
      // next resume is judged on its own pause.
      pausedAt.current = null;
      return;
    }
    pausedAt.current = null;
    if (!mounted.current) return;
    setPhase("locked");
    await runPrompt();
  }, [runPrompt]);

  useEffect(() => {
    if (!isNative) return;

    let cancelled = false;
    let handles: PluginListenerHandle[] = [];

    void (async () => {
      try {
        const registered = await Promise.all([
          CapApp.addListener("pause", () => {
            // Android's biometric sheet is its own activity, so it pauses us.
            // That is our own prompt, not the user leaving — starting the grace
            // clock here would re-lock the app the moment they unlock it.
            if (prompting.current || isSettlingPrompt()) return;
            pausedAt.current = Date.now();
          }),
          CapApp.addListener("resume", () => {
            if (prompting.current || isSettlingPrompt()) return;
            void handleResume();
          }),
        ]);
        if (cancelled) {
          registered.forEach((h) => void h.remove());
          return;
        }
        handles = registered;
      } catch (err) {
        // No lifecycle events means no re-lock on resume. The cold-start lock
        // still works, which is the case that matters most.
        console.warn("[applock] lifecycle listeners unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
      handles.forEach((h) => void h.remove());
    };
  }, [handleResume]);

  // ---- escape hatch -----------------------------------------------------
  const handleSignOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      beginUserSignOut();
      await supabase.auth.signOut();

      // signOut() resolves the same way whether it signed out or the unsynced-
      // work guard talked the user out of it, so ask the session itself. Only
      // once it is really gone may the lock come off — otherwise "Sign out" and
      // then "Cancel" would be a two-tap way to disarm someone else's lock.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (!mounted.current) return;
        setBusy(false);
        setError("Sign-out cancelled. The app stays locked.");
        return;
      }

      await disableLockLocally();
      if (!mounted.current) return;
      // The global auth listener wipes local data and routes to /login; lifting
      // the gate here means the login screen is reachable even if it does not.
      setBusy(false);
      setPhase("unlocked");
    } catch (err) {
      console.warn("[applock] sign-out failed:", err);
      if (!mounted.current) return;
      setBusy(false);
      setError("Sign-out failed. Check your connection and try again.");
    }
  }, []);

  if (phase === "unlocked") return <>{children}</>;

  // "checking" is one preference read. Painting the app for those few frames
  // would flash the very data the lock exists to hide, so it shows the empty
  // background instead.
  if (phase === "checking") return <div className="min-h-dvh bg-background" />;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background pb-safe pt-safe">
      <div className="flex min-h-full w-full flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Store className="h-8 w-8" />
            </span>

            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-foreground sm:text-2xl">
                Unlock CatalogShare
              </h1>
              <p className="text-sm text-muted-foreground">
                Your customers, prices and estimates are locked. Unlock with {method}.
              </p>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-center text-sm font-medium text-destructive"
            >
              {error}
            </p>
          )}

          <Button
            size="lg"
            className="mt-6 h-12 w-full text-base"
            onClick={() => void runPrompt()}
            disabled={busy}
          >
            {busy ? (
              <Lock className="h-5 w-5" />
            ) : (
              <Fingerprint className="h-5 w-5" />
            )}
            {busy ? "Waiting for you…" : error ? "Try again" : "Unlock"}
          </Button>

          {/* Never a dead end: a user whose sensor stopped recognising them can
              still leave, and signing out drops the lock with the session. */}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={busy}
            className="mt-3 flex h-11 w-full items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:text-foreground disabled:opacity-50"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
