import { useEffect } from "react";

/**
 * Applies a company's selected color theme to CSS custom properties.
 * Overrides --primary and --accent with the company's saved theme.
 * Uses dark mode aware accent colors.
 */
const useStoreTheme = (themePrimary: string | null, themeAccent: string | null) => {
    useEffect(() => {
        if (!themePrimary) return;

        const root = document.documentElement;
        const originalPrimary = getComputedStyle(root).getPropertyValue("--primary").trim();
        const originalAccent = getComputedStyle(root).getPropertyValue("--accent").trim();
        const originalRing = getComputedStyle(root).getPropertyValue("--ring").trim();

        root.style.setProperty("--primary", themePrimary);
        root.style.setProperty("--ring", themePrimary);
        if (themeAccent) {
            root.style.setProperty("--accent", themeAccent);
        }

        return () => {
            // Restore original values when unmounting
            root.style.setProperty("--primary", originalPrimary);
            root.style.setProperty("--accent", originalAccent);
            root.style.setProperty("--ring", originalRing);
        };
    }, [themePrimary, themeAccent]);
};

export default useStoreTheme;
