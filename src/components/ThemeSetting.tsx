/**
 * Theme choice as a settings row, rather than a cycling icon in the app bar.
 *
 * The icon button had to be guessed at: it showed the CURRENT state, so a
 * merchant on dark saw a moon and had no way to know that tapping twice reached
 * "match device", or that "match device" existed at all. Three labelled options
 * say what they do.
 *
 * "Match device" is the default for anyone who has never chosen, and it stays
 * live — Android flips the system theme on a schedule and on battery saver, and
 * the app follows without a restart.
 */

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyTheme,
  getStoredPreference,
  setStoredPreference,
  subscribeToSystemTheme,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "system", label: "Match device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeSetting() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredPreference());

  useEffect(() => {
    applyTheme(preference);
    setStoredPreference(preference);
  }, [preference]);

  // Keep following the OS for as long as "Match device" is the choice. This
  // subscription is torn down the moment the user picks a fixed theme, so a
  // system flip cannot override an explicit choice.
  useEffect(() => {
    if (preference !== "system") return;
    return subscribeToSystemTheme(() => applyTheme("system"));
  }, [preference]);

  return (
    <div className="px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Appearance</p>
          <p className="text-xs text-muted-foreground">
            {preference === "system"
              ? "Following your device setting"
              : `Always ${preference}`}
          </p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Appearance"
        className="grid grid-cols-3 gap-2"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(value)}
              className={cn(
                "flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground active:bg-accent",
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 1.9} />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeSetting;
