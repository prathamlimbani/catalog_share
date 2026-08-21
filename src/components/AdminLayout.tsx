import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CreditCard,
  FileText,
  LayoutGrid,
  LogOut,
  Mail,
  Package,
  Pencil,
  Search,
  Store,
  User,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import CompanyEditDialog from "@/components/CompanyEditDialog";
import { CustomerSupportDialog } from "@/components/CustomerSupportDialog";
import BottomNav from "@/components/mobile/BottomNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { onBannerHeightChange } from "@/native/ads";
import { useSyncScheduler } from "@/hooks/useSync";
import { useEntitlementLive } from "@/hooks/useEntitlementLive";

interface AdminLayoutProps {
  children: React.ReactNode;
  company: any;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onLogout: () => void;
  /** Hide the product search field on screens where it means nothing. */
  showSearch?: boolean;
  /** Overrides the company name in the header. */
  title?: string;
  /** Placeholder for the header search. */
  searchPlaceholder?: string;
}

/**
 * The signed-in app shell.
 *
 * Adaptive by breakpoint rather than by device:
 *  - phone (< lg)  : compact header + fixed bottom tab bar
 *  - tablet/desktop: persistent left sidebar, no tab bar
 *
 * This is one component rather than two so that a foldable which changes width
 * mid-session simply re-renders into the other layout with no state loss.
 */
export const AdminLayout = ({
  children,
  company,
  searchQuery,
  onSearchChange,
  onLogout,
  showSearch = true,
  title,
  searchPlaceholder = "Search products...",
}: AdminLayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  // A logo_url pointing at a deleted storage object renders as a broken-image
  // glyph in the header on every screen. One failed load switches the whole
  // shell back to the wordmark/initials fallback.
  const [logoBroken, setLogoBroken] = useState(false);

  // Keep the offline queue draining in the background for as long as the user
  // is inside the app shell.
  useSyncScheduler(company?.id);
  // Keeps the plan current while the app is open, so a payment captured after
  // verify (or a plan granted from the admin console) drops the paywall
  // without the merchant having to restart the app.
  useEntitlementLive(company?.id);

  // Publish the live AdMob banner height so the bottom tab bar and the scroll
  // container can both stay clear of it. Free users only — for paid users the
  // height stays 0 because no banner is ever requested.
  useEffect(() => {
    return onBannerHeightChange((px) => {
      document.documentElement.style.setProperty("--banner-height", `${px}px`);
    });
  }, []);

  // `company` is an untyped row: name can be null, blank, or not even a string.
  const companyName = typeof company?.name === "string" ? company.name.trim() : "";
  const logoUrl = !logoBroken && typeof company?.logo_url === "string" ? company.logo_url : "";

  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .map((word) => word.charAt(0))
      .join("")
      .substring(0, 2)
      .toUpperCase() || "CS";

  const handleEditCompanyClick = () => setEditDialogOpen(true);
  const handleSupportClick = () => setSupportDialogOpen(true);

  const navItem = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 font-medium transition-colors",
        location.pathname.startsWith(to)
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </Link>
  );

  const NavLinks = () => (
    <>
      <div className="flex h-[88px] items-center gap-3 border-b px-6 py-6">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={companyName || "Logo"}
            onError={() => setLogoBroken(true)}
            className="max-h-12 w-full shrink-0 object-contain object-left"
          />
        ) : (
          <>
            <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
              <Store className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">CatalogShare</span>
          </>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-6">
        {navItem("/invoices", <FileText className="h-5 w-5" />, "Estimates")}
        {navItem("/dashboard", <Package className="h-5 w-5" />, "Products")}
        {navItem("/store", <LayoutGrid className="h-5 w-5" />, "My Store")}
        {navItem("/billing", <CreditCard className="h-5 w-5" />, "Billing")}

        {company && (
          <button
            onClick={handleEditCompanyClick}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-5 w-5" />
            Edit Company
          </button>
        )}

        <button
          onClick={handleSupportClick}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Mail className="h-5 w-5" />
          Customer Support
        </button>

        {navItem("/account", <UserRound className="h-5 w-5" />, "Account")}
      </div>

      <div className="border-t p-4">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh bg-secondary/30 print:block print:bg-white">
      {/* Sidebar — tablets and up */}
      <aside className="fixed inset-y-0 z-20 hidden w-64 flex-col border-r bg-card lg:flex print:hidden">
        <NavLinks />
      </aside>

      <main className="flex min-h-dvh w-full min-w-0 flex-1 flex-col lg:pl-64 print:block print:pl-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card px-3 pt-safe sm:px-6 print:hidden">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-2 sm:h-16">
            {/* No hamburger below lg: the bottom tab bar is the navigation there,
                and two competing menus on a 360px screen is just clutter. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt=""
                  onError={() => setLogoBroken(true)}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              )}
              <h1 className="truncate text-base font-bold sm:text-xl">
                {title || companyName || "CatalogShare"}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            {showSearch && (
              <div className="relative hidden sm:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={searchPlaceholder}
                  className="h-10 w-[180px] rounded-full border-transparent bg-secondary/50 pl-9 transition-all focus-visible:bg-secondary focus-visible:ring-1 lg:w-[250px]"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
            )}

            <ThemeToggle />

            <button
              onClick={() => navigate("/account")}
              className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              aria-label="Account"
            >
              <Avatar className="h-9 w-9 bg-primary font-semibold text-primary-foreground">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {companyName ? getInitials(companyName) : <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
            </button>
          </div>
        </header>

        <OfflineBanner companyId={company?.id} className="print:hidden" />

        {/* Phone-width search sits under the header rather than competing with
            the title for space in it. */}
        {showSearch && (
          <div className="border-b bg-card p-3 sm:hidden print:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={searchPlaceholder}
                className="h-10 w-full rounded-full bg-secondary/50 pl-9"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Bottom padding is set on its own axis, never through a `p-*`
            shorthand. Tailwind emits its responsive utilities after this file's
            plain `.pb-safe-tabbar` rule, so `sm:p-6` was resetting
            padding-bottom to 1.5rem from 640px up — and the tab bar is visible
            until 1024px, which left the last 64px of every page on a small
            tablet or an unfolded foldable sitting underneath it.

            From lg the tab bar is gone, but the AdMob banner is still painted
            over the bottom of the WebView, so the override clears the banner
            and the gesture inset rather than dropping to a flat 2rem. */}
        <div className="native-scroll no-x-scroll min-w-0 flex-1 px-3 pt-3 pb-safe-tabbar sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-[calc(env(safe-area-inset-bottom)+var(--banner-height)+2rem)] print:p-0">
          {children}
        </div>
      </main>

      <BottomNav />

      {company && (
        <CompanyEditDialog
          company={company}
          externalOpen={editDialogOpen}
          onExternalOpenChange={setEditDialogOpen}
        />
      )}
      <CustomerSupportDialog
        plan={company?.subscription_plan || "free"}
        externalOpen={supportDialogOpen}
        onExternalOpenChange={setSupportDialogOpen}
      />
    </div>
  );
};

export default AdminLayout;
