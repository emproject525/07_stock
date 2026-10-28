import type { QuoteProvider } from "@/lib/types";
import { KisQuoteProvider } from "./kis";
import { MockQuoteProvider } from "./mock";

const globalForProvider = globalThis as unknown as { quoteProvider?: QuoteProvider };

function createProvider(): QuoteProvider {
  const kind = process.env.QUOTE_PROVIDER ?? "mock";
  if (kind === "kis") {
    const appKey = process.env.KIS_APP_KEY;
    const appSecret = process.env.KIS_APP_SECRET;
    if (!appKey || !appSecret) throw new Error("QUOTE_PROVIDER=kis 사용 시 KIS_APP_KEY, KIS_APP_SECRET이 필요합니다.");
    return new KisQuoteProvider({ appKey, appSecret, paper: process.env.KIS_PAPER === "true" });
  }
  return new MockQuoteProvider();
}

/** 토큰/Mock 상태를 유지하기 위해 서버 프로세스당 하나의 공급자를 공유한다 (dev HMR 대응) */
export function getQuoteProvider(): QuoteProvider {
  globalForProvider.quoteProvider ??= createProvider();
  return globalForProvider.quoteProvider;
}
