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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  Mail,
  MonitorPlay,
  Save,
  Settings2,
  ShieldCheck,
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
    title: "Google sign-in",
    icon: KeyRound,
    blurb:
      "From Google Cloud Console → Credentials. Paste the WEB application client - the same id serves the website and the Android app; the Android clients only need registering with Google. Google sign-in also needs Email (above) configured first: until it is, the app auto-confirms signups, and turning Google on then would allow account takeover, so the button stays hidden until both are set.",
    keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    title: "General",
    icon: Settings2,
    blurb: "Everything else.",
    keys: ["SUPPORT_EMAIL"],
  },
];

/** Exactly what Google Cloud Console asks for, so nothing has to be looked up. */
const GOOGLE_SETUP_VALUES: Array<{ label: string; value: string; where: string }> = [
  {
    label: "Authorized JavaScript origin",
    value: "https://app.catalogshare.online",
    where: "Web application client",
  },
  {
    label: "Authorized redirect URI",
    value: "https://app.catalogshare.online/backend/auth/v1/callback",
    where: "Web application client",
  },
  {
    label: "Package name",
    value: "in.catalogshare.app",
    where: "Every Android client",
  },
  {
    label: "SHA-1 — upload key",
    value: "2D:03:1F:13:9F:D9:9C:90:1F:1F:74:AB:C6:3A:0C:AD:32:B1:E7:9A",
    where: "Android client (builds signed on this machine)",
  },
  {
    label: "SHA-1 — debug key",
    value: "86:7B:8C:DA:26:83:48:BE:47:A3:02:4E:E9:C3:47:59:E0:10:D2:14",
    where: "Android client (local debug builds)",
  },
];

const AUTH_SETTINGS_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/auth/v1/settings`;

/** The callback URL AdMob asks for when enabling server-side verification. */
const SSV_CALLBACK_URL = "https://app.catalogshare.online/api/admob-ssv";

/**
 * AdMob's "Set up and verify callback URL" dialog, answered.
 *
 * This is here because the answer is a fact about our infrastructure, not
 * something to look up: the endpoint is already deployed, and the two optional
 * boxes in that dialog are a trap - filling them makes AdMob send a test ping
 * with a fake user id, which verifies fine and teaches nothing, while the real
 * SDK sends the actual values at runtime.
 *
 * The reachability check is the useful part. If the endpoint is down, AdMob's
 * verification fails with a message that does not say why.
 */
function AdmobSsvCard() {
  const [copied, setCopied] = useState(false);
  const [probe, setProbe] = useState<"idle" | "checking" | "ok" | "bad">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SSV_CALLBACK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", { description: SSV_CALLBACK_URL });
    }
  };

  const check = async () => {
    setProbe("checking");
    try {
      const res = await fetch(`${SSV_CALLBACK_URL}/health`, { cache: "no-store" });
      setProbe(res.ok ? "ok" : "bad");
    } catch {
      setProbe("bad");
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Rewarded ads: callback URL</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          AdMob asks for this when you turn on server-side verification for a
          rewarded ad unit. It is what actually credits a merchant after they
          watch an ad — the app is never trusted to do that, because a modified
          build could simply claim the reward.
        </p>

        <Label className="text-sm font-medium">Callback URL</Label>
        <div className="mt-1.5 flex gap-2">
          <code className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
            {SSV_CALLBACK_URL}
          </code>
          <Button variant="outline" onClick={() => void copy()} aria-label="Copy the callback URL">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium">What to put in the other two boxes</p>
          <p className="text-sm text-muted-foreground">
            Nothing. <span className="font-medium text-foreground">Leave user ID and
            custom data blank.</span> They only exist so you can fire a test ping
            by hand; the SDK sends the real values at runtime. Filling them in
            verifies a request that no user ever makes.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void check()} disabled={probe === "checking"}>
            {probe === "checking" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking
              </>
            ) : (
              "Check the endpoint is up"
            )}
          </Button>
          {probe === "ok" && (
            <Badge variant="secondary" className="gap-1">
              <Check className="h-3 w-3" /> Reachable — AdMob will verify
            </Badge>
          )}
          {probe === "bad" && (
            <Badge variant="outline" className="gap-1 border-destructive text-destructive">
              <AlertTriangle className="h-3 w-3" /> Not reachable
            </Badge>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Set this on each rewarded ad unit under{" "}
          <span className="font-medium">Ad unit &rarr; Server-side verification</span>.
          Points are only credited once Google calls this URL with a signature we
          verify against Google&apos;s public keys, so a forged call earns nothing.
        </p>
      </CardContent>
    </Card>
  );
}

/** One copyable value in the Google setup card. */
function CopyRow({ label, value, where }: { label: string; value: string; where: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", { description: value });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground">{where}</span>
      </div>
      <div className="mt-1.5 flex gap-2">
        <code className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button variant="outline" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Google Cloud Console's side of the setup, answered.
 *
 * The redirect URI, origin, package name and certificate fingerprints are facts
 * about this deployment, not things to work out each time - and a fingerprint
 * typed by hand is how "Developer console is not set up correctly" happens.
 *
 * The probe reads GoTrue's public settings endpoint, which is the one honest
 * answer to "did it take?": the reconcile script copies the pasted values into
 * GoTrue's environment and restarts it within a minute, and `external.google`
 * flips to true only once that restart has happened with both values present.
 */
function GoogleSetupCard() {
  const [probe, setProbe] = useState<"idle" | "checking" | "on" | "off" | "bad">("idle");

  const check = useCallback(async () => {
    setProbe("checking");
    try {
      const res = await fetch(AUTH_SETTINGS_URL, { cache: "no-store" });
      if (!res.ok) {
        setProbe("bad");
        return;
      }
      const settings = (await res.json()) as { external?: { google?: boolean } };
      setProbe(settings?.external?.google === true ? "on" : "off");
    } catch {
      setProbe("bad");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Google sign-in: what to give Google</h3>
          {probe === "on" && (
            <Badge variant="secondary" className="gap-1">
              <Check className="h-3 w-3" /> Enabled on the server
            </Badge>
          )}
          {probe === "off" && (
            <Badge variant="outline" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Not enabled yet — needs the client id, secret, and Email configured; applies within a minute
            </Badge>
          )}
          {probe === "bad" && (
            <Badge variant="outline" className="gap-1 border-destructive text-destructive">
              <AlertTriangle className="h-3 w-3" /> Could not read the server&apos;s auth settings
            </Badge>
          )}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Create these in <span className="font-medium text-foreground">one</span> Google
          Cloud project under APIs &amp; Services → Credentials: a{" "}
          <span className="font-medium text-foreground">Web application</span> client
          (its id and secret go in the fields above) and one{" "}
          <span className="font-medium text-foreground">Android</span> client per signing
          certificate. The Android clients are only registered with Google; the app
          uses the Web client id on every platform.
        </p>

        <div className="space-y-4">
          {GOOGLE_SETUP_VALUES.map((row) => (
            <CopyRow key={row.label} {...row} />
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium">Also register the Play App Signing key</p>
          <p className="text-sm text-muted-foreground">
            Play re-signs the store build with its own key, so the upload-key SHA-1
            above is not what installed phones present. Copy the SHA-1 from Play
            Console → <span className="font-medium text-foreground">Test and release → Setup → App signing</span>{" "}
            and add it as a third Android client with the same package name.
            Without it, Google sign-in works in local builds and fails from the
            Play Store with &ldquo;Developer console is not set up correctly&rdquo;.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void check()} disabled={probe === "checking"}>
            {probe === "checking" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking
              </>
            ) : (
              "Re-check the server"
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            Reads {AUTH_SETTINGS_URL.replace(/^https?:\/\//, "")}
          </span>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          While the OAuth consent screen is in Testing, only the Google accounts
          listed as test users can sign in. Changes in Google Cloud can take a few
          hours to reach phones.
        </p>
      </CardContent>
    </Card>
  );
}

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
          : key.startsWith("GOOGLE_")
            ? "Google sign-in switches on within a minute once both the client id and the secret are saved."
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
          <Fragment key={title}>
          <Card>
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
          {title === "Google sign-in" && <GoogleSetupCard />}
          </Fragment>
        );
      })}

      <AdmobSsvCard />
    </div>
  );
}

export default IntegrationsAdmin;
