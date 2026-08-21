/**
 * The prompt shown when the daily estimate quota is used up.
 *
 * Two shapes, driven by the `save_gate_mode` setting:
 *
 *  - "required": watching is the only way to save this estimate. The copy says
 *    so plainly rather than implying the work is lost — it is still on the
 *    device, and closing this dialog returns to the form with everything typed
 *    still there.
 *  - "offered": watching is optional and Save anyway is a real button.
 *
 * The wording matters more than usual here. A merchant who thinks their half
 * hour of typing is about to be thrown away will not watch an ad; they will
 * uninstall.
 */

import { useState } from "react";
import { Clapperboard, Loader2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface RewardedSaveDialogProps {
  open: boolean;
  mode: "required" | "offered";
  /** Estimates already saved today. */
  used: number;
  /** Today's allowance, including any already unlocked by ads. */
  allowance: number;
  /** Runs the ad. Resolves true when it was watched to the end. */
  onWatch: () => Promise<boolean>;
  /** Continue without watching. Only reachable in "offered" mode. */
  onSkip: () => void;
  /** Back to the form; nothing is discarded. */
  onCancel: () => void;
}

export function RewardedSaveDialog({
  open,
  mode,
  used,
  allowance,
  onWatch,
  onSkip,
  onCancel,
}: RewardedSaveDialogProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const watch = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const earned = await onWatch();
      if (!earned) {
        setFailed(
          "The ad did not finish, so it does not count. You can try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Clapperboard className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <AlertDialogTitle className="text-center">
            {mode === "required"
              ? "Watch a short ad to save this estimate"
              : "You have used today's free estimates"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            You have saved {used} of {allowance} free estimates today. Watch one short
            ad to unlock another — and earn points you can spend on a plan.
            {mode === "required" && (
              <>
                {" "}
                <span className="mt-2 block font-medium text-foreground">
                  Nothing you have typed is lost. Close this and your estimate is
                  still here.
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {failed && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
            {failed}
          </p>
        )}

        <div className="mt-2 flex flex-col gap-2">
          <Button onClick={watch} disabled={busy} className="h-12 w-full">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading ad…
              </>
            ) : (
              <>
                <Clapperboard className="mr-2 h-4 w-4" />
                Watch ad &amp; save
              </>
            )}
          </Button>

          {mode === "offered" && (
            <Button variant="outline" onClick={onSkip} disabled={busy} className="h-11 w-full">
              Save without watching
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            className="h-10 w-full text-muted-foreground"
          >
            <X className="mr-2 h-4 w-4" />
            Back to estimate
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default RewardedSaveDialog;
