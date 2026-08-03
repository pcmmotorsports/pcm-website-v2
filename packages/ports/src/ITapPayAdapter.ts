import type {
  TapPayChargePayload,
  TapPayChargeResult,
  TapPayInitiationPayload,
  TapPayInitiationResult,
  TapPayRefundPayload,
  TapPayRefundResult,
  TapPayRecordQuery,
  TapPayRecordResult,
} from '@pcm/domain';

/**
 * ITapPayAdapter: TapPay 金流 port。
 *
 * 對齊 PHASE-1-MILESTONES §6 M-3-08(TapPay sandbox 整合)。
 *
 * @see backlog #11 — TapPay-specific type 位置純度待 M-3-08 重檢
 */
export interface ITapPayAdapter {
  charge(payload: TapPayChargePayload): Promise<TapPayChargeResult>;
  /**
   * 3DS charge 啟動(M-3 3DS-5a):組 3DS body(`three_domain_secure` / `result_url` / caller 帶入唯一
   * `bankTransactionId`)→ 回 `payment_url` 跳轉網址 + `rec_trade_id`,**不請款、無實扣金額**。
   *
   * 🔴 與同步 `charge` 語意不同(獨立方法、不 overload):同步回「已扣款」、3DS 回「啟動待 OTP」。
   * 🔴 唯 `status===0 && payment_url && rec_trade_id` 回 `pending_3ds`;其餘(status≠0、含 421/timeout
   * 等模糊態 / HTTP 非 2xx / 格式異常)**一律 throw**(use-case 映 charge_unknown、不釋鎖;結算交 settleCharge /
   * Record API 唯一權威)。PII 零 log(payment_url 含 token query → 不入 log)。
   *
   * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §2.1
   */
  initiateThreeDSCharge(payload: TapPayInitiationPayload): Promise<TapPayInitiationResult>;
  /**
   * Refund API(M-3 退款線第一片;`/tpc/transaction/refund`)。
   *
   * 🔴 fail-closed 三分法(詳 domain `TapPayRefundResult` JSDoc):
   * - return `accepted`:受理(≠錢已到帳;生效權威=Record API/Portal)。
   * - return `deferred`(10024)/`rejected`(10051):實證零副作用的乾淨拒絕、**僅 kind='partial' 可達**。
   * - throw `TapPayRefundNotSentError`:pre-flight 輸入違規=**確定未送出**、可修正後安全重試。
   * - throw 其他一切(transport/HTTP/逾時/格式/未實證碼/kind='full' 的任何非 0 碼)= unknown-state,
   *   **絕不得自動重發**(bank_refund_id 冪等未實證 ⇒ 盲目重發=可能雙退);Record API 對帳後人工裁決。
   *
   * 🔴 呼叫端契約(A7c 接線片;詳 docs/handoff/2026-08-03-nightly-refund-adapter.md §7):
   * ①呼叫前必先把 bankRefundId durable 落帳本(order_refunds processing 列)——崩潰視窗內
   * TapPay 端真退款的唯一歸屬線索 ②同單必 single-flight(DB 允許多筆 processing 並存、不擋雙擊)
   * ③accepted.refundId 轉 confirmed 那次 UPDATE 才寫入帳本(P7C10)。
   */
  refund(payload: TapPayRefundPayload, options?: TapPayRefundOptions): Promise<TapPayRefundResult>;
  /**
   * Record API 反查(M-3 3DS-1a):依交易識別鍵查 TapPay 交易紀錄、忠實解析 trade_records 白名單欄。
   *
   * 🔴 **不下裁決**(無「已付款」判斷):top status / record_status / is_captured / amount 等原值回給
   * 3DS-1b settleCharge,由 1b 套全條件判 paid(§1 step 2)。Record 失敗 / HTTP 非 2xx / 格式異常 → throw
   * (1b 映 pending 保留、不誤判 failed)。
   *
   * @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §1 / §7
   */
  recordQuery(
    query: TapPayRecordQuery,
    options?: TapPayRecordQueryOptions,
  ): Promise<TapPayRecordResult>;
}

/**
 * `recordQuery` 的可選執行控制(M-4b E10 A15)。
 *
 * 🔴 為什麼要放進 **port** 而不是只改 adapter:呼叫端是**經 port 注入**拿到 adapter 的。
 * 簽章只改在具體 adapter 上、port 沒開這個參數的話,呼叫端拿到的是 port 型別 ⇒
 * **傳不了 signal**,逾時控制形同不存在。(原設想的「第 3 批退款 worker」已被 A7c 拍板取消
 * 〔2026-08-01:同步後台發起、無 worker〕;機制保留給任何需要逾時的注入呼叫端。)
 *
 * 🔴 **中止時丟出來的是 `signal.reason`,不保證是 `AbortError`**:
 * - `controller.abort()` → `AbortError`
 * - `AbortSignal.timeout(ms)` → **`TimeoutError`**(要逾時的呼叫端最自然的用法)
 * - `controller.abort(自訂 reason)` → **任意值,甚至不是 Error**
 *
 * ⇒ 消費端**不得**用 `err.name === 'AbortError'` 之類的分支去判「這是我方逾時、不是真失敗」。
 * 照 name 分支的話,自家逾時會被誤分類成真失敗、退款狀態機走錯枝。
 * **一律當作 unknown-state 保留重試。**
 *
 * 🔴 語意:中止走的是與既有「Record 失敗 → throw」相同的那條路
 * ⇒ 上游 `settleCharge` 映成 **pending / record_unreachable**(保留、不誤判 failed)。
 * 逾時**不是**「這筆沒付款」的證據,絕不可被當成 failed —— 那會把已扣款的單移走。
 *
 * 🔴 本型別**不設預設逾時**:adapter 不自作主張給既有金流路徑(settleCharge)加上原本沒有的
 * 中止行為。要逾時的呼叫端自己帶 signal。
 *
 * 🔴 **任何帶 signal 呼叫端的驗收條件**:TypeScript 對「多帶一個參數」是可賦值的 ⇒ 一個**忽略
 * options 的實作或測試替身照樣 typecheck 全綠**,「呼叫端有傳、實作沒接」型別層抓不到。
 * ⇒ 單元測試必須斷言 signal **真的到達 fetch**(例如:mock 在沒收到 signal 時
 * 永不 settle,漏接就會逾時變紅),否則等於沒有逾時保護。
 *
 * ✅(2026-08-03 退款線第一片)`refund()` 已有自己的 `TapPayRefundOptions` —— 與本型別**刻意不同**:
 * refund 的 30s 預設逾時**恆在**(見下)。本型別「不設預設」的理由(不給既有 settleCharge 路徑
 * 加原本沒有的中止行為)仍然成立、維持不變。
 */
export type TapPayRecordQueryOptions = {
  /** 中止訊號;未給 = 沿用既有行為(無逾時)。 */
  signal?: AbortSignal;
};

/**
 * `refund` 的可選執行控制(M-3 退款線第一片)。
 *
 * 🔴 與 `TapPayRecordQueryOptions` 刻意不同:**30 秒預設逾時恆在**(官方建議 30s;動真錢的
 * 同步呼叫 hang 住=值班重按=併發重複退窗)。呼叫端有給 signal 時 adapter 以
 * `AbortSignal.any([signal, AbortSignal.timeout(30_000)])` 合成 —— **傳自己的 signal 不會
 * 移除 30s 上限**,兩者先到先中止。
 *
 * 🔴 **不要傳 request-scoped(client disconnect)signal**:管理員送出退款後關頁/導頁會把
 * **已在途的退款**人為中止成 unknown-state(refundId 遺失窗)。要傳就傳呼叫端自己控制的
 * controller/timeout。
 *
 * 🔴 中止時丟出的是 `signal.reason`(可能 AbortError / TimeoutError / 任意自訂值),adapter
 * 原樣傳出;消費端**不得**按 `err.name` 分支 —— 凡非 `TapPayRefundNotSentError` 的 throw
 * 一律當 unknown-state 保留、絕不自動重發(紀律同 TapPayRecordQueryOptions,後果更重:動的是退款)。
 */
export type TapPayRefundOptions = {
  /** 中止訊號;未給 = 只有 30s 預設逾時;有給 = 與 30s 逾時 any() 合成。 */
  signal?: AbortSignal;
};
