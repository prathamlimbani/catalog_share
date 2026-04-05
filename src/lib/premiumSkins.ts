/**
 * Premium Skin Themes for Pro plan users.
 * These completely transform the store appearance beyond just color changes.
 * 
 * Skin names are stored in theme_primary as "skin:<skin_id>"
 * e.g. "skin:luxe_gold", "skin:wooden_artisan", "skin:midnight_aurora"
 */

export interface PremiumSkin {
  id: string;
  name: string;
  description: string;
  /** Preview colors for the picker [bg, accent, text] */
  previewColors: [string, string, string];
  /** CSS class added to the store wrapper */
  wrapperClass: string;
  /** CSS custom property overrides */
  cssVars: Record<string, string>;
  /** Dark mode CSS custom property overrides */
  darkCssVars: Record<string, string>;
}

export const PREMIUM_SKINS: PremiumSkin[] = [
  {
    id: "luxe_gold",
    name: "Luxe Gold",
    description: "Luxury dark & gold theme",
    previewColors: ["#1a1814", "#d4a853", "#f5e6c8"],
    wrapperClass: "skin-luxe-gold",
    cssVars: {
      "--background": "40 15% 96%",
      "--foreground": "35 30% 12%",
      "--card": "40 20% 99%",
      "--card-foreground": "35 30% 12%",
      "--popover": "40 20% 99%",
      "--popover-foreground": "35 30% 12%",
      "--primary": "43 74% 49%",
      "--primary-foreground": "40 20% 99%",
      "--secondary": "40 18% 92%",
      "--secondary-foreground": "35 30% 12%",
      "--muted": "40 15% 93%",
      "--muted-foreground": "35 10% 48%",
      "--accent": "43 60% 92%",
      "--accent-foreground": "43 74% 30%",
      "--border": "40 15% 88%",
      "--input": "40 15% 88%",
      "--ring": "43 74% 49%",
    },
    darkCssVars: {
      "--background": "35 20% 8%",
      "--foreground": "40 30% 90%",
      "--card": "35 18% 12%",
      "--card-foreground": "40 30% 90%",
      "--popover": "35 18% 12%",
      "--popover-foreground": "40 30% 90%",
      "--primary": "43 74% 55%",
      "--primary-foreground": "35 20% 8%",
      "--secondary": "35 15% 18%",
      "--secondary-foreground": "40 25% 85%",
      "--muted": "35 15% 18%",
      "--muted-foreground": "40 15% 60%",
      "--accent": "43 50% 18%",
      "--accent-foreground": "43 70% 80%",
      "--border": "35 15% 22%",
      "--input": "35 15% 22%",
      "--ring": "43 74% 55%",
    },
  },
  {
    id: "wooden_artisan",
    name: "Wooden Artisan",
    description: "Warm earthy wood tones",
    previewColors: ["#3e2723", "#8d6e63", "#efebe9"],
    wrapperClass: "skin-wooden-artisan",
    cssVars: {
      "--background": "25 25% 95%",
      "--foreground": "16 30% 15%",
      "--card": "28 30% 98%",
      "--card-foreground": "16 30% 15%",
      "--popover": "28 30% 98%",
      "--popover-foreground": "16 30% 15%",
      "--primary": "16 45% 40%",
      "--primary-foreground": "28 30% 98%",
      "--secondary": "25 20% 90%",
      "--secondary-foreground": "16 30% 15%",
      "--muted": "25 18% 91%",
      "--muted-foreground": "16 15% 48%",
      "--accent": "25 35% 90%",
      "--accent-foreground": "16 45% 25%",
      "--border": "25 18% 85%",
      "--input": "25 18% 85%",
      "--ring": "16 45% 40%",
    },
    darkCssVars: {
      "--background": "16 25% 9%",
      "--foreground": "25 20% 88%",
      "--card": "16 22% 13%",
      "--card-foreground": "25 20% 88%",
      "--popover": "16 22% 13%",
      "--popover-foreground": "25 20% 88%",
      "--primary": "25 45% 50%",
      "--primary-foreground": "16 25% 9%",
      "--secondary": "16 18% 18%",
      "--secondary-foreground": "25 18% 82%",
      "--muted": "16 18% 18%",
      "--muted-foreground": "25 12% 58%",
      "--accent": "25 30% 18%",
      "--accent-foreground": "25 40% 75%",
      "--border": "16 18% 22%",
      "--input": "16 18% 22%",
      "--ring": "25 45% 50%",
    },
  },
  {
    id: "midnight_aurora",
    name: "Midnight Aurora",
    description: "Futuristic neon aurora",
    previewColors: ["#0f0f23", "#6366f1", "#22d3ee"],
    wrapperClass: "skin-midnight-aurora",
    cssVars: {
      "--background": "240 15% 96%",
      "--foreground": "240 20% 12%",
      "--card": "240 20% 99%",
      "--card-foreground": "240 20% 12%",
      "--popover": "240 20% 99%",
      "--popover-foreground": "240 20% 12%",
      "--primary": "239 84% 67%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "240 14% 93%",
      "--secondary-foreground": "240 20% 12%",
      "--muted": "240 14% 93%",
      "--muted-foreground": "240 10% 48%",
      "--accent": "187 85% 53%",
      "--accent-foreground": "240 20% 12%",
      "--border": "240 13% 89%",
      "--input": "240 13% 89%",
      "--ring": "239 84% 67%",
    },
    darkCssVars: {
      "--background": "240 25% 5%",
      "--foreground": "210 20% 92%",
      "--card": "240 22% 9%",
      "--card-foreground": "210 20% 92%",
      "--popover": "240 22% 9%",
      "--popover-foreground": "210 20% 92%",
      "--primary": "239 84% 67%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "240 14% 15%",
      "--secondary-foreground": "210 20% 90%",
      "--muted": "240 14% 15%",
      "--muted-foreground": "215 15% 60%",
      "--accent": "187 85% 38%",
      "--accent-foreground": "187 85% 90%",
      "--border": "240 14% 18%",
      "--input": "240 14% 18%",
      "--ring": "239 84% 67%",
    },
  },
];

/**
 * Check if a theme_primary value represents a premium skin
 */
export function isSkinTheme(themePrimary: string | null): boolean {
  return !!themePrimary && themePrimary.startsWith("skin:");
}

/**
 * Extract the skin ID from a theme_primary value
 */
export function getSkinId(themePrimary: string): string {
  return themePrimary.replace("skin:", "");
}

/**
 * Get a skin definition by ID
 */
export function getSkinById(skinId: string): PremiumSkin | undefined {
  return PREMIUM_SKINS.find((s) => s.id === skinId);
}

/**
 * Get the full skin key for storing in theme_primary
 */
export function getSkinKey(skinId: string): string {
  return `skin:${skinId}`;
}
