/**
 * The SMTP accounts email can be sent through, and which one is live.
 *
 * Replaces the single hardcoded Resend key. The business already pays for a
 * Microsoft 365 mailbox; being unable to use it without a code change was the
 * problem, and having exactly one provider meant Resend was a single point of
 * failure for password resets, receipts and every admin notification.
 *
 * Two rules carried over from IntegrationsAdmin, both about not losing a
 * credential:
 *
 *  1. A password is never sent back to the browser. The server reports whether
 *     one is set, not what it is.
 *  2. Leaving the password box empty means "leave it alone", not "clear it".
 *     `admin_save_email_provider` enforces that server-side too, so it holds
 *     even if this form is bypassed.
 *
 * The active provider is switched through its own RPC rather than a checkbox
 * write, so there is never an instant with two active or none.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Loader2,
  Mail,
  Plus,
  Send,
  Server,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Loose = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
  functions: { invoke(name: string, opts?: any): PromiseLike<{ data: any; error: any }> };
};

interface ProviderRow {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_email: string;
  from_name: string;
  reply_to: string;
  transport: string;
  active: boolean;
  sort_order: number;
  notes: string | null;
  password_set: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

interface Draft extends Omit<ProviderRow, "port"> {
  port: string;
  /** Blank means "keep whatever is stored". Never pre-filled. */
  password: string;
}

/** Settings that are easy to get wrong and cost an afternoon to diagnose. */
const PRESETS: Record<string, { host: string; port: string; secure: boolean; hint: string }> = {
  m365: {
    host: "smtp.office365.com",
    port: "587",
    secure: false,
    hint: "SMTP AUTH has to be enabled on the mailbox in the Microsoft 365 admin centre — it is off by default on new tenants. With MFA on the account, use an app password. The From address must be the mailbox itself or an address it has Send As rights over.",
  },
  gmail: {
    host: "smtp.gmail.com",
    port: "465",
    secure: true,
    hint: "Needs a Google App Password, not the account password. Two-step verification has to be on before Google will issue one.",
  },
  resend: {
    host: "smtp.resend.com",
    port: "465",
    secure: true,
    hint: "The username is the literal word “resend” and the password is your API key. Use the Resend API transport instead if outbound SMTP is blocked on this host.",
  },
};

function toDraft(row: ProviderRow): Draft {
  return { ...row, port: String(row.port ?? 587), password: "" };
}

function describeError(err: unknown): string {
  const e = err as { message?: unknown } | null | undefined;
  return typeof e?.message === "string" && e.message ? e.message : "The write did not go through.";
}

function whenText(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function EmailProvidersAdmin() {
  const db = supabase as unknown as Loose;

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");

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
        const { data, error } = await db.rpc("admin_list_email_providers");
        if (!alive.current) return;
        if (error) {
          setMissing(true);
          return;
        }
        setMissing(false);
        setDrafts(((data ?? []) as ProviderRow[]).map(toDraft));
      } catch (err) {
        console.warn("[email] provider load failed:", err);
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

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const save = async (draft: Draft) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(draft.id);
    try {
      const { error } = await db.rpc("admin_save_email_provider", {
        p_id: draft.id,
        p_label: draft.label,
        p_host: draft.host.trim(),
        p_port: Number(draft.port) || 587,
        p_secure: draft.secure,
        p_username: draft.username.trim(),
        p_password: draft.password,
        p_from_email: draft.from_email.trim(),
        p_from_name: draft.from_name.trim(),
        p_reply_to: draft.reply_to.trim(),
        p_transport: draft.transport,
      });
      if (error) throw error;
      toast.success(`Saved ${draft.label}`, {
        description: draft.password ? undefined : "The stored password was left untouched.",
      });
      await refresh(true);
    } catch (err) {
      toast.error("Could not save that provider", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
  };

  const activate = async (draft: Draft) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActivating(draft.id);
    try {
      const { error } = await db.rpc("admin_activate_email_provider", { p_id: draft.id });
      if (error) throw error;
      toast.success(`${draft.label} is now the active provider`, {
        description:
          "Transactional email switches over within a minute. GoTrue's own mail (password reset links) follows on the next reconcile tick.",
      });
      await refresh(true);
    } catch (err) {
      // The RPC refuses a provider with no password or no host, deliberately —
      // the symptom of getting that wrong is every password reset silently
      // failing, so it is checked in the database rather than only here.
      toast.error("Could not switch provider", { description: describeError(err) });
    } finally {
      inFlight.current = false;
      setActivating(null);
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
        body: { type: "test", to, companyName: "CatalogShare" },
      });
      if (error) throw error;
      toast.success("Test email sent", {
        description: data?.provider ? `Delivered through "${data.provider}".` : undefined,
      });
      await refresh(true);
    } catch (err) {
      toast.error("The test email did not go out", { description: describeError(err) });
      await refresh(true);
    } finally {
      setTesting(false);
    }
  };

  const addProvider = async () => {
    const name = window.prompt(
      "A short key for the new provider — letters, digits and underscores.\n\nExamples: zoho, ses, office_backup",
    );
    if (!name) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id) return;

    try {
      const { error } = await db.rpc("admin_save_email_provider", {
        p_id: id,
        p_label: id.replace(/_/g, " "),
        p_host: "",
        p_port: 587,
        p_secure: false,
        p_username: "",
        p_password: "",
        p_from_email: "",
        p_from_name: "CatalogShare",
        p_reply_to: "",
        p_transport: "smtp",
      });
      if (error) throw error;
      toast.success(`Added "${id}". Fill in the host and password to use it.`);
      await refresh(true);
    } catch (err) {
      toast.error("Could not add that provider", { description: describeError(err) });
    }
  };

  const applyPreset = (draft: Draft) => {
    const preset = PRESETS[draft.id];
    if (!preset) return;
    update(draft.id, { host: preset.host, port: preset.port, secure: preset.secure });
  };

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
              <p className="font-medium">The email provider table is not there yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Run <code>20260827000000_whatsapp_otp_and_smtp.sql</code>. Until then email keeps
                going out through whatever is set in Integrations → Email, exactly as before.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const active = drafts.find((d) => d.active);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Email providers</h3>
            </div>
            <Button size="sm" variant="outline" onClick={() => void addProvider()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            One account per row, one of them live. A send tries the active provider first and only
            falls back to the others if it fails — a fallback is for an outage, not a preference.
          </p>

          {active ? (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CircleCheck className="h-4 w-4 shrink-0" />
              Sending through <strong>{active.label}</strong>.
            </p>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              No provider is active. Password resets and receipts are not being sent.
            </p>
          )}

          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="test-to" className="text-xs">
                Send a test email to
              </Label>
              <Input
                id="test-to"
                type="email"
                placeholder="you@example.com"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => void sendTest()} disabled={testing}>
              {testing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send test
            </Button>
          </div>
        </CardContent>
      </Card>

      {drafts.map((d) => {
        const preset = PRESETS[d.id];
        return (
          <Card key={d.id} className={d.active ? "border-emerald-400 dark:border-emerald-800" : ""}>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Input
                  className="h-8 w-auto min-w-[10rem] max-w-[16rem] font-semibold"
                  value={d.label}
                  onChange={(e) => update(d.id, { label: e.target.value })}
                  aria-label="Provider name"
                />
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{d.id}</code>
                {d.active && (
                  <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                    ACTIVE
                  </Badge>
                )}
                {d.password_set ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    password set
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    no password
                  </Badge>
                )}
              </div>

              {preset && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {preset.hint}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => applyPreset(d)}>
                    Use standard settings
                  </Button>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`tr-${d.id}`} className="text-xs">
                    Transport
                  </Label>
                  <Select value={d.transport} onValueChange={(v) => update(d.id, { transport: v })}>
                    <SelectTrigger id={`tr-${d.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smtp">SMTP</SelectItem>
                      <SelectItem value="resend_api">Resend HTTPS API</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Use the HTTPS API when outbound SMTP ports are blocked on this host.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`pw-${d.id}`} className="text-xs">
                    Password / API key
                  </Label>
                  <Input
                    id={`pw-${d.id}`}
                    type="password"
                    autoComplete="new-password"
                    placeholder={d.password_set ? "•••••••• (leave blank to keep)" : "Not set"}
                    value={d.password}
                    onChange={(e) => update(d.id, { password: e.target.value })}
                  />
                </div>

                {d.transport === "smtp" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor={`host-${d.id}`} className="text-xs">
                        SMTP host
                      </Label>
                      <Input
                        id={`host-${d.id}`}
                        value={d.host}
                        onChange={(e) => update(d.id, { host: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`port-${d.id}`} className="text-xs">
                          Port
                        </Label>
                        <Input
                          id={`port-${d.id}`}
                          inputMode="numeric"
                          value={d.port}
                          onChange={(e) => update(d.id, { port: e.target.value })}
                        />
                      </div>
                      <div className="flex items-end justify-between gap-2 pb-1">
                        <Label htmlFor={`sec-${d.id}`} className="text-xs">
                          TLS on connect
                        </Label>
                        <Switch
                          id={`sec-${d.id}`}
                          checked={d.secure}
                          onCheckedChange={(v) => update(d.id, { secure: v })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`user-${d.id}`} className="text-xs">
                        Username
                      </Label>
                      <Input
                        id={`user-${d.id}`}
                        autoComplete="off"
                        value={d.username}
                        onChange={(e) => update(d.id, { username: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={`from-${d.id}`} className="text-xs">
                    From address
                  </Label>
                  <Input
                    id={`from-${d.id}`}
                    type="email"
                    value={d.from_email}
                    onChange={(e) => update(d.id, { from_email: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be an address this account is allowed to send as, or SPF and DMARC will
                    put every message in a spam folder.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`fname-${d.id}`} className="text-xs">
                    From name
                  </Label>
                  <Input
                    id={`fname-${d.id}`}
                    value={d.from_name}
                    onChange={(e) => update(d.id, { from_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`reply-${d.id}`} className="text-xs">
                    Reply-to (optional)
                  </Label>
                  <Input
                    id={`reply-${d.id}`}
                    type="email"
                    value={d.reply_to}
                    onChange={(e) => update(d.id, { reply_to: e.target.value })}
                  />
                </div>
              </div>

              {(d.last_ok_at || d.last_error) && (
                <p className="text-xs text-muted-foreground">
                  Last success: {whenText(d.last_ok_at)}.
                  {d.last_error && (
                    <span className="text-destructive">
                      {" "}
                      Last failure {whenText(d.last_error_at)}: {d.last_error}
                    </span>
                  )}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void save(d)} disabled={saving === d.id}>
                  {saving === d.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
                {!d.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void activate(d)}
                    disabled={activating === d.id}
                  >
                    {activating === d.id ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CircleCheck className="mr-2 h-3.5 w-3.5" />
                    )}
                    Make this the active provider
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default EmailProvidersAdmin;
