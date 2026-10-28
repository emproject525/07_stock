"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Quote, WatchItem } from "@/lib/types";

/** lightweight-charts는 UTC로 표시하므로 KST로 보이도록 보정 */
const KST_OFFSET_SEC = 9 * 60 * 60;

const COLORS = {
  line: "#e5e7eb",
  dayHigh: "#f87171",
  dayLow: "#60a5fa",
  highTarget: "#f59e0b",
  lowTarget: "#a78bfa",
};

type LineKey = "dayHigh" | "dayLow" | "highTarget" | "lowTarget";

const LINE_TITLES: Record<LineKey, string> = {
  dayHigh: "장중 고가",
  dayLow: "장중 저가",
  highTarget: "목표 최고가",
  lowTarget: "목표 최저가",
};

function toChartTime(timestamp: number) {
  return (Math.floor(timestamp / 1000) + KST_OFFSET_SEC) as UTCTimestamp;
}

interface Props {
  history: Quote[];
  item: WatchItem;
}

export default function StockChart({ history, item }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<Partial<Record<LineKey, IPriceLine>>>({});
  /** 마지막으로 그린 시세 시각. null이면 다음 업데이트에서 setData로 전체를 그린다 */
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: "#374151" },
      rightPriceScale: { borderColor: "#374151" },
      localization: { priceFormatter: (price: number) => Math.round(price).toLocaleString() },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(LineSeries, { color: COLORS.line, lineWidth: 2 });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = {};
      lastTimeRef.current = null;
    };
  }, [item.symbol]);

  // 시세 데이터: 처음엔 전체를 그리고, 이후엔 새 포인트만 이어 붙인다
  useEffect(() => {
    const series = seriesRef.current;
    const last = history.at(-1);
    if (!series || !last) return;

    if (lastTimeRef.current === null) {
      // 같은 초에 여러 포인트가 오면 마지막 값만 남긴다 (시간축은 오름차순·고유해야 함)
      const bySecond = new Map<number, number>();
      for (const q of history) bySecond.set(toChartTime(q.timestamp), q.price);
      series.setData([...bySecond].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
      chartRef.current?.timeScale().fitContent();
    } else {
      series.update({ time: toChartTime(last.timestamp), value: last.price });
    }
    lastTimeRef.current = last.timestamp;
  }, [history]);

  // 장중 고/저가와 목표가 수평선
  const latest = history.at(-1);
  const levels: Record<LineKey, number | null> = {
    dayHigh: latest?.dayHigh ?? null,
    dayLow: latest?.dayLow ?? null,
    highTarget: item.highTarget,
    lowTarget: item.lowTarget,
  };
  const levelsKey = JSON.stringify(levels);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const parsed = JSON.parse(levelsKey) as Record<LineKey, number | null>;

    for (const key of Object.keys(parsed) as LineKey[]) {
      const price = parsed[key];
      const existing = priceLinesRef.current[key];
      if (price === null) {
        if (existing) series.removePriceLine(existing);
        delete priceLinesRef.current[key];
      } else if (existing) {
        existing.applyOptions({ price });
      } else {
        priceLinesRef.current[key] = series.createPriceLine({
          price,
          color: COLORS[key],
          lineWidth: 1,
          lineStyle: key.endsWith("Target") ? LineStyle.Dashed : LineStyle.Dotted,
          axisLabelVisible: true,
          title: LINE_TITLES[key],
        });
      }
    }
  }, [levelsKey]);

  return <div ref={containerRef} className="h-full w-full" />;
}
