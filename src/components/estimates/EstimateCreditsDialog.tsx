/**
 * The gate on saving an estimate when the plan is ad-funded.
 *
 * Rules this component must never break:
 *
 *  - Nothing the merchant typed is ever at risk, and the dialog says so in as
 *    many words. Someone who believes half an hour of typing is about to be
 *    thrown away does not watch an ad; they uninstall. Closing this returns to
 *    the form with every field still filled in.
 *  - It is ALWAYS dismissable. On Android the hardware back button is
 *    intercepted, so a dialog with no exit is an inescapable screen and an
 *    automatic Play Store rejection.
 *  - The price is shown BEFORE the first ad, not discovered after it. "Watch 2
 *    ads to save this estimate" up front is a deal; two ads and then a third
 *    request is a bait.
 *
 * The upgrade route is offered beside the ads rather than instead of them,
 * because that is the actual choice: pay with attention now, or pay once and
 * never see this dialog again.
 */

import { Clapperboard, Crown, FileText, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { costOf, type CreditAction, type CreditSnapshot } from "@/lib/estimateCredits";
import type { RewardedOutcome } from "@/native/ads";
import WatchAdButton from "./WatchAdButton";

export interface EstimateCreditsDialogProps {
  open: boolean;
  /** What the merchant is trying to do, which is what sets the price. */
  action: CreditAction;
  credits: CreditSnapshot;
  /** Runs one rewarded ad and banks the credit. */
  onWatch: () => Promise<RewardedOutcome>;
  /** The balance now covers it — go ahead and save. */
  onProceed: () => void;
  /** Back to the form; nothing is discarded. */
  onCancel: () => void;
  /** Send the merchant to the plans screen. */
  onUpgrade: () => void;
}

export function EstimateCreditsDialog({
  open,
  action,
  credits,
  onWatch,
  onProceed,
  onCancel,
  onUpgrade,
}: EstimateCreditsDialogProps) {
  const cost = costOf(action, credits.config);
  const have = Math.min(credits.balance, cost);
  const affordable = credits.balance >= cost;
  const stillNeeded = Math.max(0, cost - credits.balance);
  const noun = action === "edit" ? "edit" : "estimate";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Clapperboard className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <AlertDialogTitle className="text-center">
            {affordable
              ? action === "edit"
                ? "Ready to save your changes"
                : "Ready to save this estimate"
              : `Watch ${stillNeeded} ${stillNeeded === 1 ? "ad" : "ads"} to save this ${noun}`}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {action === "edit"
              ? `Editing an estimate costs ${cost} ${cost === 1 ? "ad" : "ads"}.`
              : `Creating an estimate costs ${cost} ${cost === 1 ? "ad" : "ads"}.`}{" "}
            {affordable
              ? "You have enough credits — this will use them."
              : "Each ad you finish banks one credit, and credits never expire."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Progress towards the price. Dots rather than a number because the
            question in the merchant's head is "how many more", not "how many". */}
        <div className="flex items-center justify-center gap-2 py-1" aria-hidden="true">
          {Array.from({ length: cost }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-8 rounded-full transition-colors",
                i < have ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {have} of {cost} paid for
          {credits.balance > cost ? ` · ${credits.balance - cost} credits spare` : ""}
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {affordable ? (
            <Button onClick={onProceed} className="h-12 w-full">
              <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
              {action === "edit" ? "Save changes" : "Save estimate"}
            </Button>
          ) : (
            <WatchAdButton
              onWatch={onWatch}
              watch={credits.watch}
              label={`Watch an ad · ${stillNeeded} to go`}
            />
          )}

          <Button variant="outline" onClick={onUpgrade} className="h-11 w-full">
            <Crown className="mr-2 h-4 w-4" aria-hidden="true" />
            Upgrade for unlimited estimates
          </Button>

          {/* The always-available exit. Never gate, delay or hide this. */}
          <Button variant="ghost" onClick={onCancel} className="h-10 w-full text-muted-foreground">
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to the estimate
          </Button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Nothing you have typed is lost. Close this and your {noun} is still here, exactly as you
          left it.
        </p>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default EstimateCreditsDialog;
