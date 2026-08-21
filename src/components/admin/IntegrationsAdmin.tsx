/**
 * Integration credentials, editable by the platform owner.
 *
 * SMTP, Razorpay and AdMob used to live in env files on the server, so changing
 * one meant an SSH session. They now live in `integration_secrets`, which has
 * NO public read policy - unlike `app_settings`, which the client reads to
 * render the Earn screen and would therefore have published an SMTP password to
 * every visitor.
 *
 * Two rules this screen follows, both about not leaking or losing a credential:
 *
 *  1. A secret is never sent back to the browser. The server returns whether it
 *     is set, not what it is. A console that displays a credential is a console
 *     that puts it in a screenshot.
 *
 *  2. Leaving a secret field blank means "leave it alone", not "clear it".
 *     Otherwise editing the SMTP host and hitting Save takes the password down
 *     with it, and payments or email stop for a reason nobody would connect to
 *     the edit they just made. `admin_set_integration_secret` enforces this
 *     server-side too, so it holds even if this form is bypassed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CreditCard,
  Loader2,
  Mail,
  MonitorPlay,
  Save,
  Settings2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface SettingRow {
  key: string;
  label: string | null;
  description: string | null;
  is_secret: boolean;
  value: string;
  is_set: boolean;
  updated_at: string;
}

type Loose = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
  functions: { invoke(name: string, opts?: any): PromiseLike<{ data: any; error: any }> };
};

/** Grouped so an operator configuring email is not scrolling past AdMob ids. */
const GROUPS: Array<{ title: string; icon: typeof Mail; blurb: string; keys: string[] }> = [
  {
    title: "Email",
    icon: Mail,
    blurb:
      "Used for password resets and every transactional email. For Resend, the username is the literal word \"resend\" and the password is your API key.",
    keys: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_FROM_NAME", "RESEND_API_KEY"],
  },
  {
    title: "Payments",
    icon: CreditCard,
    blurb: "Razorpay. The secret is used server-side to verify every payment; it never reaches the app.",
    keys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
  },
  {
    title: "Ads",
    icon: MonitorPlay,
    blurb:
      "AdMob unit ids. The app ships with Google's test ids until these are filled in, which means ads show but earn nothing.",
    keys: ["ADMOB_APP_ID", "ADMOB_BANNER_ID", "ADMOB_INTERSTITIAL_ID", "ADMOB_REWARDED_ID"],
  },
  {
    title: "General",
    icon: Settings2,
    blurb: "Everything else.",
    keys: ["SUPPORT_EMAIL"],
  },
];

export function IntegrationsAdmin() {
  const db = supabase as unknown as Loose;

  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc("admin_list_integration_settings");
      if (error) {
        setMissing(true);
        setRows([]);
        return;
      }
      setMissing(false);
      const list = (data ?? []) as SettingRow[];
      setRows(list);
      // Plain values are editable in place; secrets always start blank.
      const next: Record<string, string> = {};
      for (const r of list) next[r.key] = r.is_secret ? "" : (r.value ?? "");
      setDraft(next);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  const save = async (key: string) => {
    const row = byKey.get(key);
    if (!row || savingKey) return;

    const value = draft[key] ?? "";
    if (row.is_secret && !value.trim()) {
      toast.info("Nothing to save", { description: "Leave a secret blank to keep the current value." });
      return;
    }

    setSavingKey(key);
    try {
      const { error } = await db.rpc("admin_set_integration_secret", { p_key: key, p_value: value });
      if (error) throw error;
      toast.success(`${row.label ?? key} saved`, {
        description: key.startsWith("SMTP") || key === "RESEND_API_KEY"
          ? "Email settings apply within a minute."
          : "Applies within a minute.",
      });
      if (row.is_secret) setDraft((d) => ({ ...d, [key]: "" }));
      await refresh();
    } catch (err: any) {
      toast.error("Could not save", { description: err?.message });
    } finally {
      setSavingKey(null);
    }
  };

  const sendTest = async () => {
    const to = testTo.trim();
    if (!to) {
      toast.error("Enter an address to send the test to.");
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await db.functions.invoke("send-emails", {
        body: {
          type: "test",
          to,
          companyName: "CatalogShare",
          ownerName: "Administrator",
        },
      });
      if (error) throw error;
      toast.success("Test email sent", { description: `Check ${to}, including spam.` });
      void data;
    } catch (err: any) {
      // The most common cause by far is an unset SMTP password, so say so
      // rather than only echoing the transport error.
      toast.error("Could not send the test email", {
        description: err?.message ?? "Check that the SMTP password is set above.",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading integrations…
      </div>
    );
  }

  if (missing) {
    return (
      <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
        <CardContent className="flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Integration settings are not available
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">
              Apply{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                supabase/migrations/20260822010000_integration_secrets.sql
              </code>{" "}
              and reload. Until then these values are read from the server's env
              files, so everything keeps working — it just cannot be edited here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const smtpReady = byKey.get("SMTP_PASS")?.is_set || byKey.get("RESEND_API_KEY")?.is_set;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Integrations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Credentials are stored server-side and never sent back to this page.
          Leave a password field blank to keep the value that is already saved.
        </p>
      </div>

      {!smtpReady && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Email is not configured.</span> Password
              resets cannot be sent, so new accounts are auto-confirmed to keep
              sign-up working. Set the SMTP password below and confirmation turns
              itself on.
            </p>
          </CardContent>
        </Card>
      )}

      {GROUPS.map(({ title, icon: Icon, blurb, keys }) => {
        const groupRows = keys.map((k) => byKey.get(k)).filter(Boolean) as SettingRow[];
        if (!groupRows.length) return null;

        return (
          <Card key={title}>
            <CardContent className="p-5">
              <div className="mb-1 flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">{title}</h3>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{blurb}</p>

              <div className="space-y-4">
                {groupRows.map((row) => (
                  <div key={row.key}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Label htmlFor={`int-${row.key}`} className="text-sm font-medium">
                        {row.label ?? row.key}
                      </Label>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {row.key}
                      </code>
                      {row.is_secret &&
                        (row.is_set ? (
                          <Badge variant="secondary">Saved</Badge>
                        ) : (
                          <Badge variant="outline">Not set</Badge>
                        ))}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        id={`int-${row.key}`}
                        type={row.is_secret ? "password" : "text"}
                        autoComplete="off"
                        value={draft[row.key] ?? ""}
                        placeholder={
                          row.is_secret
                            ? row.is_set
                              ? "Saved. Type a new value to replace it."
                              : "Not set"
                            : row.description ?? ""
                        }
                        onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save(row.key);
                        }}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void save(row.key)}
                        disabled={savingKey !== null}
                        aria-label={`Save ${row.label ?? row.key}`}
                      >
                        {savingKey === row.key ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {row.description && !row.is_secret && (
                      <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                    )}
                    {row.description && row.is_secret && (
                      <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                    )}
                  </div>
                ))}
              </div>

              {title === "Email" && (
                <div className="mt-5 rounded-lg border border-border p-4">
                  <p className="mb-2 text-sm font-medium">Send a test email</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Proves the credentials work end to end. Sends through the same
                    path the app uses for real mail.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      placeholder="you@example.com"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                    <Button onClick={() => void sendTest()} disabled={testing} className="sm:w-40">
                      {testing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" /> Send test
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default IntegrationsAdmin;
