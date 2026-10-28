import type { Quote, QuoteProvider } from "@/lib/types";

const REAL_BASE_URL = "https://openapi.koreainvestment.com:9443";
const PAPER_BASE_URL = "https://openapivts.koreainvestment.com:29443";
/** 토큰 만료 직전 재발급을 위한 여유 시간 */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

interface KisConfig {
  appKey: string;
  appSecret: string;
  paper: boolean;
}

interface KisToken {
  value: string;
  expiresAt: number;
}

interface KisPriceOutput {
  stck_prpr: string;
  stck_hgpr: string;
  stck_lwpr: string;
  stck_oprc: string;
  stck_sdpr: string;
  acml_vol: string;
}

interface KisPriceResponse {
  rt_cd: string;
  msg1: string;
  output?: KisPriceOutput;
}

/**
 * 한국투자증권 KIS Developers REST API 기반 공급자.
 * 주식현재가 시세(FHKST01010100)를 폴링한다.
 */
export class KisQuoteProvider implements QuoteProvider {
  readonly name = "kis";
  private readonly baseUrl: string;
  private token: KisToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly config: KisConfig) {
    this.baseUrl = config.paper ? PAPER_BASE_URL : REAL_BASE_URL;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const token = await this.getToken();
    const params = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol });
    const res = await fetch(`${this.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST01010100",
        custtype: "P",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KIS 시세 조회 실패 (HTTP ${res.status})`);

    const body = (await res.json()) as KisPriceResponse;
    if (body.rt_cd !== "0" || !body.output) throw new Error(`KIS 시세 조회 실패: ${body.msg1}`);

    const out = body.output;
    return {
      symbol,
      price: Number(out.stck_prpr),
      dayHigh: Number(out.stck_hgpr),
      dayLow: Number(out.stck_lwpr),
      open: Number(out.stck_oprc),
      prevClose: Number(out.stck_sdpr),
      volume: Number(out.acml_vol),
      timestamp: Date.now(),
    };
  }

  /** 접근 토큰은 발급 횟수 제한(1분당 1회)이 있으므로 메모리에 캐시하고 동시 요청을 하나로 합친다 */
  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return this.token.value;
    this.tokenRequest ??= this.issueToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async issueToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/oauth2/tokenP`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KIS 토큰 발급 실패 (HTTP ${res.status})`);

    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
