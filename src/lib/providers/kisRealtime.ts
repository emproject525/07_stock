import type { OrderBook, OrderBookLevel, Quote, RealtimeListener } from "@/lib/types";

const REAL_WS_URL = "ws://ops.koreainvestment.com:21000";
const PAPER_WS_URL = "ws://ops.koreainvestment.com:31000";
/** 실시간 체결가 */
const TR_TRADE = "H0STCNT0";
/** 실시간 호가 */
const TR_ASKING = "H0STASP0";
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const ORDER_BOOK_DEPTH = 10;
/** 전일 대비 부호: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락 */
const FALLING_SIGNS = new Set(["4", "5"]);

interface KisRealtimeConfig {
  appKey: string;
  appSecret: string;
  paper: boolean;
  restBaseUrl: string;
}

interface KisSystemMessage {
  header: { tr_id: string; tr_key?: string };
  body?: { rt_cd: string; msg1: string };
}

/**
 * KIS 실시간 웹소켓 클라이언트.
 * 앱키당 연결 하나를 공유하고, 종목별 구독자가 생기거나 사라질 때 등록/해제 메시지를 보낸다.
 */
export class KisRealtimeClient {
  private socket: WebSocket | null = null;
  private approvalKey: string | null = null;
  private readonly listeners = new Map<string, Set<RealtimeListener>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private connecting = false;

  constructor(private readonly config: KisRealtimeConfig) {}

  subscribe(symbol: string, listener: RealtimeListener): () => void {
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.sendRegistration(symbol, "1");
    }
    set.add(listener);
    void this.ensureConnected();

    return () => {
      const current = this.listeners.get(symbol);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.listeners.delete(symbol);
      this.sendRegistration(symbol, "2");
      if (this.listeners.size === 0) this.close();
    };
  }

  private async ensureConnected() {
    if (this.socket || this.connecting) return;
    this.connecting = true;
    try {
      this.approvalKey ??= await this.issueApprovalKey();
      // 접속키를 받는 사이 구독이 모두 해제됐으면 연결하지 않는다
      if (this.listeners.size > 0) this.open(this.approvalKey);
    } catch (e) {
      this.broadcastError(e instanceof Error ? e.message : String(e));
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private open(approvalKey: string) {
    const socket = new WebSocket(this.config.paper ? PAPER_WS_URL : REAL_WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      for (const symbol of this.listeners.keys()) this.sendRegistration(symbol, "1", approvalKey);
    };
    socket.onmessage = (event) => this.handleMessage(String(event.data));
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.listeners.size > 0) this.scheduleReconnect();
    };
    socket.onerror = () => this.broadcastError("KIS 실시간 연결 오류");
  }

  private close() {
    clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = setTimeout(() => void this.ensureConnected(), delay);
  }

  /** tr_type "1" 등록, "2" 해제. 연결 전이면 onopen에서 한꺼번에 등록한다 */
  private sendRegistration(symbol: string, trType: "1" | "2", approvalKey = this.approvalKey) {
    if (!approvalKey || this.socket?.readyState !== WebSocket.OPEN) return;
    for (const trId of [TR_TRADE, TR_ASKING]) {
      this.socket.send(
        JSON.stringify({
          header: { approval_key: approvalKey, custtype: "P", tr_type: trType, "content-type": "utf-8" },
          body: { input: { tr_id: trId, tr_key: symbol } },
        }),
      );
    }
  }

  private handleMessage(text: string) {
    // 실시간 데이터: "암호화여부|TR_ID|건수|필드^필드^..."  /  그 외: JSON 시스템 메시지
    if (text[0] === "0" || text[0] === "1") {
      const [, trId, countText, payload] = text.split("|");
      const fields = payload.split("^");
      const count = Number(countText) || 1;
      const size = fields.length / count;
      for (let i = 0; i < count; i++) this.handleRecord(trId, fields.slice(i * size, (i + 1) * size));
      return;
    }

    const message = JSON.parse(text) as KisSystemMessage;
    // 서버가 연결 확인용으로 보내는 PINGPONG은 그대로 돌려보내야 연결이 유지된다
    if (message.header.tr_id === "PINGPONG") {
      this.socket?.send(text);
      return;
    }
    if (message.body && message.body.rt_cd !== "0" && message.header.tr_key) {
      this.notify(message.header.tr_key, (l) => l.onError(message.header.tr_key!, `KIS 실시간: ${message.body!.msg1}`));
    }
  }

  private handleRecord(trId: string, f: string[]) {
    const symbol = f[0];
    if (trId === TR_TRADE) {
      const quote = parseTrade(f);
      this.notify(symbol, (l) => l.onQuote(quote));
    } else if (trId === TR_ASKING) {
      const orderBook = parseOrderBook(f);
      this.notify(symbol, (l) => l.onOrderBook(symbol, orderBook));
    }
  }

  private notify(symbol: string, call: (listener: RealtimeListener) => void) {
    this.listeners.get(symbol)?.forEach(call);
  }

  private broadcastError(message: string) {
    for (const [symbol, set] of this.listeners) set.forEach((l) => l.onError(symbol, message));
  }

  private async issueApprovalKey(): Promise<string> {
    const res = await fetch(`${this.config.restBaseUrl}/oauth2/Approval`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.appKey,
        secretkey: this.config.appSecret,
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { approval_key?: string; error_description?: string } | null;
    if (!res.ok || !body?.approval_key) {
      throw new Error(`KIS 실시간 접속키 발급 실패 (HTTP ${res.status}): ${body?.error_description ?? "응답 없음"}`);
    }
    return body.approval_key;
  }
}

/** H0STCNT0 필드: 0 종목코드, 2 현재가, 3 부호, 4 전일대비, 7 시가, 8 고가, 9 저가, 13 누적거래량, 18 체결강도 */
function parseTrade(f: string[]): Quote {
  const price = Number(f[2]);
  const diff = Math.abs(Number(f[4]));
  return {
    symbol: f[0],
    price,
    dayHigh: Number(f[8]),
    dayLow: Number(f[9]),
    open: Number(f[7]),
    prevClose: FALLING_SIGNS.has(f[3]) ? price + diff : price - diff,
    volume: Number(f[13]),
    strength: Number(f[18]),
    timestamp: Date.now(),
  };
}

/** H0STASP0 필드: 3~12 매도호가1~10, 13~22 매수호가1~10, 23~32 매도잔량1~10, 33~42 매수잔량1~10, 43 총매도잔량, 44 총매수잔량 */
function parseOrderBook(f: string[]): OrderBook {
  const asks: OrderBookLevel[] = [];
  const bids: OrderBookLevel[] = [];
  for (let i = 0; i < ORDER_BOOK_DEPTH; i++) {
    asks.push({ price: Number(f[3 + i]), quantity: Number(f[23 + i]) });
    bids.push({ price: Number(f[13 + i]), quantity: Number(f[33 + i]) });
  }
  return {
    totalAsk: Number(f[43]),
    totalBid: Number(f[44]),
    // 매도호가1이 가장 낮은 가격이므로 높은 가격 → 낮은 가격 순서로 뒤집는다
    asks: asks.filter((l) => l.price > 0).reverse(),
    bids: bids.filter((l) => l.price > 0),
  };
}
