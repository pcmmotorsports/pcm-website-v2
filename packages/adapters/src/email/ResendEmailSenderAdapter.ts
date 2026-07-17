/**
 * @module @pcm/adapters/email/ResendEmailSenderAdapter — 交易信寄送(M-4a Email 通知片 E1b/E1c)
 *
 * **🔴 server-only**:持 Resend API key(敏感、絕不進 client bundle)。鏡像 `EmailAlertNotifierAdapter`
 * (原生 fetch、零新依賴、config 注入不直讀 env),差異三點:
 * 1. 收件者逐封不同(客戶交易信、非固定告警收件者)→ `to` 在 send 入參、不在 config。
 * 2. 🔴 帶 `Idempotency-Key: <event_type>/<outbox_id>`(plan §3.5-2;官方保留 24h、只是第一道網,
 *    DB 唯一鍵 + sent 狀態不可省)。既有告警 adapter 無此 header(告警可重複、交易信不可)。
 * 3. 可預期失敗回結構化 `EmailSendErrorCode` 不 throw(outbox 需錯誤碼落表退避;throw 會把
 *    可重試失敗與程式錯誤混流)。
 *
 * 🔴 REQUIRED-E1b(**原則**):錯誤碼**原則上只**由 HTTP 狀態碼經固定映射表產生(非 allowlist 狀態
 * → `provider_error`、transport 失敗 → `network_error`)。錯誤路徑零 PII:不 log 收件者、不把回應
 * 內容帶進任何結果。🔴 **`message` 永不參與轉碼、永不外傳 —— 此條無例外。**
 *
 * ## § 窄幅破例(E1c;Sean 2026-07-17 Q6=A 授權;關卡1 codex+Fable 雙審)
 *
 * 🔴 **定性 = 授權下的破例,不是「原則從未被違反」。** codex 關卡1 must-fix 擊破後者:`res.json()`
 * **讀取 + 緩衝 + 解析整份 body** → `message` 已在記憶體物件裡;**「不讀」≠「不使用」**。
 * 前版(E1c plan v1)宣稱「PII 風險 = 0」**是不實宣稱、已作廢**。
 *
 * **允許範圍(逾此即違規)**:
 * 1. 僅 `status === 429` 時讀 body(非 429 **完全不碰**、`json` 零呼叫)。
 * 2. 🔴 **精確字面(codex 關卡2 nit;前版「僅讀頂層 name 單一欄」不精確、與下方殘餘風險段自相拉扯)**:
 *    `json()` **會解析整份 body**;解析後**僅存取頂層 `name`**,且**只有 `name` 可影響分類結果**;
 *    其他欄位(尤其 `message`)**不得存取、不得進入任何 sink**。`name` 以 `unknown` 處理
 *    (wire 不可信:官方 TS union 是編譯期保證、**非 runtime 封閉輸入**)。
 * 3. 僅接受 `QUOTA_ERROR_CODE_BY_NAME` 的**三個本地固定字面**,其餘一律 `http_429`
 *    (🔴 該表必須是 `Map` —— 物件字面量的原型鏈會破此條,見該表註解)。
 * 4. 原文**不跨出區域變數**:不落表、不 log、不進任何回傳結果。
 *
 * **殘餘風險(誠實、非 0)**:`json()` 必然緩衝整份 body → **短暫記憶體暴露**。可接受理由 = 生命週期
 * 限於單次 `send` 呼叫、無 sink、且無同等可靠的替代方案能保住 Q5=A 的額度訊號(codex 關卡1 背書:
 * 「若完全禁止 body,目前沒有同等可靠又能保留 Q5 額度訊號的替代方案」)。
 *
 * **為什麼非做不可**:E1c 前 429 恆映射 `http_429` → 撞日額度時,可重試的信會被當一般失敗、
 * 在幾分鐘內(sweeper 每 5 分鐘一輪)燒完 5 次 attempts → **永久死信,即使隔天額度重置也不補寄**。
 * ⚠️ **精確算式(關卡2 兩審皆抓前版「33 單/日即撞」無成立假設;R2 再抓口徑混用)**:
 * Resend Free = 100 封/日 → **累計第 101 封起命中**。換算訂單數**取決於每單封數** = 1(付款信)
 * + N(出貨批數;E4 的 S2=B「每批一封」),**兩個口徑分開講**:
 * · 單批出貨 = 2 封/單 → **完整涵蓋 50 單**;首個受影響訂單 = 第 **51** 單(其第 1 封 = 第 101 封)。
 * · 雙批出貨 = 3 封/單 → **完整涵蓋 33 單**;首個受影響訂單 = 第 **34** 單(其第 2 封 = 第 101 封)。
 * **告警信與其他 Resend 用途吃同一額度**,實際門檻更低。
 */
import 'server-only';

import type { IEmailSender, SendEmailInput, SendEmailResult, EmailSendErrorCode } from '@pcm/ports';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * 最小 fetch 抽象(本地定義、**刻意不共用** `payment/LineAlertNotifierAdapter` 的 `FetchLike`)。
 * 🔴 理由(codex 關卡1 must-fix):共用版回應型別只有 `{ ok, status }`、**無 `json()`** → 本 adapter
 * 若沿用,實作者只能危險 cast、或去擴張那個共用型別 → **意外波及 LINE 告警 adapter**(它也在用)。
 * 故本地窄化:`json` 為 **optional**(wire 不保證存在)、回 `unknown`(body 不可信、見檔頭 §窄幅破例-2)。
 */
export type ResendFetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

/** HTTP 狀態 → 有限錯誤碼映射表(封閉;值受 EmailSendErrorCode union 型別檢查)。 */
const ERROR_CODE_BY_STATUS: Readonly<Record<number, EmailSendErrorCode>> = {
  400: 'http_400',
  401: 'http_401',
  403: 'http_403',
  404: 'http_404',
  408: 'http_408',
  409: 'http_409',
  422: 'http_422',
  // ⚠️ 死碼(關卡2 code-reviewer nit):429 在 `send` 內於查表**前**即被 §窄幅破例攔截 → 永不落此項。
  //    保留僅為映射表完整性 + 防「未來移除攔截」時無聲落 provider_error。改此項無效果、勿誤以為有。
  429: 'http_429',
  500: 'http_500',
  502: 'http_502',
  503: 'http_503',
  504: 'http_504',
};

/**
 * 🔴 429 body `name` → 內部錯誤碼(**窄幅破例的全部允許集**;三字面寫死、其餘一律 `http_429`)。
 *
 * 🔴 **必須是 `Map` 不可用物件字面量**(關卡2 code-reviewer Critical + codex must-fix **獨立雙命中**):
 * 物件字面量帶 `Object.prototype` → 429 + body `{"name":"toString"}`(或 `constructor`/`valueOf`/
 * `hasOwnProperty`/`__proto__`)會**查到繼承來的函式/物件而非 undefined** → `?? 'http_429'` 不觸發
 * → `errorCode` 在執行期**違反 union**(TS 的 `Record<string,…>` 索引簽章不會紅)→ 下游 allowlist
 * 把它改寫成 **`provider_error`(非 `http_429`)** → 走非保守退避 → 幾分鐘燒完 attempts → 死信
 * = **重開本片要關的洞**。`Map.get()` 不查原型鏈。⚠️ 勿「順手」改回物件字面量。
 *
 * 左側 = Resend **官方 enum 字面**(2026-07-17 查證):
 * · 官方 errors 頁列 21 碼、**掛 429 的恰好只有這三個**。
 * · resend-node `src/interfaces.ts`:`ErrorResponse = { message; statusCode; name: RESEND_ERROR_CODE_KEY }`,
 *   且 `src/resend.ts` `fetchRequest` 對非 2xx **把 body 解析後直接當 `ErrorResponse` 回傳**(零重組)
 *   → **強烈支持「429 body 含 `name`」此一預期**。
 *   ⚠️ **但這是 SDK 的型別宣告與預期,不是 wire 實證**(codex 關卡2 R2 nit;前版「即含 `name`…最強證據」
 *   為過度宣稱、已改)。
 * ⚠️ **殘餘不確定(誠實揭示;codex 關卡2 R1 抓出前版「三來源直證」失真)**:**兩官方 SDK 對 429 不一致**
 * —— resend-go `resend.go` 的 `case http.StatusTooManyRequests` 解成 `DefaultError{ Message string }`、
 * **不含 `Name`**(`name` 只在 400/422 的 `InvalidRequestError`)。前版註解稱「go json tag 直證 wire
 * format」**是失真引用、已刪**(Claude 親查兩 SDK 原始碼確認 codex 為對)。
 * → 🔴 **影響評估(codex 關卡2 R2 must-fix 更正前版)**:若 429 body 實際無 `name` → `classify429`
 *   恆回 `http_429` → 依 union 合約走 **≥24h 長退避** → **所有 429 的信都白等約 24h**。
 *   故**不得**宣稱「最壞情況本片無效果 / 不會壞 / 零回歸」(前版此字面**已作廢**)。
 *   此代價 = **Sean 2026-07-17 拍 Q11=A 明示接受**(理由與第三選項見 `EmailSendErrorCode.http_429`
 *   JSDoc + backlog **#285**)。
 *
 * 右側 = provider 中立內部碼(退避政策見 `EmailSendErrorCode` 逐碼 JSDoc)。
 * ⚠️ 新增 provider 或官方新增 429 碼 → 改本表 + union;**未知一律落 `http_429`**(=保守長退避)。
 */
const QUOTA_ERROR_CODE_BY_NAME: ReadonlyMap<string, EmailSendErrorCode> = new Map<
  string,
  EmailSendErrorCode
>([
  ['rate_limit_exceeded', 'rate_limited'],
  ['daily_quota_exceeded', 'quota_daily_exceeded'],
  ['monthly_quota_exceeded', 'quota_monthly_exceeded'],
]);

export type ResendEmailSenderConfig = {
  /** Resend API key(server-only 密鑰)。 */
  apiKey: string;
  /** 寄件者(需 Resend 已驗證網域;E1 定案 orders@pcmmotorsports.com、由 composition 從 env 注入)。 */
  from: string;
};

export class ResendEmailSenderAdapter implements IEmailSender {
  constructor(
    private readonly cfg: ResendEmailSenderConfig,
    private readonly fetchImpl: ResendFetchLike = globalThis.fetch as unknown as ResendFetchLike,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // 🔴 冪等鍵由本 adapter 組字面(codex 關卡2 R1:port 收結構化座標、不收自由字串,
    // 呼叫端無法誤餵 orderId/dedupKey/亂數)。
    const idempotencyKey = `${input.idempotency.eventType}/${input.idempotency.outboxId}`;
    try {
      const res = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
        }),
      });
      // 回應形狀驗證留在 try 內(畸形回應/getter 拋錯 → fail closed,不外洩為程式錯誤)。
      if (res?.ok === true) {
        return { kind: 'sent' };
      }
      const status = typeof res?.status === 'number' ? res.status : null;
      // 🔴 §窄幅破例的唯一入口:只有 429 才碰 body(其餘路徑 `json` 零呼叫)。
      if (status === 429) {
        return { kind: 'failed', errorCode: await classify429(res) };
      }
      // 非 429:只看數字狀態碼、不讀回應 body;非映射表內(含畸形回應無 status)→ provider_error 兜底。
      return {
        kind: 'failed',
        errorCode: status === null ? 'provider_error' : (ERROR_CODE_BY_STATUS[status] ?? 'provider_error'),
      };
    } catch {
      // transport 失敗(DNS / 連線 / 逾時)。🔴 刻意不讀 error.message 轉碼(REQUIRED-E1b 原則)。
      return { kind: 'failed', errorCode: 'network_error' };
    }
  }
}

/**
 * 🔴 §窄幅破例的唯一實作點(見檔頭)。只在 `status === 429` 被呼叫;任何失敗 → `http_429`
 * (= E1c 前的既有行為,零回歸)。
 *
 * 🔴 **獨立內層 try/catch,不可併入 `send` 的外層 try**(codex 關卡1 must-fix):否則 `json()`
 * reject(body 已消耗 / 非 JSON / getter throw)會被外層吸走 → 誤回 `network_error` 而非 `http_429`
 * → **誤導 E2a 退避**(transport 短退避 vs 429 保守長退避,語意天差地別)。外層 try 只留給 fetch/transport。
 */
async function classify429(res: { json?: () => Promise<unknown> }): Promise<EmailSendErrorCode> {
  try {
    if (typeof res?.json !== 'function') {
      return 'http_429';
    }
    // 🔴 body 視為不可信 `unknown`(codex 關卡1 nit:官方 TS union 只是編譯期保證,wire 不封閉)。
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) {
      return 'http_429';
    }
    // 🔴 只取頂層 `name` 單一欄;`message` 永不觸碰(原文不跨出本區域變數、不落表/不 log/不外傳)。
    const name: unknown = (body as { name?: unknown }).name;
    if (typeof name !== 'string') {
      return 'http_429';
    }
    // 🔴 `Map.get`(非物件索引):不查原型鏈 —— `name='toString'` 等必須落 `http_429`(見上方註解)。
    return QUOTA_ERROR_CODE_BY_NAME.get(name) ?? 'http_429';
  } catch {
    // body 已消耗(真實 Response 二讀 → TypeError)/ 非 JSON / getter throw → 退回既有行為。
    return 'http_429';
  }
}
