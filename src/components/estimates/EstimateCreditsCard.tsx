/**
 * The balance strip above the estimate list.
 *
 * It exists so the gate dialog is never the first time a merchant hears the
 * price. The number they will spend, what it costs to create, what it costs to
 * edit, and a way to bank more ahead of time are all visible before they open
 * the form — which turns the dialog from an ambush into a confirmation.
 *
 * Banking ahead also fixes the worst moment in the flow: standing in front of a
 * customer with a finished estimate and being asked to sit through two ads.
 * Credits watched over morning tea spend exactly the same.
 */

import { useState } from "react";
import { Clapperboard, Crown, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { costOf, formatUntil, type CreditSnapshot } from "@/lib/estimateCredits";
import type { RewardedOutcome } from "@/native/ads";
import WatchAdButton from "./WatchAdButton";

export interface EstimateCreditsCardProps {
  credits: CreditSnapshot;
  onWatch: () => Promise<RewardedOutcome>;
  onUpgrade: () => void;
}

/**
 * Rendered only where the gate is enforced, which is the native build alone —
 * see `creditsEnforced`. A browser cannot play a rewarded ad, so a "watch an
 * ad" button there would be a button that can never work.
 */
export function EstimateCreditsCard({ credits, onWatch, onUpgrade }: EstimateCreditsCardProps) {
  const [open, setOpen] = useState(false);
  const createCost = costOf("create", credits.config);
  const editCost = costOf("edit", credits.config);
  const { estimates, spare, watch } = credits;

  return (
    <Card className="mx-auto mb-3 w-full max-w-2xl overflow-hidden p-0">
      <div className="flex items-center gap-3 p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-600 dark:text-amber-400">
          <Ticket className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {estimates === 0
              ? "No estimates left"
              : `${estimates} estimate${estimates === 1 ? "" : "s"} left`}
            {spare > 0 && (
              <span className="ml-1 font-normal text-muted-foreground">
                + {spare} ad{spare === 1 ? "" : "s"} towards the next
              </span>
            )}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {createCost} ads to create · {editCost} ad{editCost === 1 ? "" : "s"} to edit
          </p>
        </div>

        <Button
          size="sm"
          variant={estimates === 0 ? "default" : "outline"}
          className="h-9 shrink-0"
          onClick={() => setOpen((v) => !v)}
        >
          <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Get more
        </Button>
      </div>

      {open && (
        <div className="border-t border-border p-3.5">
          <WatchAdButton onWatch={onWatch} watch={watch} label="Watch an ad · +1 credit" />
          <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
            {watch.allowed
              ? `${watch.remaining} more ${watch.remaining === 1 ? "ad" : "ads"} available right now. Credits never expire, so it is worth banking a few.`
              : `Ad limit reached. Another opens up in ${formatUntil(Math.max(0, watch.resetsAt - Date.now()))}.`}
          </p>

          <Button variant="ghost" className="mt-2 h-10 w-full text-xs" onClick={onUpgrade}>
            <Crown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Or upgrade and never watch another
          </Button>
        </div>
      )}
    </Card>
  );
}

export default EstimateCreditsCard;
