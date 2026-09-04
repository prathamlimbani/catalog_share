/**
 * The one button that buys an estimate credit.
 *
 * Shared by the gate dialog and the balance card on the Estimates list so the
 * two can never drift on the things that are easy to get wrong: the double-tap
 * guard, the wording when an ad is closed early, and the rolling watch limit.
 *
 * The double-tap guard is a ref, not state, for the reason the Earn screen
 * found the hard way — a tap reads the state of the render it happened on and
 * `disabled` only takes effect at the next paint, so two touches inside one
 * frame both saw "idle" and opened two rewarded ads back to back.
 */

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RewardedOutcome } from "@/native/ads";
import { formatUntil, type WatchAllowance } from "@/lib/estimateCredits";

/**
 * A short gap between rewarded ads.
 *
 * AdMob serves the next ad far more reliably once the last one has had a moment
 * to be replaced — a tap the instant the previous ad closes is what produces
 * "No ad was available just now". The countdown is on the button so the wait is
 * visible rather than feeling like a dead tap.
 */
const COOLDOWN_MS = 8_000;

/** Why an ad could not be watched, in words a merchant can act on. */
function reasonText(outcome: RewardedOutcome): string {
  switch (outcome.reason) {
    case "dismissed":
      return "The ad was closed before it finished, so it does not count. Watching one all the way through earns the credit.";
    case "not-signed-in":
      return "We could not confirm you are signed in. Log out and back in, then try again.";
    case "unavailable":
      return "Rewarded ads only run in the Android app.";
    default:
      return "No ad was available just now. That happens — try again in a moment.";
  }
}

export interface WatchAdButtonProps {
  /** Runs the ad and credits it. Resolves with what actually happened. */
  onWatch: () => Promise<RewardedOutcome>;
  /** The rolling-limit state, so the button can explain a refusal itself. */
  watch: WatchAllowance;
  /** Overrides the idle label. */
  label?: string;
  variant?: "default" | "outline";
  className?: string;
  /** Told whether an ad is currently in flight, so callers can lock the rest. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export function WatchAdButton({
  onWatch,
  watch,
  label = "Watch an ad",
  variant = "default",
  className,
  onBusyChange,
  disabled = false,
}: WatchAdButtonProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownSecs = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const blocked = !watch.allowed;

  // The "another one opens up in …" line has to move on its own, or a merchant
  // staring at it concludes the limit is stuck. Coarse on purpose — the line is
  // rendered in whole minutes, so anything finer only costs battery.
  useEffect(() => {
    if (!blocked) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [blocked]);

  const run = async () => {
    if (running.current || busy || blocked || disabled) return;
    running.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setFailure(null);

    try {
      const outcome = await onWatch();
      if (!alive.current) return;
      if (!outcome.earned) setFailure(reasonText(outcome));
    } catch (err) {
      // Anything thrown in here used to strand the Earn screen on a disabled
      // spinner with the rejection swallowed. Say something and let go.
      console.warn("[credits] rewarded flow failed:", err);
      if (alive.current) {
        setFailure("Something went wrong loading that ad. Nothing was lost — try again.");
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
        setCooldownUntil(Date.now() + COOLDOWN_MS);
      }
    }
  };

  return (
    <div className={cn("w-full", className)}>
      <Button
        variant={variant}
        className="h-12 w-full"
        disabled={busy || blocked || disabled || cooldownSecs > 0}
        onClick={() => void run()}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Clapperboard className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy
          ? "Playing ad…"
          : cooldownSecs > 0
            ? `Next ad in ${cooldownSecs}s`
            : blocked
              ? "Ad limit reached"
              : label}
      </Button>

      {blocked && (
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          You have watched {watch.used} ads in the last few hours, which is the limit. Another one
          opens up in {formatUntil(Math.max(0, watch.resetsAt - now))}.
        </p>
      )}

      {failure && !blocked && (
        <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs leading-relaxed text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}

export default WatchAdButton;
