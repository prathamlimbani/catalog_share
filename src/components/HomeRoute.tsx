import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getMirroredCompany } from "@/lib/offline/mirror";
import { isOnline } from "@/native/net";
import { PREF_KEYS, prefGet } from "@/native/prefs";
import AuthChoice from "@/components/onboarding/AuthChoice";
import Onboarding from "@/components/onboarding/Onboarding";

type Phase = "checking" | "onboarding" | "auth" | "signed-in";

/**
 * What "/" shows in the app.
 *
 * The app used to redirect straight to /invoices, which bounced a signed-out
 * user to the login form the instant the APK opened — no branding, no context,
 * no way to reach "create an account" except a small link. It then showed the
 * website's home page instead, which fixed the context but looked like a web
 * page inside an app. Now a first-time user gets a native onboarding carousel,
 * and everyone who has already seen it gets the sign-in / sign-up decision on
 * its own. The marketing page is the website's job (see src/pages/Landing.tsx).
 *
 * A returning, signed-in merchant should not have to walk past any of that to
 * get to work, so the session is resolved BEFORE anything paints — rendering a
 * welcome screen first and redirecting after would flash it on every launch.
 * The onboarding flag is read in the same pre-paint phase, and in parallel, so
 * a returning user never sees a frame of slide 1 and the check costs no extra
 * time.
 */
export default function HomeRoute() {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let active = true;

    void (async () => {
      // Started before the session read, awaited only where it is needed, so
      // the two round trips overlap instead of queueing.
      const onboarded = prefGet(PREF_KEYS.onboarded).catch(() => null);
      const signedOutPhase = async (): Promise<Phase> => ((await onboarded) ? "auth" : "onboarding");

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;

        if (!error && data.session) {
          setPhase("signed-in");
          return;
        }

        // Offline with a mirrored company means this device has signed in
        // before; the session is simply unverifiable right now. Sending them to
        // the welcome screen would look like being logged out, so trust the
        // mirror — every screen behind this still enforces its own access.
        if (!isOnline()) {
          const mirrored = await getMirroredCompany();
          if (!active) return;
          if (mirrored) {
            setPhase("signed-in");
            return;
          }
        }

        const next = await signedOutPhase();
        if (active) setPhase(next);
      } catch {
        // A failed session lookup is not proof of being signed out, but the
        // welcome screens are the safe place to land: their actions all work.
        const next = await signedOutPhase();
        if (active) setPhase(next);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // One session read plus one preference read. Painting anything here would
  // either flash a welcome screen at a returning user or flash the app shell at
  // a stranger.
  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (phase === "signed-in") return <Navigate to="/invoices" replace />;

  if (phase === "onboarding") return <Onboarding />;

  return <AuthChoice />;
}
