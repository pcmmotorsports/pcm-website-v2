import type { ProcurementFailureCode } from './procurement-action-state';
import type { ProcurementResultCode } from './procurement-repository';

// procurement-result.ts — A5a 17 個固定碼的**唯一**語意分類器(M-4b E10 A9h-1)。
//
// 🔴 **為什麼要有這個檔**:A9h(批次訂貨 coordinator)要對逐列結果做同一套「成功 / 失敗」判斷。
//    若它自己再寫一份 switch,兩份會在**加碼時**漂移,而漂移的症狀是
//    **「同一個回傳碼在單列路徑是失敗、在批次路徑是成功」** —— 那種 bug 不會有測試紅給你看。
//    ⇒ 一份分類器,兩條路徑共用。本檔是「A9h-1」這一片的全部內容。
//
// 🔴 **為什麼不塞進 `procurement-action-state.ts`**(那才是最省檔案的做法):
//    該檔 `:3-4` 自陳不變式「**本檔會被 client 端 import ⇒ 不得引入 server-only 或任何
//    server 專用模組。目前零 import、零 IO、零敏感值**」,而下面第二行 import 的來源
//    `procurement-repository.ts` 檔頭是 `import 'server-only'`。
//    即使 `import type` 在編譯期會被抹除、功能上安全,也會讓那句「目前零 import」與事實不符
//    ⇒ 要嘛留下錯的註解、要嘛改寫別人的守門說明。開新檔比較誠實。
//
// 🔴 **兩個 import 都是 `import type`**:編譯期抹除 ⇒ 本檔零 runtime 相依、不把 server-only
//    拖進任何 bundle。

/**
 * 17 碼 → 三類語意(逐碼、非代表值)。成功型回 `null`(呼叫端自行決定 redirect / 記成功),
 * 其餘回失敗碼。
 *
 * 🔴 **`NO_CHANGE` 是成功型**:它意謂「送上來的內容與現況完全相同、零寫入」(A5a `:300-322`)。
 *    顯示成錯誤會誘發員工亂改一個欄位再送一次,把「什麼都沒發生」變成一次真的寫入。
 *    ⇒ 這也正是重送整批時「已成功的列自然 no-op」的機制(母 plan `:436` R7:冪等靠 A5a)。
 * 🔴 **`SUPPLIER_INACTIVE` 是可改輸入型、不是 bug**:停用是合法的業務狀態
 *    (Sean 2026-08-03 晚 Q1=A:擋新建與調升、放行事實記錄欄更新),員工改選一家或改回原數量就過得去。
 *
 * ⚠️ **本函式只回答「成功或失敗」,不回答「該不該中止批次」** —— 後者是 A9h-2 的編排決策,
 *    而且兩者**不是同一條線**:`INVALID_INPUT` / `ORDER_ITEM_NOT_FOUND` / `SUPPLIER_NOT_FOUND`
 *    在 `procurement-action-state.ts:96-99` 被歸為「呼叫端 bug 型」(`:96` 是那條分隔註解;
 *    ⚠️ `:95` 的 `EXPECTED_ARRIVAL_OUT_OF_RANGE` 在分隔線**上方**、是可改輸入型,別一起收進去),
 *    雖然在這裡是失敗碼,
 *    批次不該把它們當成「下一列還能繼續」的普通業務失敗(關卡1 R2 抓到的一條)。
 *    ⇒ 那個分界寫在 A9h-2 的 plan,**不要偷偷塞進這個函式**。
 */
export function classifyResult(code: ProcurementResultCode): ProcurementFailureCode | null {
  switch (code) {
    case 'CREATED':
    case 'UPDATED':
    case 'NO_CHANGE':
      return null;
    case 'SUPPLIER_INACTIVE':
    case 'OVER_ALLOCATION':
    case 'ALLOCATED_BELOW_RECEIVED':
    case 'INVALID_ALLOCATED':
    case 'INVALID_REPLY_STATUS':
    case 'INVALID_CONTACT_CHANNEL':
    case 'INVALID_SUPPLIER_ORDER_NO':
    case 'INVALID_EXCEPTION_REASON':
    case 'SUBMITTED_AT_OUT_OF_RANGE':
    case 'SUBMITTED_AT_IN_FUTURE':
    case 'EXPECTED_ARRIVAL_OUT_OF_RANGE':
    case 'INVALID_INPUT':
    case 'ORDER_ITEM_NOT_FOUND':
    case 'SUPPLIER_NOT_FOUND':
      return code;
  }
}
