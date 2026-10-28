"use client";

import { useEffect, useState } from "react";

interface PollingState<T> {
  url: string | null;
  data: T | null;
  error: string | null;
}

/** url을 intervalMs마다 GET해서 JSON 결과를 돌려준다. url이 바뀌면 이전 결과는 버린다. */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [state, setState] = useState<PollingState<T>>({ url: null, data: null, error: null });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setState({ url, data: body as T, error: null });
      } catch (e) {
        if (!cancelled) setState((prev) => ({ ...prev, url, error: e instanceof Error ? e.message : String(e) }));
      }
    };

    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, intervalMs]);

  // 종목을 바꾼 직후엔 이전 종목 데이터를 보여주지 않는다
  return state.url === url ? state : { url, data: null, error: null };
}
