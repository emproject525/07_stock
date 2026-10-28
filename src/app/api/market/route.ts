import { fetchInvestorTrends, fetchOrderBook } from "@/lib/naverMarket";

const SYMBOL_PATTERN = /^[0-9A-Z]{6}$/;

/**
 * 호가 잔량 또는 투자자별 매매동향을 조회한다.
 * GET /api/market?symbol=000660&type=orderbook|investors
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase();
  const type = searchParams.get("type");

  if (!SYMBOL_PATTERN.test(symbol)) return Response.json({ error: "symbol이 올바르지 않습니다." }, { status: 400 });

  try {
    if (type === "orderbook") return Response.json(await fetchOrderBook(symbol));
    if (type === "investors") return Response.json(await fetchInvestorTrends(symbol));
    return Response.json({ error: "type은 orderbook 또는 investors입니다." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
