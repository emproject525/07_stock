import type { Quote, WatchItem } from "@/lib/types";

export type AlarmSide = "low" | "high";

export interface AlarmEvent {
  id: string;
  symbol: string;
  name: string;
  side: AlarmSide;
  target: number;
  price: number;
  timestamp: number;
}

/**
 * 목표가 도달을 판정한다.
 * 한 번 울린 알람은 가격이 다시 목표 범위 안으로 돌아올 때까지 재발송하지 않는다.
 */
export class AlarmTracker {
  /** 이미 울린 상태인 `${symbol}:${side}:${target}` 키 */
  private readonly fired = new Set<string>();

  check(item: WatchItem, quote: Quote): AlarmEvent[] {
    const events: AlarmEvent[] = [];
    const sides: [AlarmSide, number | null, boolean][] = [
      ["low", item.lowTarget, item.lowTarget !== null && quote.price <= item.lowTarget],
      ["high", item.highTarget, item.highTarget !== null && quote.price >= item.highTarget],
    ];

    for (const [side, target, reached] of sides) {
      if (target === null) continue;
      const key = `${item.symbol}:${side}:${target}`;
      if (!reached) {
        this.fired.delete(key);
        continue;
      }
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      events.push({
        id: `${key}:${quote.timestamp}`,
        symbol: item.symbol,
        name: item.name || quote.name || item.symbol,
        side,
        target,
        price: quote.price,
        timestamp: quote.timestamp,
      });
    }
    return events;
  }
}

let audioContext: AudioContext | null = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

/**
 * 소리를 켠다. 브라우저 자동재생 정책 때문에 사용자 클릭/키 입력 전에는
 * suspended 상태로 남을 수 있으며, 그 경우 클릭 시점에 다시 호출하면 켜진다.
 */
export function unlockAudio() {
  void getAudioContext().resume();
}

/** useSyncExternalStore용: 소리를 낼 수 있는 상태인지 구독 */
export const audioStore = {
  subscribe(listener: () => void) {
    const ctx = getAudioContext();
    ctx.addEventListener("statechange", listener);
    return () => ctx.removeEventListener("statechange", listener);
  },
  getSnapshot: () => getAudioContext().state === "running",
  getServerSnapshot: () => false,
};

export function playBeep(side: AlarmSide) {
  if (audioContext?.state !== "running") return;
  const now = audioContext.currentTime;
  const frequencies = side === "high" ? [880, 1175, 880] : [523, 392, 523];
  frequencies.forEach((frequency, i) => {
    const osc = audioContext!.createOscillator();
    const gain = audioContext!.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.2, now + i * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.18);
    osc.connect(gain).connect(audioContext!.destination);
    osc.start(now + i * 0.2);
    osc.stop(now + i * 0.2 + 0.2);
  });
}

export function showBrowserNotification(event: AlarmEvent) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const label = event.side === "high" ? "최고가" : "최저가";
  new Notification(`${event.name} ${label} 도달`, {
    body: `현재가 ${event.price.toLocaleString()}원 (목표 ${event.target.toLocaleString()}원)`,
    tag: `${event.symbol}:${event.side}`,
    requireInteraction: true,
  });
}
