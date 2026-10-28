"use client";

import { useEffect, useRef, useState } from "react";
import { appendPerSecond } from "@/lib/history";
import type { OrderBook, Quote, StreamEvent } from "@/lib/types";

/** 종목당 브라우저에 유지할 최대 시세 수 (1초당 1개 → 1시간치) */
const MAX_HISTORY = 3_600;

export interface SymbolFeed {
  latest: Quote | null;
  history: Quote[];
  /** 실시간 호가 (실시간 공급자일 때만 채워짐) */
  orderBook: OrderBook | null;
  error: string | null;
}

const EMPTY_FEED: SymbolFeed = { latest: null, history: [], orderBook: null, error: null };

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
    const updateFeed = (symbol: string, update: (feed: SymbolFeed) => Partial<SymbolFeed>) =>
      setFeeds((prev) => {
        const feed = prev[symbol] ?? EMPTY_FEED;
        return { ...prev, [symbol]: { ...feed, ...update(feed) } };
      });

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.type === "snapshot") {
        // 접속(새로고침 포함) 직후 서버가 쌓아 둔 데이터로 교체한다
        const latest = event.history.at(-1) ?? null;
        updateFeed(event.symbol, () => ({ latest, history: event.history, orderBook: event.orderBook, error: null }));
        if (latest) onQuoteRef.current(latest);
      } else if (event.type === "quote") {
        const { quote } = event;
        updateFeed(quote.symbol, (feed) => {
          const history = [...feed.history];
          appendPerSecond(history, quote, MAX_HISTORY);
          return { latest: quote, history, error: null };
        });
        onQuoteRef.current(quote);
      } else if (event.type === "orderbook") {
        updateFeed(event.symbol, () => ({ orderBook: event.orderBook }));
      } else {
        updateFeed(event.symbol, () => ({ error: event.message }));
      }
    };

    return () => {
      source.close();
      setStatus("idle");
    };
  }, [symbolsKey]);

  return { feeds, status: symbolsKey ? status : "idle" };
}
