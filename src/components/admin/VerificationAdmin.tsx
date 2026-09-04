/**
 * Who has to prove what, and through which channel.
 *
 * Three surfaces in one screen because an operator setting this up is making
 * one decision, not three:
 *
 *  1. THE GATES — email verification, WhatsApp verification, login 2FA, and
 *     WhatsApp password reset. All in `app_settings.auth`, all live on the next
 *     app foreground, no release.
 *  2. THE WHATSAPP TEMPLATES — the Fast2SMS message ids. More are coming
 *     (payment reminder, payment received), and each one has to be addable here
 *     rather than in a build.
 *  3. THE EMAIL PROVIDERS — see EmailProvidersAdmin, rendered alongside.
 *
 * The one rule this screen enforces harder than the others: turning 2FA on
 * while nobody has a verified number is a mass lockout, so it says so and shows
 * the count before the switch is thrown.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { applyAuthConfig } from "@/lib/authConfig";

type Loose = {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};

interface GatesForm {
  phoneLogin: boolean;
  phoneLoginClaims: boolean;
  emailVerification: boolean;
  whatsappVerification: boolean;
  twoFactor: boolean;
  whatsappReset: boolean;
  otpLength: string;
  otpTtlMinutes: string;
  otpMaxAttempts: string;
  otpResendSeconds: string;
  otpHourlyLimit: string;
}

const BLANK_GATES: GatesForm = {
  phoneLogin: true,
  phoneLoginClaims: true,
  emailVerification: false,
  whatsappVerification: true,
  twoFactor: false,
  whatsappReset: true,
  otpLength: "6",
  otpTtlMinutes: "10",
  otpMaxAttempts: "5",
  otpResendSeconds: "45",
  otpHourlyLimit: "6",
};

interface TemplateRow {
  purpose: string;
  label: string;
  template_name: string;
  template_id: string;
  message_id: string;
  /** Stored as JSONB; edited here as a comma-separated list. */
  variables: string[];
  active: boolean;
  description: string | null;
}

interface TemplateDraft extends Omit<TemplateRow, "variables"> {
  variables: string;
}

function intOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseIntField(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDraft(row: TemplateRow): TemplateDraft {
  return { ...row, variables: (row.variables ?? []).join(", ") };
}

function describeError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = String(e?.code ?? "");
  if (code === "42501") return "This account is not an admin, so the write was refused.";
  if (code === "42P01") return "That table does not exist yet. Run the WhatsApp OTP migration.";
  return typeof e?.message === "string" && e.message ? e.message : "The write did not go through.";
}

export function VerificationAdmin() {
  const db = supabase as unknown as Loose;

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [gates, setGates] = useState<GatesForm>(BLANK_GATES);
  const [savingGates, setSavingGates] = useState(false);
  const [templates, setTemplates] = useState<TemplateDraft[]>([]);
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
  /** How many merchants could actually pass a 2FA challenge today. */
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null);

  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [settingsRes, templateRes, countRes] = await Promise.all([
          db.from("app_settings").select("value").eq("key", "auth").maybeSingle(),
          db.from("whatsapp_templates").select("*").order("purpose", { ascending: true }),
          db
            .from("user_security")
            .select("user_id", { count: "exact", head: true })
            .not("phone_verified_at", "is", null),
        ]);

        if (!alive.current) return;

        if (settingsRes.error || templateRes.error) {
          setMissing(true);
          return;
        }
        setMissing(false);

        const v = (settingsRes.data?.value ?? {}) as Record<string, unknown>;
        setGates({
          phoneLogin: v.phone_login_enabled !== false,
          phoneLoginClaims: v.phone_login_claims_unverified !== false,
          emailVerification: v.email_verification_enabled === true,
          whatsappVerification: v.whatsapp_verification_enabled !== false,
          twoFactor: v.two_factor_enabled === true,
          whatsappReset: v.whatsapp_reset_enabled !== false,
          otpLength: String(intOr(v.otp_length, 6)),
          otpTtlMinutes: String(intOr(v.otp_ttl_minutes, 10)),
          otpMaxAttempts: String(intOr(v.otp_max_attempts, 5)),
          otpResendSeconds: String(intOr(v.otp_resend_seconds, 45)),
          otpHourlyLimit: String(intOr(v.otp_hourly_limit, 6)),
        });

        setTemplates(((templateRes.data ?? []) as TemplateRow[]).map(toDraft));
        setVerifiedCount(typeof countRes?.count === "number" ? countRes.count : null);
      } catch (err) {
        console.warn("[verification] load failed:", err);
        if (alive.current) setMissing(true);
      } finally {
        if (alive.current && !silent) setLoading(false);
      }
    },
    [db],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveGates = async () => {
    const length = parseIntField(gates.otpLength);
    if (length === null || length < 4 || length > 8) {
      toast.error("Code length must be between 4 and 8 digits.");
      return;
    }
    const ttl = parseIntField(gates.otpTtlMinutes);
    if (ttl === null || ttl < 1 || ttl > 60) {
      toast.error("Codes must stay valid for between 1 and 60 minutes.");
      return;
    }
    const attempts = parseIntField(gates.otpMaxAttempts);
    if (attempts === null || attempts < 1 || attempts > 20) {
      toast.error("Allowed tries must be between 1 and 20.");
      return;
    }
    const resend = parseIntField(gates.otpResendSeconds);
    if (resend === null || resend < 0 || resend > 600) {
      toast.error("The resend wait must be between 0 and 600 seconds.");
      return;
    }
    const hourly = parseIntField(gates.otpHourlyLimit);
    if (hourly === null || hourly < 1) {
      toast.error("The hourly limit must be at least 1 — it is what caps the message spend.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingGates(true);

    const payload = {
      phone_login_enabled: gates.phoneLogin,
      phone_login_claims_unverified: gates.phoneLoginClaims,
      email_verification_enabled: gates.emailVerification,
      whatsapp_verification_enabled: gates.whatsappVerification,
      two_factor_enabled: gates.twoFactor,
      whatsapp_reset_enabled: gates.whatsappReset,
      otp_length: length,
      otp_ttl_minutes: ttl,
      otp_max_attempts: attempts,
      otp_resend_seconds: resend,
      otp_hourly_limit: hourly,
    };

    try {
      // MERGED, never replaced. The same row carries google_web_client_id,
      // written by selfhost-smtp-reconcile.sh — overwriting it here would hide
      // the Google button until the reconcile timer next ran.
      const { data: existing } = await db
        .from("app_settings")
        .select("value")
        .eq("key", "auth")
        .maybeSingle();

      const merged = { ...((existing?.value ?? {}) as Record<string, unknown>), ...payload };

      const { error } = await db
        .from("app_settings")
        .upsert({ key: "auth", value: merged, updated_at: new Date().toISOString() });
      if (error) throw error;

      applyAuthConfig(merged);
      toast.success("Verification settings saved", {
        description: gates.twoFactor
          ? "Two-factor is ON. Merchants without a verified number are let through, not locked out."
          : undefined,
      });
      await refresh(true);
    } catch (err) {
      toast.error("Could not save the verification settings", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingGates(false);
    }
  };

  const saveTemplate = async (draft: TemplateDraft) => {
    const variables = draft.variables
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (draft.active && !draft.message_id.trim()) {
      toast.error("A template cannot be switched on without a Fast2SMS message id.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setSavingTemplate(draft.purpose);
    try {
      const { error } = await db
        .from("whatsapp_templates")
        .update({
          label: draft.label.trim() || draft.purpose,
          template_name: draft.template_name.trim(),
          template_id: draft.template_id.trim(),
          message_id: draft.message_id.trim(),
          variables,
          active: draft.active,
          updated_at: new Date().toISOString(),
        })
        .eq("purpose", draft.purpose);
      if (error) throw error;
      toast.success(`Saved the ${draft.label || draft.purpose} template`);
      await refresh(true);
    } catch (err) {
      toast.error("Could not save the template", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSavingTemplate(null);
    }
  };

  const addTemplate = async () => {
    const purpose = window.prompt(
      "A short key for the new template — letters, digits and underscores.\n\nExamples: payment_reminder, order_placed, plan_expiring",
    );
    if (!purpose) return;
    const key = purpose.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!key) return;

    try {
      const { error } = await db.from("whatsapp_templates").insert({
        purpose: key,
        label: key.replace(/_/g, " "),
        // Inactive with no message id: the sender skips a template in that
        // state rather than firing a request Fast2SMS will reject.
        active: false,
        variables: [],
      });
      if (error) throw error;
      toast.success(`Added "${key}". Fill in the Fast2SMS message id to switch it on.`);
      await refresh(true);
    } catch (err) {
      toast.error("Could not add the template", { description: describeError(err) });
    }
  };

  const update = (purpose: string, patch: Partial<TemplateDraft>) =>
    setTemplates((prev) => prev.map((t) => (t.purpose === purpose ? { ...t, ...patch } : t)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (missing) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">The verification tables are not there yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Run <code>20260827000000_whatsapp_otp_and_smtp.sql</code>. Until then every gate
                stays off and the app behaves exactly as it did before — nobody is locked out.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const otpTemplate = templates.find((t) => t.purpose === "otp");
  const otpReady = Boolean(otpTemplate?.message_id && otpTemplate.active);

  return (
    <div className="space-y-4">
      {/* ---------------- The gates ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">What merchants have to verify</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Every switch here reaches installed apps on their next foreground, with no release. All
            of them fail OPEN: if the app cannot read this row, no gate applies — being unable to
            reach a setting must never lock a merchant out of their own account.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-wa" className="cursor-pointer text-sm font-medium">
                  WhatsApp number
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A code on signup, and again whenever the number is changed.
                </p>
              </div>
              <Switch
                id="gate-wa"
                checked={gates.whatsappVerification}
                onCheckedChange={(v) => setGates({ ...gates, whatsappVerification: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-email" className="cursor-pointer text-sm font-medium">
                  Email address
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Optional now. Leaving this off means nobody is ever blocked on a confirmation
                  link.
                </p>
              </div>
              <Switch
                id="gate-email"
                checked={gates.emailVerification}
                onCheckedChange={(v) => setGates({ ...gates, emailVerification: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-phone-login" className="cursor-pointer text-sm font-medium">
                  Sign in with a mobile number
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A WhatsApp code instead of a password. Email sign-in is unaffected.
                </p>
              </div>
              <Switch
                id="gate-phone-login"
                checked={gates.phoneLogin}
                onCheckedChange={(v) => setGates({ ...gates, phoneLogin: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-claims" className="cursor-pointer text-sm font-medium">
                  Confirm an unverified number by signing in
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Lets merchants whose number was never confirmed use it to sign in, confirming it
                  in the process. Without this, only accounts that verified at signup can.
                </p>
              </div>
              <Switch
                id="gate-claims"
                checked={gates.phoneLoginClaims}
                disabled={!gates.phoneLogin}
                onCheckedChange={(v) => setGates({ ...gates, phoneLoginClaims: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-2fa" className="cursor-pointer text-sm font-medium">
                  Two-factor at login
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A WhatsApp code after the password.{" "}
                  {verifiedCount !== null && (
                    <span className="font-medium text-foreground">
                      {verifiedCount} account{verifiedCount === 1 ? "" : "s"} could receive one
                      today.
                    </span>
                  )}
                </p>
              </div>
              <Switch
                id="gate-2fa"
                checked={gates.twoFactor}
                onCheckedChange={(v) => setGates({ ...gates, twoFactor: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="gate-reset" className="cursor-pointer text-sm font-medium">
                  Password reset by WhatsApp
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Offered alongside the emailed code, for merchants who cannot reach their inbox.
                </p>
              </div>
              <Switch
                id="gate-reset"
                checked={gates.whatsappReset}
                onCheckedChange={(v) => setGates({ ...gates, whatsappReset: v })}
              />
            </div>
          </div>

          {gates.twoFactor && !otpReady && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
              Two-factor is on but the OTP template is not ready, so no code can be sent. Every
              merchant with a verified number would be stopped at the login screen. Fix the template
              below before saving this.
            </p>
          )}

          {gates.twoFactor && otpReady && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Merchants who have NOT verified a number are let straight through rather than locked
              out — switching this on must not be a mass lockout. They are covered as they verify,
              which the signup gate above does over time. One account can be exempted individually
              in <code>user_security.two_factor_exempt</code>.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="otp-length" className="text-sm">
                Code length
              </Label>
              <Input
                id="otp-length"
                inputMode="numeric"
                value={gates.otpLength}
                onChange={(e) => setGates({ ...gates, otpLength: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otp-ttl" className="text-sm">
                Valid for (minutes)
              </Label>
              <Input
                id="otp-ttl"
                inputMode="numeric"
                value={gates.otpTtlMinutes}
                onChange={(e) => setGates({ ...gates, otpTtlMinutes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otp-attempts" className="text-sm">
                Tries allowed
              </Label>
              <Input
                id="otp-attempts"
                inputMode="numeric"
                value={gates.otpMaxAttempts}
                onChange={(e) => setGates({ ...gates, otpMaxAttempts: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otp-resend" className="text-sm">
                Resend wait (seconds)
              </Label>
              <Input
                id="otp-resend"
                inputMode="numeric"
                value={gates.otpResendSeconds}
                onChange={(e) => setGates({ ...gates, otpResendSeconds: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="otp-hourly" className="text-sm">
                Codes per number, per hour
              </Label>
              <Input
                id="otp-hourly"
                inputMode="numeric"
                value={gates.otpHourlyLimit}
                onChange={(e) => setGates({ ...gates, otpHourlyLimit: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                A spend control as much as an abuse control — every WhatsApp message costs money,
                and an unthrottled OTP endpoint is somebody else&rsquo;s free gateway.
              </p>
            </div>
          </div>

          <Button onClick={() => void saveGates()} disabled={savingGates}>
            {savingGates ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save verification settings
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- WhatsApp templates ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">WhatsApp templates</h3>
            </div>
            <Button size="sm" variant="outline" onClick={() => void addTemplate()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            One row per approved Fast2SMS template. Adding the payment-reminder and
            payment-received templates when they are approved is a row here, not a release.
          </p>

          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>The variable order is positional.</strong> Fast2SMS sends the values as a
            pipe-separated list with no names in it, so a template whose variables are{" "}
            <code>otp, minutes</code> and a list in the other order produces a perfectly deliverable
            message telling the merchant their code is &ldquo;10&rdquo;. Match the order of{" "}
            <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… in the approved template exactly.
          </p>

          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.purpose} className="rounded-lg border p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
                    {t.purpose}
                  </code>
                  {t.message_id && t.active ? (
                    <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                      LIVE
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold">
                      NOT PROVISIONED
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Label htmlFor={`tpl-active-${t.purpose}`} className="text-xs">
                      On
                    </Label>
                    <Switch
                      id={`tpl-active-${t.purpose}`}
                      checked={t.active}
                      onCheckedChange={(v) => update(t.purpose, { active: v })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`tpl-label-${t.purpose}`} className="text-xs">
                      Name shown here
                    </Label>
                    <Input
                      id={`tpl-label-${t.purpose}`}
                      value={t.label}
                      onChange={(e) => update(t.purpose, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`tpl-msgid-${t.purpose}`} className="text-xs">
                      Fast2SMS message id *
                    </Label>
                    <Input
                      id={`tpl-msgid-${t.purpose}`}
                      inputMode="numeric"
                      placeholder="e.g. 30312"
                      value={t.message_id}
                      onChange={(e) => update(t.purpose, { message_id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`tpl-name-${t.purpose}`} className="text-xs">
                      Template name at Meta
                    </Label>
                    <Input
                      id={`tpl-name-${t.purpose}`}
                      placeholder="e.g. catalogshareotp"
                      value={t.template_name}
                      onChange={(e) => update(t.purpose, { template_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`tpl-tid-${t.purpose}`} className="text-xs">
                      Template id at Meta
                    </Label>
                    <Input
                      id={`tpl-tid-${t.purpose}`}
                      value={t.template_id}
                      onChange={(e) => update(t.purpose, { template_id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`tpl-vars-${t.purpose}`} className="text-xs">
                      Variables, in order
                    </Label>
                    <Input
                      id={`tpl-vars-${t.purpose}`}
                      placeholder="otp, minutes"
                      value={t.variables}
                      onChange={(e) => update(t.purpose, { variables: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Comma-separated. The OTP template takes <code>otp, minutes</code>.
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => void saveTemplate(t)}
                  disabled={savingTemplate === t.purpose}
                >
                  {savingTemplate === t.purpose ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </div>
            ))}
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The Fast2SMS API key and the phone number id live under Integrations, with the other
            credentials.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default VerificationAdmin;
