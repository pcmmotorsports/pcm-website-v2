// M-4a M0-S3 SSO server-to-server 兌換 —— admin 後端拿 code+state+共享 secret 向報價單換 {amr, auth_time, sub?}。
//
// 契約(報價單 exchange/route.ts 頂部註解逐字):
//   POST quote/api/sso/exchange
//   Header Authorization: Bearer <PCM_SSO_EXCHANGE_SECRET>
//   Body   { code, state }
//   回     200 { ok:true, amr:string[], auth_time:number(unix秒), sub?:{...} } | 401 { error }
//          🔴 sub 是【選填】(M-4b E8-B):報價單 B3/B4 上線前不帶它。形狀與三態見 sanitizeSub。
// 所有失敗一律 401 不洩因;code 於報價單側原子消耗(單一 UPDATE...RETURNING)。
//
// 🔴 不重試(Fable nit-8):code 一次性,重試必 401 且會淹掉真 race 訊號。
// 🔴 amr admin 端自驗(報價單 exchange 直透 DB 值、無白名單):每元素 ∈ enum、過濾後須非空。
// 🔴 auth_time 收 number 或**數字字串**(防 DB bigint 被 PostgREST 序列化成字串)→ parse → 安全整數 且 0<t<=now+30
//    (±30s 只當未來上界 sanity;真正「近期」新鮮度比對屬 step-up slice,見 session.ts auth_time 註解)。
// 注入式 fetch / nowSec:供單測。相對 import 見 session.ts 註解。
import type { AdminSessionAmr, AdminSessionSub } from '../session/session';
import { buildExchangeUrl, type SsoConfig } from './config';

export interface ExchangeResult {
  readonly amr: AdminSessionAmr[];
  readonly auth_time: number;
  /**
   * 報價單傳來的身分(M-4b E8-B)。**選填**:B3/B4 上線前報價單不會帶它 ⇒ 此欄恆 undefined。
   *
   * ⚠️ **「零行為改變」的射程(codex 關卡2 抓,我原本講太寬)**:
   *   它只對【不帶 `sub` 的回應】成立 —— 而那正是報價單今天送的每一顆(B3/B4 零行 code)。
   *   🔴 對【帶了壞 `sub`】的回應,行為【變了】:改動前那個欄根本沒人讀 ⇒ 被忽略、照舊登入;
   *      改動後 ⇒ 整包拒。**那是刻意的(fail-closed)**,而它不是「零行為改變」。
   *   ⇒ 講清楚的版本:**對今天實際會收到的輸入零行為改變;對壞輸入從【靜默忽略】改成【拒絕】。**
   * 🔴 「沒有」用【欄位不存在】表示,不是 `null` —— 報價單側同樣規定(B4 spec §5)。
   *   兩者要分得開:缺席=舊版報價單(正常);`null` 或壞形狀=整包拒(見 sanitizeSub)。
   */
  readonly sub?: AdminSessionSub;
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

/**
 * 驗身分欄。回:`undefined`=沒有這個欄(舊版報價單,正常) / `AdminSessionSub`=合法 / `null`=壞形狀。
 *
 * 🔴 三態不可壓成兩態(這是本函式唯一的複雜度來源,而它是承重的):
 *   缺席 ⇒ 照舊登入(B3/B4 未上線時的常態)
 *   壞形狀 ⇒ 🔴 【整包拒】,與 sanitizeAmr 同語意 —— 不得靜默降級成「沒有」,
 *            那會讓一顆被竄改的回應長得跟舊版報價單一模一樣(B5 spec §B5-4 (2) 逐字)
 *
 * 🔴 exact shape:多一個鍵就拒。理由不是潔癖 ——
 *   `{kind:'fallback', staff_id:'sean'}` 這種形狀若被接受,下游可能把備援【升格】成具名身分
 *   (B3 spec §6 格 4b/4d 的鏡像;報價單那端也擋,而【兩端都要擋,不要指望對方擋】)。
 */
function sanitizeSub(raw: unknown): AdminSessionSub | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  switch (o.kind) {
    case 'user':
      // 具名身分:恰兩個鍵,且 staff_id 是非空白字串(btrim 後仍非空 —— 與報價單 CHECK 同判準)
      if (keys.length !== 2) return null;
      if (typeof o.staff_id !== 'string' || o.staff_id.trim() === '') return null;
      return { kind: 'user', staff_id: o.staff_id };
    case 'fallback':
    case 'bootstrap':
      // 這兩支【沒有 staff_id】⇒ 恰一個鍵
      if (keys.length !== 1) return null;
      return { kind: o.kind };
    default:
      // 🔴 未知 kind ⇒ 拒,不放行。新增變體要【先改本函式】才收得下
      //   (B3 §3.9「加變體的紀律」:加 union 變體不會自動讓消費端被迫決定)
      return null;
  }
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
 * 兌換 code。成功回 {amr, auth_time, sub?};任何異常(401 / 非 JSON / ok≠true / 形狀不對 / timeout / 網路)→ null(當失敗、不洩因)。
 * 🔴 `sub` 是選填(M-4b E8-B):報價單 B3/B4 上線前不帶它 ⇒ 結果不含該欄。壞形狀 ⇒ 整包拒(見 sanitizeSub)。
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
    const sub = sanitizeSub(rec.sub);
    // 🔴 只有【壞形狀】(null) 才整包拒;undefined = 舊版報價單沒帶這個欄 ⇒ 照舊放行
    if (sub === null) return null;
    return sub === undefined ? { amr, auth_time: authTime } : { amr, auth_time: authTime, sub };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
