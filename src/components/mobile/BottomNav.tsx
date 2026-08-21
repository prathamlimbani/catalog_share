import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { CreditCard, FileText, LayoutGrid, Package, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncPending } from "@/hooks/useSync";

interface TabDef {
  to: string;
  label: string;
  icon: typeof Package;
  /** Extra paths that should also light this tab up. */
  match?: (pathname: string) => boolean;
}

const TABS: TabDef[] = [
  {
    to: "/invoices",
    label: "Estimates",
    icon: FileText,
    match: (p) => p.startsWith("/invoices"),
  },
  {
    to: "/dashboard",
    label: "Products",
    icon: Package,
    match: (p) => p.startsWith("/dashboard"),
  },
  {
    to: "/store",
    label: "Store",
    icon: LayoutGrid,
    match: (p) => p.startsWith("/store"),
  },
  {
    to: "/billing",
    label: "Billing",
    icon: CreditCard,
    match: (p) => p.startsWith("/billing"),
  },
  {
    to: "/account",
    label: "Account",
    icon: UserRound,
    match: (p) => p.startsWith("/account") || p.startsWith("/more") || p.startsWith("/settings"),
  },
];

/**
 * Tracks the `keyboard-open` class the native bootstrap puts on <body>.
 *
 * There is no CSS-only way to react to it from a Tailwind class list, and no
 * event either — the class is the contract, so watch it directly. On web the
 * class is never set, so this settles on `false` and never fires again.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const read = () => setOpen(document.body.classList.contains("keyboard-open"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return open;
}

/**
 * Bottom tab bar — the app's primary navigation on phones.
 *
 * Sits above the gesture bar (pb-safe) and above the AdMob banner, whose live
 * height is published as --banner-height so the two never overlap.
 *
 * The banner is cleared with padding, NOT by lifting the bar off the bottom of
 * the screen. Offsetting `bottom` left a --banner-height gap underneath the bar
 * that showed whatever the page had scrolled to whenever that value was wrong —
 * a stale SizeChanged, an ad that reserved space and never painted — which read
 * as a rendering glitch, most visibly on the long estimate form. Anchored at 0
 * the bar always reaches the bottom of the viewport, so the worst a bad value
 * can now do is make the bar slightly too tall. The reserved strip is where the
 * native banner draws.
 *
 * Hidden while the soft keyboard is up: Android resizes the WebView, so the bar
 * would otherwise park itself directly on top of the keyboard and cover the
 * sticky Save bars that the forms lift with `.keyboard-aware`.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  const pending = useSyncPending();
  const keyboardOpen = useKeyboardOpen();

  if (keyboardOpen) return null;

  return (
    <nav
      className={cn(
        "fixed inset-x-0 z-40 lg:hidden print:hidden",
        "border-t border-border bg-card/98 backdrop-blur-md",
      )}
      style={{ bottom: 0, paddingBottom: "var(--banner-height, 0px)" }}
      aria-label="Primary"
    >
      <ul className="flex items-stretch justify-around pb-safe">
        {TABS.map((tab) => {
          const active = tab.match ? tab.match(pathname) : pathname === tab.to;
          const Icon = tab.icon;

          return (
            <li key={tab.to} className="min-w-0 flex-1">
              <NavLink
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 px-0.5",
                  // 10px keeps "Estimates" — the longest label — inside a 64px
                  // tab at 320px. The step up to 11px only applies once there is
                  // room for it.
                  "text-[10px] font-medium leading-none min-[360px]:text-[11px]",
                  active ? "text-primary" : "text-muted-foreground active:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} />
                  {tab.to === "/invoices" && pending > 0 && (
                    <span
                      className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white"
                      title={`${pending} estimate${pending === 1 ? "" : "s"} waiting to sync`}
                    >
                      {pending > 9 ? "9+" : pending}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate leading-none">{tab.label}</span>
                {active && (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomNav;
