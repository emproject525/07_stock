"use client";

import { useSyncExternalStore } from "react";
import { watchlistStore } from "@/lib/watchlistStore";

export function useWatchlist() {
  const items = useSyncExternalStore(
    watchlistStore.subscribe,
    watchlistStore.getSnapshot,
    watchlistStore.getServerSnapshot,
  );
  return { items, upsert: watchlistStore.upsert, remove: watchlistStore.remove };
}
