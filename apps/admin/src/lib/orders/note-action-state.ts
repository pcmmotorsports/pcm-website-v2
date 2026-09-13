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

/**
 * 🔴🔴 **更正成功的結果碼 —— Sean 2026-09-13 逐字定案:「備註已更新」(四個字,沒有句號)。**
 *
 * 🔴 **同一個 action(`appendOrderNoteAction`)有兩個成功碼,分岔判準只有一個**:
 *    `correctsNoteId !== null` ⇒ 本碼;否則 `NOTE_ADDED_RESULT_CODE`。
 *    理由 = 員工按的是**兩顆不同的鈕**(「新增備註」/「更正」),而 DB 側兩者都是 append 一列
 *    ⇒ **後端看起來是同一件事,對員工不是。** 共用「備註加好了。」會讓按更正的人以為自己
 *    多開了一筆新的,然後回頭去找那筆不存在的重複。
 *
 * ⚠️ **標點照他逐字原樣:本句【沒有】句號,而「備註已收起。」【有】。**
 *    兩句不一致**是照抄他的字,不是漏統一** —— 要統一要問他。
 *    (同族坑:下面 `DELETE_KEEPS_RECORD_NOTICE` 的全形逗號,已經被順手改過一次。)
 */
export const NOTE_UPDATED_RESULT_CODE = 'note_updated';

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
  // 🔴 2026-08-19:表單的型別選項已改成「內部備註 / 客人聯繫 + 一個『這次有正式告知客人』勾選」
  //    ⇒ 這句原本寫「聯絡紀錄與『已告知客人』」,而**畫面上已經沒有那兩個詞了**
  //    ⇒ 錯誤訊息要用員工**看得到**的字,不是用 DB 的型別名(那是 `literal-sweep` 掃出來的)。
  CONTACT_FIELDS_REQUIRED: '「客人聯繫」必須填聯絡管道與聯絡時間。',
  INTERNAL_FIELDS_FORBIDDEN: '內部備註不能填聯絡管道與聯絡時間(那兩欄留給「客人聯繫」)。',
  OCCURRED_AT_OUT_OF_RANGE: '聯絡時間超出合理範圍,請確認年份。',
  OCCURRED_AT_IN_FUTURE: '聯絡時間不能填未來的時間。',
  INVALID_BODY: '備註內容不能空白,請填寫實際內容。',
  BODY_TOO_LONG: '備註內容太長(上限 4000 字),請縮短後再送出。',
  // 🔴🔴 **這一句換掉的是一個【會弄壞 U6 告知義務那本帳】的指引**(2026-09-13)。
  //    ⛔ 舊字面逐字:「這筆備註已經被更正過了,一筆只能更正一次;**請改為重新登記一筆新的紀錄**。」
  //    **可重現的壞結局**:X 與 Y 同時開著同一單,X 先更正了第 2 版 ⇒ Y 按第 2 版的「更正」
  //    ⇒ 拿到本碼 ⇒ Y **照著那句話做**,登記一筆**沒有 `corrects_note_id` 指標**的新
  //    `customer_notified` ⇒ 時間軸出現兩個互不指向的現行版
  //    ⇒ `mappers/order-notes.ts` 的 `some(customer_notified && !corrected)` 回 **true**
  //    ⇒ **U6 被一個「照系統指示做事」的員工翻回「已告知」。**
  //    📌 **那句話叫他做的,正好是這條資料設計最不希望他做的事。**
  //    🔵 而正確的路今天就走得通(2026-09-13 拋棄式 PG + 真瀏覽器實測):
  //       `A ← B ← C` 的鏈本來就合法(A3 `20260729030000:158-159` 逐字),
  //       **最新那一版有可按的「更正」** ⇒ 指引要把他送去那裡。
  //    ⚠️ **不得**再出現「重新登記一筆新的紀錄」這個方向。
  //    🔵 刻意**不寫「有人先改了」** —— 同一個人開兩個分頁也會走到這裡,`deleted_by` 那類推定會說錯話。
  //    (三段式:核心狀態 → 後果 → 行動指引;不辯解、不碎念。)
  //    ⚠️ 「**本次**更正沒有寫入」而不是「你的內容沒有寫入」(codex 2026-09-13 收窄):
  //       後者會被讀成「你先前寫的也沒進去」,而那不成立 —— 同 token 的重送會先回
  //       `DUPLICATE_REQUEST` 並按成功處理,走到本碼的一定是**這一次**沒寫進去。
  ALREADY_CORRECTED:
    '這一版已經被更正過了,本次更正沒有寫入。請重新整理,再去更正最新那一版。',
  INVALID_INPUT: '系統參數有誤,備註沒有寫入。請停手並通知系統維護,不要重複按送出。',
  ORDER_NOT_FOUND: '找不到這張訂單(可能剛被移除),備註沒有寫入。請停手並通知系統維護。',
  CORRECTS_NOT_FOUND: '找不到要更正的那筆備註,備註沒有寫入。請停手並通知系統維護。',
  denied: '可能沒有權限,也可能登入過期了。備註沒有寫入。先重新登入試一次;還是不行請找管理者。',
  // 🔴 **不要在這句後面補「哪一格不對會標在旁邊」** —— 畫面不會標。
  //    2026-09-10 Sean 拍掉全樹 8 處;理由見 `components/orders/result-banner.tsx` 檔頭。
  invalid: '表單有地方不對,備註沒有寫入。',
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

// ══ 貼板 138:軟刪除的 state ═══════════════════════════════════════════════
//
// 🔴 **另立一組,不塞進上面那組** —— 兩個動作的失敗碼集合不一樣(刪除沒有 body / channel 那幾碼),
//    合成一個聯集會讓 `FAILURE_MESSAGES` 出現一堆「這個動作不可能發生」的碼,
//    而型別層再也擋不住「新增備註回了一個只有刪除會回的碼」。

/** 成功後 PRG 帶的結果碼(與 `result-banner.tsx` 共用同一個常數,理由同上面那顆)。 */
export const NOTE_DELETED_RESULT_CODE = 'note_deleted';

/** 刪除表單欄位名(解析器與元件共用單一真相)。 */
export const NOTE_DELETE_ID_FIELD = 'delete_note_id';
export const NOTE_DELETE_REASON_FIELD = 'delete_reason';

/**
 * 🔴🔴 **鈕上方那句小字 —— Sean 2026-09-13 逐字定案:「僅收起，不刪除。」**
 * (形狀抄 `note-timeline.ts` 的 `CORRECTION_IRREVOCABLE_NOTICE`,那一句他 2026-08-03 也拍過字面。)
 *
 * 🔴🔴 **「按之前」與「按之後」是【兩格】,刻意不共用一句話 —— 這是他拍板的一部分**:
 *   · **按之前**(本常數,鈕上方小字):回答「我按下去會怎樣」⇒ 員工在**猶豫**時看它,
 *     而他猶豫的正是「會不會就沒了」。
 *   · **按之後**(`NOTE_DELETED_RESULT_CODE` → `result-banner.tsx`,逐字「備註已收起。」):
 *     回答「剛剛發生了什麼」⇒ 那時他已經按了,那句話改變不了他的決定。
 *   📌 **這一格唯一會被下一個人「順手統一」掉的就是這件事** —— 看到兩句話講同一個主題
 *      就想合成一句。合掉的話,**省的是一行小字,失去的是員工敢不敢按**。
 *
 * ⚠️ **刻意不寫「誰刪的也會被記下來」** —— 那是真的,但寫進去會把這句話變成**警告**,
 *    而這一句要傳達的是「你可以放心按」。那一格資訊在稽核頁上,不在按鈕旁邊。
 * ⚠️ 標點照他逐字原樣(全形逗號)。本檔其餘訊息用半形逗號 = repo 既有慣例
 *    ⇒ **這一處與旁邊不一致是因為照抄他的字,不是漏統一**;要改要問他。
 */
export const DELETE_KEEPS_RECORD_NOTICE = '僅收起，不刪除。';

/**
 * 刪除的失敗原因碼 = RPC 的 4 個非成功固定碼 + 本層自己的 4 個。
 *
 * 🔴 成功型(`DELETED` / `DUPLICATE_REQUEST`)**不在這裡** —— 它們走 redirect。
 * 🔴 而 `ALREADY_DELETED` **是失敗型**:它意謂「這一則已經是收起狀態」,而**本次沒有寫入任何東西**。
 *    把它併進成功型 = 告訴他「收起來了」而他其實什麼都沒做,`deleted_at` 也不是這一刻。
 *    ⚠️ **不要推定是「別人」做的**(codex 2026-09-13 nit 1):同一個人開兩個分頁、
 *       或成功後回應掉了再重載拿新 token 重送,都會走到這裡 —— 那時 `deleted_by` 就是他自己。
 */
export type NoteDeleteFailureCode =
  // ── 可改輸入型(RPC 回傳碼)
  | 'REASON_TOO_LONG'
  // ── 要讓員工知道、但不是他的錯
  | 'ALREADY_DELETED'
  // ── 呼叫端 bug 型(表單流程下不該出現)
  | 'INVALID_INPUT'
  | 'ORDER_NOT_FOUND'
  | 'NOTE_NOT_FOUND'
  // ── 本層閘
  | 'denied'
  | 'invalid'
  | 'bug'
  | 'error';

const DELETE_FAILURE_MESSAGES: Record<NoteDeleteFailureCode, string> = {
  REASON_TOO_LONG: '刪除理由太長(上限 500 字),請縮短後再送出。理由也可以留空。',
  ALREADY_DELETED: '這則備註已經被收起了。重新整理就會看到是誰收的、什麼時候。',
  INVALID_INPUT: '系統參數有誤,備註沒有被刪除。請停手並通知系統維護,不要重複按。',
  ORDER_NOT_FOUND: '找不到這張訂單(可能剛被移除),備註沒有被刪除。請停手並通知系統維護。',
  NOTE_NOT_FOUND: '找不到這則備註(可能剛被移除),沒有任何東西被刪除。請重新整理這張單。',
  // 🔴 逐字沿用上面那組的 `denied` —— 同一個 session 失效在兩個動作上長得一樣,
  //    講兩套話會讓員工以為是兩件事。
  denied: '可能沒有權限,也可能登入過期了。備註沒有被刪除。先重新登入試一次;還是不行請找管理者。',
  invalid: '表單有地方不對,備註沒有被刪除。',
  // 🔴 這兩句與新增那組**不共用**,而差別只有一句話(codex 2026-09-13 nit 3 證偽了我第一版的描述):
  //    兩組的 `bug` 都是「先重新整理去看」、`error` 都是「確認後再決定要不要重送」;
  //    **新增那組的 `bug` 多一句「不要直接重複按送出」** —— 因為新增重按會多一筆刪不掉的備註,
  //    而刪除重按是冪等的(同 token ⇒ DUPLICATE_REQUEST;不同 token ⇒ ALREADY_DELETED,都不會二次寫入)。
  //    ⛔ ~~原本寫「新增叫停手、刪除叫重新整理」~~ —— 那把一句話的差別說成了兩種語氣。
  bug: '系統狀態異常。請先重新整理這張單,看那則備註是不是已經被收起來了;若沒有,請通知系統維護。',
  error: '刪除失敗,也可能已經刪掉了。請重新整理這張單確認之後再決定要不要重按。',
};

/** 刪除 action 回傳型別。🔵 **不帶回 body** —— 刪除表單裡員工唯一打的字是理由,而理由可以不填。 */
export type NoteDeleteActionState =
  | { status: 'idle'; requestToken: string }
  | {
      status: 'failed';
      code: NoteDeleteFailureCode;
      message: string;
      /** 員工打的理由原樣帶回(他可能打了 400 字) */
      reason: string;
      /** 🔴 原樣帶回 —— 換新的 = 在 error 路上可能刪到別的世界(同 append 那條 R2-2) */
      requestToken: string;
    };

export function noteDeleteFailure(
  code: NoteDeleteFailureCode,
  reason: string,
  requestToken: string,
): NoteDeleteActionState {
  return {
    status: 'failed',
    code,
    message: DELETE_FAILURE_MESSAGES[code],
    reason,
    requestToken,
  };
}
