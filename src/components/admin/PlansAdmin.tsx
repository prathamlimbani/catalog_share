/**
 * Plan management for the platform owner.
 *
 * Create, edit, hide and delete plans, and grant any plan to any merchant for
 * any number of days. Everything routes through the SECURITY DEFINER functions
 * (`admin_upsert_plan`, `admin_delete_plan`, `admin_grant_plan`) rather than
 * writing the tables directly, so the rules that stop a plan edit from
 * corrupting live subscriptions live in one place instead of being reimplemented
 * in this form.
 *
 * ⚠ Changing a PRICE has a server-side consequence. verify-razorpay-payment
 * compares what Razorpay charged against the plan price and rejects a mismatch.
 * The warning in the price field is not decoration — until the updated edge
 * function is deployed, editing a live plan's price breaks payment for it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Crown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { loadPlanCatalogue } from "@/lib/planCatalogue";

interface PlanRecord {
  id: string;
  name: string;
  price: number;
  price_label: string | null;
  product_limit: number;
  features: string[] | null;
  unlocks_estimates: boolean;
  unlocks_premium_skins: boolean;
  unlocks_call_support: boolean;
  popular: boolean;
  rank: number;
  active: boolean;
  sort_order: number;
}

interface CompanyRow {
  id: string;
  name: string;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
}

/** The generated types predate these tables; describe what we use and cast. */
type Loose = {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};

const BLANK: PlanRecord = {
  id: "",
  name: "",
  price: 0,
  price_label: null,
  product_limit: 40,
  features: [],
  unlocks_estimates: false,
  unlocks_premium_skins: false,
  unlocks_call_support: false,
  popular: false,
  rank: 0,
  active: true,
  sort_order: 99,
};

export function PlansAdmin() {
  const db = supabase as unknown as Loose;

  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<PlanRecord | null>(null);
  const [saving, setSaving] = useState(false);

  // Grant form
  const [grantCompany, setGrantCompany] = useState("");
  const [grantPlan, setGrantPlan] = useState("");
  const [grantDays, setGrantDays] = useState("30");
  const [grantExtend, setGrantExtend] = useState(false);
  const [granting, setGranting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db
        .from("plans")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) {
        setMissing(true);
        setPlans([]);
      } else {
        setMissing(false);
        setPlans((data ?? []) as PlanRecord[]);
      }

      const { data: comps } = await db
        .from("companies")
        .select("id, name, subscription_plan, subscription_expires_at")
        .order("name", { ascending: true });
      setCompanies((comps ?? []) as CompanyRow[]);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!editing) return;
    if (!editing.id.trim()) {
      toast.error("A plan needs an id.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await db.rpc("admin_upsert_plan", {
        p_plan: {
          id: editing.id.trim().toLowerCase(),
          name: editing.name.trim() || editing.id,
          price: Number(editing.price) || 0,
          price_label: editing.price_label?.trim() || null,
          product_limit: Number(editing.product_limit) || 40,
          features: editing.features ?? [],
          unlocks_estimates: editing.unlocks_estimates,
          unlocks_premium_skins: editing.unlocks_premium_skins,
          unlocks_call_support: editing.unlocks_call_support,
          popular: editing.popular,
          rank: Number(editing.rank) || 0,
          active: editing.active,
          sort_order: Number(editing.sort_order) || 0,
        },
      });
      if (error) throw error;
      toast.success(`Saved ${editing.name || editing.id}`);
      setEditing(null);
      await refresh();
      // Push the change into the running app straight away.
      await loadPlanCatalogue();
    } catch (err: any) {
      toast.error("Could not save the plan", { description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (plan: PlanRecord) => {
    if (!window.confirm(`Delete the "${plan.name}" plan?`)) return;
    try {
      const { data, error } = await db.rpc("admin_delete_plan", { p_plan_id: plan.id });
      if (error) throw error;
      // The function hides rather than deletes when merchants are still on it,
      // and says so — surface that instead of claiming a delete that never
      // happened.
      toast.success(data?.message ?? "Plan deleted");
      await refresh();
      await loadPlanCatalogue();
    } catch (err: any) {
      toast.error("Could not delete the plan", { description: err?.message });
    }
  };

  const grant = async () => {
    if (!grantCompany || !grantPlan) {
      toast.error("Pick a merchant and a plan.");
      return;
    }
    setGranting(true);
    try {
      const { data, error } = await db.rpc("admin_grant_plan", {
        p_company_id: grantCompany,
        p_plan_id: grantPlan,
        p_days: Math.max(1, Number(grantDays) || 30),
        p_extend: grantExtend,
      });
      if (error) throw error;
      const until = data?.until ? new Date(data.until).toLocaleDateString() : "—";
      toast.success(`Granted ${grantPlan} until ${until}`);
      await refresh();
    } catch (err: any) {
      toast.error("Could not grant the plan", { description: err?.message });
    } finally {
      setGranting(false);
    }
  };

  const planOptions = useMemo(() => plans.filter((p) => p.active), [plans]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading plans…
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
              The plans table does not exist yet
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">
              Run{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                supabase/migrations/20260821010000_plans_table.sql
              </code>{" "}
              in the Supabase SQL editor, then reload. Until then the app uses the
              plan catalogue built into the bundle, so nothing is broken — it just
              cannot be edited here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Plans ---------------- */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Plans</h2>
        <Button onClick={() => setEditing({ ...BLANK })} size="sm">
          <Plus className="mr-2 h-4 w-4" /> New plan
        </Button>
      </div>

      <div className="grid gap-3">
        {plans.map((plan) => (
          <Card key={plan.id} className={plan.active ? "" : "opacity-60"}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{plan.name}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {plan.id}
                  </code>
                  {plan.popular && <Badge variant="secondary">Popular</Badge>}
                  {!plan.active && <Badge variant="outline">Hidden</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.price > 0 ? `₹${plan.price}/month` : "Free"} ·{" "}
                  {plan.product_limit >= 9999 ? "Unlimited" : plan.product_limit} products
                  {plan.unlocks_estimates && " · Estimates"}
                  {plan.unlocks_call_support && " · Call support"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing({ ...plan })}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remove(plan)}
                  disabled={plan.id === "free"}
                  title={plan.id === "free" ? "The free plan cannot be removed" : "Delete"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---------------- Editor ---------------- */}
      {editing && (
        <Card className="border-primary/40">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {plans.some((p) => p.id === editing.id) ? "Edit plan" : "New plan"}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="plan-id">Plan id</Label>
                <Input
                  id="plan-id"
                  value={editing.id}
                  disabled={plans.some((p) => p.id === editing.id)}
                  onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                  placeholder="starter"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Lower-case letters, digits and underscores. Permanent once saved.
                </p>
              </div>

              <div>
                <Label htmlFor="plan-name">Display name</Label>
                <Input
                  id="plan-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Starter Plan"
                />
              </div>

              <div>
                <Label htmlFor="plan-price">Price (₹ per month)</Label>
                <Input
                  id="plan-price"
                  type="number"
                  min={0}
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                />
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Payment verification compares this against what Razorpay charged.
                  Deploy the updated edge function before changing a live price.
                </p>
              </div>

              <div>
                <Label htmlFor="plan-limit">Product limit</Label>
                <Input
                  id="plan-limit"
                  type="number"
                  min={0}
                  value={editing.product_limit}
                  onChange={(e) =>
                    setEditing({ ...editing, product_limit: Number(e.target.value) })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">9999 means unlimited.</p>
              </div>
            </div>

            <div>
              <Label htmlFor="plan-features">Features (one per line)</Label>
              <Textarea
                id="plan-features"
                rows={5}
                value={(editing.features ?? []).join("\n")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    features: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                  })
                }
                placeholder={"Up to 300 Products\nEstimates & Invoices\nNo ads"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["unlocks_estimates", "Unlocks estimates"],
                  ["unlocks_premium_skins", "Unlocks premium skins"],
                  ["unlocks_call_support", "Unlocks call support"],
                  ["popular", "Show as popular"],
                  ["active", "Offered for sale"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor={`plan-${key}`} className="cursor-pointer text-sm">
                    {label}
                  </Label>
                  <Switch
                    id={`plan-${key}`}
                    checked={Boolean(editing[key])}
                    onCheckedChange={(v) => setEditing({ ...editing, [key]: v })}
                  />
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="plan-rank">Rank (upgrade order)</Label>
                <Input
                  id="plan-rank"
                  type="number"
                  value={editing.rank}
                  onChange={(e) => setEditing({ ...editing, rank: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="plan-sort">Display order</Label>
                <Input
                  id="plan-sort"
                  type="number"
                  value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Save plan
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Grant ---------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Give a plan to a merchant</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Grants without a payment. Use for refunds, apologies, trials and deals.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Merchant</Label>
              <Select value={grantCompany} onValueChange={setGrantCompany}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a merchant" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.subscription_plan ?? "free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Plan</Label>
              <Select value={grantPlan} onValueChange={setGrantPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {planOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="grant-days">Days</Label>
              <Input
                id="grant-days"
                type="number"
                min={1}
                value={grantDays}
                onChange={(e) => setGrantDays(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="grant-extend" className="cursor-pointer text-sm">
                Add to time remaining
              </Label>
              <Switch id="grant-extend" checked={grantExtend} onCheckedChange={setGrantExtend} />
            </div>
          </div>

          <Button onClick={grant} disabled={granting}>
            {granting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Grant plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default PlansAdmin;
