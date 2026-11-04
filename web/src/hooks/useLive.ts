"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Live<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** True once data has come back at least once. Polling never hides it again. */
  loaded: boolean;
  refresh: () => Promise<void>;
};

/** Reads from the chain, keeps the last good value and polls while the tab is open. */
export function useLive<T>(fetcher: (() => Promise<T>) | null, key: string, intervalMs = 6_000): Live<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: Error; loaded: boolean }>({ key, loaded: false });
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const run = latest.current;
    if (!run) return;
    const mine = ++generation.current;
    try {
      const data = await run();
      if (mine === generation.current) setState({ key, data, loaded: true });
    } catch (error) {
      if (mine === generation.current) {
        setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : undefined,
          error: error instanceof Error ? error : new Error(String(error)),
          loaded: previous.key === key && previous.loaded,
        }));
      }
    }
  }, [key]);

  useEffect(() => {
    void refresh();
    if (!intervalMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  const current = state.key === key ? state : { data: undefined, error: undefined, loaded: false };
  return {
    data: current.data,
    error: current.error,
    loaded: current.loaded,
    loading: !current.loaded && !current.error && fetcher !== null,
    refresh,
  };
}

/** Chain time that keeps ticking between polls, so countdowns stay live. */
export function useChainNow(chainNow: number | undefined): number {
  const [tick, setTick] = useState({ chain: chainNow, offset: 0 });
  useEffect(() => {
    if (chainNow === undefined) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setTick({ chain: chainNow, offset: Math.floor((Date.now() - startedAt) / 1000) }), 1000);
    return () => clearInterval(timer);
  }, [chainNow]);
  // A tick from before the latest poll no longer applies.
  return (chainNow ?? 0) + (tick.chain === chainNow ? tick.offset : 0);
}
