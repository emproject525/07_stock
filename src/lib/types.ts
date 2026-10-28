/** 한 시점의 종목 시세 */
export interface Quote {
  symbol: string;
  /** 종목명 (공급자가 제공하는 경우) */
  name?: string;
  /** 현재가 */
  price: number;
  /** 당일 장중 최고가 */
  dayHigh: number;
  /** 당일 장중 최저가 */
  dayLow: number;
  /** 시가 */
  open: number;
  /** 전일 종가 */
  prevClose: number;
  /** 누적 거래량 */
  volume: number;
  /** 체결강도 (매수 체결량 / 매도 체결량 × 100, 실시간 체결 공급자만 제공) */
  strength?: number;
  /** 수신 시각 (epoch ms) */
  timestamp: number;
}

/** 실시간 공급자가 보내주는 이벤트를 받는 쪽 */
export interface RealtimeListener {
  onQuote(quote: Quote): void;
  onOrderBook(symbol: string, orderBook: OrderBook): void;
  onError(symbol: string, message: string): void;
}

/** 시세 공급자 (증권사 API, Mock 등) */
export interface QuoteProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<Quote>;
  /** 실시간 푸시를 지원하는 공급자만 구현한다. 반환값은 구독 해제 함수 */
  subscribe?(symbol: string, listener: RealtimeListener): () => void;
}

/** 사용자가 등록한 감시 종목 */
export interface WatchItem {
  symbol: string;
  /** 사용자가 붙인 표시 이름 (선택) */
  name: string;
  /** 이 가격 이하로 내려가면 알람 */
  lowTarget: number | null;
  /** 이 가격 이상으로 올라가면 알람 */
  highTarget: number | null;
}

export interface OrderBookLevel {
  price: number;
  /** 잔량 (주) */
  quantity: number;
}

/** 호가 잔량 */
export interface OrderBook {
  /** 총 매도 잔량 */
  totalAsk: number;
  /** 총 매수 잔량 */
  totalBid: number;
  /** 매도 호가 (높은 가격 → 낮은 가격) */
  asks: OrderBookLevel[];
  /** 매수 호가 (높은 가격 → 낮은 가격) */
  bids: OrderBookLevel[];
}

/** 하루치 투자자별 순매수 수량 (주, 음수면 순매도) */
export interface InvestorTrend {
  /** YYYY-MM-DD */
  date: string;
  foreign: number;
  institution: number;
  individual: number;
  /** 외국인 보유 비율 (예: "48.61%") */
  foreignHoldRatio: string;
}

export type StreamEvent =
  /** 접속 직후 서버가 쌓아 둔 데이터 */
  | { type: "snapshot"; symbol: string; history: Quote[]; orderBook: OrderBook | null }
  | { type: "quote"; quote: Quote }
  | { type: "orderbook"; symbol: string; orderBook: OrderBook }
  | { type: "error"; symbol: string; message: string };
