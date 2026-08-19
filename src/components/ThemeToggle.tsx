import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyTheme,
  getStoredPreference,
  nextPreference,
  setStoredPreference,
  subscribeToSystemTheme,
  type ThemePreference,
} from "@/lib/theme";

const ICON = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const LABEL: Record<ThemePreference, string> = {
  light: "Light theme",
  dark: "Dark theme",
  system: "Match device theme",
};

/**
 * Three-state theme control: light → dark → system.
 *
 * "system" is the default and follows the phone, because a merchant who has put
 * their whole device in dark mode expects apps to honour it — and one who has
 * not is usually working in daylight.
 */
const ThemeToggle = () => {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredPreference());

  useEffect(() => {
    applyTheme(preference);
    setStoredPreference(preference);
  }, [preference]);

  // Follow the OS while the user is on "system" — Android can flip it on a
  // schedule or on battery saver, mid-session.
  useEffect(() => {
    if (preference !== "system") return;
    return subscribeToSystemTheme(() => applyTheme("system"));
  }, [preference]);

  const Icon = ICON[preference];

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setPreference(nextPreference(preference))}
      aria-label={LABEL[preference]}
      title={LABEL[preference]}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
};

export default ThemeToggle;
