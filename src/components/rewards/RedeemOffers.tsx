/**
 * Spend points.
 *
 * WHAT POINTS BUY, AND WHY IT CHANGED
 * They used to buy plan days, and that never once worked in the field: the
 * grant writes a column `guard_company_subscription_columns` refuses to let a
 * merchant change, so every redemption aborted (see 20260829000000). It was
 * also the wrong prize — three days of Growth arrives, expires, and leaves
 * nothing behind. Points now buy estimates and product slots, neither of which
 * can expire and neither of which can be taken back on a downgrade.
 *
 * The three kinds are rendered from one list because they are one economy: the
 * merchant reads a cost and a thing they get. What differs is the sentence
 * under the title, what the confirmation warns about, and what has to be
 * refreshed afterwards.
 *
 * The interesting decisions are still all on the failure path, because the only
 * thing that knows whether a redemption is allowed is `redeem_reward_offer` —
 * the balance, the row lock that stops a double tap spending twice, and the
 * rule that you cannot redeem plan days over a plan you are already on. None of
 * that is reimplemented here. The server's reason is rendered VERBATIM when it
 * came from that function: those strings are written to be read by a merchant
 * and rewording one throws away the date, which is the only part that answers
 * "so when can I?". Reasons that came from BELOW that function are not — see
 * `merchantReason` in @/lib/rewards, which sits next to the code that writes
 * them so the two cannot drift apart.
 *
 * The affordability check on the cards is presentation only. It picks which
 * button to draw; it never decides whether the redeem may proceed. Nothing here
 * ever moves a balance: the number shown is the wallet the parent read back
 * from the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, Lock, Package, Smartphone, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useRewardOffers } from "@/hooks/useRewards";
import {
  DEFAULT_REWARDS_CONFIG,
  GENERIC_FAILURE,
  merchantReason,
  redeemOffer,
  type OfferKind,
  type RewardOffer,
} from "@/lib/rewards";
import { syncCreditGrants } from "@/lib/estimateCredits";
import { isNative } from "@/native/platform";
import { PLANS, getPlanName } from "@/lib/plans";
import { activateEntitlementNow } from "@/hooks/useRazorpaySubscription";
import { cn } from "@/lib/utils";

export interface RedeemOffersProps {
  companyId: string | null | undefined;
  balance: number;
  pointsLabel: string;
  /** The balance and possibly the plan moved — refresh the wallet and the badge. */
  onRedeemed: () => void;
}

/**
 * `getPlanName` answers "Free Plan" for a plan id it has never heard of, which
 * would print an offer that grants Pro as though it granted nothing. Offers are
 * rows, so one can name a plan added after this build shipped: fall back to the
 * raw id rather than to a confident lie.
 */
function planLabel(planId: string | null | undefined): string {
  const id = (planId ?? "").trim();
  if (!id) return "";
  return PLANS.some((p) => p.id === id) ? getPlanName(id) : id;
}

function formatUntil(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const dayWord = (days: number) => `${days} day${days === 1 ? "" : "s"}`;
const estimateWord = (n: number) => `${n} estimate${n === 1 ? "" : "s"}`;
const productWord = (n: number) => `${n} product${n === 1 ? "" : "s"}`;

/**
 * Offer rows are typed by a cast, not by the generated schema, and they are
 * written by an admin panel — a cost can arrive as null or as a string. Without
 * this, one bad row turns the whole Earn page white on `.toLocaleString()`.
 */
function wholeNumber(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The line under the title: what this card actually hands over. */
function describeOffer(offer: RewardOffer): string {
  const amount = wholeNumber(offer.amount);
  switch (offer.kind) {
    case "estimate_credits":
      return `${estimateWord(amount)} to create, with no ads to watch`;
    case "product_slots":
      return `Room for ${productWord(amount)} more, on any plan, forever`;
    default:
      return `${planLabel(offer.plan_id)} for ${dayWord(wholeNumber(offer.days))}`.trim();
  }
}

/** The same thing again inside the confirmation, phrased as a consequence. */
function describeGrant(offer: RewardOffer | null): string {
  if (!offer) return "";
  const amount = wholeNumber(offer.amount);
  switch (offer.kind) {
    case "estimate_credits":
      return `gives you ${estimateWord(amount)} you can create without watching anything`;
    case "product_slots":
      return `raises your product limit by ${amount}, permanently`;
    default:
      return `gives you ${planLabel(offer.plan_id)} for ${dayWord(wholeNumber(offer.days))}`;
  }
}

const KIND_ICON: Record<OfferKind, typeof Gift> = {
  estimate_credits: Sparkles,
  product_slots: Package,
  plan_days: Gift,
};

export function RedeemOffers({ companyId, balance, pointsLabel, onRedeemed }: RedeemOffersProps) {
  const { offers, loading, refresh } = useRewardOffers();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<RewardOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Radix keeps the dialog mounted through its close animation, so reading the
  // copy straight off `pending` made it flash "Redeem ?" on the way out. The
  // last offer stays readable until the next one replaces it.
  const lastShown = useRef<RewardOffer | null>(null);
  // `busy` is state, so two taps dispatched before React re-renders would both
  // pass the guard. The ref closes that window; the row lock in the RPC is the
  // real defence, this only stops us asking twice.
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // An admin can save an empty label in the rewards panel; falling back to the
  // configured default keeps the copy readable instead of "10  to unlock".
  const label = (pointsLabel ?? "").trim() || DEFAULT_REWARDS_CONFIG.pointsLabel;

  /**
   * Estimates are bought for a wallet that only exists on the phone.
   *
   * A rewarded ad cannot play in a browser, so the whole credit gate is
   * native-only and the web build creates estimates for free — banking a
   * purchase there would spend 100 points on a balance nothing ever reads. The
   * card stays visible so the merchant knows the reward exists; it just cannot
   * be bought from here.
   */
  const estimatesBuyableHere = isNative;

  const openConfirm = (offer: RewardOffer) => {
    lastShown.current = offer;
    setFailure(null);
    setPending(offer);
  };

  const confirm = useCallback(async () => {
    const offer = pending;
    if (!offer || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await redeemOffer(offer.id);
      if (!alive.current) return;

      if (!result.ok) {
        const shown = merchantReason(result.reason);
        if (result.reason && shown !== result.reason) {
          console.warn("[rewards] redeem refused:", result.reason);
        }
        setFailure(shown);
        return;
      }

      // The server's `kind` wins over the card's: an offer can have been edited
      // between the list being fetched and the tap landing, and what was
      // actually granted is what the merchant should be told about.
      const kind = result.kind ?? offer.kind;
      const amount = wholeNumber(result.amount ?? offer.amount);

      if (kind === "estimate_credits") {
        // Collect it immediately rather than waiting for the Estimates screen
        // to mount. The points have already gone; a balance that only moves
        // after a navigation reads as a redemption that did nothing.
        const banked = await syncCreditGrants(companyId).catch((err) => {
          console.warn("[rewards] banking the grant failed:", err);
          return { credited: 0, estimates: 0 };
        });
        toast.success(
          banked.credited > 0
            ? `${estimateWord(banked.estimates)} added to your balance`
            : `${estimateWord(amount)} added — they will appear on your phone shortly`,
        );
      } else if (kind === "product_slots") {
        toast.success(`You can add ${productWord(amount)} more from now on`);
      } else {
        const plan = planLabel(result.plan ?? offer.plan_id) || planLabel(offer.plan_id);
        const until = formatUntil(result.until);
        const days = wholeNumber(result.days ?? offer.days);
        toast.success(
          until ? `${plan} is active until ${until}` : `${plan} is active for ${dayWord(days)}`,
        );
      }

      // The COMPANY ROW moved — the plan for a plan_days grant, and
      // bonus_product_limit for a product_slots one — and `onRedeemed` only
      // re-reads the WALLET. Without this the points drop, the toast says the
      // limit has gone up, and every entitlement gate keeps answering with the
      // old number until `useEntitlementLive`'s 45-second poll happens to come
      // round (AdminLayout.tsx:80) — or until the company query's five-minute
      // staleTime lapses, on any screen that poller does not cover. Three
      // quarters of a minute staring at a limit you just paid to lift is
      // indistinguishable from the redemption not working.
      //
      // Reused from the payment flow rather than reimplemented: it seeds the
      // company caches instead of merely invalidating them, writes the offline
      // entitlement snapshot, and mirrors the row — all three have to move
      // together or the app re-locks itself from a stale copy on next launch.
      //
      // Skipped for estimate credits, which touch no server-side entitlement at
      // all: the wallet is on this device and has already been updated above.
      if (companyId && kind !== "estimate_credits") {
        try {
          await activateEntitlementNow(queryClient, companyId);
        } catch (err) {
          // The grant is already committed server-side. Failing to refresh is
          // a stale badge, not a failed redemption, so it must not reach the
          // catch below and turn a success into an error message.
          console.warn("[rewards] redeemed, but the entitlement refresh failed:", err);
        }
      }

      // Told even if this card has since been unmounted — a stale balance is
      // worse than a no-op call.
      onRedeemed();
      if (!alive.current) return;
      setPending(null);
      // An offer can be a limited deal the server has just retired, so re-read
      // the list instead of assuming it survived the redemption unchanged.
      refresh();
    } catch (err) {
      // redeemOffer swallows its own failures, so reaching here means something
      // unexpected threw. Left uncaught it would be an unhandled rejection and
      // the dialog would sit there spinning with nothing to read.
      console.warn("[rewards] redeem threw:", err);
      if (alive.current) setFailure(GENERIC_FAILURE);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, [pending, companyId, queryClient, onRedeemed, refresh]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  // No table, or nothing active in it. Both look identical to a merchant and
  // neither is their fault, so this never says "error".
  if (offers.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-5">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">No rewards to redeem yet</p>
            <p className="mt-1 text-muted-foreground">
              Rewards are not set up yet. Keep collecting {label} — they stay in your account,
              and you will be able to spend them here once rewards go live.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dialogOffer = pending ?? lastShown.current;
  const dialogCost = wholeNumber(dialogOffer?.points_cost);
  const dialogTitle =
    (dialogOffer?.label ?? "").trim() ||
    (dialogOffer ? describeOffer(dialogOffer) : "this reward");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-bold">Spend your {label}</h2>
      </div>

      {offers.map((offer) => {
        const cost = wholeNumber(offer.points_cost);
        const affordable = balance >= cost;
        const shortfall = Math.max(0, cost - balance);
        const title = (offer.label ?? "").trim() || describeOffer(offer);
        const Icon = KIND_ICON[offer.kind] ?? Gift;
        const buyableHere = offer.kind !== "estimate_credits" || estimatesBuyableHere;

        return (
          <Card key={offer.id} className={cn(!affordable && "border-dashed")}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-semibold">{title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{describeOffer(offer)}</p>
                  </div>
                </div>
                <Badge variant={affordable ? "default" : "secondary"} className="shrink-0">
                  {cost.toLocaleString("en-IN")} {label}
                </Badge>
              </div>

              {!buyableHere ? (
                <p className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Estimates are stored on your phone, so buy this in the app. Your {label} are
                  safe here in the meantime.
                </p>
              ) : affordable ? (
                <Button
                  className="h-11 w-full"
                  disabled={busy || !companyId}
                  onClick={() => openConfirm(offer)}
                >
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                  Redeem
                </Button>
              ) : (
                <div className="space-y-2">
                  {/* The bar is here so the gap reads as progress rather than as a
                      locked door: the shortfall is a countable number of ads. It is
                      hidden from screen readers because the sentence under it says
                      the same thing in words. */}
                  <Progress
                    value={Math.min(100, (balance / Math.max(1, cost)) * 100)}
                    className="h-2"
                    aria-hidden="true"
                  />
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {shortfall.toLocaleString("en-IN")} more {label} to unlock this
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {!companyId && (
        <p className="text-xs text-muted-foreground">
          Your shop details are still loading. Redeeming will be available in a moment.
        </p>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Closing mid-flight would leave the merchant with no idea whether
          // their points were spent. Ignore the dismiss until the RPC settles.
          if (!open && !busy) setPending(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem {dialogTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              This spends {dialogCost.toLocaleString("en-IN")} {label} of your{" "}
              {wholeNumber(balance).toLocaleString("en-IN")} and {describeGrant(dialogOffer)}.
              Spent {label} cannot be returned.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Kept in the dialog rather than a toast: these reasons run to two
              sentences and a date, and a toast slides away before that is read. */}
          {failure && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {failure}
            </p>
          )}

          <AlertDialogFooter>
            <Button
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {failure ? "Close" : "Cancel"}
            </Button>
            <Button className="h-11" disabled={busy} onClick={() => void confirm()}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Redeeming…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                  Yes, redeem
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RedeemOffers;
