"use client";

import { usePolling } from "@/hooks/usePolling";
import type { InvestorTrend, OrderBook } from "@/lib/types";

/** 네이버 호가는 실시간이 아닌 지연 데이터라 짧게 폴링해도 의미가 없다 */
const ORDER_BOOK_INTERVAL_MS = 10_000;
/** 투자자 동향은 하루 단위 확정치라 자주 볼 필요가 없다 */
const INVESTOR_INTERVAL_MS = 60_000;
const INVESTOR_DAYS = 5;
/** 매도·매수 각각 보여줄 호가 단계 수 */
const VISIBLE_LEVELS = 5;

function formatSigned(n: number) {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

/** 한국 시장 관례: 매수(+) 빨강, 매도(-) 파랑 */
function signColor(n: number) {
  if (n === 0) return "text-gray-700";
  return n > 0 ? "text-red-600" : "text-blue-600";
}

interface Props {
  symbol: string;
  /** 실시간 스트림으로 받은 호가. 있으면 네이버 지연 호가 대신 이것을 보여준다 */
  liveOrderBook: OrderBook | null;
}

export default function MarketFlow({ symbol, liveOrderBook }: Props) {
  const delayedOrderBook = usePolling<OrderBook>(
    liveOrderBook ? null : `/api/market?symbol=${symbol}&type=orderbook`,
    ORDER_BOOK_INTERVAL_MS,
  );
  const investors = usePolling<InvestorTrend[]>(`/api/market?symbol=${symbol}&type=investors`, INVESTOR_INTERVAL_MS);
  const orderBook = liveOrderBook ?? delayedOrderBook.data;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-gray-200 p-4">
        <SectionTitle
          title="호가 잔량"
          note={liveOrderBook ? "대기 주문 · 🟢 실시간" : "대기 주문 · ⚠️ 지연 데이터 (현재가보다 늦음)"}
        />
        {orderBook ? <OrderBookView book={orderBook} /> : <Placeholder error={delayedOrderBook.error} />}
      </section>
      <section className="rounded-lg border border-gray-200 p-4">
        <SectionTitle title="투자자별 순매수" note="일별 · 장 마감 후 확정치 (단위: 주)" />
        {investors.data ? <InvestorView trends={investors.data} /> : <Placeholder error={investors.error} />}
      </section>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="font-medium">{title}</h2>
      <span className="text-xs text-gray-500">{note}</span>
    </div>
  );
}

function Placeholder({ error }: { error: string | null }) {
  return <p className={`text-sm ${error ? "text-red-600" : "text-gray-500"}`}>{error ?? "불러오는 중..."}</p>;
}

function OrderBookView({ book }: { book: OrderBook }) {
  const total = book.totalAsk + book.totalBid;
  const bidRatio = total > 0 ? (book.totalBid / total) * 100 : 50;
  // 현재가에 가까운 호가만 보여준다 (asks·bids 모두 높은 가격 → 낮은 가격 순)
  const asks = book.asks.slice(-VISIBLE_LEVELS);
  const bids = book.bids.slice(0, VISIBLE_LEVELS);
  const maxQuantity = Math.max(1, ...asks.map((l) => l.quantity), ...bids.map((l) => l.quantity));
  const verdict = bidRatio > 55 ? "매수 우세" : bidRatio < 45 ? "매도 우세" : "팽팽함";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-blue-600">매도 {book.totalAsk.toLocaleString()}</span>
          <span className="font-medium">{verdict}</span>
          <span className="text-red-600">매수 {book.totalBid.toLocaleString()}</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
          <div className="bg-blue-500 transition-all" style={{ width: `${100 - bidRatio}%` }} />
          <div className="bg-red-500 transition-all" style={{ width: `${bidRatio}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-gray-500">
          <span>{(100 - bidRatio).toFixed(1)}%</span>
          <span>{bidRatio.toFixed(1)}%</span>
        </div>
      </div>

      <table className="w-full table-fixed font-mono text-sm">
        <thead>
          <tr className="text-xs text-gray-500">
            <th className="text-left font-normal">매도잔량</th>
            <th className="text-center font-normal">호가</th>
            <th className="text-right font-normal">매수잔량</th>
          </tr>
        </thead>
        <tbody>
          {asks.map((level) => (
            <tr key={`ask-${level.price}`} className="bg-blue-50/50">
              <QuantityCell quantity={level.quantity} max={maxQuantity} side="ask" />
              <td className="py-0.5 text-center text-blue-600">{level.price.toLocaleString()}</td>
              <td />
            </tr>
          ))}
          {bids.map((level) => (
            <tr key={`bid-${level.price}`} className="bg-red-50/50">
              <td />
              <td className="py-0.5 text-center text-red-600">{level.price.toLocaleString()}</td>
              <QuantityCell quantity={level.quantity} max={maxQuantity} side="bid" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuantityCell({ quantity, max, side }: { quantity: number; max: number; side: "ask" | "bid" }) {
  const width = `${(quantity / max) * 100}%`;
  return (
    <td className="relative py-0.5">
      <div
        className={`absolute inset-y-0.5 ${side === "ask" ? "right-0 bg-blue-200" : "left-0 bg-red-200"}`}
        style={{ width }}
      />
      <span className={`relative block px-1 ${side === "ask" ? "text-left" : "text-right"}`}>{quantity.toLocaleString()}</span>
    </td>
  );
}

function InvestorView({ trends }: { trends: InvestorTrend[] }) {
  const latest = trends[0];
  if (!latest) return <Placeholder error={null} />;
  const groups: [string, number][] = [
    ["외국인", latest.foreign],
    ["기관", latest.institution],
    ["개인", latest.individual],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs text-gray-500">{latest.date} 기준</p>
        <div className="grid grid-cols-3 gap-2">
          {groups.map(([label, value]) => (
            <div key={label} className="rounded-md border border-gray-200 px-3 py-2">
              <div className="text-xs text-gray-500">
                {label} {value > 0 ? "순매수" : value < 0 ? "순매도" : ""}
              </div>
              <div className={`font-mono text-sm font-medium ${signColor(value)}`}>{formatSigned(value)}</div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">외국인 보유 비율 {latest.foreignHoldRatio}</p>
      </div>

      <table className="w-full font-mono text-sm">
        <thead>
          <tr className="text-xs text-gray-500">
            <th className="text-left font-normal">날짜</th>
            <th className="text-right font-normal">외국인</th>
            <th className="text-right font-normal">기관</th>
            <th className="text-right font-normal">개인</th>
          </tr>
        </thead>
        <tbody>
          {trends.slice(0, INVESTOR_DAYS).map((row) => (
            <tr key={row.date} className="border-t border-gray-100">
              <td className="py-1 text-gray-600">{row.date.slice(5)}</td>
              <td className={`text-right ${signColor(row.foreign)}`}>{formatSigned(row.foreign)}</td>
              <td className={`text-right ${signColor(row.institution)}`}>{formatSigned(row.institution)}</td>
              <td className={`text-right ${signColor(row.individual)}`}>{formatSigned(row.individual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
