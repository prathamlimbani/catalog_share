/**
 * Where a freshly signed-in user belongs.
 *
 * Shared by every way into the app - password, Google on the device, and the
 * browser's return from an OAuth redirect - so the rule lives in one place:
 * platform owner → console, merchant with a company → dashboard, anyone else →
 * company setup.
 */

import type { User } from "@supabase/supabase-js";
import type { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { logActivityInBackground } from "@/lib/activity";

export type PostLoginDestination = "/master-admin" | "/dashboard" | "/register";

/**
 * Decide the destination. Never throws: where to land is a nicety, being
 * signed in is the thing that matters. A dropped connection during these two
 * lookups used to throw the user back to the login form even though the
 * session was already live, so any failure answers "/dashboard" and lets that
 * screen sort it out.
 */
export async function destinationAfterSignIn(user: Pick<User, "id">): Promise<PostLoginDestination> {
  try {
    // An admin signing in through the merchant login still belongs in the
    // console. The error is captured so a failed lookup does not silently
    // route the owner into the company-setup flow.
    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin");

    if (roleError) throw roleError;
    if (roles && roles.length > 0) return "/master-admin";

    const { data: companies, error: companyError } = await supabase
      .from("companies")
      .select("slug")
      .eq("owner_id", user.id)
      .limit(1);

    // A dropped error here reads as "no company" and sends a merchant who has
    // been trading for a year back to the registration form — the same mistake
    // the role lookup above had until 4ba03ee. Throw into the catch, which
    // defaults to the dashboard: for someone who just signed in successfully,
    // guessing "already registered" is the safe way to be wrong.
    if (companyError) throw companyError;

    // No company yet → registration step 2.
    return companies && companies.length > 0 ? "/dashboard" : "/register";
  } catch {
    return "/dashboard";
  }
}

export async function routeAfterSignIn(navigate: NavigateFunction, user: Pick<User, "id">): Promise<void> {
  const destination = await destinationAfterSignIn(user);

  // Logged here rather than in each of the three sign-in screens, for the same
  // reason the routing rule lives here: password, Google-on-device and the
  // OAuth redirect all come through this one function, and a per-screen call
  // would be forgotten by the fourth way in.
  //
  // NOT awaited. Where someone lands must never wait on an audit row, and a
  // sign-in that appears to hang is a sign-in people retry.
  logActivityInBackground("auth.signed_in", {
    summary: destination === "/register" ? "Signed in (no shop yet)" : "Signed in",
    metadata: { destination },
  });

  navigate(destination);
}
