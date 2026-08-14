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

/**
 * 🔴 **彈窗模式旗標**(#352-b-2 入口 2;主視窗 2026-08-11 裁 E1)。值 `'1'` = 這次送出來自出貨彈窗。
 *
 * 差別**只有成功那一半**:彈窗模式成功時 action **回 state 不 redirect**。
 * 理由:`redirect()` 之後**表單會重掛** ⇒ 彈窗連同員工還沒送出的數量/物流/備註一起消失、
 * 出貨的冪等鍵也會換一把(= 變成另一箱),而驗收 23a 逐字要求「**不重整**就能出」。
 * 🔴 **原字面寫的是「整頁重載」,那個機制講錯了**(#15-B2-c 片2 真 router 實測,`D-547-NOTE` §2):
 *    server action 的 `redirect()` 走的是 **soft navigation** —— 整頁沒有重載
 *    (從外部種在 `window` 上的標記活了下來),但表單**仍然重新掛載**、`useActionState` 仍然歸零。
 *    ⇒ **結論不變**(彈窗模式不 redirect 是對的),錯的只是理由;
 *    留著錯理由的代價是下一代拿它去推別的東西 —— 本片就是被它推著走了一輪。
 *
 * ⚠️ **這是「成功一律 PRG」的具名例外,不是把慣例改掉** ——
 * 列表模式(採購區塊)照舊 redirect;兩邊各有一格釘住,免得例外倒灌成常態。
 */
export const RCPT_INLINE_FIELD = 'inline';

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
  // ── 狀態型(#452 片 2a-2):**不是** bug、也不是可改輸入 —— 同事(或自己稍早)把這筆採購作廢了。
  //    表單開著的時候被別人作廢是**正常會發生的事** ⇒ 文案要給出路,不能寫成「系統異常」。
  | 'PROCUREMENT_VOIDED'
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
  // 🔴 文案要件(memory `project_admin-ux-operation-intuitiveness`:不用人教能做對):
  //    ①講清楚發生什麼(被作廢了,不是壞掉)②講清楚沒寫入 ③給下一步。
  //    🔴 **不承諾「去把作廢取消掉」** —— Sean 2026-08-14 拍 Q-452-換路=C,
  //       系統裡**沒有**取消作廢的功能。指向一個不存在的按鈕就是說謊。
  PROCUREMENT_VOIDED:
    '這筆採購已經作廢了,到貨沒有寫入。' +
    '請重新整理這張單,看看同一家供應商是不是另有一筆生效中的採購 —— 有的話請登錄到那一筆;' +
    '沒有的話,請先重新對這家供應商下一筆採購,再登錄到貨。',
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
  /**
   * 🔴 **「成功了,而且請你就地處理」**(#352-b-2 E1)—— **不是** `'success'` 的別名,
   * 也**不是** redirect 成功的替代品。它只在**彈窗模式**出現,語意是:
   * 「到貨已經寫進去了,接下來由呼叫端自己重取資料、就地更新畫面」。
   *
   * 列表模式成功**看不到這個 state**(那條路走 redirect,函式根本不返回)。
   * ⇒ 收到它的呼叫端**有義務**做那件就地更新;把它當成普通成功、只顯示一句話就結束,
   * 會讓員工看著一個沒更新的彈窗以為沒生效。
   */
  | {
      status: 'recorded_inline';
      /** 這次是真的寫進去了(`RECORDED`),還是冪等重放且產物仍在(`DUPLICATE_REQUEST`)。 */
      outcome: 'recorded' | 'duplicate';
      procurementId: string;
    }
  | {
      status: 'failed';
      code: ReceiptFailureCode;
      message: string;
      /** 🔴 哪一筆採購的小視窗失敗了 —— 一個品項可能有多筆採購、各有一顆按鈕 */
      procurementId: string | null;
      values: ReceiptFormValues;
    };

/**
 * 「撤銷剛剛登錄的那筆」的結果(#352-b「改軟」線片 1;Sean 逐字「登入到貨也要可以取消」)。
 *
 * 🔴 **與 `ReceiptActionState` 分開、不共用** —— 兩者失敗語意不同:登錄失敗要**帶回輸入值**
 *    讓員工改;撤銷沒有輸入可帶,卻多一個登錄沒有的形狀(`blocked` = 業務拒絕 + DB 原文)。
 *    塞進同一個聯集會讓兩邊欄位互相汙染(登錄的 `values` 對撤銷永遠是空殼)。
 *
 * 🔴 `blocked.message` 是 **DB 原文**(`20260810233000:428-433`,逐箱列出未出貨包裹編號與件數)
 *    ⇒ 原文畫給員工,**不准**壓成一句「刪不掉」(`receipt-repository.ts` 檔頭交辦)。
 */
export type ReceiptUndoState =
  | { status: 'idle' }
  | { status: 'undone' }
  /** `ALREADY_DELETED` / `RECEIPT_NOT_FOUND`:對員工是同一件事 —— 那筆已經不在了。 */
  | { status: 'already_gone' }
  | { status: 'blocked'; message: string }
  | { status: 'failed'; code: ReceiptUndoFailureCode; message: string };

export type ReceiptUndoFailureCode = 'denied' | 'bug' | 'error';

/** 撤銷失敗的三句話。與碼一對一 ⇒ 新增碼忘了寫訊息會型別紅。 */
const UNDO_FAILURE_MESSAGES: Record<ReceiptUndoFailureCode, string> = {
  denied: '你目前沒有權限撤銷到貨紀錄。請重新登入後再試。',
  bug: '這次撤銷被系統擋下(送出的資料不符合規則)。請重新整理這一頁再確認一次,不要重複按。',
  // 🔴 不寫「請再按一次」:撤銷**沒有冪等鍵**(`p_request_id` 那支不用於冪等判斷),
  //    而 error 涵蓋「RPC 已 commit、回應斷在路上」⇒ 叫他先確認狀態,不是叫他重按。
  error: '撤銷沒有完成(系統忙線或連線中斷)。請重新整理這一頁,確認那筆到貨還在不在,再決定要不要重按。',
};

export function receiptUndoFailure(code: ReceiptUndoFailureCode): ReceiptUndoState {
  return { status: 'failed', code, message: UNDO_FAILURE_MESSAGES[code] };
}

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
