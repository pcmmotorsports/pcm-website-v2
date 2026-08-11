// receipt-action-state.ts — M-4b E10 #352-b:到貨登錄小視窗 action 的回傳 state。
//
// 🔴🔴 **本檔會被 client 端 import**(小視窗用 `useActionState` 接 state)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 **本片真的需要表單一次性 token**(與 A5a 相反,別照抄 `procurement-action-state.ts` 的立場):
//    `admin_record_item_receipt` 的 `p_request_id` **是冪等鍵**,有 `order_item_receipt_requests`
//    帳本擋著(同鍵同內容 → `DUPLICATE_REQUEST`、同鍵不同內容 → RAISE)。
//    A5a 那支的 `p_request_id` 只寫進 audit log、零唯一性約束,所以它可以每次用新的 HTTP request id;
//    這支不行 —— 每次 render 重產會讓「重送」變成新請求、冪等失效,員工手滑按兩次就記兩筆到貨。

/** 成功後 PRG 帶的結果碼。 */
export const RECEIPT_RECORDED_RESULT_CODE = 'receipt_recorded';
/** 冪等重放、**且產物還在** ⇒ 對員工等同成功(帳上有那筆貨)。 */
export const RECEIPT_DUPLICATE_RESULT_CODE = 'receipt_duplicate';

/** 表單欄位名(解析器與表單共用單一真相)。 */
export const RCPT_ORDER_ID_FIELD = 'order_id';
export const RCPT_ORDER_ITEM_ID_FIELD = 'order_item_id';
export const RCPT_PROCUREMENT_ID_FIELD = 'procurement_id';
export const RCPT_QUANTITY_FIELD = 'quantity';
export const RCPT_SURPLUS_FIELD = 'surplus_quantity';
export const RCPT_NOTE_FIELD = 'note';

/**
 * 到貨時刻(`datetime-local` 原值、不帶偏移)。
 *
 * 🔴 **只有一個欄位,刻意不照 A5a 開兩個** —— A5a 的 `submitted_at` 有「可見欄 + hidden ISO」
 *    兩份是因為那支在 client 端就換算好;本片的換算在 **action 裡**做
 *    (`toTaipeiIso`,理由:裝置時區會寫錯時刻)⇒ 再開一個 hidden 只是把同一個值抄兩份,
 *    而兩份同值欄位遲早會漂移(一邊改了另一邊沒改),且失敗帶回時要自己記得帶哪一份。
 */
export const RCPT_RECEIVED_AT_LOCAL_FIELD = 'received_at_local';

/**
 * 🔴 **一次性冪等鍵**(由表單掛載時產生一次、隨表單送出)。
 * 值形狀必須通過 RPC `20260811010000:101-103`:可列印 ASCII、無空白、**全小寫**、≤200。
 */
export const RCPT_REQUEST_ID_FIELD = 'request_id';

export type ReceiptFailureCode =
  // ── 可改輸入型(RPC 回傳碼)
  | 'EXCEEDS_ROOM_AFTER_CANCELLATION'
  | 'QUANTITY_EXCEEDS_ALLOCATED'
  | 'INVALID_QUANTITY'
  | 'NOTE_TOO_LONG'
  | 'RECEIVED_AT_REQUIRED'
  | 'RECEIVED_AT_OUT_OF_RANGE'
  | 'RECEIVED_AT_IN_FUTURE'
  // ── 呼叫端 bug 型(RPC 回傳碼;表單流程下不該出現)
  | 'PROCUREMENT_NOT_FOUND'
  // ── 冪等重放但**產物已被刪**:不是錯誤,但**絕不可**顯示成綠色的成功
  | 'DUPLICATE_DELETED'
  | 'DUPLICATE_UNKNOWN'
  // ── 本層閘
  | 'denied'
  | 'invalid'
  | 'bug'
  | 'error';

/**
 * 員工看到的字。🔴 **中文字面全部暫定、結構鎖字不鎖,待 Sean 肉眼定稿。**
 *
 * 🔴 `EXCEEDS_ROOM_AFTER_CANCELLATION` **必須把出路寫出來**:
 *    這條的正解是「到貨填 0、把多的填進溢收」(a1 `20260810230000:82` 逐字
 *    「訂單已收滿之後才到的貨 = `quantity=0 / surplus=N`」),兩道額度守門都只看到貨件數。
 *    ⚠️ 只寫「請改走現貨入庫」是**指向一個員工在畫面上找不到的地方**(backlog #386)
 *    —— 那句話在 migration 註解裡是設計意圖的簡寫,不是可以直接搬給員工的文案。
 *
 * 🔴 `DUPLICATE_DELETED` 是本表最重要的一條:RPC 對「先前登錄過、產物後來被刪」一樣回
 *    `DUPLICATE_REQUEST` 且**不重新建立**(`20260811010000:181` 逐字)⇒ 顯示成功會讓員工
 *    以為貨記在帳上,而帳面其實是空的。
 */
const FAILURE_MESSAGES: Record<ReceiptFailureCode, string> = {
  EXCEEDS_ROOM_AFTER_CANCELLATION:
    '這張單被取消掉的份額不能再登錄到貨。' +
    '如果貨真的到了,請把「到貨幾件」改成 0、把實際到的件數填進「溢收」——' +
    '這樣帳上查得到這批貨,但不會掛回這張單、也不會拿去出貨。',
  // 🔴 上限是「**還能登錄**的件數」= 訂購 − 已到貨,**不是訂購數**(R1 nit 7)——
  //    這筆採購先前已經登錄過的部分要扣掉。`findProcurementRemaining` 查得到時 action 會補上
  //    確切數字;查不到時員工只拿到這句,所以這句自己就不能講錯。
  QUANTITY_EXCEEDS_ALLOCATED:
    '到貨件數超過這筆採購還能登錄的件數(訂購數扣掉先前已登錄的到貨)。請先確認供應商出貨單;' +
    '如果對方確實多送了,把「到貨幾件」填到還能登錄的上限、多出來的填進「溢收」。',
  // 上下界都要講(R1 nit 8):RPC `:106-110` 是 `NOT BETWEEN 1 AND 100000` ⇒ 上限也會被拒。
  INVALID_QUANTITY:
    '到貨與溢收都要是 0 以上的整數,而且兩者加起來要在 1 到 100000 件之間。',
  NOTE_TOO_LONG: '備註太長了(上限 500 字)。',
  RECEIVED_AT_REQUIRED: '請填到貨時間。',
  RECEIVED_AT_OUT_OF_RANGE: '到貨時間超出合理範圍,請確認年份。',
  RECEIVED_AT_IN_FUTURE: '到貨時間不能填未來的時間。',
  PROCUREMENT_NOT_FOUND:
    '找不到這筆採購(可能剛被移除),到貨沒有寫入。請重新整理這張單再看一次。',
  DUPLICATE_DELETED:
    '這筆到貨先前已經登錄過,而且後來被刪除了 —— 這次沒有重新建立。' +
    '如果這批貨確實該記進來,請重新整理頁面,用新的一次登錄。',
  DUPLICATE_UNKNOWN:
    '這筆到貨先前已經登錄過,但現在查不到它的狀態。請重新整理這張單,確認到貨紀錄在不在,再決定要不要重登。',
  denied: '沒有權限或登入狀態已失效,到貨沒有寫入。',
  invalid: '表單內容不正確,到貨沒有寫入。',
  bug: '系統狀態異常,到貨沒有寫入。請重新整理這張單確認之後再操作,不要重複按送出。',
  error:
    '寫入失敗,到貨可能已經寫進去了。請重新整理這張單確認目前的內容之後,再決定要不要重送。',
};

/** 員工剛才打的內容(失敗時原樣帶回)。 */
export type ReceiptFormValues = {
  quantity: string;
  surplusQuantity: string;
  receivedAtLocal: string;
  note: string;
};

export const EMPTY_RECEIPT_VALUES: ReceiptFormValues = {
  quantity: '',
  surplusQuantity: '',
  receivedAtLocal: '',
  note: '',
};

export type ReceiptActionState =
  | { status: 'idle' }
  | {
      status: 'failed';
      code: ReceiptFailureCode;
      message: string;
      /** 🔴 哪一筆採購的小視窗失敗了 —— 一個品項可能有多筆採購、各有一顆按鈕 */
      procurementId: string | null;
      values: ReceiptFormValues;
    };

/**
 * 組失敗 state。訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。
 *
 * `detail` = `QUANTITY_EXCEEDS_ALLOCATED` 的拆分建議(由 action 算出後接在基本訊息之後)。
 */
export function receiptFailure(
  code: ReceiptFailureCode,
  procurementId: string | null,
  values: ReceiptFormValues,
  detail?: string,
): ReceiptActionState {
  const base = FAILURE_MESSAGES[code];
  return {
    status: 'failed',
    code,
    message: detail ? `${base}\n${detail}` : base,
    procurementId,
    values,
  };
}
