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
  refund(payload: TapPayRefundPayload): Promise<TapPayRefundResult>;
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
 * 🔴 為什麼要放進 **port** 而不是只改 adapter:退款 worker(第 3 批)是**經 port 注入**呼叫
 * adapter 的。簽章只改在具體 adapter 上、port 沒開這個參數的話,worker 拿到的是 port 型別 ⇒
 * **傳不了 signal**,逾時控制形同不存在。
 *
 * 🔴 **中止時丟出來的是 `signal.reason`,不保證是 `AbortError`**:
 * - `controller.abort()` → `AbortError`
 * - `AbortSignal.timeout(ms)` → **`TimeoutError`**(第 3 批 worker 最自然的用法就是這個)
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
 * 🔴 **第 3 批 worker 的驗收條件**:TypeScript 對「多帶一個參數」是可賦值的 ⇒ 一個**忽略
 * options 的實作或測試替身照樣 typecheck 全綠**,「worker 有傳、實作沒接」型別層抓不到。
 * ⇒ worker 的單元測試必須斷言 signal **真的到達 fetch**(例如:mock 在沒收到 signal 時
 * 永不 settle,漏接就會逾時變紅),否則等於沒有逾時保護。
 *
 * ⚠️ 逾時控制目前**只開在 `recordQuery`**;真正動錢的 `refund()` 簽章未動、傳不了 signal。
 * RF 線實作退款時要自帶同款 options,不要以為 A15 已經全覆蓋。
 */
export type TapPayRecordQueryOptions = {
  /** 中止訊號;未給 = 沿用既有行為(無逾時)。 */
  signal?: AbortSignal;
};
