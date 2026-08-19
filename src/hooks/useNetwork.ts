import { useEffect, useState } from "react";
import { isOnline, onNetworkChange, startNetworkWatch } from "@/native/net";

/**
 * Live connectivity state.
 *
 * Screens use this to switch between "live" and "offline" presentation rather
 * than letting a failed query render as an error or, worse, as empty data.
 */
export function useNetwork(): { online: boolean; offline: boolean } {
  const [online, setOnline] = useState<boolean>(isOnline());

  useEffect(() => {
    let active = true;
    void startNetworkWatch().then(() => {
      if (active) setOnline(isOnline());
    });
    const unsubscribe = onNetworkChange((next) => {
      if (active) setOnline(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { online, offline: !online };
}
