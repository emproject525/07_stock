"use client";

import { useState, type FormEvent } from "react";
import type { WatchItem } from "@/lib/types";

interface Props {
  initial?: WatchItem;
  onSubmit: (item: WatchItem) => void;
  onCancel?: () => void;
}

function parsePrice(value: string): number | null {
  const n = Number(value.replaceAll(",", ""));
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export default function WatchItemForm({ initial, onSubmit, onCancel }: Props) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [low, setLow] = useState(initial?.lowTarget?.toString() ?? "");
  const [high, setHigh] = useState(initial?.highTarget?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = symbol.trim().toUpperCase();
    const lowTarget = parsePrice(low);
    const highTarget = parsePrice(high);

    if (!/^[0-9A-Z]{6}$/.test(code)) return setError("종목코드는 6자리입니다. (예: 005930)");
    if (lowTarget === null && highTarget === null) return setError("최저가 또는 최고가 중 하나는 입력하세요.");
    if (lowTarget !== null && highTarget !== null && lowTarget >= highTarget) {
      return setError("최저가는 최고가보다 작아야 합니다.");
    }

    setError(null);
    onSubmit({ symbol: code, name: name.trim(), lowTarget, highTarget });
    if (!initial) {
      setSymbol("");
      setName("");
      setLow("");
      setHigh("");
    }
  };

  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inputClass}
          placeholder="종목코드"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          disabled={!!initial}
          inputMode="numeric"
        />
        <input className={inputClass} placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className={inputClass}
          placeholder="최저가 알람"
          value={low}
          onChange={(e) => setLow(e.target.value)}
          inputMode="numeric"
        />
        <input
          className={inputClass}
          placeholder="최고가 알람"
          value={high}
          onChange={(e) => setHigh(e.target.value)}
          inputMode="numeric"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-md bg-gray-900 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
          {initial ? "저장" : "추가"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
            취소
          </button>
        )}
      </div>
    </form>
  );
}
