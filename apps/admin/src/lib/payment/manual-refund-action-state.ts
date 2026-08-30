// manual-refund-action-state.ts — M-4b E10 D3:非卡退款登記(現金/匯款)的 action state + 表單常數。
//
// 🔴 與 `refund-action-state.ts`(TapPay 線)刻意分檔:那支的 token 有「三種去向」是因為
//    TapPay 退款有 wire 層未定狀態(deferred/held/unknown_state);本 RPC
//    (`admin_record_manual_refund`)只有「成功」與「RAISE」兩種結局、沒有 wire 層,
//    token 去向因此只有兩種,合檔會把不存在的複雜度也一起搬過來。
//
// 🔴🔴 本檔會被 client 元件 import(`useActionState` 要讀 `requestToken`)⇒ 不得引入
//    `server-only` 或任何 server 專用模組(同 `refund-action-state.ts` 檔頭紀律)。

import { isUuid } from '../orders/note-action-state';

export const MANUAL_REFUND_SUBMITTED_RESULT_CODE = 'manual_refund_submitted';

export const MANUAL_REFUND_ORDER_ID_FIELD = 'order_id';
export const MANUAL_REFUND_RAIL_FIELD = 'rail';
export const MANUAL_REFUND_AMOUNT_FIELD = 'amount';
export const MANUAL_REFUND_REASON_FIELD = 'reason';
export const MANUAL_REFUND_OCCURRED_AT_FIELD = 'occurred_at';
export const MANUAL_REFUND_REQUEST_TOKEN_FIELD = 'request_token';

/** 冪等 token:一般 uuid(D1 的 `p_request_id` 型別只是 `uuid`,不要求 v4)。 */
export function generateManualRefundRequestToken(): string {
  return crypto.randomUUID();
}

export function isManualRefundRequestToken(value: string): boolean {
  return isUuid(value);
}

/**
 * 失敗原因碼。**分類依 SQLSTATE、不逐句解析 RPC 訊息**(同 `cancel-repository.ts` 的做法)——
 * D1 的業務 RAISE 全部走預設 `P0001`(`20260820021000:169` 只有隔離閘顯式帶 `P8C01`,
 * 其餘一個 `USING ERRCODE` 都沒有),分不出來哪一種業務拒絕,所以不強行分。
 *
 * ⚠️ **2026-08-31 補一格 —— 上面那句【只涵蓋 D1 那支 RPC 自己】,而它不是那張表的全部寫入者。**
 * `#866`(`20260824011000`)在 `order_manual_refunds` 上掛了 `BEFORE INSERT OR UPDATE OR DELETE`
 * trigger,吐 `PCM01`(現金/匯款軌別上限)/ `PCM02`(算不出上限)/ `PCM03`(不能 DELETE)——
 * 它們會**穿過** RPC 冒上來,而 `manual-refund-repository.ts` 的 map 已經接了。
 * 🔴 **這一段是給【從這裡反推】的人看的**(關卡2 R2 must-fix 4):
 *    上面那句話的主詞是「D1 那支 RPC」,而下一個人很容易把它讀成「這條路上的全部」
 *    ⇒ 然後推出「PCM0x 不存在」。**兩個宣稱,而它們共用同一句話。**
 *
 * 🔴 **`rejected` 例外地把 RPC 的 `message` 原樣顯示給員工**(見 repository 層的
 * `staffMessage`),這與 `cancel-repository.ts`/`refund-action-state.ts` 的慣例(只顯示
 * 罐頭訊息、原始 message 只進 log)刻意不同 —— 理由:D1 每一句 RAISE 本身就是寫給員工看的
 * 指示(例:「不要換人重送」「同一個 request_id 帶了不同的內容」),罐頭化只會把這些
 * RPC 作者已經寫好的具體指引換成一句更含糊的話,而且十幾句各自要一份罐頭譯文與 RPC 同步,
 * 是新的漂移點。RPC 訊息不含員工輸入(D1 的 RAISE 只帶欄名/系統值,不回顯 reason 全文),
 * 顯示風險與罐頭訊息相同。
 */
export type ManualRefundFailureCode =
  | 'denied'
  | 'invalid'
  | 'rejected'
  | 'bug'
  | 'error';

const FAILURE_MESSAGES: Record<ManualRefundFailureCode, string> = {
  denied: '沒有權限或登入狀態已失效,退款登記沒有送出。',
  invalid: '表單內容不正確(管道、金額、原因或時間格式有誤),退款登記沒有送出。',
  // 🔴 只在 repository 沒有給到 rpcMessage 時當備援(理論上不會發生,見呼叫端)。
  rejected: '這筆退款登記被拒絕,退款登記沒有送出。請重新整理頁面後再試一次。',
  bug: '系統呼叫異常,請重新整理頁面確認這筆是否已登記;不要重複送出,並通知系統維護。',
  error: '退款登記未完成,可以用同一張表單稍後再試——系統會辨識這筆請求並回報它的現況;請不要重新整理頁面後另開新請求。',
};

export type ManualRefundFormInput = {
  rail: string;
  amount: string;
  reason: string;
  occurredAt: string;
};

export const EMPTY_MANUAL_REFUND_INPUT: ManualRefundFormInput = {
  rail: '',
  amount: '',
  reason: '',
  occurredAt: '',
};

export type ManualRefundActionState =
  | { status: 'idle'; requestToken: string }
  | {
      status: 'failed';
      code: ManualRefundFailureCode;
      message: string;
      input: ManualRefundFormInput;
      /** 🔴 一律原樣帶回(不換新鍵):D1 沒有「列已終結、token 被永久消耗」的分支
       *  ——冪等鍵未使用就不必換,重送本來就該被同一把鍵認出。 */
      requestToken: string;
    };

export function manualRefundFailure(
  code: ManualRefundFailureCode,
  input: ManualRefundFormInput,
  submittedToken: string,
  /** 僅 `rejected` 會給值(RPC 的 message);其餘一律用罐頭文案。 */
  rpcMessage?: string,
): ManualRefundActionState {
  return {
    status: 'failed',
    code,
    message: code === 'rejected' && rpcMessage ? rpcMessage : FAILURE_MESSAGES[code],
    input,
    requestToken: submittedToken,
  };
}
