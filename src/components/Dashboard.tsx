"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import MarketFlow from "@/components/MarketFlow";
import StockChart from "@/components/StockChart";
import WatchItemForm from "@/components/WatchItemForm";
import { useQuoteStream, type ConnectionStatus, type SymbolFeed } from "@/hooks/useQuoteStream";
import { useWatchlist } from "@/hooks/useWatchlist";
import { AlarmTracker, playBeep, showBrowserNotification, unlockAudio, type AlarmEvent } from "@/lib/alarm";
import type { Quote, WatchItem } from "@/lib/types";

const MAX_ALARM_LOG = 50;
/** 차트 묶음 단위 선택지 [라벨, 초] */
const BUCKET_OPTIONS: [string, number][] = [
  ["1초", 1],
  ["10초", 10],
  ["1분", 60],
];
const DEFAULT_BUCKET_SEC = 10;
const APP_TITLE = "주가 알람";

const noopSubscribe = () => () => {};

function useNotificationPermission() {
  const [requested, setRequested] = useState<NotificationPermission | null>(null);
  const current = useSyncExternalStore(
    noopSubscribe,
    () => (typeof Notification === "undefined" ? "denied" : Notification.permission),
    () => "default" as NotificationPermission,
  );
  const request = async () => setRequested(await Notification.requestPermission());
  return { permission: requested ?? current, request };
}

function formatPrice(n: number | null | undefined) {
  return n === null || n === undefined ? "-" : n.toLocaleString();
}

/** 사용자가 붙인 이름 → 공급자 종목명 → 종목코드 순으로 표시 */
function displayNameOf(item: WatchItem, quote: Quote | null) {
  return item.name || quote?.name || item.symbol;
}

function changeOf(quote: Quote | null) {
  if (!quote || !quote.prevClose) return null;
  const diff = quote.price - quote.prevClose;
  return { diff, rate: (diff / quote.prevClose) * 100 };
}

/** 한국 시장 관례: 상승 빨강, 하락 파랑 */
function changeColor(diff: number | undefined) {
  if (!diff) return "text-gray-700";
  return diff > 0 ? "text-red-600" : "text-blue-600";
}

const STATUS_LABEL: Record<ConnectionStatus, [string, string]> = {
  idle: ["대기", "bg-gray-500"],
  connecting: ["연결 중", "bg-yellow-400"],
  open: ["실시간", "bg-green-400"],
  error: ["연결 끊김", "bg-red-500"],
};

export default function Dashboard() {
  const { items, upsert, remove } = useWatchlist();
  const [selected, setSelected] = useState<string | null>(null);
  const [bucketSec, setBucketSec] = useState(DEFAULT_BUCKET_SEC);
  const [editing, setEditing] = useState<string | null>(null);
  const [alarmLog, setAlarmLog] = useState<AlarmEvent[]>([]);
  const [pending, setPending] = useState<AlarmEvent[]>([]);
  const [soundOn, setSoundOn] = useState(false);
  const { permission, request } = useNotificationPermission();

  const trackerRef = useRef(new AlarmTracker());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleQuote = useCallback((quote: Quote) => {
    const item = itemsRef.current.find((i) => i.symbol === quote.symbol);
    if (!item) return;
    const events = trackerRef.current.check(item, quote);
    if (events.length === 0) return;

    for (const event of events) {
      playBeep(event.side);
      showBrowserNotification(event);
    }
    setAlarmLog((prev) => [...events, ...prev].slice(0, MAX_ALARM_LOG));
    setPending((prev) => [...events, ...prev]);
  }, []);

  const { feeds, status } = useQuoteStream(
    items.map((i) => i.symbol),
    handleQuote,
  );

  // 확인하지 않은 알람이 있으면 탭 제목으로도 알린다
  useEffect(() => {
    document.title = pending.length > 0 ? `🔔 (${pending.length}) ${APP_TITLE}` : APP_TITLE;
  }, [pending.length]);

  const enableAlerts = async () => {
    unlockAudio();
    setSoundOn(true);
    if (permission === "default") await request();
  };

  const selectedItem = items.find((i) => i.symbol === selected) ?? items[0] ?? null;
  const selectedFeed: SymbolFeed | undefined = selectedItem ? feeds[selectedItem.symbol] : undefined;
  const [statusLabel, statusDot] = STATUS_LABEL[status];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold">{APP_TITLE}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span className={`h-2 w-2 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          {(!soundOn || permission !== "granted") && (
            <button onClick={enableAlerts} className="rounded-md bg-amber-500 px-3 py-1 font-medium text-gray-900 hover:bg-amber-400">
              🔔 알림·소리 켜기
            </button>
          )}
          {permission === "denied" && <span className="text-xs text-red-600">브라우저 알림이 차단됨 (사이트 설정에서 허용)</span>}
        </div>
      </header>

      {pending.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-amber-300 bg-amber-50 px-4 py-2">
          {pending.slice(0, 3).map((event) => (
            <p key={event.id} className="text-sm text-amber-900">
              🔔 <b>{event.name}</b> {event.side === "high" ? "최고가" : "최저가"} 도달 — 현재가 {formatPrice(event.price)}원 (목표{" "}
              {formatPrice(event.target)}원)
            </p>
          ))}
          <button onClick={() => setPending([])} className="self-start text-xs text-amber-700 underline">
            확인 ({pending.length}건)
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="flex w-full flex-col gap-4 border-gray-200 p-4 md:w-80 md:border-r">
          <section>
            <h2 className="mb-2 text-sm font-medium text-gray-600">종목 추가</h2>
            <WatchItemForm onSubmit={upsert} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-gray-600">감시 목록</h2>
            {items.length === 0 && <p className="text-sm text-gray-500">종목을 추가하세요.</p>}
            {items.map((item) => (
              <WatchRow
                key={item.symbol}
                item={item}
                feed={feeds[item.symbol]}
                active={item.symbol === selectedItem?.symbol}
                editing={item.symbol === editing}
                onSelect={() => setSelected(item.symbol)}
                onEdit={() => setEditing(item.symbol)}
                onSave={(next) => {
                  upsert(next);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
                onRemove={() => remove(item.symbol)}
              />
            ))}
          </section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          {selectedItem ? (
            <>
              <QuoteSummary item={selectedItem} feed={selectedFeed} />
              <div className="flex flex-col rounded-lg border border-gray-200 p-2">
                <div className="flex items-center justify-between px-2 pb-2">
                  <span className="text-xs text-gray-500">최근 30구간 평균 가격</span>
                  <div className="flex rounded-md border border-gray-200 text-xs">
                    {BUCKET_OPTIONS.map(([label, sec]) => (
                      <button
                        key={sec}
                        onClick={() => setBucketSec(sec)}
                        className={`px-3 py-1 first:rounded-l-md last:rounded-r-md ${
                          bucketSec === sec ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-[400px]">
                  <StockChart
                    key={selectedItem.symbol}
                    item={selectedItem}
                    history={selectedFeed?.history ?? []}
                    bucketSec={bucketSec}
                  />
                </div>
              </div>
              <MarketFlow symbol={selectedItem.symbol} liveOrderBook={selectedFeed?.orderBook ?? null} />
            </>
          ) : (
            <p className="text-gray-500">왼쪽에서 종목을 추가하면 실시간 차트가 표시됩니다.</p>
          )}

          <section>
            <h2 className="mb-2 text-sm font-medium text-gray-600">알람 기록</h2>
            {alarmLog.length === 0 ? (
              <p className="text-sm text-gray-500">아직 울린 알람이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {alarmLog.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="text-gray-500">{new Date(event.timestamp).toLocaleTimeString("ko-KR")}</span>
                    <span>{event.name}</span>
                    <span className={event.side === "high" ? "text-red-600" : "text-blue-600"}>
                      {event.side === "high" ? "최고가" : "최저가"} {formatPrice(event.target)} 도달
                    </span>
                    <span className="text-gray-600">현재가 {formatPrice(event.price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

interface WatchRowProps {
  item: WatchItem;
  feed: SymbolFeed | undefined;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSave: (item: WatchItem) => void;
  onCancel: () => void;
  onRemove: () => void;
}

function WatchRow({ item, feed, active, editing, onSelect, onEdit, onSave, onCancel, onRemove }: WatchRowProps) {
  if (editing) {
    return (
      <div className="rounded-lg border border-gray-300 p-2">
        <WatchItemForm initial={item} onSubmit={onSave} onCancel={onCancel} />
      </div>
    );
  }

  const quote = feed?.latest ?? null;
  const change = changeOf(quote);
  const displayName = displayNameOf(item, quote);

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border p-2 text-sm ${active ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium">
          {displayName} {displayName !== item.symbol && <span className="text-xs text-gray-500">{item.symbol}</span>}
        </span>
        <span className={`font-mono ${changeColor(change?.diff)}`}>{formatPrice(quote?.price)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-gray-600">
        <span>
          알람 <span className="text-blue-600">{formatPrice(item.lowTarget)}</span> ~{" "}
          <span className="text-red-600">{formatPrice(item.highTarget)}</span>
        </span>
        <span className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="hover:text-gray-900"
          >
            수정
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="hover:text-red-600"
          >
            삭제
          </button>
        </span>
      </div>
      {feed?.error && <p className="mt-1 text-xs text-red-600">{feed.error}</p>}
    </div>
  );
}

function QuoteSummary({ item, feed }: { item: WatchItem; feed: SymbolFeed | undefined }) {
  const quote = feed?.latest ?? null;
  const change = changeOf(quote);
  const stats: [string, string, string?][] = [
    ["장중 최고가", formatPrice(quote?.dayHigh), "text-red-600"],
    ["장중 최저가", formatPrice(quote?.dayLow), "text-blue-600"],
    ["시가", formatPrice(quote?.open)],
    ["전일 종가", formatPrice(quote?.prevClose)],
    ["거래량", formatPrice(quote?.volume)],
    ["목표 최고가", formatPrice(item.highTarget), "text-amber-700"],
    ["목표 최저가", formatPrice(item.lowTarget), "text-violet-600"],
  ];
  // 체결강도 100 초과 = 매수 체결이 매도 체결보다 많음
  if (quote?.strength !== undefined) {
    stats.splice(2, 0, ["체결강도", quote.strength.toFixed(2), quote.strength >= 100 ? "text-red-600" : "text-blue-600"]);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold">{displayNameOf(item, quote)}</h2>
        <span className="text-sm text-gray-500">{item.symbol}</span>
        <span className={`font-mono text-3xl font-bold ${changeColor(change?.diff)}`}>{formatPrice(quote?.price)}</span>
        {change && (
          <span className={`font-mono text-sm ${changeColor(change.diff)}`}>
            {change.diff > 0 ? "▲" : change.diff < 0 ? "▼" : ""} {formatPrice(Math.abs(change.diff))} ({change.rate.toFixed(2)}%)
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {stats.map(([label, value, color]) => (
          <div key={label} className="rounded-md border border-gray-200 px-3 py-2">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className={`font-mono text-sm ${color ?? ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {feed?.error && <p className="text-sm text-red-600">{feed.error}</p>}
    </section>
  );
}
