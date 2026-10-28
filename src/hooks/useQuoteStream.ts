"use client";

import { useEffect, useRef, useState } from "react";
import type { Quote, StreamEvent } from "@/lib/types";

/** 종목당 차트에 유지할 최대 포인트 수 */
const MAX_HISTORY = 5_000;

export interface SymbolFeed {
  latest: Quote | null;
  history: Quote[];
  error: string | null;
}

export type ConnectionStatus = "idle" | "connecting" | "open" | "error";

/**
 * /api/stream SSE에 연결해 감시 종목들의 시세를 실시간으로 받는다.
 * onQuote는 매 시세 수신 시 호출된다 (알람 판정용).
 */
export function useQuoteStream(symbols: string[], onQuote: (quote: Quote) => void) {
  const [feeds, setFeeds] = useState<Record<string, SymbolFeed>>({});
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const onQuoteRef = useRef(onQuote);
  const symbolsKey = [...symbols].sort().join(",");

  useEffect(() => {
    onQuoteRef.current = onQuote;
  }, [onQuote]);

  useEffect(() => {
    if (!symbolsKey) return;

    const source = new EventSource(`/api/stream?symbols=${encodeURIComponent(symbolsKey)}`);
    source.onopen = () => setStatus("open");
    // EventSource는 끊기면 자동 재연결한다
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "error" : "connecting");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.type === "quote") {
        const { quote } = event;
        setFeeds((prev) => {
          const history = [...(prev[quote.symbol]?.history ?? []), quote].slice(-MAX_HISTORY);
          return { ...prev, [quote.symbol]: { latest: quote, history, error: null } };
        });
        onQuoteRef.current(quote);
      } else {
        setFeeds((prev) => ({
          ...prev,
          [event.symbol]: {
            latest: prev[event.symbol]?.latest ?? null,
            history: prev[event.symbol]?.history ?? [],
            error: event.message,
          },
        }));
      }
    };

    return () => {
      source.close();
      setStatus("idle");
    };
  }, [symbolsKey]);

  return { feeds, status: symbolsKey ? status : "idle" };
}
