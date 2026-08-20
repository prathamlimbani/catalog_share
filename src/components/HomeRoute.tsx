import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getMirroredCompany } from "@/lib/offline/mirror";
import { isOnline } from "@/native/net";
import Landing from "@/pages/Landing";

type Phase = "checking" | "welcome" | "signed-in";

/**
 * What "/" shows.
 *
 * The app used to redirect straight to /invoices, which bounced a signed-out
 * user to the login form the instant the APK opened — no branding, no context,
 * no way to reach "create an account" except a small link. Now a first-time
 * user gets the same home page as the website, with its Create Your Catalog and
 * I already have an account calls to action.
 *
 * A returning, signed-in merchant should not have to walk past a marketing page
 * to get to work, so the session is resolved BEFORE anything paints — rendering
 * Landing first and redirecting after would flash it on every launch.
 */
export default function HomeRoute() {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let active = true;

    void (async () => {
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

        setPhase("welcome");
      } catch {
        // A failed session lookup is not proof of being signed out, but the
        // welcome screen is the safe place to land: both its actions work.
        if (active) setPhase("welcome");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // One session read. Painting anything here would either flash the marketing
  // page at a returning user or flash the app shell at a stranger.
  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (phase === "signed-in") return <Navigate to="/invoices" replace />;

  return <Landing />;
}
