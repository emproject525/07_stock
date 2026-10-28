import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Quote, QuoteProvider } from "@/lib/types";

const REAL_BASE_URL = "https://openapi.koreainvestment.com:9443";
const PAPER_BASE_URL = "https://openapivts.koreainvestment.com:29443";
/** 토큰 만료 직전 재발급을 위한 여유 시간 */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
/** 토큰 발급은 1분당 1회로 제한되므로, 실패하면 이만큼 기다린 뒤 다시 시도한다 */
const TOKEN_RETRY_DELAY_MS = 60 * 1000;
/** 서버를 재시작해도 24시간짜리 토큰을 재사용하기 위한 캐시 파일 (gitignore 대상) */
const TOKEN_CACHE_FILE = path.join(process.cwd(), ".kis-token.json");

interface KisConfig {
  appKey: string;
  appSecret: string;
  paper: boolean;
}

interface KisToken {
  value: string;
  expiresAt: number;
}

interface CachedKisToken extends KisToken {
  appKey: string;
  paper: boolean;
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
  private cacheChecked = false;
  /** 이 시각 전에는 토큰 발급을 다시 시도하지 않는다 */
  private tokenRetryAt = 0;

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
    // KIS는 호출 한도 초과 등도 HTTP 500 + JSON 본문(msg1)으로 알려주므로 본문을 먼저 읽는다
    const body = (await res.json().catch(() => null)) as KisPriceResponse | null;
    if (!res.ok || !body || body.rt_cd !== "0" || !body.output) {
      throw new Error(`KIS 시세 조회 실패 (HTTP ${res.status}): ${body?.msg1 ?? "응답 없음"}`);
    }

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

  /** 접근 토큰은 발급 횟수 제한(1분당 1회)이 있으므로 메모리·파일에 캐시하고 동시 요청을 하나로 합친다 */
  private async getToken(): Promise<string> {
    if (isUsable(this.token)) return this.token.value;
    this.tokenRequest ??= this.loadOrIssueToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async loadOrIssueToken(): Promise<string> {
    if (!this.cacheChecked) {
      this.cacheChecked = true;
      const cached = await this.readCachedToken();
      if (isUsable(cached)) {
        this.token = cached;
        return cached.value;
      }
    }

    const waitMs = this.tokenRetryAt - Date.now();
    if (waitMs > 0) throw new Error(`KIS 토큰 발급 대기 중 (${Math.ceil(waitMs / 1000)}초 후 재시도)`);

    try {
      return await this.issueToken();
    } catch (e) {
      this.tokenRetryAt = Date.now() + TOKEN_RETRY_DELAY_MS;
      throw e;
    }
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
    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string }
      | null;
    if (!res.ok || !body?.access_token || !body.expires_in) {
      throw new Error(`KIS 토큰 발급 실패 (HTTP ${res.status}): ${body?.error_description ?? "응답 없음"}`);
    }

    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    await this.writeCachedToken(this.token);
    return this.token.value;
  }

  private async readCachedToken(): Promise<KisToken | null> {
    try {
      const cached = JSON.parse(await readFile(TOKEN_CACHE_FILE, "utf8")) as CachedKisToken;
      // 다른 키(또는 실전/모의 전환)로 발급된 토큰은 쓰지 않는다
      if (cached.appKey !== this.config.appKey || cached.paper !== this.config.paper) return null;
      return { value: cached.value, expiresAt: cached.expiresAt };
    } catch {
      return null;
    }
  }

  private async writeCachedToken(token: KisToken) {
    const cached: CachedKisToken = { ...token, appKey: this.config.appKey, paper: this.config.paper };
    try {
      await writeFile(TOKEN_CACHE_FILE, JSON.stringify(cached), { mode: 0o600 });
    } catch {
      // 캐시 저장에 실패해도 메모리 토큰으로 계속 동작한다
    }
  }
}

function isUsable(token: KisToken | null): token is KisToken {
  return token !== null && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();
}
