import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMirroredCompany, mirrorCompany } from "@/lib/offline/mirror";
import { isOnline } from "@/native/net";

/** Query key for the signed-in company, scoped by user so accounts cannot bleed. */
export const companyKey = (userId?: string | null) => ["current-company", userId ?? "anon"] as const;

/**
 * What useCurrentCompany returns.
 *
 * `isPending` / `isLoading` are widened to cover BOTH queries — see the note in
 * the hook — so a caller can trust them to mean "we do not know yet".
 */
export type CurrentCompanyResult = Omit<
  UseQueryResult<Record<string, any> | null>,
  "isPending" | "isLoading"
> & {
  isPending: boolean;
  isLoading: boolean;
};

/**
 * The signed-in user's company.
 *
 * Three behaviours matter here beyond the plain fetch:
 *  1. The key is scoped by user id. It used to be a bare ["current-company"],
 *     so after switching accounts the previous owner's name, email, GST and UPI
 *     id kept rendering for up to five minutes.
 *  2. When the network is unavailable the locally mirrored row is returned, so
 *     estimates keep their branding offline instead of the screen collapsing to
 *     "No company found. Please register first."
 *  3. The company fetch is gated on the session lookup, and react-query reports
 *     a DISABLED query as isLoading === false with data === undefined. Callers
 *     read that as "loaded, no company" and flashed the setup empty state at
 *     every signed-in merchant on cold start, so the pending flags below are
 *     widened to cover the session query too.
 */
export const useCurrentCompany = (): CurrentCompanyResult => {
  const sessionQuery = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.user?.id ?? null;
    },
    staleTime: 30 * 1000,
  });

  const userId = sessionQuery.data ?? null;

  const companyQuery = useQuery({
    queryKey: companyKey(userId),
    enabled: sessionQuery.isFetched,
    queryFn: async () => {
      if (!userId) {
        // Signed out — but if we are merely offline, keep the mirror so the
        // app does not bounce the user to /login on a flaky connection.
        if (!isOnline()) return (await getMirroredCompany()) as Record<string, any> | null;
        return null;
      }

      if (!isOnline()) {
        const mirrored = await getMirroredCompany();
        if (mirrored) return mirrored as unknown as Record<string, any>;
      }

      try {
        const { data, error } = await supabase
          .from("companies")
          .select("*")
          .eq("owner_id", userId)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) void mirrorCompany(data as Record<string, unknown>);
        return data as Record<string, any> | null;
      } catch (err) {
        const mirrored = await getMirroredCompany();
        if (mirrored) return mirrored as unknown as Record<string, any>;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // `data === null` only means "this account has no company" once BOTH queries
  // have settled; until then the honest answer is "still loading".
  const pending = sessionQuery.isPending || companyQuery.isPending;

  return { ...companyQuery, isPending: pending, isLoading: pending } as CurrentCompanyResult;
};

export const useCompanyBySlug = (slug: string) => {
  return useQuery({
    queryKey: ["company", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
};
