/**
 * Theme resolution.
 *
 * The app used to hardcode `class="dark"` on <html> and default every user to
 * dark regardless of their device. It now defaults to **system**: light unless
 * the phone says otherwise.
 *
 * The dark class lives on <html> (documentElement), never on <body> — several
 * CSS rules key off `html.dark`, and a stray `body.dark` silently matches
 * nothing.
 */

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

/** Cycle order for the toggle button. */
const ORDER: ThemePreference[] = ["light", "dark", "system"];

export function nextPreference(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The stored choice, defaulting to "system" for anyone who has never chosen. */
export function getStoredPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* storage unavailable in some privacy modes */
  }
  return "system";
}

export function setStoredPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* non-fatal: the theme just will not persist */
  }
}

/** Resolve a preference to the concrete theme to paint. */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

/**
 * Paint a theme.
 *
 * Also updates `color-scheme`, which is what makes native form controls, the
 * scrollbars and the date picker render in the matching palette — without it a
 * dark app gets a white date picker.
 */
export function applyTheme(preference: ThemePreference): "light" | "dark" {
  const theme = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  // Keep the Android status/navigation bars in step with the web layer.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0B1020" : "#FFFFFF");

  // Announced rather than imported: the native status-bar update lives in the
  // Capacitor layer, and theme.ts must stay usable in the browser build.
  document.dispatchEvent(new CustomEvent("cs:themechange", { detail: theme }));

  return theme;
}

/** Watch the OS setting. Returns an unsubscribe function. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;

  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();

  // Safari < 14 and some old Android WebViews only have the deprecated form.
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }
  query.addListener(handler);
  return () => query.removeListener(handler);
}

/**
 * Apply the stored theme as early as possible.
 *
 * Called from main.tsx before React mounts so the first painted frame is
 * already the right colour — otherwise a light-mode user sees a dark flash.
 */
export function initTheme(): void {
  const preference = getStoredPreference();
  applyTheme(preference);

  if (preference === "system") {
    subscribeToSystemTheme(() => applyTheme("system"));
  }
}
