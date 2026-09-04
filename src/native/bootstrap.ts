/**
 * Native boot sequence — status bar, splash, keyboard, hardware back button,
 * connectivity and app-lifecycle wiring.
 *
 * Called once from main.tsx. Every step is independently guarded: a plugin that
 * is missing or throws must never stop the app from starting.
 */

import { App as CapApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { supabase } from "@/integrations/supabase/client";
import { clearOfflineData } from "@/lib/offline/db";
import { isOnline, startNetworkWatch } from "./net";
import { isNative } from "./platform";
import { clearAppPrefs } from "./prefs";
import { resetCreditCache } from "@/lib/estimateCredits";
import { teardownAds } from "./ads";

/** Routes from which the hardware back button should close the app. */
const ROOT_ROUTES = new Set(["/", "/dashboard", "/invoices", "/login"]);

let booted = false;

export async function bootstrapNative(): Promise<void> {
  if (booted) return;
  booted = true;

  // Connectivity is needed on web too — everything else below is native-only.
  await startNetworkWatch();

  if (!isNative) return;

  // ---- status bar -------------------------------------------------------
  // Follows the web theme rather than being pinned dark, so a light-mode phone
  // does not get a black status bar above a white app.
  const paintChrome = async (theme: "light" | "dark") => {
    try {
      // Style.Dark means "dark CONTENT on a light bar" in this plugin, which is
      // the opposite of what the name suggests — hence the inversion here.
      await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
      await StatusBar.setBackgroundColor({ color: theme === "dark" ? "#0B1020" : "#FFFFFF" });
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch {
      /* some OEM skins reject this */
    }
  };

  await paintChrome(document.documentElement.classList.contains("dark") ? "dark" : "light");

  document.addEventListener("cs:themechange", (event) => {
    const theme = (event as CustomEvent<"light" | "dark">).detail;
    void paintChrome(theme === "dark" ? "dark" : "light");
  });

  // ---- keyboard ---------------------------------------------------------
  // setAccessoryBarVisible is iOS-only: on Android the plugin answers with
  // unimplemented() and the promise REJECTS. It used to share a try block with
  // the listeners below, so on every Android device those listeners were never
  // registered, --keyboard-height stayed 0 and the keyboard-aware action bars
  // sat underneath the keyboard. Hence its own guard.
  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch {
    /* iOS-only API */
  }

  try {
    // Expose the keyboard height as a CSS variable so forms can lift their
    // action bars above it instead of hiding the Save button.
    await Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.style.setProperty("--keyboard-height", `${info.keyboardHeight}px`);
      document.body.classList.add("keyboard-open");
    });
    await Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.style.setProperty("--keyboard-height", "0px");
      document.body.classList.remove("keyboard-open");
    });
  } catch {
    /* keyboard plugin unavailable */
  }

  // ---- hardware back button --------------------------------------------
  try {
    await CapApp.addListener("backButton", ({ canGoBack }) => {
      // Let an open dialog/sheet consume the press first.
      const openOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]',
      );
      if (openOverlay) {
        // Radix's DismissableLayer registers a document-level keydown listener
        // for every open layer, so a synthetic Escape closes dialogs, alert
        // dialogs and sheets alike and still runs their onOpenChange. (This used
        // to look for a [data-radix-dialog-close] button first — an attribute
        // src/components/ui/dialog.tsx never renders, so that branch was dead.)
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }

      const atRoot = ROOT_ROUTES.has(window.location.pathname);
      if (canGoBack && !atRoot) {
        window.history.back();
      } else {
        void CapApp.exitApp();
      }
    });
  } catch {
    /* back button wiring failed — Android default applies */
  }

  // ---- token refresh follows the app lifecycle -------------------------
  try {
    await CapApp.addListener("resume", () => {
      void supabase.auth.startAutoRefresh();
    });
    await CapApp.addListener("pause", () => {
      void supabase.auth.stopAutoRefresh();
    });
  } catch {
    /* lifecycle events unavailable */
  }
}

/** Hide the native splash once React has painted its first screen. */
export async function hideSplash(): Promise<void> {
  if (!isNative) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* already hidden */
  }
}

// --------------------------------------------------------------- sign-out

let explicitSignOut = false;
let skipPendingPrompt = false;
let systemSignOut = false;
let signOutIntercepted = false;

/**
 * Declare that the SIGNED_OUT event about to arrive is the user's own doing.
 *
 * Call this immediately before `supabase.auth.signOut()` in a Logout handler.
 * Only an explicit sign-out may destroy local data — see installAuthListener.
 *
 * `discardUnsynced` suppresses the "you have unsynced estimates" confirmation
 * for flows where losing them is the point, such as account deletion.
 */
export function beginUserSignOut(options: { discardUnsynced?: boolean } = {}): void {
  explicitSignOut = true;
  skipPendingPrompt = options.discardUnsynced === true;
}

/**
 * The opposite declaration: a sign-out the APP performs on the user's behalf —
 * the admin/master login screens dropping a session that turned out not to hold
 * the admin role, for instance. Nobody asked to leave the device, so local data
 * must survive and the unsynced-work prompt must not appear.
 */
export function beginSystemSignOut(): void {
  systemSignOut = true;
}

/** Local changes that have not reached the server yet; 0 when unknowable. */
async function unsyncedCount(): Promise<number> {
  try {
    // Imported lazily so the offline/sync modules stay out of the cold-start
    // bundle — this path only runs when somebody presses Logout.
    const { pendingCount } = await import("@/lib/offline/estimates");
    return await pendingCount();
  } catch {
    return 0;
  }
}

/**
 * Last chance to rescue work before signing out wipes the device copy.
 *
 * Returns false when the user chose to stay signed in rather than lose
 * estimates that never reached the server.
 */
async function protectUnsyncedWork(): Promise<boolean> {
  let pending = await unsyncedCount();
  if (pending === 0) return true;

  if (isOnline()) {
    try {
      const [{ syncNow }, { getMirroredCompany }] = await Promise.all([
        import("@/lib/sync/syncEngine"),
        import("@/lib/offline/mirror"),
      ]);
      const company = await getMirroredCompany();
      await syncNow(company?.id, { products: false });
      pending = await unsyncedCount();
    } catch (err) {
      console.warn("[auth] pre-sign-out sync failed:", err);
    }
  }

  if (pending === 0) return true;

  const one = pending === 1;
  return window.confirm(
    `${pending} estimate${one ? "" : "s"} ${one ? "has" : "have"} not been backed up yet. ` +
      `Signing out removes ${one ? "it" : "them"} from this device permanently.\n\n` +
      "Sign out anyway?  (Cancel keeps you signed in so the backup can finish.)",
  );
}

type SignOutFn = typeof supabase.auth.signOut;

/**
 * Treat any call to `supabase.auth.signOut()` as a user-initiated sign-out.
 *
 * GoTrue fires SIGNED_OUT for two very different reasons and the event itself
 * does not say which: the user pressed Logout, or a refresh token could not be
 * renewed (expired, revoked, or simply a week spent offline). Only the first may
 * wipe local data.
 *
 * The public signOut() method is reached exclusively from app code — the
 * refresh-failure path inside supabase-js removes the session and notifies
 * subscribers directly, without going through it — so wrapping it is a reliable
 * signal, and it covers the Logout handlers that live in files this module
 * cannot reach.
 */
function interceptSignOut(): void {
  if (signOutIntercepted) return;
  signOutIntercepted = true;

  const auth = supabase.auth;
  const original = auth.signOut.bind(auth) as SignOutFn;

  auth.signOut = (async (...args: Parameters<SignOutFn>) => {
    const skipPrompt = skipPendingPrompt;
    skipPendingPrompt = false;

    if (systemSignOut) {
      systemSignOut = false;
      explicitSignOut = false; // nothing local may be destroyed
      return original(...args);
    }

    let proceed = true;
    try {
      proceed = skipPrompt || (await protectUnsyncedWork());
    } catch (err) {
      // Whatever went wrong in the guard, being unable to sign out is worse.
      console.warn("[auth] pre-sign-out check failed:", err);
    }

    if (!proceed) {
      // The user backed out. The session stays valid and nothing is destroyed.
      return { error: null };
    }

    explicitSignOut = true;
    return original(...args);
  }) as SignOutFn;
}

/**
 * Global auth listener.
 *
 * An explicit sign-out wipes every local trace of the account: cached queries,
 * the offline estimate store, cached entitlement, and any banner still on
 * screen. Without this the next person to sign in on the device inherits the
 * previous user's data.
 *
 * An UNSOLICITED sign-out is the opposite situation. It means the refresh token
 * failed, which for a merchant who has been offline for a week is routine — so
 * it clears only the in-memory query cache and routes to /login. IndexedDB
 * survives, and with it every estimate that has not been pushed yet: signing
 * back in finds the work waiting instead of gone.
 */
export function installAuthListener(onSignedOut: () => void): () => void {
  interceptSignOut();

  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;

    const wasExplicit = explicitSignOut;
    explicitSignOut = false;

    void (async () => {
      // The estimate-credit mirror is memory only, and it is dropped on EVERY
      // sign-out so the next account on this device cannot read the previous
      // balance out of it. The persisted rows are keyed by company and are
      // deliberately left alone: credits are earned by watching ads, and
      // destroying them on a routine sign-out would be taking that back.
      resetCreditCache();

      // Ads are torn down either way: whoever comes back is unauthenticated
      // until they sign in, and a banner has no business on the login screen.
      if (wasExplicit) {
        await Promise.all([clearOfflineData(), clearAppPrefs(), teardownAds()]);
      } else {
        await teardownAds();
      }
      onSignedOut();
    })();
  });

  return () => data.subscription.unsubscribe();
}
