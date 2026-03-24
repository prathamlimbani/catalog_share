import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

export interface ThemePreset {
    name: string;
    primary: string;
    accent: string;
    color: string;
    isPremium?: boolean;
}

const THEME_PRESETS: ThemePreset[] = [
    { name: "Orange", primary: "25 95% 53%", accent: "25 95% 95%", color: "#f97316" },
    { name: "Blue", primary: "217 91% 60%", accent: "217 91% 95%", color: "#3b82f6" },
    { name: "Green", primary: "142 71% 45%", accent: "142 71% 95%", color: "#22c55e" },
    { name: "Purple", primary: "262 83% 58%", accent: "262 83% 95%", color: "#8b5cf6" },
    { name: "Rose", primary: "346 77% 50%", accent: "346 77% 95%", color: "#e11d48" },
    { name: "Teal", primary: "172 66% 50%", accent: "172 66% 95%", color: "#14b8a6" },
    { name: "Amber", primary: "38 92% 50%", accent: "38 92% 95%", color: "#f59e0b" },
    { name: "Indigo", primary: "239 84% 67%", accent: "239 84% 95%", color: "#6366f1" },
    { name: "Gold", primary: "45 93% 47%", accent: "45 93% 95%", color: "#eab308", isPremium: true },
    { name: "Slate", primary: "215 16% 47%", accent: "215 16% 95%", color: "#64748b", isPremium: true },
    { name: "Emerald", primary: "158 64% 52%", accent: "158 64% 95%", color: "#10b981", isPremium: true },
];

interface ColorThemePickerProps {
    selectedPrimary: string;
    onSelect: (primary: string, accent: string) => void;
    plan?: string;
}

const ColorThemePicker = ({ selectedPrimary, onSelect, plan = "free" }: ColorThemePickerProps) => {
    return (
        <div className="space-y-2">
            <Label>Store Color Theme</Label>
            <div className="grid grid-cols-4 gap-2">
                {THEME_PRESETS.map((preset) => {
                    const isSelected = selectedPrimary === preset.primary;
                    const isPremiumLocked = preset.isPremium && plan !== "growth" && plan !== "pro";
                    return (
                        <button
                            key={preset.name}
                            type="button"
                            disabled={isPremiumLocked}
                            onClick={() => {
                                if (!isPremiumLocked) {
                                    onSelect(preset.primary, preset.accent);
                                }
                            }}
                            className={`relative flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${
                                isPremiumLocked ? "opacity-50 cursor-not-allowed border-transparent" :
                                isSelected ? "border-foreground bg-muted shadow-sm" : "border-transparent hover:border-border hover:bg-muted/50"
                            }`}
                        >
                            <div className="relative">
                                <div
                                    className="w-8 h-8 rounded-full shadow-sm ring-2 ring-background"
                                    style={{ backgroundColor: preset.color }}
                                />
                                {isPremiumLocked && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-full">
                                        <Lock className="w-4 h-4 text-foreground drop-shadow-md" />
                                    </div>
                                )}
                            </div>
                            <span className="text-xs font-medium">{preset.name}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export { THEME_PRESETS };
export default ColorThemePicker;
