/**
 * App Links → in-app routes.
 *
 * AndroidManifest.xml claims https://app.catalogshare.online/store/… and /invoices/…
 * with autoVerify, so Android hands those taps to this app instead of the
 * browser. Until something reads the incoming URL, though, the app simply opened
 * on whatever screen it opens on — a shared storefront link took the recipient
 * to the login screen rather than the shop.
 *
 * This has to live inside <BrowserRouter> (bootstrapNative runs long before the
 * router exists) so it can use the router's own navigation instead of a reload,
 * which would throw away the WebView's warm state.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "@/native/platform";

/** Must stay in step with the App Links intent-filter in AndroidManifest.xml. */
const APP_LINK_HOSTS = new Set([
  "app.catalogshare.online",
  // Kept so storefront links shared before the move still open in the app.
  "catalogshare.online",
  "www.catalogshare.online",
]);

/**
 * A cold-start link arrives twice on some Android versions — once as the launch
 * intent and once as an appUrlOpen event — and navigating twice would leave a
 * duplicate entry in the history stack.
 */
const DUPLICATE_WINDOW_MS = 3000;

export const DeepLinkHandler = (): null => {
  const navigate = useNavigate();
  const last = useRef<{ url: string; at: number } | null>(null);

  useEffect(() => {
    if (!isNative) return;

    let active = true;
    let removeListener: (() => void) | undefined;

    const openInApp = (raw?: string | null) => {
      if (!active || !raw) return;

      const now = Date.now();
      if (last.current?.url === raw && now - last.current.at < DUPLICATE_WINDOW_MS) return;
      last.current = { url: raw, at: now };

      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return; // not a URL we can route on
      }

      // Only our own links. Anything else stays with the system browser.
      if (!APP_LINK_HOSTS.has(parsed.hostname)) return;

      const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (!target.startsWith("/")) return;

      navigate(target);
    };

    void CapApp.addListener("appUrlOpen", (event) => openInApp(event.url)).then((handle) => {
      if (active) {
        removeListener = () => void handle.remove();
      } else {
        void handle.remove();
      }
    });

    // A link that COLD-starts the app is delivered as the launch intent, and the
    // listener above is registered too late to see it.
    void CapApp.getLaunchUrl()
      .then((result) => openInApp(result?.url))
      .catch(() => {
        /* no launch URL — ordinary launcher start */
      });

    return () => {
      active = false;
      removeListener?.();
    };
  }, [navigate]);

  return null;
};

export default DeepLinkHandler;
