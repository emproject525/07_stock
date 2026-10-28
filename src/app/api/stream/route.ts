import { getQuoteProvider } from "@/lib/providers";
import type { StreamEvent } from "@/lib/types";

const DEFAULT_INTERVAL_MS = 2_000;
const MIN_INTERVAL_MS = 500;
const SYMBOL_PATTERN = /^[0-9A-Z]{6}$/;
const MAX_SYMBOLS = 20;

/**
 * 감시 종목들의 시세를 주기적으로 조회해 Server-Sent Events로 흘려보낸다.
 * GET /api/stream?symbols=005930,000660
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = [...new Set((searchParams.get("symbols") ?? "").split(","))]
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SYMBOL_PATTERN.test(s))
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) return new Response("symbols 파라미터가 필요합니다.", { status: 400 });

  const intervalMs = Math.max(MIN_INTERVAL_MS, Number(process.env.QUOTE_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const provider = getQuoteProvider();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const tick = async () => {
        // 증권사 API 초당 호출 제한을 피하기 위해 종목별로 순차 조회한다
        for (const symbol of symbols) {
          if (closed) return;
          try {
            send({ type: "quote", quote: await provider.getQuote(symbol) });
          } catch (e) {
            send({ type: "error", symbol, message: e instanceof Error ? e.message : String(e) });
          }
        }
        if (!closed) timer = setTimeout(tick, intervalMs);
      };

      void tick();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });

  request.signal.addEventListener("abort", () => {
    closed = true;
    clearTimeout(timer);
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
