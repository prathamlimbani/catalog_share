/**
 * Keep the signed-in company row — and therefore the entitlement — current
 * while the app is open.
 *
 * The problem this solves: `useCurrentCompany` caches for five minutes and the
 * app had no subscription to server-side changes at all, so a plan that became
 * active anywhere other than in this tab was invisible until the cache expired
 * or the screen remounted. A merchant who paid and was left on the paywall had
 * no way to move except to kill the app, which is exactly what they reported.
 *
 * The plan can change without this client doing anything:
 *  - a Razorpay payment that was only *authorized* at verify time is captured
 *    seconds or minutes later, and the grant lands then (see the 202 branch in
 *    verify-razorpay-payment);
 *  - support grants a plan through the master admin console;
 *  - `check-expired-subscriptions` lapses or renews the row on its schedule;
 *  - the merchant paid on their phone and is looking at the shop tablet.
 *
 * Three independent triggers, because none of them is reliable on its own:
 *
 *  1. Postgres realtime — instant, but needs `companies` in the
 *     `supabase_realtime` publication and a working websocket. Corporate
 *     networks and some Indian mobile carriers block or idle out websockets.
 *  2. Focus / resume / online — covers the common "user came back to the app"
 *     case even with realtime unavailable, and costs one query.
 *  3. A slow interval — the floor. Five minutes matches the existing staleTime,
 *     so this changes nothing about load in the steady state.
 *
 * Every path funnels into the same invalidation, and all of them are safe to
 * fire together: react-query dedupes concurrent fetches of the same key.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companyKey } from "@/hooks/useCompany";
import { isOnline } from "@/native/net";

/**
 * The backstop poll.
 *
 * Forty-five seconds, not five minutes. Realtime is the mechanism that was
 * supposed to make a plan change instant, and it is not running on the
 * self-hosted backend — there is no realtime service in that stack — so this
 * interval IS the propagation delay in practice. An admin who grants a plan and
 * then watches the merchant's phone was waiting up to five minutes for it to
 * appear, which reads as "it didn't work" and invites them to grant it twice.
 *
 * The cost is one indexed single-row select per open app per 45s, and only
 * while the app is in the foreground (see below) — a backgrounded app polls
 * nothing, because `resume` already forces a refresh the moment it comes back.
 */
const REFRESH_INTERVAL_MS = 45 * 1000;

/**
 * Ignore repeat triggers inside this window.
 *
 * Resume and visibilitychange both fire when an Android app returns to the
 * foreground, and `online` often lands alongside them.
 */
const COALESCE_MS = 2_000;

export function useEntitlementLive(companyId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!companyId) return;

    let disposed = false;

    const refresh = (opts?: { background?: boolean }) => {
      if (disposed) return;
      // Nothing to update on a screen nobody is looking at, and Android throttles
      // these timers anyway. `resume` and `visibilitychange` cover the return.
      if (opts?.background && document.visibilityState !== "visible") return;
      // Offline there is nothing to fetch, and letting the query run would
      // replace the row with the mirrored copy for no reason.
      if (!isOnline()) return;
      const now = Date.now();
      if (now - lastRefresh.current < COALESCE_MS) return;
      lastRefresh.current = now;

      void queryClient.invalidateQueries({ queryKey: ["current-company"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-company"] });
    };

    // ---- 1. Realtime -------------------------------------------------------
    // Scoped to this company's row: a merchant must never receive another
    // merchant's subscription changes, and RLS is not a substitute for the
    // filter here because realtime authorises the whole subscription, not
    // each row.
    const channel = supabase
      .channel(`company-entitlement:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "companies",
          filter: `id=eq.${companyId}`,
        },
        (payload) => {
          const row = (payload as { new?: Record<string, unknown> }).new;
          if (!row) {
            refresh();
            return;
          }
          // Write the row straight into the cache so the paywall drops on the
          // same frame, then invalidate so the canonical fetch still runs and
          // anything realtime omitted is filled in.
          const userId = queryClient.getQueryData<string | null>(["auth-user-id"]) ?? null;
          queryClient.setQueryData(companyKey(userId), row);
          lastRefresh.current = 0;
          refresh();
        },
      )
      .subscribe((status) => {
        // CHANNEL_ERROR is the expected status when `companies` is not in the
        // realtime publication yet. It is not fatal — triggers 2 and 3 carry
        // the feature — so this logs once rather than surfacing to the user.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            `[entitlement] realtime unavailable (${status}); ` +
              "falling back to focus and interval refresh. " +
              "Add `companies` to the supabase_realtime publication to enable it.",
          );
        }
      });

    // ---- 2. Focus / resume / online ----------------------------------------
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // A named handler, so removeEventListener can actually find it.
    const onWake = () => refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);

    let removeResume: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) => App.addListener("resume", onWake))
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeResume = () => void handle.remove();
      })
      .catch(() => {
        /* web build — visibilitychange already covers this */
      });

    // ---- 3. Interval backstop ----------------------------------------------
    const interval = window.setInterval(() => refresh({ background: true }), REFRESH_INTERVAL_MS);

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      removeResume?.();
      window.clearInterval(interval);
    };
  }, [companyId, queryClient]);
}
