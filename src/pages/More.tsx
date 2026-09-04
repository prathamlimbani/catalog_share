import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  ChevronRight,
  Crown,
  FileText,
  Fingerprint,
  KeyRound,
  Link2,
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
import { Coins, MessageCircle } from "lucide-react";
import { openPrivacyOptions } from "@/native/ads";
import {
  isBiometricAvailable,
  isLockEnabled,
  setLockEnabled,
  type BiometricStatus,
} from "@/native/biometrics";
import { isNative } from "@/native/platform";
import { authConfig, loadAuthConfig } from "@/lib/authConfig";
import { fetchSecurityState, type SecurityState } from "@/lib/otp";
import { fromE164, toE164, toIndianMobile, formatForDisplay, INDIA } from "@/lib/phone";
import OtpChallenge from "@/components/auth/OtpChallenge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { notify } from "@/native/files";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_DIGITS,
  SUPPORT_PHONE_ENABLED,
  APP_VERSION,
} from "@/lib/appInfo";
import { toast } from "sonner";
import type { UserIdentity } from "@supabase/supabase-js";
import { useGoogleSignInConfig } from "@/lib/authProviders";
import {
  googleIdentityOf,
  identityEmail,
  linkGoogleAccount,
  oauthErrorFromLocation,
  unlinkGoogleAccount,
} from "@/lib/googleAuth";
import { authErrorMessage } from "@/lib/errorMessages";

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

interface MethodRowProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Shown at the trailing edge; the row itself is not clickable. */
  action?: React.ReactNode;
}

/**
 * A sign-in method that is already in place: a label, its address, and an
 * optional control. Deliberately a div, not a Row: Row is a button, and the
 * Disconnect control inside it would be a button inside a button, which is
 * invalid markup that swallows the inner tap on some Android WebViews.
 */
function MethodRow({ icon, label, hint, action }: MethodRowProps) {
  return (
    <div className="flex w-full min-h-[56px] items-center gap-3 px-4 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {action ?? <span />}
    </div>
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
  /**
   * What the server says about this account's number.
   *
   * null means NOT KNOWN YET, which is rendered differently from
   * "not verified" — telling a merchant their number is unverified because a
   * query was slow is how you get someone re-verifying a number that was
   * already fine.
   */
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [lockStatus, setLockStatus] = useState<BiometricStatus | null>(null);

  // Refreshed whenever the dialog closes, so a successful verification updates
  // the badge without a reload.
  useEffect(() => {
    let active = true;
    void (async () => {
      await loadAuthConfig();
      const { data: { user } } = await supabase.auth.getUser();
      const state = await fetchSecurityState(user?.id);
      if (active) setSecurity(state);
    })();
    return () => {
      active = false;
    };
  }, [verifyOpen]);
  const [lockOn, setLockOn] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  // ---- sign-in methods ------------------------------------------------
  // The account's own email and its linked identities. Both come from GoTrue,
  // not the company row: a merchant can change the email shown to customers
  // without changing the one they sign in with.
  const { webClientId: googleWebClientId, enabled: googleConfigured } = useGoogleSignInConfig();
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const loadSignInMethods = async () => {
    try {
      const [{ data: userData }, { data: identityData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getUserIdentities(),
      ]);
      setAccountEmail(userData.user?.email ?? "");
      setIdentities(identityData?.identities ?? []);
    } catch {
      // Offline or the lookup failed: leave identities as they were (null =
      // "unknown"), so the email/password row stays shown optimistically
      // rather than the section collapsing. Nothing is set to [] here — an
      // empty array would read as "this account has no sign-in methods".
    }
  };

  // Queried fresh on every mount on purpose: on the web the link flow leaves
  // for Google and comes back to this page, and the new identity has to show
  // up without a manual refresh.
  useEffect(() => {
    void loadSignInMethods();
    // A web "Connect Google" that failed comes back to /account with the reason
    // in the URL. Surface it here — GoTrue does not otherwise tell the user.
    const redirectError = oauthErrorFromLocation();
    if (redirectError) {
      toast.error(authErrorMessage(redirectError, "Couldn't connect Google. Please try again."));
    }
  }, []);

  const googleIdentity = googleIdentityOf(identities);
  const googleEmail = identityEmail(googleIdentity);
  // While identities are unknown (loading or an offline read) assume the common
  // case — an email/password account — so the row does not flicker away. Only a
  // successfully loaded Google-only account (no email identity) hides it.
  const hasEmailIdentity = identities === null ? true : identities.some((i) => i.provider === "email");
  // GoTrue refuses to unlink the last identity, so only offer Disconnect when
  // there is another way in.
  const canDisconnectGoogle = (identities?.length ?? 0) > 1;

  const handleConnectGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const result = await linkGoogleAccount({ webClientId: googleWebClientId });
      if (result.cancelled || result.redirected) return;
      toast.success(result.email ? `Google connected · ${result.email}` : "Google connected.");
      await loadSignInMethods();
    } catch (error) {
      toast.error(authErrorMessage(error, "Could not connect Google. Please try again."));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (googleBusy) return;
    const confirmed = window.confirm(
      "Disconnect Google from this account?\n\nYou will still be able to sign in with your email and password.",
    );
    if (!confirmed) return;
    setGoogleBusy(true);
    try {
      await unlinkGoogleAccount();
      toast.success("Google disconnected.");
      await loadSignInMethods();
    } catch (error) {
      toast.error(authErrorMessage(error, "Could not disconnect Google. Please try again."));
    } finally {
      setGoogleBusy(false);
    }
  };

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
  // The number as stored on the company row, reduced to its local part so it can
  // be compared with `user_security.phone` (which the server normalises to ten
  // digits) and rendered consistently.
  const companyPhoneLocal = fromE164(company?.phone).local;
  const phoneIsVerified =
    security?.phoneVerified === true && security.phone === toIndianMobile(companyPhoneLocal);

  const syncedAtLabel =
    syncedAt && !Number.isNaN(syncedAt.getTime())
      ? syncedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : null;

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
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {entitlement.isPaid
                  ? `Renews manually · ${entitlement.daysRemaining} day${entitlement.daysRemaining === 1 ? "" : "s"} left`
                  : "Ads supported · upgrade to remove ads"}
              </p>
            </div>
            <Button size="sm" className="shrink-0" onClick={() => navigate("/billing")}>
              {entitlement.isPaid ? "Manage" : "Upgrade"}
            </Button>
          </div>
        </Card>

        {/* The Google row appears once the server is set up for it, and stays
            visible for an account that already has Google attached even if the
            setting is later switched off - they need the Disconnect control. */}
        <Section title="Sign-in methods">
          {/* The WhatsApp number, and whether anyone has ever proven it.
              It matters more than it looks: an unverified number cannot receive
              a password reset and cannot be used to sign in, so a merchant who
              loses their password has no way back in until this says Verified. */}
          {companyPhoneLocal && (
            <MethodRow
              icon={<MessageCircle className="h-4 w-4" />}
              label="WhatsApp number"
              hint={formatForDisplay(companyPhoneLocal, INDIA)}
              action={
                security === null ? (
                  <span className="text-xs text-muted-foreground">Checking…</span>
                ) : phoneIsVerified ? (
                  <Badge className="h-6 bg-emerald-500/15 px-2 text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                    VERIFIED
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => setVerifyOpen(true)}
                  >
                    Verify now
                  </Button>
                )
              }
            />
          )}
          {hasEmailIdentity && (
            <MethodRow
              icon={<KeyRound className="h-4 w-4" />}
              label="Email & password"
              hint={accountEmail || "Signed in"}
            />
          )}
          {googleIdentity ? (
            <MethodRow
              icon={<Link2 className="h-4 w-4" />}
              label="Google"
              hint={
                canDisconnectGoogle
                  ? googleEmail
                    ? `Connected · ${googleEmail}`
                    : "Connected"
                  : googleEmail
                    ? `${googleEmail} · your only way to sign in`
                    : "Your only way to sign in"
              }
              action={
                canDisconnectGoogle ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    disabled={googleBusy}
                    onClick={() => void handleDisconnectGoogle()}
                  >
                    {googleBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Disconnect"}
                  </Button>
                ) : undefined
              }
            />
          ) : googleConfigured && identities !== null ? (
            <Row
              icon={<Link2 className="h-4 w-4" />}
              label="Connect Google account"
              hint={googleBusy ? "Waiting for Google…" : "Sign in faster with one tap"}
              onClick={() => void handleConnectGoogle()}
            />
          ) : null}
        </Section>

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

      {/* Verifying an existing number. `change_number` is reused deliberately —
          proving control of a number and recording it is the same operation
          whether or not the number changed, and a second near-identical purpose
          would be a second place for the rules to drift. */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle>Confirm your WhatsApp number</DialogTitle>
            <DialogDescription>
              Once confirmed you can sign in with this number instead of a password, and reset your
              password through WhatsApp.
            </DialogDescription>
          </DialogHeader>
          {verifyOpen && companyPhoneLocal && (
            <OtpChallenge
              purpose="change_number"
              phone={toE164(companyPhoneLocal, INDIA)}
              onVerified={() => setVerifyOpen(false)}
              onCancel={() => setVerifyOpen(false)}
              cancelLabel="Not now"
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default More;
