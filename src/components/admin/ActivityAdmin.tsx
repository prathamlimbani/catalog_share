/**
 * The activity feed — who did what, when, across every shop.
 *
 * This is the screen the old "Analytics" tab was mistaken for. That one charts
 * what anonymous VISITORS do on a storefront; it can never answer "who wrote
 * this estimate", because `analytics_events` has no actor. This reads
 * `activity_events`, which does.
 *
 * Two decisions worth stating, because both are about not lying to the reader:
 *
 *  - The empty state distinguishes "nothing has happened" from "this database
 *    has no activity log yet". They look identical on screen and are completely
 *    different problems: one is a quiet week, the other is a migration that was
 *    never applied — which is exactly how the master console's analytics sat
 *    empty for months without anyone being able to tell why.
 *  - An actor whose email cannot be resolved renders as a shortened id, never
 *    as "Unknown" or as blank. The id is the only thing that identifies them,
 *    and hiding it turns a resolvable question into an unanswerable one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Filter,
  Loader2,
  RefreshCw,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ACTIVITY_GROUPS,
  actionLabel,
  attachActorEmails,
  fetchActivity,
  groupOf,
  normaliseActivity,
  shortWhen,
  type ActivityGroup,
  type ActivityRow,
} from "@/lib/activity";
import { cn } from "@/lib/utils";

export interface ActivityAdminProps {
  /** Companies to offer in the filter. */
  companies: { id: string; name: string }[] | undefined;
}

/** How many rows the feed pulls. Deep enough to scroll, short enough to load. */
const FEED_LIMIT = 500;

/** A colour per group, so a run of one kind of event is scannable. */
const GROUP_TONE: Record<string, string> = {
  estimate: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  product: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  auth: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  payment: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  points: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ad: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  reward: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  store: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  export: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  other: "bg-muted text-muted-foreground",
};

/** ISO-8601 in IST, for the exact timestamp under each row. */
function exactWhen(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Who did it, in whatever detail we actually have. */
function actorName(row: ActivityRow): string {
  if (row.actor_email) return row.actor_email;
  // Not "Unknown": the id is the only handle on this person, and it is the
  // thing support would search for.
  if (row.actor_id) return `user ${row.actor_id.slice(0, 8)}`;
  return "system";
}

export function ActivityAdmin({ companies }: ActivityAdminProps) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Set when the table itself could not be read — a missing migration, say. */
  const [failure, setFailure] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string>("all");
  const [group, setGroup] = useState<string>("all");

  const load = useCallback(async () => {
    setFailure(null);
    const result = await fetchActivity({
      companyId: companyId === "all" ? null : companyId,
      group: group === "all" ? null : (group as ActivityGroup),
      max: FEED_LIMIT,
    });

    if (result.error) {
      setFailure(result.error);
      setRows([]);
      return;
    }

    // Names are attached after the rows are in hand, and a failure to resolve
    // them is not a failure to load the feed.
    setRows(await attachActorEmails(normaliseActivity(result.rows)));
  }, [companyId, group]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  /** A count per group, for the filter's own labels. */
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of rows) {
      const g = groupOf(row.action);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  }, [rows]);

  const companyName = (row: ActivityRow) =>
    row.company_name ?? (row.company_id ? "—" : "no shop yet");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
            Activity
          </h2>
          <p className="text-sm text-muted-foreground">
            Every estimate, product, payment and sign-in — and who did it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="All shops" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shops</SelectItem>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <SelectValue placeholder="Everything" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {Object.entries(ACTIVITY_GROUPS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                  {counts.has(key) ? ` (${counts.get(key)})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : failure ? (
        /* Read failures are named, not swallowed. "No activity yet" over a
           missing table is the exact shape of bug this whole feature was
           built to fix. */
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">The activity log could not be read</p>
              <p className="mt-1 text-muted-foreground">
                This usually means migration 20260904000000_activity_log.sql has not been
                applied to this database yet. Nothing is lost — events start recording the
                moment it is.
              </p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{failure}</p>
            </div>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-20 text-center">
          <Activity className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-20" />
          <p className="font-medium text-muted-foreground">Nothing recorded for this filter.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Estimates, products and payments are logged automatically as they happen.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length === FEED_LIMIT
              ? `Showing the ${FEED_LIMIT} most recent events. Use the export for the full history.`
              : `${rows.length} event${rows.length === 1 ? "" : "s"}.`}
          </p>

          <div className="space-y-2">
            {rows.map((row) => {
              const g = groupOf(row.action);
              return (
                <Card key={row.id}>
                  <CardContent className="flex items-start gap-3 p-4">
                    <Badge
                      variant="secondary"
                      className={cn("shrink-0 border-0 font-medium", GROUP_TONE[g])}
                    >
                      {ACTIVITY_GROUPS[g as ActivityGroup] ?? "Other"}
                    </Badge>

                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{actionLabel(row.action)}</p>
                      {row.summary && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {row.summary}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {actorName(row)}
                        </span>
                        <span>{companyName(row)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {exactWhen(row.created_at)}
                        </span>
                      </div>
                    </div>

                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {shortWhen(row.created_at)}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default ActivityAdmin;
