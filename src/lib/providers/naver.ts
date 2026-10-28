import type { Quote, QuoteProvider } from "@/lib/types";

const BASE_URL = "https://polling.finance.naver.com/api/realtime/domestic/stock";
/** 전일 대비 방향 코드: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락 */
const FALLING_CODES = new Set(["4", "5"]);

interface NaverStockData {
  itemCode: string;
  stockName: string;
  closePriceRaw: string;
  compareToPreviousClosePriceRaw: string;
  compareToPreviousPrice: { code: string };
  openPriceRaw: string;
  highPriceRaw: string;
  lowPriceRaw: string;
  accumulatedTradingVolumeRaw: string;
}

/**
 * 네이버 금융 실시간 시세 폴링 API 기반 공급자.
 * 키 없이 무료로 쓸 수 있지만 비공식 API라 예고 없이 바뀌거나 막힐 수 있다.
 */
export class NaverQuoteProvider implements QuoteProvider {
  readonly name = "naver";

  async getQuote(symbol: string): Promise<Quote> {
    const res = await fetch(`${BASE_URL}/${symbol}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`네이버 시세 조회 실패 (HTTP ${res.status})`);

    const body = (await res.json()) as { datas?: NaverStockData[] };
    const data = body.datas?.[0];
    if (!data) throw new Error(`종목을 찾을 수 없습니다: ${symbol}`);

    const price = Number(data.closePriceRaw);
    const diff = Math.abs(Number(data.compareToPreviousClosePriceRaw));
    const prevClose = FALLING_CODES.has(data.compareToPreviousPrice.code) ? price + diff : price - diff;

    return {
      symbol,
      name: data.stockName,
      price,
      dayHigh: Number(data.highPriceRaw),
      dayLow: Number(data.lowPriceRaw),
      open: Number(data.openPriceRaw),
      prevClose,
      volume: Number(data.accumulatedTradingVolumeRaw),
      timestamp: Date.now(),
    };
  }
}
