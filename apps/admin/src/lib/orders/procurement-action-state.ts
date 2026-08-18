// procurement-action-state.ts — M-4b E10 A10b:採購表單 action 的回傳 state。
//
// 🔴🔴 **本檔會被 client 端 import**(表單用 `useActionState` 接 state)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 **刻意不做 A6/A9d2-1 那套「表單冪等 token」**(這是本片最容易照抄錯的一條):
//    A6 需要 token 是因為 `order_notes` **append-only** —— 重送 = 第二筆刪不掉的備註。
//    A5a 不是:它的冪等來自**業務鍵 upsert +(order_item_id, supplier_id)同值 no-op**
//    (`20260803160000:300-322`),重送同一份 payload 回 `NO_CHANGE`、零寫入。
//    親驗該 migration 全檔:`p_request_id` **只**用於步 12 寫進 `admin_audit_log.request_id`
//    (`:426`/`:450`),**沒有**任何唯一性約束、也沒有 A6 那種「同 id 不同內容就 RAISE」的比對
//    ⇒ 每次送出用一把新的 HTTP `x-request-id` 是安全且正確的,搬 token 機制過來只是多一個會壞的東西。
//
// 🔴 **失敗回 state、成功才 redirect**(沿用 Sean 2026-08-02 對備註線拍的 Q1=A 形狀):
//    本表單有 7 個輸入欄(含最長 500 字的異常原因),redirect 會把員工打的整份清掉。

/** 成功後 PRG 帶的結果碼(三個成功碼各自一個,員工要看得出「有沒有真的改到東西」)。 */
export const PROCUREMENT_CREATED_RESULT_CODE = 'procurement_created';
export const PROCUREMENT_UPDATED_RESULT_CODE = 'procurement_updated';
export const PROCUREMENT_NO_CHANGE_RESULT_CODE = 'procurement_no_change';

/** 表單欄位名(解析器與表單共用單一真相,避免兩邊各打一次字串)。 */
export const PROC_ORDER_ID_FIELD = 'order_id';
export const PROC_ORDER_ITEM_ID_FIELD = 'order_item_id';
export const PROC_SUPPLIER_ID_FIELD = 'supplier_id';
export const PROC_ALLOCATED_FIELD = 'allocated_quantity';
export const PROC_REPLY_STATUS_FIELD = 'reply_status';
export const PROC_CONTACT_CHANNEL_FIELD = 'contact_channel';
export const PROC_SUBMITTED_AT_FIELD = 'submitted_at';
export const PROC_SUPPLIER_ORDER_NO_FIELD = 'supplier_order_no';
export const PROC_EXCEPTION_REASON_FIELD = 'exception_reason';
export const PROC_EXPECTED_ARRIVAL_FIELD = 'expected_arrival_date';

/**
 * 送出時間的**可見欄**(datetime-local 原值,不帶偏移)。
 * 🔴 與 `PROC_SUBMITTED_AT_FIELD`(hidden、帶偏移的 ISO)是**兩個不同的欄位**:
 *    送進 RPC 的是後者;失敗帶回畫面的是前者(帶 ISO 回去,datetime-local 會顯示空白 =
 *    「保留輸入」變成空宣稱)。兩者由同一份 state 換算 ⇒ 結構上不可能分岔。
 */
export const PROC_SUBMITTED_AT_LOCAL_FIELD = 'submitted_at_local';

/**
 * 截斷旗標(A9a-2 MF1 的下游義務)。值 `'1'` = 這個品項的採購清單**可能不完整**
 * ⇒ action 拒收(全量 payload 拿不可信的 hydrate 送出 = 用不完整內容覆蓋既有事實)。
 */
export const PROC_STALE_FIELD = 'procurement_stale';

/**
 * hydration 旗標(關卡2 code-reviewer Critical)。值 `'1'` = **誠實 client 已掛載**。
 * ⚠️ 它保證的僅止於此(關卡2 codex nit):**不**保證 `hydrateFormValues` 跑完、**不**保證手上的資料仍是最新、
 * 也**不**保證繞過畫面的人不能自己帶 `'1'`。真正的 fail-closed 在 RPC 的 17 個固定碼。
 *
 * 🔴 **為什麼需要它**:React 19 的 form action **在 hydration 完成前就送得出去**(漸進增強)。
 *    那一刻 `onChange` 沒接上 ⇒ 員工用原生下拉選到一個**已經有採購紀錄**的供應商、
 *    其餘選填欄維持空白送出 ⇒ A5a 是**全量 payload**,空白 = NULL
 *    ⇒ 單號 / 異常原因 / 預計到貨 / 送出時間 / 聯絡管道**全部被靜默清空**。
 * 🔴 **既有兩道都擋不住這條**:解析器對 `submitted_at` 的 fail-closed 只擋「不帶偏移的字面」,
 *    空字串是合法的「沒填」;RPC 端 NULL 也是合法輸入。⇒ 必須自己加一道。
 * ⚠️ 代價 = **本表單放棄無 JS 的漸進增強**(未掛載時不給送)。對一個「送錯就靜默清掉事實」的
 *    全量 payload 表單,fail-closed 比可用性優先;這是知情取捨,不是沒想到。
 */
export const PROC_HYDRATED_FIELD = 'procurement_hydrated';

/**
 * uuid 形狀。**大小寫皆收**(`/i`)—— 理由同 `note-action-state.ts:36-40`。
 * 🔴 與備註線各養一份是刻意的:那份綁著「冪等 token 的產生器同源」語意(該檔 `:41-48`),
 *    本片沒有 token ⇒ 借過來會讓讀者以為本片也有那套機制。兩份都只是 uuid 形狀、不會實質漂移。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProcurementUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * 失敗原因碼 = A5a 的 14 個非成功固定碼 + 本層自己的 **6** 個(denied / invalid / stale /
 * not_hydrated / bug / error)= **共 20**。
 *
 * 🔴 三類語意(逐碼、非代表值):
 *   ①**可改輸入型**(員工自己改得掉)②**呼叫端 bug 型**(叫他停手、別再按)③本層閘。
 * 🔴 成功型(`CREATED` / `UPDATED` / `NO_CHANGE`)**不在這裡** —— 它們走 redirect、不回 state。
 */
export type ProcurementFailureCode =
  // ── 可改輸入型(RPC 回傳碼)
  | 'SUPPLIER_INACTIVE'
  | 'OVER_ALLOCATION'
  | 'ALLOCATED_BELOW_RECEIVED'
  | 'INVALID_ALLOCATED'
  | 'INVALID_REPLY_STATUS'
  | 'INVALID_CONTACT_CHANNEL'
  | 'INVALID_SUPPLIER_ORDER_NO'
  | 'INVALID_EXCEPTION_REASON'
  | 'SUBMITTED_AT_OUT_OF_RANGE'
  | 'SUBMITTED_AT_IN_FUTURE'
  | 'EXPECTED_ARRIVAL_OUT_OF_RANGE'
  // ── 呼叫端 bug 型(RPC 回傳碼;表單流程下不該出現)
  | 'INVALID_INPUT'
  | 'ORDER_ITEM_NOT_FOUND'
  | 'SUPPLIER_NOT_FOUND'
  // ── 本層閘
  | 'denied'
  | 'invalid'
  | 'stale'
  | 'not_hydrated'
  | 'bug'
  | 'error';

/**
 * 員工看到的字。🔴 **中文字面全部暫定、結構鎖字不鎖,待 Sean 肉眼定稿。**
 *
 * 🔴 bug 型叫他「停手」而不是「稍後再試」;但**理由與備註線不同**,不要照抄那句話:
 *    採購列是 upsert、重按不會多一筆(業務鍵擋著)。這裡要他停手是因為
 *    **參數已經對不上畫面**(品項/供應商 id 不存在)⇒ 再按只會用同一組壞參數再打一次。
 */
const FAILURE_MESSAGES: Record<ProcurementFailureCode, string> = {
  SUPPLIER_INACTIVE:
    '這家供應商已停用,不能新建採購、也不能調高訂購數量。' +
    '(已建立的採購仍可更新回覆狀態、單號、異常原因等紀錄欄。)',
  OVER_ALLOCATION:
    '這個品項的各家採購數量加起來超過可訂購數量。請調低本筆數量;' +
    '若本筆已經是 1 件降不下去(例如另一家掛著缺貨卻仍佔著配額),' +
    '要先去把「那一家」的訂購數量調低或改掉,再回來新增這一筆。',
  ALLOCATED_BELOW_RECEIVED: '訂購數量不能低於這筆採購已經到貨的數量。',
  INVALID_ALLOCATED: '訂購數量要是 1 到 100000 之間的整數。',
  INVALID_REPLY_STATUS: '回覆狀態不正確,請重新選擇。',
  INVALID_CONTACT_CHANNEL: '聯絡管道不正確(上限 200 字、不能含控制字元)。',
  INVALID_SUPPLIER_ORDER_NO:
    '供應商單號不正確(上限 200 字、前後不能有空白、不能含看不見的字元)。' +
    '這一欄之後要靠它跨單搜尋,混到空白就查不到。',
  INVALID_EXCEPTION_REASON: '異常原因不正確(上限 500 字、不能含控制字元)。',
  SUBMITTED_AT_OUT_OF_RANGE: '送出時間超出合理範圍,請確認年份。',
  SUBMITTED_AT_IN_FUTURE: '送出時間不能填未來的時間。',
  EXPECTED_ARRIVAL_OUT_OF_RANGE: '預計到貨日超出合理範圍,請確認年份。',
  INVALID_INPUT: '系統參數有誤,採購沒有寫入。請停手並通知系統維護。',
  ORDER_ITEM_NOT_FOUND: '找不到這個品項(可能剛被移除),採購沒有寫入。請停手並通知系統維護。',
  SUPPLIER_NOT_FOUND: '找不到這家供應商,採購沒有寫入。請停手並通知系統維護。',
  denied: '沒有權限或登入狀態已失效,採購沒有寫入。',
  invalid: '表單內容不正確,採購沒有寫入。',
  // 🔴 `#643` B(2026-08-18):**這一句是那個截斷警告的【伺服器端回聲】,不是另一件事。**
  //    `stale` 由 `item-procurement-form.tsx:248` 的 hidden 欄位帶上來,而它的值是
  //    `value={truncated ? '1' : '0'}`,`truncated = item.procurementTruncated || detail.itemsTruncated`
  //    ⇒ **與畫面上那個警告【同一個旗標】。**
  //    ⚠️ 舊字面逐字 ~~「請重新整理這張單再操作。」~~ —— 而 `detail.itemsTruncated` 是
  //    `order_items.length >= 200`(固定上限)⇒ **重整永遠不會好**,那句話是叫員工做白工。
  //    ⇒ 改成與畫面那則**同一個句型**(條件句)。**兩處要一起改** ——
  //    只改看得見那則的話,員工照樣送出、然後從這裡拿到舊的錯指示。
  //    📎 全陣紀律逐字 `apps/storefront/src/lib/account-order-copy.ts:16`:
  //       「請重新整理」只准出現在【真的重整就會好】的地方。
  stale:
    '這個品項的採購清單這次沒有完整載入,現在送出會用不完整的內容覆蓋既有資料。' +
    '可以先重新整理看看;如果還是這樣,那是系統的固定限制、不會自己好,請找負責人處理。',
  not_hydrated:
    '這張表單還沒載入完成就被送出,採購沒有寫入(避免把沒填到的欄位清空)。' +
    '請等畫面載入完成後再操作一次。',
  bug: '系統狀態異常,採購沒有寫入。請重新整理這張單確認之後再操作,不要重複按送出。',
  error:
    '寫入失敗,採購可能已經寫進去了。請重新整理這張單確認目前的內容之後,再決定要不要重送。',
};

/** 員工剛才打的內容(失敗時原樣帶回;React 19 的 form action 完成後會清空未受控欄位)。 */
export type ProcurementFormValues = {
  supplierId: string;
  allocatedQuantity: string;
  replyStatus: string;
  contactChannel: string;
  submittedAtLocal: string;
  supplierOrderNo: string;
  exceptionReason: string;
  expectedArrivalDate: string;
};

export const EMPTY_PROCUREMENT_VALUES: ProcurementFormValues = {
  supplierId: '',
  allocatedQuantity: '',
  replyStatus: '',
  contactChannel: '',
  submittedAtLocal: '',
  supplierOrderNo: '',
  exceptionReason: '',
  expectedArrivalDate: '',
};

/** action 回傳型別(`useActionState` 的 state)。 */
export type ProcurementActionState =
  | { status: 'idle' }
  | {
      status: 'failed';
      code: ProcurementFailureCode;
      message: string;
      /** 🔴 哪一個品項的表單失敗了 —— 一張單有多個品項、各有一份表單,錯誤要顯示在對的那一份上 */
      orderItemId: string | null;
      /** 🔴 員工打的內容原樣帶回(不帶回 = 「保留輸入」是空宣稱) */
      values: ProcurementFormValues;
    };

/** 組失敗 state。訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。 */
export function procurementFailure(
  code: ProcurementFailureCode,
  orderItemId: string | null,
  values: ProcurementFormValues,
): ProcurementActionState {
  return { status: 'failed', code, message: FAILURE_MESSAGES[code], orderItemId, values };
}
