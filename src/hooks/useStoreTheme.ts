import { useEffect } from "react";
import { isSkinTheme, getSkinId, getSkinById, PREMIUM_SKINS } from "@/lib/premiumSkins";

/**
 * Applies a company's selected color theme or premium skin to CSS custom properties.
 * 
 * For regular themes: Overrides --primary and --accent with the company's saved theme.
 * For premium skins: Applies complete CSS variable overrides and adds wrapper classes.
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

            // Save all original values we're going to override
            const originalVars: Record<string, string> = {};
            const varsToApply = isDark ? skin.darkCssVars : skin.cssVars;
            
            Object.keys(varsToApply).forEach((key) => {
                originalVars[key] = getComputedStyle(root).getPropertyValue(key).trim();
            });

            // Apply all skin CSS variables
            Object.entries(varsToApply).forEach(([key, value]) => {
                root.style.setProperty(key, value);
            });

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
                const newVars = nowDark ? skin.darkCssVars : skin.cssVars;
                Object.entries(newVars).forEach(([key, value]) => {
                    root.style.setProperty(key, value);
                });
            });
            observer.observe(root, { attributes: true, attributeFilter: ["class"] });

            return () => {
                // Restore original values
                Object.entries(originalVars).forEach(([key, value]) => {
                    root.style.setProperty(key, value);
                });
                // Remove skin class
                document.body.classList.remove(skin.wrapperClass);
                observer.disconnect();
            };
        }

        // Regular color theme
        const originalPrimary = getComputedStyle(root).getPropertyValue("--primary").trim();
        const originalAccent = getComputedStyle(root).getPropertyValue("--accent").trim();
        const originalRing = getComputedStyle(root).getPropertyValue("--ring").trim();

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
            // Restore original values when unmounting
            root.style.setProperty("--primary", originalPrimary);
            root.style.setProperty("--accent", originalAccent);
            root.style.setProperty("--ring", originalRing);
        };
    }, [themePrimary, themeAccent]);
};

export default useStoreTheme;
