import { useEffect } from "react";
import { isSkinTheme, getSkinId, getSkinById, PREMIUM_SKINS } from "@/lib/premiumSkins";

/**
 * Applies a company's selected color theme or premium skin to CSS custom properties.
 *
 * For regular themes: Overrides --primary and --accent with the company's saved theme.
 * For premium skins: Applies complete CSS variable overrides and adds wrapper classes.
 *
 * Cleanup REMOVES the properties this hook wrote rather than restoring a
 * snapshot. The snapshot used to be taken with getComputedStyle, so restoring
 * it baked ~16 resolved values onto :root as inline styles — and an inline
 * custom property outranks the `.dark` class, which left dark mode broken for
 * the rest of the session once the user navigated back to /dashboard.
 */
const useStoreTheme = (themePrimary: string | null, themeAccent: string | null) => {
    useEffect(() => {
        if (!themePrimary) return;

        const root = document.documentElement;
        const isDark = root.classList.contains("dark");

        // Check if this is a premium skin
        if (isSkinTheme(themePrimary)) {
            const skinId = getSkinId(themePrimary);
            const skin = getSkinById(skinId);
            if (!skin) return;

            // Union of every property written while this effect is alive. The
            // light and dark variable sets are re-applied on theme flips, so
            // the set has to grow rather than be recomputed.
            const appliedKeys = new Set<string>();

            const applyVars = (vars: Record<string, string>) => {
                Object.entries(vars).forEach(([key, value]) => {
                    root.style.setProperty(key, value);
                    appliedKeys.add(key);
                });
            };

            applyVars(isDark ? skin.darkCssVars : skin.cssVars);

            // Add skin wrapper class to body
            document.body.classList.add(skin.wrapperClass);
            // Remove any other skin classes
            PREMIUM_SKINS.forEach((s) => {
                if (s.id !== skinId) {
                    document.body.classList.remove(s.wrapperClass);
                }
            });

            // Listen for theme (dark/light) changes and re-apply
            const observer = new MutationObserver(() => {
                const nowDark = root.classList.contains("dark");
                applyVars(nowDark ? skin.darkCssVars : skin.cssVars);
            });
            observer.observe(root, { attributes: true, attributeFilter: ["class"] });

            return () => {
                appliedKeys.forEach((key) => root.style.removeProperty(key));
                document.body.classList.remove(skin.wrapperClass);
                observer.disconnect();
            };
        }

        // Regular color theme
        root.style.setProperty("--primary", themePrimary);
        root.style.setProperty("--ring", themePrimary);
        if (themeAccent) {
            root.style.setProperty("--accent", themeAccent);
        }

        // Remove any leftover skin classes
        PREMIUM_SKINS.forEach((s) => {
            document.body.classList.remove(s.wrapperClass);
        });

        return () => {
            // Dropping the inline declaration hands :root back to the
            // stylesheet, so the .dark block wins again as it should.
            root.style.removeProperty("--primary");
            root.style.removeProperty("--ring");
            root.style.removeProperty("--accent");
        };
    }, [themePrimary, themeAccent]);
};

export default useStoreTheme;
