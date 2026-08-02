// note-action-state.ts — M-4b E10 A9d2-1:訂單備註 action 的回傳 state + 冪等 token。
//
// 🔴🔴 **本檔會被 client 端 import**(A10a 的表單要用 `useActionState` 接 state、並讀 `requestToken`)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 **為什麼不用樣板的 `Promise<void>` + 全路徑 PRG**(Sean 2026-08-02 拍板 Q1=A):
//    9 個「可改輸入型」錯誤 × 最長 4000 碼位的聯絡摘要 —— redirect 會把員工打的整段內容清掉。
//    供應商片丟的是一行店名所以無感,這裡不是。⇒ **失敗回 state(內容留著)、成功才 redirect**。
//
// 🔴 **`requestToken` 為什麼要由 state 原樣帶回**(關卡1 Fable R2-2,本片最容易被改壞的一條):
//    失敗路徑也會 `revalidatePath` ⇒ server component 重渲染 ⇒ 表單若「每次渲染產新 token」,
//    員工在 `error` 分支重按就是**新 token**。而 `error` 的定義正是「RPC **可能已經 commit**、
//    只是回應斷在路上」⇒ 新 token 讓 A6 認不出這是重送 ⇒ **真的多一筆刪不掉的備註**
//    (`order_notes` append-only)。⇒ A10a 必須用 `state.requestToken ?? 新產一個`。

/**
 * 成功後 PRG 帶的結果碼。
 * 🔴 **`result-banner.tsx` 直接拿本常數當查表 key、action 直接拿它組 URL** ——
 *    關卡2 MF1:兩邊各打一次字串時,任一側 typo 都會全綠,而員工成功後看到的是一片空白、
 *    會以為沒寫進去而再寫一次(而備註刪不掉)。用同一個常數 ⇒ 結構上 typo 不可能。
 */
export const NOTE_ADDED_RESULT_CODE = 'note_added';

/** 表單欄位名(解析器與 A10a 共用單一真相,避免兩邊各打一次字串)。 */
export const NOTE_ORDER_ID_FIELD = 'order_id';
export const NOTE_TYPE_FIELD = 'note_type';
export const NOTE_BODY_FIELD = 'body';
export const NOTE_CHANNEL_FIELD = 'channel';
export const NOTE_OCCURRED_AT_FIELD = 'occurred_at';
export const NOTE_CORRECTS_FIELD = 'corrects_note_id';
export const NOTE_REQUEST_TOKEN_FIELD = 'request_token';

/**
 * 冪等 token 形狀 = 裸 uuid(含連字號)。**大小寫皆收**(`/i`)—— `crypto.randomUUID()` 產小寫,
 * 但收大寫不會有壞處,而拒收大寫會讓「手上有一把合法 uuid 卻被擋掉」變成難查的 bug。
 *
 * 🔴 **不要重用 `lib/request-id.ts` 的 `generateRequestId()`** —— 它回的是 `req_<uuid>`
 *    (`request-id.ts:13-15`),過不了本驗證器。關卡1 Fable F3:那是 A10a 最自然的寫法,
 *    真寫下去會讓每次送出都變成 `invalid`、整個備註功能死掉,而本片測試照樣全綠(錯在片界外)。
 * ⇒ 產生器與驗證器**同檔同源**,不留下「用文字描述形狀」的空間。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 產一把冪等 token。
 *
 * 🔴 **產生點必須在 server component 的渲染期**(Sean 拍板 Q2=C),而且
 * **不得落在任何快取層內**(`unstable_cache` / `React.cache` 會把 token 凍住 ⇒ 多次載入拿到同一把
 * ⇒ 第二個人寫備註直接撞 `DUPLICATE_REQUEST` 或 C9 的 RAISE)。
 * 頁層 `app/orders/[id]/page.tsx:14` 是 `force-dynamic`(已實查)⇒ 頁層無此問題,風險只在元件層自己加快取。
 */
export function generateNoteRequestToken(): string {
  return crypto.randomUUID();
}

/** token 形狀驗證(解析器用;與產生器同源)。 */
export function isNoteRequestToken(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * uuid 形狀(orderId / correctsNoteId 用)。
 * 🔴 與 token 共用同一條正規式 —— 關卡2 抓到我在 `note-form.ts` 另養了一份字面相同的,
 *    那是純粹的漂移面(兩份總有一天會不一樣)。
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * 失敗原因碼 = RPC 的 12 個非成功固定碼 + 本層自己的 4 個。
 *
 * 🔴 三類語意來自母 plan v4 §5 F3(逐碼、非代表值):
 *   ①**可改輸入型**(員工自己改得掉)②**呼叫端 bug 型**(叫他停手、別再按)③本層閘。
 * 🔴 成功型(`APPENDED` / `DUPLICATE_REQUEST`)**不在這裡** —— 它們走 redirect,不回 state。
 */
export type NoteFailureCode =
  // ── 可改輸入型(RPC 回傳碼)
  | 'INVALID_TYPE'
  | 'INVALID_CHANNEL'
  | 'CONTACT_FIELDS_REQUIRED'
  | 'INTERNAL_FIELDS_FORBIDDEN'
  | 'OCCURRED_AT_OUT_OF_RANGE'
  | 'OCCURRED_AT_IN_FUTURE'
  | 'INVALID_BODY'
  | 'BODY_TOO_LONG'
  | 'ALREADY_CORRECTED'
  // ── 呼叫端 bug 型(RPC 回傳碼;表單流程下不該出現)
  | 'INVALID_INPUT'
  | 'ORDER_NOT_FOUND'
  | 'CORRECTS_NOT_FOUND'
  // ── 本層閘
  | 'denied'
  | 'invalid'
  | 'bug'
  | 'error';

/**
 * 員工看到的字。
 *
 * 🔴 **bug 型一律叫他「停手、不要再按」而不是「稍後再試」** —— `order_notes` append-only,
 *    再按一次可能就是第二筆永久紀錄(supplier 片 `r=bug` 的同一慣例)。
 */
const FAILURE_MESSAGES: Record<NoteFailureCode, string> = {
  INVALID_TYPE: '備註類型不正確,請重新選擇。',
  INVALID_CHANNEL: '聯絡管道不正確,請重新選擇。',
  CONTACT_FIELDS_REQUIRED: '聯絡紀錄與「已告知客人」必須填聯絡管道與聯絡時間。',
  INTERNAL_FIELDS_FORBIDDEN: '內部備註不能填聯絡管道與聯絡時間(那兩欄留給聯絡類紀錄)。',
  OCCURRED_AT_OUT_OF_RANGE: '聯絡時間超出合理範圍,請確認年份。',
  OCCURRED_AT_IN_FUTURE: '聯絡時間不能填未來的時間。',
  INVALID_BODY: '備註內容不能空白,請填寫實際內容。',
  BODY_TOO_LONG: '備註內容太長(上限 4000 字),請縮短後再送出。',
  ALREADY_CORRECTED: '這筆備註已經被更正過了,一筆只能更正一次;請改為重新登記一筆新的紀錄。',
  INVALID_INPUT: '系統參數有誤,備註沒有寫入。請停手並通知系統維護,不要重複按送出。',
  ORDER_NOT_FOUND: '找不到這張訂單(可能剛被移除),備註沒有寫入。請停手並通知系統維護。',
  CORRECTS_NOT_FOUND: '找不到要更正的那筆備註,備註沒有寫入。請停手並通知系統維護。',
  denied: '沒有權限或登入狀態已失效,備註沒有寫入。',
  invalid: '表單內容不正確,備註沒有寫入。',
  bug:
    '系統狀態異常,備註可能已經寫進去了。請先重新整理這張單,確認備註在不在;' +
    '若不在,請通知系統維護,不要直接重複按送出。',
  error: '寫入失敗,備註可能已經寫進去了。請重新整理這張單確認之後再決定要不要重送。',
};

/** action 回傳型別(`useActionState` 的 state)。 */
export type NoteActionState =
  | { status: 'idle'; requestToken: string }
  | {
      status: 'failed';
      code: NoteFailureCode;
      message: string;
      /** 🔴 員工打的內容原樣帶回(Q1=A 的承重;不帶回 = 「保留輸入」是空宣稱) */
      body: string;
      /** 🔴 原樣帶回(R2-2:換新的 = 在 error 路上製造第二筆永久備註) */
      requestToken: string;
    };

/** 組失敗 state。訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。 */
export function noteFailure(
  code: NoteFailureCode,
  body: string,
  requestToken: string,
): NoteActionState {
  return { status: 'failed', code, message: FAILURE_MESSAGES[code], body, requestToken };
}
