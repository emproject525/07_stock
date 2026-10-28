"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineStyle,
  LineType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { averageByBucket } from "@/lib/history";
import type { Quote, WatchItem } from "@/lib/types";

/** lightweight-charts는 UTC로 표시하므로 KST로 보이도록 보정 */
const KST_OFFSET_SEC = 9 * 60 * 60;

/** 차트에 보여줄 최근 구간 개수 */
const MAX_POINTS = 30;

const COLORS = {
  line: "#0ea5e9",
  areaTop: "rgba(56, 189, 248, 0.45)",
  areaBottom: "rgba(56, 189, 248, 0.02)",
  dayHigh: "#dc2626",
  dayLow: "#2563eb",
  highTarget: "#d97706",
  lowTarget: "#7c3aed",
};

type LineKey = "dayHigh" | "dayLow" | "highTarget" | "lowTarget";

const LINE_TITLES: Record<LineKey, string> = {
  dayHigh: "장중 고가",
  dayLow: "장중 저가",
  highTarget: "목표 최고가",
  lowTarget: "목표 최저가",
};

interface Props {
  history: Quote[];
  item: WatchItem;
  /** 이 초 단위 구간마다 평균 가격 하나로 묶어 그린다 */
  bucketSec: number;
}

export default function StockChart({ history, item, bucketSec }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<Partial<Record<LineKey, IPriceLine>>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#4b5563" },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: "#d1d5db" },
      rightPriceScale: { borderColor: "#d1d5db" },
      localization: { priceFormatter: (price: number) => Math.round(price).toLocaleString() },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: COLORS.line,
      lineWidth: 2,
      lineType: LineType.Curved,
      topColor: COLORS.areaTop,
      bottomColor: COLORS.areaBottom,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = {};
    };
  }, [item.symbol]);

  // bucketSec 단위 평균으로 묶은 최근 MAX_POINTS개를 매번 다시 그리고 화면 폭에 맞춘다.
  // (처음 1~2개일 때 fitContent한 간격이 고정되면 새 점이 화면 밖으로 밀려나므로)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || history.length === 0) return;

    const points = averageByBucket(history, bucketSec).slice(-MAX_POINTS);
    series.setData(points.map(({ time, price }) => ({ time: (time + KST_OFFSET_SEC) as UTCTimestamp, value: price })));
    chartRef.current?.applyOptions({ timeScale: { secondsVisible: bucketSec < 60 } });
    chartRef.current?.timeScale().fitContent();
  }, [history, bucketSec]);

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
