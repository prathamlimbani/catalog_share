import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, FileText, RefreshCw, WifiOff, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useNetwork } from "@/hooks/useNetwork";
import { useManualSync, useRenumberings, useSyncCounts, useSyncState } from "@/hooks/useSync";
import { cn } from "@/lib/utils";

interface OfflineBannerProps {
  companyId?: string | null;
  className?: string;
}

/**
 * The one place the app tells the user about connectivity and sync.
 *
 * Offline it is reassuring rather than alarming — estimates keep working, so
 * the message says so instead of implying the app is broken. Back online with
 * queued work, it turns into a sync affordance. Work that has given up retrying
 * gets its own alarming state, because the difference between "saved" and "not
 * saved" is the one thing the merchant must never have to guess.
 *
 * The action pills are 44px tall with negative vertical margin: the target is
 * thumb-sized without the banner itself growing into the content.
 */
export function OfflineBanner({ companyId, className }: OfflineBannerProps) {
  const { offline } = useNetwork();
  const { pending, failed } = useSyncCounts();
  const { running, lastError } = useSyncState();
  const { run, retry, busy } = useManualSync(companyId);
  const { renumberings, dismiss } = useRenumberings();

  const renumberNotice = renumberings.length > 0 && (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-border bg-primary/10 px-4 py-2"
    >
      <p className="min-w-0 flex-1 break-anywhere text-xs font-medium leading-snug text-foreground">
        {renumberings.length === 1
          ? `Estimate renumbered to ${renumberings[0].to} (was ${renumberings[0].from}) — the number was already taken on the server.`
          : `${renumberings.length} estimates were renumbered on sync: ${renumberings
              .map((r) => `${r.from} → ${r.to}`)
              .join(", ")}`}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss renumbering notice"
        className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (offline) {
    return (
      <>
        {renumberNotice}
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-amber-700 dark:text-amber-300",
            className,
          )}
        >
          <WifiOff className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 text-xs font-medium leading-snug">
            You&apos;re offline. Estimates still work — they&apos;ll sync when you reconnect.
            {pending > 0 && (
              <span className="ml-1 opacity-80">
                {pending} change{pending === 1 ? "" : "s"} waiting.
              </span>
            )}
          </p>
        </div>
      </>
    );
  }

  // Parked work outranks ordinary pending work: these estimates have already
  // exhausted their retries and will not clear on their own.
  if (failed > 0) {
    return (
      <>
        {renumberNotice}
        <div
          role="alert"
          className={cn(
            "flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5",
            className,
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-xs font-semibold leading-snug text-destructive">
            {failed} estimate{failed === 1 ? "" : "s"} couldn&apos;t sync
            <span className="block font-normal opacity-80">
              Saved on this phone. Tap retry to send {failed === 1 ? "it" : "them"} again.
            </span>
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy || running}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-destructive px-3 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3 w-3", (busy || running) && "animate-spin")} />
            {busy || running ? "Retrying" : "Retry"}
          </button>
        </div>
      </>
    );
  }

  if (pending > 0 || lastError) {
    return (
      <>
        {renumberNotice}
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 border-b border-border bg-secondary/60 px-4 py-1.5",
            className,
          )}
        >
          <CloudOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            {pending > 0
              ? `${pending} estimate${pending === 1 ? "" : "s"} waiting to sync`
              : "Last sync didn't finish"}
          </p>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || running}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3 w-3", (busy || running) && "animate-spin")} />
            {busy || running ? "Syncing" : "Sync now"}
          </button>
        </div>
      </>
    );
  }

  return renumberNotice || null;
}

interface OfflineStateProps {
  feature: string;
  description?: string;
  lastSynced?: string | null;
  /**
   * Replaces the default "Open Estimates" way out. Pass one when the screen has
   * something more useful to offer than the app's offline-capable surface.
   */
  action?: ReactNode;
}

/**
 * Placeholder shown in place of an online-only screen.
 *
 * Replaces the old failure mode where a network error rendered as
 * "No company found. Please register first." — which reads as data loss.
 *
 * It always carries a way forward. "Try again" would be a lie here (nothing
 * retries without a connection), so the action points at Estimates, which is
 * the part of the app that genuinely does work offline.
 */
export function OfflineState({ feature, description, lastSynced, action }: OfflineStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <WifiOff className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">{feature} needs a connection</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {description ??
          "Reconnect to load this up to date. Your estimates keep working offline in the meantime."}
      </p>
      {lastSynced && (
        <p className="mt-3 text-xs text-muted-foreground/80">Last updated {lastSynced}</p>
      )}
      <div className="mt-5">
        {action ?? (
          <Link
            to="/invoices"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            <FileText className="h-4 w-4" />
            Open Estimates
          </Link>
        )}
      </div>
    </div>
  );
}

export default OfflineBanner;
