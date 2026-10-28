import type { WatchItem } from "@/lib/types";

const STORAGE_KEY = "stock-alarm.watchlist";
const EMPTY: WatchItem[] = [];

let items: WatchItem[] | null = null;
const listeners = new Set<() => void>();

function load(): WatchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WatchItem[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(next: WatchItem[]) {
  items = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패(사생활 보호 모드 등)해도 현재 세션에서는 계속 동작한다
  }
  listeners.forEach((listener) => listener());
}

/** localStorage에 저장되는 감시 종목 목록 (useSyncExternalStore용) */
export const watchlistStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): WatchItem[] {
    items ??= load();
    return items;
  },
  getServerSnapshot(): WatchItem[] {
    return EMPTY;
  },
  upsert(item: WatchItem) {
    const current = watchlistStore.getSnapshot();
    const exists = current.some((i) => i.symbol === item.symbol);
    save(exists ? current.map((i) => (i.symbol === item.symbol ? item : i)) : [...current, item]);
  },
  remove(symbol: string) {
    save(watchlistStore.getSnapshot().filter((i) => i.symbol !== symbol));
  },
};
