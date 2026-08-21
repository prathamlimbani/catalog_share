/**
 * The Earn screen — watch a rewarded ad, spend what it pays for.
 *
 * The whole screen is written around one uncomfortable fact: the client never
 * grants a point. A finished ad only means the user is probably owed something;
 * the credit is written by Google's server-side verification callback a few
 * seconds later. So the button cannot say "+10 Coins" and be done — it has to
 * hand over to a waiting state, and when the credit does not arrive it has to
 * say so plainly rather than pretend or silently do nothing. A merchant who
 * thinks an ad was stolen from them stops watching ads.
 *
 * The other rule here: every reason this screen cannot pay out — web build,
 * rewards switched off, no company yet, daily cap reached — explains itself in
 * visible copy. A greyed-out button with no sentence beside it reads as a bug.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clapperboard,
  Coins,
  Gift,
  History,
  Loader2,
  PauseCircle,
  RefreshCw,
  Smartphone,
  Sparkles,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
import { useCurrentCompany } from "@/hooks/useCompany";
import { useRewardsConfig, useWallet } from "@/hooks/useRewards";
import { fetchWallet, type LedgerEntry } from "@/lib/rewards";
import { AdminLayout } from "@/components/AdminLayout";
import RedeemOffers from "@/components/rewards/RedeemOffers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { hideBanner, prepareRewarded, showRewarded } from "@/native/ads";
import { isNative } from "@/native/platform";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** What the ledger reasons mean, for rows that carry no note of their own. */
const REASON_LABELS: Record<string, string> = {
  ad_reward: "Watched an ad",
  redemption: "Redeemed for plan days",
  admin_grant: "Added by CatalogShare",
  signup_bonus: "Welcome bonus",
};

/**
 * A short, human "when".
 *
 * Guarded rather than inlined: created_at arrives as an untyped string, and a
 * bad one would otherwise print the literal "Invalid Date" in the list.
 */
function shortWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(then).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Why the Watch button cannot be pressed, in words the merchant can act on. */
interface Blocker {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}

/** What happened on the last attempt, and what to do about it. */
interface Notice {
  tone: "warn" | "info";
  text: string;
  canRefresh?: boolean;
}

type Phase = "idle" | "watching" | "confirming";

function Explainer({ icon, title, body, action }: Blocker) {
  return (
    <div className="mb-3 flex gap-3 rounded-lg bg-muted/60 p-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
        {action && (
          <Button variant="outline" size="sm" className="mt-2 h-8" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

const Earn = () => {
  const navigate = useNavigate();
  // `isPending` matters as much as the row: until the company query settles,
  // `companyId` is null for a merchant who has had a shop for a year, and the
  // blocker below would tell them to go and create one.
  const { data: company, isPending: companyPending } = useCurrentCompany();
  const companyId = typeof company?.id === "string" ? company.id : null;

  const { config, loading: configLoading } = useRewardsConfig();
  const { wallet, loading: walletLoading, refresh, awaitCredit } = useWallet(companyId);

  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // `phase` cannot guard the button on its own: a tap reads the state from the
  // render it happened on, and `disabled` only takes effect at the next paint,
  // so two touches inside one frame both saw "idle" and opened two rewarded ads
  // back to back. The ref flips on the first tap, before any render.
  const watching = useRef(false);

  // A rewarded ad takes the whole screen for half a minute; the merchant can be
  // on another page by the time it closes. Nothing may be concluded about this
  // screen's state after that.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // No banner on this screen. The one ad here is the one the merchant opted
  // into, and a banner parked under a full-width "Watch an ad" button collects
  // mistaps — which read as an accident to the user and as an invalid click to
  // Google. Deliberately no cleanup: a screen may only ever turn the banner off.
  useEffect(() => {
    void hideBanner();
  }, []);

  // Warm an ad up front so the first tap opens one instead of sitting on a
  // spinner for five seconds. Pointless before we know earning is even on, so
  // this waits for the config rather than firing on mount.
  useEffect(() => {
    if (!isNative || configLoading || !config.enabled) return;
    void prepareRewarded();
  }, [configLoading, config.enabled]);

  const label = config.pointsLabel;
  const cap = config.dailyAdCap;
  const watchedToday = Math.min(wallet.earnedToday, cap);
  const capReached = wallet.earnedToday >= cap;
  const progress = cap > 0 ? Math.min(100, (wallet.earnedToday / cap) * 100) : 0;
  const busy = phase !== "idle";
  // The wallet is the only thing that knows how many ads today has already
  // paid for. Offering the button before it arrives lets someone at their cap
  // sit through an ad the server will credit nothing for.
  const notReady = configLoading || walletLoading || companyPending;
  // Defensive: the data layer promises an array, and this list is the one place
  // a broken promise would take the whole screen down instead of a card.
  const entries = wallet.entries ?? [];

  const handleLogout = async () => {
    beginUserSignOut();
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, [refresh]);

  // Ordered by what the merchant can actually do about it, so we never tell
  // someone on the web to come back tomorrow.
  const blocker: Blocker | null = !isNative
    ? {
        icon: <Smartphone className="h-4 w-4" />,
        title: "Ads run in the Android app",
        body: `A browser cannot show a rewarded ad, so there is no way to earn ${label} here. The balance and history below are live, and you can still spend what you have.`,
      }
    : notReady
      ? null
      : !config.enabled
        ? {
            icon: <PauseCircle className="h-4 w-4" />,
            title: "Earning is paused right now",
            body: `Watching ads for ${label} is switched off at the moment. Nothing you have already earned is affected — your balance is safe and still spendable.`,
          }
        : !companyId
          ? {
              icon: <Store className="h-4 w-4" />,
              title: "Set up your business first",
              body: `${label} are credited to your business, so there has to be one before an ad can pay out.`,
              action: { label: "Go to Account", onClick: () => navigate("/account") },
            }
          : capReached
            ? {
                icon: <Sparkles className="h-4 w-4" />,
                title: "That is all for today",
                body: `You have watched all ${cap} ads for today. The counter resets at midnight UTC — 5:30 AM in India — and what you have earned can be spent any time.`,
              }
            : null;

  const handleWatch = async () => {
    if (watching.current || busy || blocker || notReady) return;
    watching.current = true;

    const previous = wallet.balance;
    setNotice(null);
    setPhase("watching");

    try {
      const outcome = await showRewarded();
      if (!alive.current) return;

      if (!outcome.earned) {
        setNotice({
          tone: "warn",
          text:
            outcome.reason === "dismissed"
              ? "The ad was closed before it finished, so it does not count. Watching one all the way through pays out."
              : outcome.reason === "not-signed-in"
                ? "The reward is tied to your account and we could not confirm you are signed in. Log out and back in, then try again."
                : outcome.reason === "unavailable"
                  ? "Rewarded ads are not available on this device."
                  : "No ad was available just now. That happens — try again in a minute.",
        });
        return;
      }

      // The ad finished; nobody has been paid yet. Google posts the reward to
      // our server and the row lands seconds later, so hold the screen here
      // rather than snapping back to a balance that has not moved.
      setPhase("confirming");
      const credited = await awaitCredit(previous);
      // awaitCredit also answers false when this screen went away mid-poll, so
      // an unmount must bail here rather than be reported as a missing credit.
      if (!alive.current) return;

      if (!credited) {
        setNotice({
          tone: "info",
          text: "The ad was watched. Google verifies every reward on their own servers before it can be credited, and that is taking longer than usual — it normally still lands on its own. Check again in a moment.",
          canRefresh: true,
        });
        return;
      }

      // awaitCredit reports THAT the credit landed, never how much, and the
      // wallet it wrote is not readable from inside this continuation. One more
      // read buys the real number, and the number is the whole point: "+10" is
      // a receipt, "reward confirmed" is a shrug.
      //
      // But the number is only ever quoted when this read actually shows the
      // rise. It used to fall back to config.pointsPerAd, which is the client
      // inventing a figure out of its own config: a failed re-read printed
      // "+10 Coins added" over a balance that had not moved by ten, or by
      // anything. What we cannot read, we do not claim.
      const after = await fetchWallet(companyId);
      const gained = after.balance - previous;
      toast.success(
        gained > 0
          ? `+${gained} ${label} added to your balance.`
          : `Reward confirmed. Your ${label} balance has been updated.`,
      );
    } catch (err) {
      // Anything that throws in here used to strand the screen: `phase` stayed
      // on "watching", so the button sat disabled reading "Loading ad…" until
      // the page was left and reopened, and `void handleWatch()` swallowed the
      // rejection with no trace.
      console.warn("[earn] rewarded flow failed:", err);
      if (alive.current) {
        setNotice({
          tone: "warn",
          text: "Something went wrong while loading that ad. Nothing was lost — try again in a moment.",
          canRefresh: true,
        });
      }
    } finally {
      watching.current = false;
      if (alive.current) setPhase("idle");
    }
  };

  // The rate is only quoted once the real config has landed. The fallback pays
  // 10, and printing that on the button before we have read the setting is the
  // screen promising an amount of its own invention.
  const buttonLabel =
    phase === "watching"
      ? "Loading ad…"
      : phase === "confirming"
        ? "Confirming your reward…"
        : notReady
          ? "Watch an ad"
          : `Watch an ad · +${config.pointsPerAd} ${label}`;

  return (
    <AdminLayout
      company={company}
      searchQuery=""
      onSearchChange={() => undefined}
      onLogout={handleLogout}
      showSearch={false}
      title="Earn"
    >
      <div className="mx-auto w-full max-w-2xl">
        {/* Balance, and how much of today is left */}
        <Card className="mb-4 overflow-hidden p-0">
          <div className="flex items-center gap-3 p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-600 dark:text-amber-400">
              <Coins className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your balance
              </p>
              {walletLoading ? (
                <Skeleton className="mt-1.5 h-8 w-28" />
              ) : (
                <p className="flex items-baseline gap-1.5 text-3xl font-bold leading-tight text-foreground">
                  {wallet.balance}
                  <span className="text-sm font-medium text-muted-foreground">{label}</span>
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label="Refresh balance"
            >
              <RefreshCw
                aria-hidden="true"
                className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
            </Button>
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Ads watched today</span>
              <span className="tabular-nums text-muted-foreground">
                {watchedToday} of {cap}
              </span>
            </div>
            <Progress
              value={progress}
              aria-label={`Ads watched today: ${watchedToday} of ${cap}`}
              className="mt-2 h-2"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {capReached
                ? "Daily limit reached. It resets at midnight UTC."
                : notReady
                  ? `Watch ads to collect ${label}.`
                  : `Each ad pays ${config.pointsPerAd} ${label}, up to ${cap} ads a day.`}
            </p>
          </div>
        </Card>

        {/* Watch */}
        <Card className="mb-4 p-4">
          {blocker && <Explainer {...blocker} />}

          {notice && (
            <div
              className={cn(
                "mb-3 rounded-lg px-3 py-2.5 text-xs leading-relaxed",
                notice.tone === "warn"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              <p>{notice.text}</p>
              {notice.canRefresh && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      refreshing ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"
                    }
                  />
                  Check again
                </Button>
              )}
            </div>
          )}

          <Button
            className="h-14 w-full text-base"
            disabled={busy || notReady || blocker !== null}
            onClick={() => void handleWatch()}
          >
            {busy ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Clapperboard className="mr-2 h-5 w-5" aria-hidden="true" />
            )}
            {buttonLabel}
          </Button>

          <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
            {phase === "confirming"
              ? "Google checks the ad on their servers before the reward is credited. This usually takes a couple of seconds."
              : `${label} arrive a few seconds after the ad ends, once Google confirms it was watched.`}
          </p>
        </Card>

        <RedeemOffers
          companyId={companyId}
          balance={wallet.balance}
          pointsLabel={label}
          onRedeemed={() => void handleRefresh()}
        />

        {/* History */}
        <section className="mb-4 mt-4">
          <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h2>
          <Card className="divide-y divide-border overflow-hidden p-0">
            {walletLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <History className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-foreground">Nothing here yet</p>
                <p className="text-xs text-muted-foreground">
                  Every ad you watch and every reward you spend will be listed here.
                </p>
              </div>
            ) : (
              entries.map((entry: LedgerEntry) => {
                const positive = entry.delta > 0;
                return (
                  <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        positive
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {positive ? (
                        <Clapperboard className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Gift className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {entry.note || REASON_LABELS[entry.reason] || "Adjustment"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {shortWhen(entry.created_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        positive
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {positive ? `+${entry.delta}` : entry.delta}
                    </span>
                  </div>
                );
              })
            )}
          </Card>
        </section>
      </div>
    </AdminLayout>
  );
};

export default Earn;
