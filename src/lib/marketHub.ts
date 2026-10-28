import { appendPerSecond } from "@/lib/history";
import { getQuoteProvider } from "@/lib/providers";
import type { OrderBook, Quote, QuoteProvider, StreamEvent } from "@/lib/types";

/** 종목당 서버 메모리에 보관할 시세 개수 (1초당 1개 → 1시간치) */
const HISTORY_LIMIT = 3_600;
/** 새로 접속한 브라우저에 처음 보내줄 시세 개수 (1분 단위 차트 30개를 채울 수 있는 30분치) */
const SNAPSHOT_LIMIT = 1_800;
/** 보는 사람이 없어도 이 시간 동안은 계속 수신해 데이터를 쌓아 둔다 */
const IDLE_RELEASE_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 2_000;
const MIN_INTERVAL_MS = 500;

type Send = (event: StreamEvent) => void;

interface SymbolEntry {
  history: Quote[];
  orderBook: OrderBook | null;
  viewers: Set<Send>;
  stop: () => void;
  idleTimer?: ReturnType<typeof setTimeout>;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 서버 프로세스 안에서 종목별 시세 수신을 한 번만 하고, 받은 데이터를 메모리에 쌓아 두는 허브.
 * 브라우저(SSE)가 새로 붙으면 쌓아 둔 데이터를 먼저 보내고 이후 실시간 데이터를 나눠준다.
 * (서버를 재시작하면 비워진다)
 */
class MarketHub {
  private readonly entries = new Map<string, SymbolEntry>();

  constructor(private readonly provider: QuoteProvider) {}

  watch(symbol: string, send: Send): () => void {
    const entry = this.entries.get(symbol) ?? this.start(symbol);
    clearTimeout(entry.idleTimer);
    entry.viewers.add(send);
    send({ type: "snapshot", symbol, history: entry.history.slice(-SNAPSHOT_LIMIT), orderBook: entry.orderBook });

    return () => {
      entry.viewers.delete(send);
      if (entry.viewers.size > 0) return;
      entry.idleTimer = setTimeout(() => this.release(symbol), IDLE_RELEASE_MS);
    };
  }

  private start(symbol: string): SymbolEntry {
    const entry: SymbolEntry = { history: [], orderBook: null, viewers: new Set(), stop: () => {} };
    this.entries.set(symbol, entry);
    entry.stop = this.provider.subscribe ? this.subscribeRealtime(symbol, entry) : this.startPolling(symbol, entry);
    return entry;
  }

  private release(symbol: string) {
    this.entries.get(symbol)?.stop();
    this.entries.delete(symbol);
  }

  private broadcast(entry: SymbolEntry, event: StreamEvent) {
    entry.viewers.forEach((send) => send(event));
  }

  private recordQuote(entry: SymbolEntry, quote: Quote) {
    // REST 스냅샷에는 체결강도가 없으므로 직전 실시간 값을 유지한다
    const last = entry.history.at(-1);
    const merged = { ...quote, strength: quote.strength ?? last?.strength };
    appendPerSecond(entry.history, merged, HISTORY_LIMIT);
    this.broadcast(entry, { type: "quote", quote: merged });
  }

  private recordError(entry: SymbolEntry, symbol: string, e: unknown) {
    this.broadcast(entry, { type: "error", symbol, message: errorMessage(e) });
  }

  /** 첫 값은 REST 스냅샷으로 채우고, 이후는 공급자가 푸시하는 체결가·호가를 쌓는다 */
  private subscribeRealtime(symbol: string, entry: SymbolEntry) {
    this.provider
      .getQuote(symbol)
      .then((quote) => {
        // 스냅샷이 실시간 체결보다 늦게 도착했으면 버린다
        if (entry.history.length === 0) this.recordQuote(entry, quote);
      })
      .catch((e) => this.recordError(entry, symbol, e));

    return this.provider.subscribe!(symbol, {
      onQuote: (quote) => this.recordQuote(entry, quote),
      onOrderBook: (sym, orderBook) => {
        entry.orderBook = orderBook;
        this.broadcast(entry, { type: "orderbook", symbol: sym, orderBook });
      },
      onError: (sym, message) => this.broadcast(entry, { type: "error", symbol: sym, message }),
    });
  }

  private startPolling(symbol: string, entry: SymbolEntry) {
    const intervalMs = Math.max(MIN_INTERVAL_MS, Number(process.env.QUOTE_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        this.recordQuote(entry, await this.provider.getQuote(symbol));
      } catch (e) {
        this.recordError(entry, symbol, e);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };

    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}

const globalForHub = globalThis as unknown as { marketHub?: MarketHub };

/** 서버 프로세스당 하나의 허브를 공유한다 (dev HMR에서도 유지) */
export function getMarketHub(): MarketHub {
  globalForHub.marketHub ??= new MarketHub(getQuoteProvider());
  return globalForHub.marketHub;
}
