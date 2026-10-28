import type { Quote, QuoteProvider } from "@/lib/types";

interface MockState {
  price: number;
  dayHigh: number;
  dayLow: number;
  open: number;
  prevClose: number;
  volume: number;
}

/** 종목코드로부터 결정적인 기준가를 만든다 (같은 코드면 같은 시작가) */
function basePriceOf(symbol: string): number {
  let hash = 0;
  for (const ch of symbol) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 10_000 + (hash % 90) * 1_000;
}

/** 한국 주식 호가 단위에 맞춰 반올림 (단순화) */
function roundToTick(price: number): number {
  const tick = price < 20_000 ? 10 : price < 50_000 ? 50 : price < 200_000 ? 100 : 500;
  return Math.round(price / tick) * tick;
}

/**
 * 랜덤 워크로 시세를 만들어내는 테스트용 공급자.
 * 증권사 API 키 없이도 화면/알람 동작을 확인할 수 있다.
 */
export class MockQuoteProvider implements QuoteProvider {
  readonly name = "mock";
  private readonly states = new Map<string, MockState>();

  async getQuote(symbol: string): Promise<Quote> {
    const state = this.states.get(symbol) ?? this.createState(symbol);
    const drift = (Math.random() - 0.5) * state.prevClose * 0.004;
    state.price = roundToTick(Math.max(1, state.price + drift));
    state.dayHigh = Math.max(state.dayHigh, state.price);
    state.dayLow = Math.min(state.dayLow, state.price);
    state.volume += Math.floor(Math.random() * 5_000);
    this.states.set(symbol, state);

    return { symbol, ...state, timestamp: Date.now() };
  }

  private createState(symbol: string): MockState {
    const prevClose = basePriceOf(symbol);
    return { price: prevClose, dayHigh: prevClose, dayLow: prevClose, open: prevClose, prevClose, volume: 0 };
  }
}
