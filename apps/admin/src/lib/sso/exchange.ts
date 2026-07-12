// M-4a M0-S3 SSO server-to-server 兌換 —— admin 後端拿 code+state+共享 secret 向報價單換 {amr, auth_time}。
//
// 契約(報價單 exchange/route.ts 頂部註解逐字):
//   POST quote/api/sso/exchange
//   Header Authorization: Bearer <PCM_SSO_EXCHANGE_SECRET>
//   Body   { code, state }
//   回     200 { ok:true, amr:string[], auth_time:number(unix秒) } | 401 { error }
// 所有失敗一律 401 不洩因;code 於報價單側原子消耗(單一 UPDATE...RETURNING)。
//
// 🔴 不重試(Fable nit-8):code 一次性,重試必 401 且會淹掉真 race 訊號。
// 🔴 amr admin 端自驗(報價單 exchange 直透 DB 值、無白名單):每元素 ∈ enum、過濾後須非空。
// 🔴 auth_time 收 number 或**數字字串**(防 DB bigint 被 PostgREST 序列化成字串)→ parse → 安全整數 且 0<t<=now+30
//    (±30s 只當未來上界 sanity;真正「近期」新鮮度比對屬 step-up slice,見 session.ts auth_time 註解)。
// 注入式 fetch / nowSec:供單測。相對 import 見 session.ts 註解。
import type { AdminSessionAmr } from '../session/session';
import { buildExchangeUrl, type SsoConfig } from './config';

export interface ExchangeResult {
  readonly amr: AdminSessionAmr[];
  readonly auth_time: number;
}

export interface ExchangeDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** 測試注入的「現在(unix秒)」;預設 Date.now()。 */
  readonly nowSec?: number;
}

const VALID_AMR = new Set<AdminSessionAmr>(['pwd', 'totp', 'bootstrap', 'recovery']);

function sanitizeAmr(raw: unknown): AdminSessionAmr[] | null {
  // 🔴 fail-closed(Fable/Codex MF1):任一元素不在 enum → 整包拒(非靜默過濾降級;與 session.ts isPayload 的 every 語意一致)。
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((x) => typeof x === 'string' && VALID_AMR.has(x as AdminSessionAmr))) return null;
  return raw as AdminSessionAmr[];
}

function parseAuthTime(raw: unknown, nowSec: number): number | null {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  else return null;
  if (!Number.isSafeInteger(n) || n <= 0 || n > nowSec + 30) return null;
  return n;
}

/**
 * 兌換 code。成功回 {amr, auth_time};任何異常(401 / 非 JSON / ok≠true / 形狀不對 / timeout / 網路)→ null(當失敗、不洩因)。
 */
export async function exchangeCode(
  code: string,
  state: string,
  config: SsoConfig,
  deps: ExchangeDeps = {},
): Promise<ExchangeResult | null> {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(buildExchangeUrl(config.quoteBase), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.exchangeSecret}`,
      },
      body: JSON.stringify({ code, state }),
      signal: controller.signal,
      cache: 'no-store',
      // 🔴 契約只允許 200/401;禁跟隨 3xx(Fable MF2):否則報價單若回 307/308,同 origin 轉送會把
      //    Authorization: Bearer secret 送去非 exchange 路徑(secret 洩漏)、跨 origin 成 server-side SSRF。任何 3xx → throw → null。
      redirect: 'error',
    });
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    if (typeof data !== 'object' || data === null) return null;
    const rec = data as Record<string, unknown>;
    if (rec.ok !== true) return null;
    const amr = sanitizeAmr(rec.amr);
    if (!amr) return null;
    const authTime = parseAuthTime(rec.auth_time, nowSec);
    if (authTime === null) return null;
    return { amr, auth_time: authTime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
