import type { InvestorTrend, OrderBook } from "@/lib/types";

/**
 * 네이버 금융 모바일 API로 호가·투자자별 매매동향을 가져온다.
 * 비공식 API라 예고 없이 바뀌거나 막힐 수 있다.
 */
const BASE_URL = "https://m.stock.naver.com/api/stock";

interface NaverAskingPrice {
  totalSell: string;
  totalBuy: string;
  sellInfo: { price: string; count: string }[];
  buyInfos: { price: string; count: string }[];
}

interface NaverDealTrend {
  bizdate: string;
  foreignerPureBuyQuant: string;
  organPureBuyQuant: string;
  individualPureBuyQuant: string;
  foreignerHoldRatio: string;
}

/** "+1,234" / "-1,234" / "1,234" → 숫자 */
function toNumber(value: string): number {
  return Number(value.replaceAll(",", ""));
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`네이버 조회 실패 (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function fetchOrderBook(symbol: string): Promise<OrderBook> {
  const body = await fetchJson<NaverAskingPrice>(`${symbol}/askingPrice`);
  const toLevel = (level: { price: string; count: string }) => ({
    price: toNumber(level.price),
    quantity: toNumber(level.count),
  });
  return {
    totalAsk: toNumber(body.totalSell),
    totalBid: toNumber(body.totalBuy),
    asks: body.sellInfo.map(toLevel),
    bids: body.buyInfos.map(toLevel),
  };
}

export async function fetchInvestorTrends(symbol: string): Promise<InvestorTrend[]> {
  const body = await fetchJson<NaverDealTrend[]>(`${symbol}/trend`);
  return body.map((row) => ({
    date: `${row.bizdate.slice(0, 4)}-${row.bizdate.slice(4, 6)}-${row.bizdate.slice(6, 8)}`,
    foreign: toNumber(row.foreignerPureBuyQuant),
    institution: toNumber(row.organPureBuyQuant),
    individual: toNumber(row.individualPureBuyQuant),
    foreignHoldRatio: row.foreignerHoldRatio,
  }));
}
