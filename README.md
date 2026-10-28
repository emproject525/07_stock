# 주가 알람

주식 종목별로 최저가/최고가 알람을 등록하면, 실시간 시세를 받아 차트로 그리고 목표가에 도달하면 웹 알람(브라우저 알림 + 소리 + 화면 배너)을 띄워주는 사이트.

## 실행

```bash
pnpm install
cp .env.example .env.local   # 필요 시 값 수정
pnpm dev
```

http://localhost:3700 접속 → 상단 **🔔 알림·소리 켜기** 클릭(브라우저 정책상 한 번 클릭해야 소리/알림 가능) → 종목코드(예: `005930`)와 최저가/최고가 입력.

## 시세 공급자

| `QUOTE_PROVIDER` | 설명 |
| --- | --- |
| `naver` (기본) | 네이버 금융 실시간 시세 폴링. 키 없이 무료, 지연 없음. **비공식 API**라 예고 없이 바뀌거나 막힐 수 있음 |
| `kis` | 한국투자증권 KIS Developers REST API (주식현재가 시세 폴링) |
| `mock` | 랜덤 워크로 만든 가짜 시세. 장 마감 후 화면/알람 테스트용 |

`kis` 사용 시 [KIS Developers](https://apiportal.koreainvestment.com)에서 App Key/Secret을 발급받아 `.env.local`에 넣는다.
다른 증권사를 붙이려면 `src/lib/providers/`에 `QuoteProvider` 구현을 추가하고 `index.ts`에 등록하면 된다.

## 구조

- `src/app/api/stream/route.ts` — 서버에서 공급자를 주기적으로 조회해 SSE로 전송 (API 키는 서버에만 존재)
- `src/hooks/useQuoteStream.ts` — 브라우저에서 SSE 구독, 종목별 시세 이력 관리
- `src/lib/alarm.ts` — 목표가 도달 판정(범위로 돌아오면 재무장), 소리, 브라우저 알림
- `src/components/StockChart.tsx` — lightweight-charts 실시간 라인 차트 + 장중 고/저가·목표가 수평선
- 감시 목록은 브라우저 `localStorage`에 저장

## 주의

- 알람은 **탭이 열려 있을 때만** 동작한다 (탭을 닫으면 시세 수신도 멈춤).
