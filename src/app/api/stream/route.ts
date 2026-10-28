import { getMarketHub } from "@/lib/marketHub";
import type { StreamEvent } from "@/lib/types";

/** 장 마감 후처럼 푸시가 없을 때도 연결이 끊기지 않도록 보내는 주석 줄 주기 */
const HEARTBEAT_MS = 15_000;
const SYMBOL_PATTERN = /^[0-9A-Z]{6}$/;
const MAX_SYMBOLS = 20;

/**
 * 감시 종목들의 시세를 Server-Sent Events로 흘려보낸다.
 * 접속 직후 서버가 쌓아 둔 데이터(snapshot)를 먼저 보내고, 이후 실시간 데이터를 보낸다.
 * GET /api/stream?symbols=005930,000660
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = [...new Set((searchParams.get("symbols") ?? "").split(","))]
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SYMBOL_PATTERN.test(s))
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) return new Response("symbols 파라미터가 필요합니다.", { status: 400 });

  const hub = getMarketHub();
  const encoder = new TextEncoder();
  let closed = false;
  let stop = () => {};

  const shutdown = () => {
    if (closed) return;
    closed = true;
    stop();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const send = (event: StreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const unwatches = symbols.map((symbol) => hub.watch(symbol, send));
      stop = () => {
        clearInterval(heartbeat);
        unwatches.forEach((unwatch) => unwatch());
      };
    },
    cancel: shutdown,
  });

  request.signal.addEventListener("abort", shutdown);

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
