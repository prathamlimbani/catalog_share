/**
 * Spend points on plan days.
 *
 * The interesting decisions here are all on the failure path, because the only
 * thing that knows whether a redemption is allowed is `redeem_reward_offer` —
 * the balance, the row lock that stops a double tap spending twice, and the
 * rule that you cannot redeem over a paid plan you are already on. None of that
 * is reimplemented here. The server's reason is rendered VERBATIM when it came
 * from that function: those strings are written to be read by a merchant ("You
 * are on the pro plan until 12 Sep 2026. Redeem this once it ends.") and
 * rewording one throws away the date, which is the only part that answers "so
 * when can I?". Reasons that came from BELOW that function are not — see
 * `merchantReason`.
 *
 * The affordability check on the cards is presentation only. It picks which
 * button to draw; it never decides whether the redeem may proceed. Nothing here
 * ever moves a balance: the number shown is the wallet the parent read back
 * from the server, and the plan days come from the RPC's own answer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, Loader2, Lock, Sparkles } from "lucide-react";
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
import { DEFAULT_REWARDS_CONFIG, redeemOffer, type RewardOffer } from "@/lib/rewards";
import { PLANS, getPlanName } from "@/lib/plans";
import { cn } from "@/lib/utils";

export interface RedeemOffersProps {
  companyId: string | null | undefined;
  balance: number;
  pointsLabel: string;
  /** The balance and the plan both moved — refresh the wallet and the plan badge. */
  onRedeemed: () => void;
}

/**
 * `getPlanName` answers "Free Plan" for a plan id it has never heard of, which
 * would print an offer that grants Pro as though it granted nothing. Offers are
 * rows, so one can name a plan added after this build shipped: fall back to the
 * raw id rather than to a confident lie.
 */
function planLabel(planId: string): string {
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

/**
 * Offer rows are typed by a cast, not by the generated schema, and they are
 * written by an admin panel — a cost can arrive as null or as a string. Without
 * this, one bad row turns the whole Earn page white on `.toLocaleString()`.
 */
function wholeNumber(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const GENERIC_FAILURE = "That did not go through. Please try again.";
const OFFLINE_FAILURE = "Could not reach the server. Check your connection and try again.";

/**
 * A `reason` reaches us from two very different places on the same field.
 *
 * `redeem_reward_offer` writes merchant-facing sentences. But when the function
 * is not deployed yet, or a policy refuses the call, or the socket dies, the
 * data layer passes PostgREST's own text through untouched — "Could not find
 * the function public.redeem_reward_offer(p_offer_id) in the schema cache". A
 * shopkeeper shown that has been handed a stack trace and has no idea whether
 * their points were spent, so anything carrying a database or transport
 * fingerprint is swapped for plain words and logged for us instead.
 */
const TRANSPORT_FINGERPRINT =
  /failed to fetch|networkerror|network request failed|load failed|timed? ?out|aborted/i;
const DATABASE_FINGERPRINT =
  /schema cache|pgrst|postgrest|supabase|relation |column |function |permission denied|row-level security|violates|duplicate key|null value|syntax error|jwt|invalid input|[{}\n]|^\w+error:/i;

function merchantReason(raw: string | undefined): string {
  const reason = (raw ?? "").trim();
  if (!reason) return GENERIC_FAILURE;
  if (TRANSPORT_FINGERPRINT.test(reason)) return OFFLINE_FAILURE;
  if (DATABASE_FINGERPRINT.test(reason) || reason.length > 240) return GENERIC_FAILURE;
  return reason;
}

export function RedeemOffers({ companyId, balance, pointsLabel, onRedeemed }: RedeemOffersProps) {
  const { offers, loading, refresh } = useRewardOffers();

  const [pending, setPending] = useState<RewardOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Radix keeps the dialog mounted through its close animation, so reading the
  // copy straight off `pending` made it flash "Redeem ?" and "for 0 days" on the
  // way out. The last offer stays readable until the next one replaces it.
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

      const plan = planLabel(result.plan ?? offer.plan_id) || planLabel(offer.plan_id);
      const until = formatUntil(result.until);
      const days = wholeNumber(result.days ?? offer.days);
      toast.success(
        until ? `${plan} is active until ${until}` : `${plan} is active for ${dayWord(days)}`,
      );

      // The plan really did change, so the parent is told even if this card has
      // since been unmounted — a stale plan badge is worse than a no-op call.
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
  }, [pending, onRedeemed, refresh]);

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
              Plan rewards are not set up yet. Keep collecting {label} — they stay in your account,
              and you will be able to spend them here once rewards go live.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dialogOffer = pending ?? lastShown.current;
  const dialogCost = wholeNumber(dialogOffer?.points_cost);
  const dialogTitle = (dialogOffer?.label ?? "").trim() || planLabel(dialogOffer?.plan_id ?? "");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-bold">Redeem a plan</h2>
      </div>

      {offers.map((offer) => {
        const cost = wholeNumber(offer.points_cost);
        const days = wholeNumber(offer.days);
        const affordable = balance >= cost;
        const shortfall = Math.max(0, cost - balance);
        const title = (offer.label ?? "").trim() || planLabel(offer.plan_id);

        return (
          <Card key={offer.id} className={cn(!affordable && "border-dashed")}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {planLabel(offer.plan_id)} for {dayWord(days)}
                  </p>
                </div>
                <Badge variant={affordable ? "default" : "secondary"} className="shrink-0">
                  {cost.toLocaleString("en-IN")} {label}
                </Badge>
              </div>

              {affordable ? (
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
              {wholeNumber(balance).toLocaleString("en-IN")} and gives you{" "}
              {planLabel(dialogOffer?.plan_id ?? "")} for {dayWord(wholeNumber(dialogOffer?.days))}.
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
