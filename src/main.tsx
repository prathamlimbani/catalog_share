import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { bootstrapNative, hideSplash } from "./native/bootstrap";
import { isNative } from "./native/platform";
import { initTheme } from "./lib/theme";

/**
 * Boot order matters:
 *  1. Tag the document so the native-only CSS layer applies before first paint.
 *  2. Mount React.
 *  3. Wire the native plugins (status bar, keyboard, back button, network).
 *  4. Only then hide the splash — hiding it earlier shows a blank frame.
 */
// Resolve light/dark before React mounts.
initTheme();

if (isNative) {
  document.body.classList.add("is-native");
  document.documentElement.classList.add("is-native");
}

createRoot(document.getElementById("root")!).render(<App />);

/**
 * Dismiss the splash.
 *
 * Deliberately NOT gated on requestAnimationFrame: the splash is a separate
 * window sitting on top of the WebView, and an occluded WebView has its rAF
 * callbacks throttled — on some OEM builds they never fire at all, so the
 * "hide" never ran and the logo stayed on screen permanently.
 *
 * Two independent timers, because failing to hide the splash makes the app
 * completely unusable while hiding it slightly early costs nothing.
 */
let splashHidden = false;
const dismissSplash = () => {
  if (splashHidden) return;
  splashHidden = true;
  void hideSplash();
};

// Failsafe: fires no matter what bootstrapNative does, including hanging.
setTimeout(dismissSplash, 2500);

void bootstrapNative()
  .catch((err) => {
    // A failed native bootstrap must not leave the user staring at a splash.
    console.error("[boot] native bootstrap failed:", err);
  })
  .finally(() => {
    setTimeout(dismissSplash, 150);
  });
