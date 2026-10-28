import type { Quote } from "@/lib/types";

/**
 * 시세 이력에 1초당 1개(그 초의 마지막 값)만 남기며 추가한다.
 * 실시간 체결은 초당 여러 건이 오므로, 이렇게 해야 같은 개수로 더 긴 시간을 보관할 수 있다.
 * history를 직접 수정한다.
 */
export function appendPerSecond(history: Quote[], quote: Quote, limit: number) {
  const last = history.at(-1);
  if (last && Math.floor(last.timestamp / 1000) === Math.floor(quote.timestamp / 1000)) {
    history[history.length - 1] = quote;
  } else {
    history.push(quote);
  }
  if (history.length > limit) history.splice(0, history.length - limit);
}

export interface PricePoint {
  /** 구간 시작 시각 (epoch 초) */
  time: number;
  price: number;
}

/** 시세 이력을 bucketSec 단위 구간으로 묶어 구간별 평균 가격을 만든다 (오래된 → 최신 순) */
export function averageByBucket(history: Quote[], bucketSec: number): PricePoint[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const q of history) {
    const sec = Math.floor(q.timestamp / 1000);
    const time = sec - (sec % bucketSec);
    const bucket = buckets.get(time) ?? { sum: 0, count: 0 };
    bucket.sum += q.price;
    bucket.count += 1;
    buckets.set(time, bucket);
  }
  return [...buckets].map(([time, { sum, count }]) => ({ time, price: Math.round(sum / count) }));
}
