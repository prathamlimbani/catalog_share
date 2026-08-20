import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/appInfo";

type AuthChoicePanelProps = {
  /**
   * Fires just before either action navigates. Onboarding uses it to write the
   * "seen it" flag so the carousel never reappears once a choice was made.
   */
  onChoose?: () => void;
  /** h1 on the standalone screen, h2 when it is the last slide of a carousel. */
  headingAs?: "h1" | "h2";
};

/**
 * The decision itself — brand mark, one-line promise, two ways in.
 *
 * It lives in its own component because it is shown twice: as the final
 * onboarding slide, and as the whole screen for a signed-out user who has
 * already been through onboarding. Two copies would drift apart.
 */
export function AuthChoicePanel({ onChoose, headingAs: Heading = "h2" }: AuthChoicePanelProps) {
  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center gap-5 text-center">
        <img
          src="/logo.png"
          alt={APP_NAME}
          className="h-16 w-auto max-w-[70vw] object-contain"
        />

        <div className="space-y-2">
          <Heading className="text-2xl font-bold tracking-tight text-foreground">
            Ready when you are
          </Heading>
          <p className="text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
            Your catalogue, your estimates and your WhatsApp orders — all in one app.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button asChild size="lg" className="h-12 w-full text-base">
          <Link to="/register" onClick={onChoose}>
            Create your catalogue
            <ArrowRight className="ml-1" />
          </Link>
        </Button>

        <Button asChild size="lg" variant="outline" className="h-12 w-full text-base">
          <Link to="/login" onClick={onChoose}>
            I already have an account
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The signed-out home screen of the app, once onboarding has been seen.
 *
 * This is what replaced the marketing page: a returning-but-signed-out user
 * wants to get in, not to be sold to again.
 */
export default function AuthChoice() {
  return (
    <div className="flex h-screen flex-col bg-background pb-safe pt-safe">
      <div className="native-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        {/* min-h-full + justify-center centres on a tall phone but lets the
            content scroll instead of clipping on a short landscape screen. */}
        <div className="flex min-h-full flex-col items-center justify-center">
          <AuthChoicePanel headingAs="h1" />
        </div>
      </div>
    </div>
  );
}
