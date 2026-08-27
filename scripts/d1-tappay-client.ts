/**
 * D1t1:獨立 runbook TapPay Record API client(交易紀錄反查)。
 *
 * 🔴 **為什麼不用 `TapPayChargeAdapter`**:該檔第一行 `import 'server-only'`,在純 node/tsx
 * 載入即 throw(規格 §5.1 row 16、交接檔 §5-2;2026-07-29 親驗)。本檔複用同一份 wire 解析
 * (`wire.ts` 無 server-only、node 可載入),request 組裝逐字對齊 adapter 既有做法
 * (TapPayChargeAdapter.ts:232-248),不自創第二種 wire 形狀。
 *
 * 🔴 **只打正式商戶**:D1 的 read-back 是刪除依據,sandbox 查回來的東西不是證據。
 * `TAPPAY_ENV` 必須是 'production',endpoint 寫死 prod(與 composition.ts 的
 * RECORD_QUERY_URL.production 同字面;測試以 readFileSync 釘兩處一致、防漂移)。
 *
 * 🔴 **merchant id 雙輸入斷言**:正式商戶 id 的字面不在 repo(在 Vercel env)。單一來源
 * 自己比自己 = 沒有斷言 ⇒ 呼叫端必須顯式傳 `expectedMerchantId`(runbook 指示從 TapPay
 * 商家後台抄,與 Vercel env 是兩個獨立系統),本檔斷言兩者相等。
 *
 * read-back 是唯讀 API;任何失敗(逾時 / HTTP 非 2xx / wire 異常)= throw,由 orchestrator
 * ROLLBACK abort,**不自動重試**(§8.4 R23)。
 */
import {
  parseTapPayRecordResponse,
  type TapPayRecordResponseWire,
} from '../packages/adapters/src/tappay/wire';

/** 與 apps/storefront/src/lib/payment/composition.ts 的 RECORD_QUERY_URL.production 同字面。 */
export const PROD_RECORD_QUERY_URL = 'https://prod.tappaysdk.com/tpc/transaction/query';

/** 單筆查詢的 HTTP 逾時上限;整批另有 3 分鐘 deadline(§8.4 步驟 8 總體預算)。 */
const PER_REQUEST_TIMEOUT_MS = 30_000;

export type D1TapPayClientConfig = Readonly<{
  partnerKey: string;
  merchantId: string;
}>;

/**
 * 從 env 建 config。三個斷言各自 fail-closed:缺 env、非 production、雙輸入不符,一律 throw。
 */
export function buildD1TapPayConfig(
  env: Record<string, string | undefined>,
  expectedMerchantId: string,
): D1TapPayClientConfig {
  const tappayEnv = env.TAPPAY_ENV;
  const partnerKey = env.TAPPAY_PARTNER_KEY;
  const merchantId = env.TAPPAY_MERCHANT_ID;

  if (tappayEnv !== 'production') {
    throw new Error(`D1:TAPPAY_ENV 必須是 production(實 '${tappayEnv ?? '未設'}');拒繼續`);
  }
  if (!partnerKey) {
    throw new Error('D1:缺 TAPPAY_PARTNER_KEY;拒繼續');
  }
  if (!merchantId) {
    throw new Error('D1:缺 TAPPAY_MERCHANT_ID;拒繼續');
  }
  // 雙輸入:env(Vercel 抄來)vs 操作者從 TapPay 商家後台抄的值。兩個獨立系統對得上才走。
  if (!expectedMerchantId || merchantId !== expectedMerchantId) {
    throw new Error('D1:merchant id 雙輸入不符(env vs 操作者輸入);拒繼續');
  }

  return { partnerKey, merchantId };
}

/**
 * 嚴格 wire 前置檢查(關卡1 R1-17 + R3-F6):既有 parser 對缺欄寬鬆(缺 `trade_records`
 * 當空陣列、缺 `number_of_transactions` 自補)—— 在金流證據語境裡,那會把「格式漂移」
 * 靜默寫成「正式商戶查無」。本檢查在 parser 之前把形狀釘死:
 * - `trade_records` 必須是 array,且 `number_of_transactions` 必須是 number 並等於其長度;
 * - **唯一合法例外:`trade_records` 缺鍵 ∧ `number_of_transactions === 0`**(TapPay 對
 *   零命中是否省略該鍵未經官方逐字驗證 —— 0052 的合法「查無」路徑不得被自家檢查堵死;
 *   D1b1 首跑須把實回應形狀落 audit)。
 */
export function assertStrictRecordWire(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('D1:TapPay Record 回應非物件;wire 不完整');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.number_of_transactions !== 'number') {
    throw new Error('D1:TapPay Record 回應缺 number_of_transactions;wire 不完整');
  }
  if (!('trade_records' in r)) {
    if (r.number_of_transactions !== 0) {
      throw new Error('D1:TapPay Record 回應缺 trade_records 但計數非 0;wire 不完整');
    }
    return; // 合法空回應。
  }
  if (!Array.isArray(r.trade_records)) {
    throw new Error('D1:TapPay Record trade_records 非陣列;wire 不完整');
  }
  if (r.trade_records.length !== r.number_of_transactions) {
    throw new Error('D1:TapPay Record 計數與 trade_records 長度不符;wire 不完整');
  }
}

/**
 * 原始回應的**形狀**(只有鍵名與計數,零欄位值)—— 本檔 `assertStrictRecordWire` 註解
 * 逐字要求「D1b1 首跑須把實回應形狀落 audit」:0052 的「查無」出口唯一的未知數就是
 * 「TapPay 零命中時到底省不省略 `trade_records` 鍵」,而 parser 窄化後這件事就看不見了。
 * 🔴 只存鍵名:值裡可能有 wire 白名單擋掉的 PII(card_info / cardholder)。
 */
export type D1RawShape = Readonly<{
  topLevelKeys: readonly string[];
  numberOfTransactions: unknown;
  recordKeys: readonly (readonly string[])[];
}>;

export type D1RawShapeSink = (recTradeId: string, shape: D1RawShape) => void;

export function describeRawShape(raw: unknown): D1RawShape {
  if (typeof raw !== 'object' || raw === null) {
    return { topLevelKeys: [], numberOfTransactions: null, recordKeys: [] };
  }
  const r = raw as Record<string, unknown>;
  const records = Array.isArray(r.trade_records) ? r.trade_records : [];
  return {
    topLevelKeys: Object.keys(r).sort(),
    numberOfTransactions: r.number_of_transactions ?? null,
    recordKeys: records.map((rec) =>
      typeof rec === 'object' && rec !== null ? Object.keys(rec as object).sort() : [],
    ),
  };
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * 以 `rec_trade_id` 為唯一查詢鍵反查一筆。
 *
 * 逾時與中止合流(關卡1 R1-19 + R2-4):`AbortSignal.any([外部 abort, per-request timeout,
 * 整批 deadline 剩餘])` —— signal handler 按下的 controller 真的接到每一次 fetch。
 * `deadlineAt` = 整批 3 分鐘 deadline 的絕對時刻(ms epoch);剩餘 ≤ 0 直接 throw。
 */
export async function queryRecordByRecTradeId(
  config: D1TapPayClientConfig,
  recTradeId: string,
  options: Readonly<{
    deadlineAt: number;
    abortSignal: AbortSignal;
    fetchImpl?: FetchLike;
    now?: () => number;
    /** D1b1 取證用:回報原始回應形狀(鍵名與計數,零值)。 */
    onRawShape?: D1RawShapeSink;
  }>,
): Promise<TapPayRecordResponseWire> {
  if (!recTradeId) {
    throw new Error('D1:recordQuery 需 rec_trade_id 查詢鍵;拒繼續');
  }
  const now = options.now ?? Date.now;
  const remainingMs = options.deadlineAt - now();
  if (remainingMs <= 0) {
    throw new Error('D1:read-back 整批 3 分鐘 deadline 已到;abort(不自動重試)');
  }
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const response = await fetchImpl(PROD_RECORD_QUERY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.partnerKey,
    },
    body: JSON.stringify({
      partner_key: config.partnerKey,
      // merchant_id 恆帶(Array;限本商戶、防跨商戶誤命中)—— 照 adapter :232。
      filters: { merchant_id: [config.merchantId], rec_trade_id: recTradeId },
      records_per_page: 50,
      page: 0,
    }),
    signal: AbortSignal.any([
      options.abortSignal,
      AbortSignal.timeout(Math.min(PER_REQUEST_TIMEOUT_MS, remainingMs)),
    ]),
  });

  if (!response.ok) {
    throw new Error(`D1:TapPay Record API HTTP ${response.status};abort`);
  }

  const raw: unknown = await response.json();
  // 形狀先落(在任何檢查之前):檢查沒過時,形狀正是唯一能說明「為什麼沒過」的東西。
  options.onRawShape?.(recTradeId, describeRawShape(raw));
  assertStrictRecordWire(raw);
  const wire = parseTapPayRecordResponse(raw);
  assertRecordsMerchant(wire, config.merchantId);
  return wire;
}

/**
 * 回應每筆 merchant_id 必為指定商戶(照 adapter :266-270)。
 * 🔴 抽成共用是 D1t2 關卡1 R1 的要求:rehearsal 的 readback fixture 也必須過同一道檢查
 * (fixture 檔內自帶 merchantId 宣告為基準 —— 形狀紀律、非身分證明),
 * 假資料不得比正式路徑寬鬆。
 */
export function assertRecordsMerchant(
  wire: TapPayRecordResponseWire,
  merchantId: string,
): void {
  for (const rec of wire.records) {
    if (rec.merchantId !== merchantId) {
      throw new Error('D1:TapPay Record 回應含非本商戶紀錄;abort');
    }
  }
}
