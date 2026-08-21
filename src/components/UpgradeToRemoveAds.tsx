import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The "upgrade to remove ads" strip.
 *
 * Shown only while an ad is actually on screen. An offer to remove ads that
 * appears on an ad-free screen is confusing at best, and on a paid account it
 * would be a lie.
 *
 * Dismissal is remembered for a day, not forever. Never letting it be
 * dismissed makes the app feel like adware; dismissing it permanently means a
 * merchant who taps X in their first minute never sees the upgrade path again.
 * A day is long enough that it is not nagging and short enough that it still
 * does its job.
 */
const DISMISS_KEY = "cs_ads_upsell_dismissed_until";
const DISMISS_MS = 24 * 60 * 60 * 1000;

function dismissedUntil(): number {
  try {
    return Number(localStorage.getItem(DISMISS_KEY)) || 0;
  } catch {
    return 0;
  }
}

interface Props {
  /** True when a banner ad is actually being displayed right now. */
  visible: boolean;
  className?: string;
}

export function UpgradeToRemoveAds({ visible, className }: Props) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => dismissedUntil() > Date.now());

  // Re-check on mount in case the app has been open across the expiry.
  useEffect(() => {
    if (!dismissed) return;
    const remaining = dismissedUntil() - Date.now();
    if (remaining <= 0) {
      setDismissed(false);
      return;
    }
    const timer = setTimeout(() => setDismissed(false), Math.min(remaining, 6 * 60 * 60 * 1000));
    return () => clearTimeout(timer);
  }, [dismissed]);

  if (!visible || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
    } catch {
      /* private mode — it simply reappears next launch */
    }
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-2 text-sm",
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <button
        type="button"
        onClick={() => navigate("/billing")}
        className="min-w-0 flex-1 text-left text-foreground"
      >
        <span className="font-medium">Upgrade to remove ads</span>
        <span className="ml-1 text-muted-foreground">— and unlock every feature.</span>
      </button>
      <button
        type="button"
        onClick={() => navigate("/billing")}
        className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
      >
        See plans
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default UpgradeToRemoveAds;
