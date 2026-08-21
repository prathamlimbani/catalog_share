import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  ChevronRight,
  Crown,
  FileText,
  Fingerprint,
  LogOut,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
import { useCurrentCompany } from "@/hooks/useCompany";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useManualSync, useSyncPending, useSyncState } from "@/hooks/useSync";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import CompanyEditDialog from "@/components/CompanyEditDialog";
import { ThemeSetting } from "@/components/ThemeSetting";
import { useRewardsConfig } from "@/hooks/useRewards";
import { Coins } from "lucide-react";
import { hideBanner, openPrivacyOptions } from "@/native/ads";
import {
  isBiometricAvailable,
  isLockEnabled,
  setLockEnabled,
  type BiometricStatus,
} from "@/native/biometrics";
import { isNative } from "@/native/platform";
import { notify } from "@/native/files";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_DIGITS,
  SUPPORT_PHONE_ENABLED,
  APP_VERSION,
} from "@/lib/appInfo";
import { toast } from "sonner";

interface RowProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  to?: string;
  danger?: boolean;
  trailing?: React.ReactNode;
}

function Row({ icon, label, hint, onClick, to, danger, trailing }: RowProps) {
  const content = (
    <>
      <span
        className={
          danger
            ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span
          className={
            danger
              ? "block truncate text-sm font-medium text-destructive"
              : "block truncate text-sm font-medium text-foreground"
          }
        >
          {label}
        </span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {trailing ?? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60 hover:bg-muted/40";

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * A Row whose trailing control is a switch.
 *
 * Deliberately not `<Row trailing={<Switch />} />`: Row is itself a button and
 * Radix renders the switch as one, and a button inside a button is invalid
 * markup that swallows the inner tap on some Android WebViews. The label is its
 * own button instead, which also gives the row a full-width 44px target rather
 * than only the 24px-tall switch.
 */
function ToggleRow({ icon, label, hint, checked, disabled, onToggle }: ToggleRowProps) {
  return (
    <div className="flex w-full items-center gap-3 px-4 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center text-left disabled:opacity-60"
      >
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </button>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={label}
        className="shrink-0"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <Card className="divide-y divide-border overflow-hidden p-0">{children}</Card>
    </section>
  );
}

/**
 * The "Account" tab — profile, plan, data, support and the legal surfaces
 * Google Play requires to be reachable in-app.
 */
const More = () => {
  const navigate = useNavigate();
  const { data: company } = useCurrentCompany();
  const { entitlement } = useEntitlement();
  const pending = useSyncPending();
  const { lastSyncAt } = useSyncState();
  const { run: syncRun, busy: syncBusy } = useManualSync(company?.id);
  const { config: rewardsConfig } = useRewardsConfig();
  const [editOpen, setEditOpen] = useState(false);
  const [lockStatus, setLockStatus] = useState<BiometricStatus | null>(null);
  const [lockOn, setLockOn] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  // This screen is chrome, not content — no ads here.
  //
  // Deliberately no cleanup: a screen may only ever turn the banner OFF. Re-
  // showing it on unmount planted a banner on whatever came next, which from
  // here is Terms, Privacy, Account deletion or Billing — exactly the surfaces
  // that must stay ad-free. The destination screen decides if it wants one.
  useEffect(() => {
    void hideBanner();
  }, []);

  // What this phone can do, and whether the lock is already armed. Both are
  // native-only reads that answer instantly on web.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [status, enabled] = await Promise.all([isBiometricAvailable(), isLockEnabled()]);
      if (cancelled) return;
      setLockStatus(status);
      setLockOn(enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLockToggle = async (next: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    // setLockEnabled prompts first and persists nothing unless it passes — in
    // both directions, so an unlocked phone in someone else's hand cannot
    // silently disarm the lock.
    const changed = await setLockEnabled(next);
    setLockBusy(false);

    if (!changed) {
      toast.error(
        next ? "Not verified — app lock stays off." : "Not verified — app lock stays on.",
      );
      return;
    }

    setLockOn(next);
    toast.success(next ? "App lock is on." : "App lock is off.");
  };

  const handleLogout = async () => {
    beginUserSignOut();
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  // `company` is an untyped row and every one of these columns is nullable, so
  // "" is as likely as null. `||` rather than `??` for exactly that reason.
  const companyName = (typeof company?.name === "string" ? company.name.trim() : "") || "";
  const companyEmail = (typeof company?.email === "string" ? company.email.trim() : "") || "";
  const logoUrl = typeof company?.logo_url === "string" ? company.logo_url : "";

  const handleAdPrivacy = async () => {
    const opened = await openPrivacyOptions();
    if (!opened) {
      toast.info("Ad privacy settings are only available where consent is required.");
    }
  };

  const handleCallSupport = () => {
    if (!entitlement.supportPhoneUnlocked) {
      toast.info("Phone support is included with the Pro and Support plans.", {
        action: { label: "See plans", onClick: () => navigate("/billing") },
      });
      return;
    }
    window.location.href = `tel:${SUPPORT_PHONE_DIGITS}`;
  };

  // The hint carries the whole story of the row: what will be asked for, or why
  // the switch cannot be moved.
  const lockHint = !lockStatus
    ? "Checking this device…"
    : lockStatus.available
      ? lockOn
        ? `Asks for ${lockStatus.type.toLowerCase()} when you open the app`
        : `Use ${lockStatus.type.toLowerCase()} to open the app`
      : lockStatus.deviceSecure
        ? "This device has no biometric sensor"
        : "Set a screen lock on your phone first";

  // Guarded rather than inlined: lastSyncAt is a stored epoch, and a bad one
  // would otherwise print the literal string "Invalid Date" in the hint.
  const syncedAt = lastSyncAt ? new Date(lastSyncAt) : null;
  const syncedAtLabel =
    syncedAt && !Number.isNaN(syncedAt.getTime())
      ? syncedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : null;

  const trialDaysLeft = Number.isFinite(entitlement.trialMsRemaining)
    ? Math.ceil(entitlement.trialMsRemaining / 86_400_000)
    : 0;

  return (
    <AdminLayout
      company={company}
      searchQuery=""
      onSearchChange={() => undefined}
      onLogout={handleLogout}
      showSearch={false}
      title="Account"
    >
      <div className="mx-auto w-full max-w-2xl">
        {/* Account header */}
        <Card className="mb-4 flex items-center gap-3 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg font-bold text-primary">
                {(companyName || "CS").slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">
              {companyName || "Your business"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {companyEmail || "Add your email in Edit"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        </Card>

        {/* Plan */}
        <Card className="mb-4 overflow-hidden p-0">
          <div className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-600 dark:text-amber-400">
              {entitlement.isPaid ? <Crown className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {entitlement.planName}
                </p>
                {entitlement.isPaid ? (
                  <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                    ACTIVE
                  </Badge>
                ) : entitlement.trialActive ? (
                  <Badge className="h-5 bg-amber-500/15 px-1.5 text-[10px] font-bold text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
                    TRIAL
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {entitlement.isPaid
                  ? `Renews manually · ${entitlement.daysRemaining} day${entitlement.daysRemaining === 1 ? "" : "s"} left`
                  : entitlement.trialActive
                    ? `Free trial · ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
                    : "Ads supported · upgrade to remove ads"}
              </p>
            </div>
            <Button size="sm" className="shrink-0" onClick={() => navigate("/billing")}>
              {entitlement.isPaid ? "Manage" : "Upgrade"}
            </Button>
          </div>
        </Card>

        {rewardsConfig.enabled && (
          <Section title="Rewards">
            <Row
              icon={<Coins className="h-[18px] w-[18px]" />}
              label={`Earn ${rewardsConfig.pointsLabel}`}
              hint={`Watch a short ad to earn ${rewardsConfig.pointsLabel}, then spend them on a plan`}
              to="/earn"
            />
          </Section>
        )}

        <Section title="Appearance">
          <ThemeSetting />
        </Section>

        <Section title="Data & sync">
          <Row
            icon={<RefreshCw className={syncBusy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
            label="Sync now"
            hint={
              pending > 0
                ? `${pending} change${pending === 1 ? "" : "s"} waiting`
                : syncedAtLabel
                  ? `Last synced ${syncedAtLabel}`
                  : "Everything up to date"
            }
            onClick={() => {
              void syncRun().then((result) => {
                if (result && !result.skipped) {
                  void notify(`Synced · ${result.pushed} sent, ${result.pulled} received`);
                }
              });
            }}
            trailing={<span />}
          />
          <Row
            icon={<FileText className="h-4 w-4" />}
            label="Estimates"
            hint="Create, edit and share — works offline"
            to="/invoices"
          />
        </Section>

        {/* Native only: there is nothing to prompt with in a browser. */}
        {isNative && (
          <Section title="Security">
            <ToggleRow
              icon={<Fingerprint className="h-4 w-4" />}
              label="Biometric app lock"
              hint={lockHint}
              checked={lockOn}
              disabled={lockBusy || !lockStatus || !lockStatus.available}
              onToggle={(next) => void handleLockToggle(next)}
            />
          </Section>
        )}

        <Section title="Support">
          <Row
            icon={<Mail className="h-4 w-4" />}
            label="Email support"
            hint={SUPPORT_EMAIL}
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}?subject=CatalogShare%20app%20support`;
            }}
          />
          {SUPPORT_PHONE_ENABLED && (
            <Row
              icon={<Phone className="h-4 w-4" />}
              label="Call support"
              hint={entitlement.supportPhoneUnlocked ? SUPPORT_PHONE : "Pro & Support plans only"}
              onClick={handleCallSupport}
            />
          )}
        </Section>

        {isNative && entitlement.adsEnabled && (
          <Section title="Ads">
            <Row
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Ad privacy settings"
              hint="Change your ad consent choices"
              onClick={() => void handleAdPrivacy()}
            />
            <Row
              icon={<Crown className="h-4 w-4" />}
              label="Remove ads"
              hint="Any paid plan removes ads completely"
              onClick={() => navigate("/billing")}
            />
          </Section>
        )}

        <Section title="Legal">
          <Row icon={<FileText className="h-4 w-4" />} label="Terms & Conditions" to="/terms" />
          <Row icon={<Shield className="h-4 w-4" />} label="Privacy Policy" to="/privacy" />
          <Row
            icon={<RotateCcw className="h-4 w-4" />}
            label="Return & Refund Policy"
            to="/refund"
          />
          <Row
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete my account"
            hint="Permanently remove your data"
            to="/account-deletion"
            danger
          />
        </Section>

        {/* No section heading: a group called "Account" inside a page called
            "Account" told the reader nothing. Sign-out stays last, on its own. */}
        <Card className="mb-4 overflow-hidden p-0">
          <Row
            icon={<LogOut className="h-4 w-4" />}
            label="Log out"
            hint={companyEmail || undefined}
            onClick={() => void handleLogout()}
            trailing={<span />}
          />
        </Card>

        <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5" />
            CatalogShare
          </div>
          <p className="text-xs text-muted-foreground/70">Version {APP_VERSION}</p>
          <p className="text-xs text-muted-foreground/70">
            © {new Date().getFullYear()} CatalogShare. All rights reserved.
          </p>
        </div>
      </div>

      {company && (
        <CompanyEditDialog
          company={company as never}
          externalOpen={editOpen}
          onExternalOpenChange={setEditOpen}
        />
      )}
    </AdminLayout>
  );
};

export default More;
