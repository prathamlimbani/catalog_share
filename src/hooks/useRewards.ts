/**
 * React bindings for the rewards data layer.
 *
 * The wallet updates over realtime as well as on demand, because the credit for
 * a watched ad arrives from Google's server-side callback seconds AFTER the ad
 * closes — the client never grants it. Without a live subscription the merchant
 * watches an ad, sees nothing happen, and watches another.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_REWARDS_CONFIG,
  EMPTY_WALLET,
  fetchRewardOffers,
  fetchRewardsConfig,
  fetchWallet,
  type RewardOffer,
  type RewardsConfig,
  type Wallet,
} from "@/lib/rewards";

export function useRewardsConfig(): { config: RewardsConfig; loading: boolean } {
  const [config, setConfig] = useState<RewardsConfig>(DEFAULT_REWARDS_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetchRewardsConfig().then((c) => {
      if (!active) return;
      setConfig(c);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { config, loading };
}

/**
 * How long to keep re-checking the wallet after an ad closes.
 *
 * The SSV callback is Google → our endpoint → Postgres, and that round trip is
 * usually under two seconds but is not instant and is not guaranteed. Realtime
 * covers the normal case; this polling window covers a websocket that never
 * connected, which is common enough on Indian mobile networks to matter.
 */
const CREDIT_POLL_MS = 2_000;
const CREDIT_POLL_ATTEMPTS = 8;

export function useWallet(companyId: string | null | undefined): {
  wallet: Wallet;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Poll until the balance rises, for use right after an ad finishes. */
  awaitCredit: (previousBalance: number) => Promise<boolean>;
} {
  const [wallet, setWallet] = useState<Wallet>(EMPTY_WALLET);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchWallet(companyId);
    if (alive.current) setWallet(next);
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setWallet(EMPTY_WALLET);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void fetchWallet(companyId).then((w) => {
      if (!active) return;
      setWallet(w);
      setLoading(false);
    });

    // A credit lands as an INSERT written by the SSV callback under the service
    // role, so it arrives here and nowhere else.
    const channel = supabase
      .channel(`wallet:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "points_ledger",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [companyId, refresh]);

  const awaitCredit = useCallback(
    async (previousBalance: number): Promise<boolean> => {
      for (let i = 0; i < CREDIT_POLL_ATTEMPTS; i += 1) {
        await new Promise((r) => setTimeout(r, CREDIT_POLL_MS));
        if (!alive.current) return false;
        const next = await fetchWallet(companyId);
        if (!alive.current) return false;
        setWallet(next);
        if (next.balance > previousBalance) return true;
      }
      return false;
    },
    [companyId],
  );

  return { wallet, loading, refresh, awaitCredit };
}

export function useRewardOffers(): { offers: RewardOffer[]; loading: boolean; refresh: () => void } {
  const [offers, setOffers] = useState<RewardOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchRewardOffers().then((list) => {
      if (!active) return;
      setOffers(list);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [tick]);

  return { offers, loading, refresh: () => setTick((t) => t + 1) };
}
