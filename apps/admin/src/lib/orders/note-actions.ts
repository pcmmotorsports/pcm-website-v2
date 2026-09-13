'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
// #365 片②:單值欄位的唯一讀法。
import { readSingle, readSingleString } from '../forms/single-value';
import { authorizeAdminMutation, authorizeManagerMutation } from '../session/authorize';
import { parseOrderNoteForm } from './note-form';
import {
  NOTE_ADDED_RESULT_CODE,
  NOTE_BODY_FIELD,
  NOTE_DELETED_RESULT_CODE,
  NOTE_DELETE_ID_FIELD,
  NOTE_DELETE_REASON_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_UPDATED_RESULT_CODE,
  generateNoteRequestToken,
  isNoteRequestToken,
  isUuid,
  noteDeleteFailure,
  noteFailure,
  type NoteActionState,
  type NoteDeleteActionState,
  type NoteDeleteFailureCode,
  type NoteFailureCode,
} from './note-action-state';
import {
  OrderNoteCallerBugError,
  appendOrderNote,
  softDeleteOrderNote,
  type NoteDeleteResultCode,
  type NoteResultCode,
} from './note-repository';
// #350d-3:動作做完回發起的那個視圖(order 域五支共用的解析器)。
import {
  ORDER_RETURN_TO_FIELD,
  appendResultQuery,
  parseOrderReturnTo,
} from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';

// M-4b E10 A9d2-1:訂單備註寫入 server action。
//
// 🔴 **混合形,不是樣板的全路徑 PRG**(Sean 2026-08-02 拍板 Q1=A):
//   **失敗回 state**(員工打的內容留在框裡)/ **成功才 redirect**(PRG:避免重整重送)。
//
// 🔴 **成功的 `redirect()` 必須在 try 之外**(關卡1 Fable R2-3):`redirect()` 是**拋 NEXT_REDIRECT**,
//    若順手包進 RPC 的 try,catch 會吞掉它、把**已經成功的寫入**分類成 `error`
//    ⇒ 員工看到失敗訊息、但備註已經寫進去了,而他會再寫一次。
//
// 🔴 **本檔沒有一行稽核 code** —— `admin_append_order_note` 在同交易寫 `admin_audit_log`。

const ORDERS_PATH = '/orders';

/** 成功後導回明細頁。🔴 `orderId` 必然已過解析器的 uuid 閘(成功路徑蘊含解析成功)。 */
function detailPath(orderId: string): string {
  return `${ORDERS_PATH}/${orderId}`;
}



/**
 * 14 碼 → 三類語意(母 plan v4 §5 F3,逐碼、非代表值)。
 * 成功型回 null(呼叫端 redirect),其餘回失敗碼。
 *
 * 🔴 **`DUPLICATE_REQUEST` 是成功型**:它意謂「這個 request 已經寫入過且經 A6 查驗
 *    (同單 + `body_sha256` 相符)」。顯示成錯誤會誘發員工換一把 token 重送
 *    = 冪等設計反而製造重複備註(母 plan F3 逐字)。
 */
function classifyResult(code: NoteResultCode): NoteFailureCode | null {
  switch (code) {
    case 'APPENDED':
    case 'DUPLICATE_REQUEST':
      return null;
    case 'INVALID_TYPE':
    case 'INVALID_CHANNEL':
    case 'CONTACT_FIELDS_REQUIRED':
    case 'INTERNAL_FIELDS_FORBIDDEN':
    case 'OCCURRED_AT_OUT_OF_RANGE':
    case 'OCCURRED_AT_IN_FUTURE':
    case 'INVALID_BODY':
    case 'BODY_TOO_LONG':
    case 'ALREADY_CORRECTED':
    case 'INVALID_INPUT':
    case 'ORDER_NOT_FOUND':
    case 'CORRECTS_NOT_FOUND':
      return code;
  }
}

/** 失敗時要帶回的兩個值。解析失敗時也要盡量帶回,否則員工打的字一樣會不見。 */
function carryBack(formData: FormData): { body: string; requestToken: string } {
  // 🔴 #365 片②:這兩欄與解析器讀的是**同兩顆欄位**,讀法必須一致 ——
  //    解析器對「送兩份」回 `ok:false`,而這裡若還採第一筆,失敗畫面就會把**其中一份**當成
  //    員工打的字回填、把**其中一把** token 當成冪等鍵繼續用(「兩邊各自正確、合起來錯」,
  //    同 `cancel-actions.ts:115-118` 的導頁目標)。讀不出恰一筆 ⇒ body 回空、token 另產一把。
  const body = readSingleString(formData, NOTE_BODY_FIELD);
  const token = readSingleString(formData, NOTE_REQUEST_TOKEN_FIELD);
  return {
    body: body ?? '',
    // 🔴 原樣帶回(R2-2);真的拿不到才新產一把,否則 `error` 路上重按會變成第二筆永久備註。
    requestToken: token !== null && token !== '' ? token : generateNoteRequestToken(),
  };
}

export async function appendOrderNoteAction(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  // ① 授權閘。🔴 **絕對第一,連讀一個欄位都在它之後** —— 未授權者送爛表單要拿到 denied
  //    而不是 invalid(否則等於對未授權者洩漏表單規則;S3b-2 關卡2 抓過同型)。
  //    🔴 **代價寫明**:`denied` 因此**不保留員工輸入**(拿不到 body 就回不了)。
  //    這是 Sean Q1=A「失敗保留輸入」的**唯一例外**,理由 = denied 意謂 session 已失效
  //    ⇒ 他下一步一定要重新登入,留著的內容在那之後也接不回去。
  //    ⚠️ **這是可選取捨、不是安全必要條件**(關卡2 抓我說滿):`carryBack` 只讀員工自己剛送上來的
  //    兩個字串、回傳碼仍是 `denied`,不洩漏任何表單規則。選現在這個順序是因為「授權閘絕對第一」
  //    最容易在日後被讀懂與維持,不是因為另一種寫法有洞。
  const authorization = await authorizeAdminMutation();
  if (!authorization) return noteFailure('denied', '', generateNoteRequestToken());

  const carried = carryBack(formData);

  // ② 解析。
  const parsed = parseOrderNoteForm(formData);
  if (!parsed.ok) return noteFailure('invalid', carried.body, carried.requestToken);

  // 🔴 #350d-3 C1:動作做完回發起的那個視圖(面板裡寫備註 ⇒ 回面板)。
  //    綁在 `parsed.orderId`(已過 uuid 閘)上 —— 契約 §6-1:`return_to` 只決定視圖、不決定哪一張單。
  //    🔴 #365 片②:改走「恰一筆」讀法(送兩份 ⇒ null ⇒ 走 fallback);**不進入口清單**,
  //    理由同 `lib/payment/refund-actions.ts` 的 `return_to` 那段(它決定不了寫什麼,
  //    只決定寫完停在哪一頁)。
  const returnTo = parseOrderReturnTo(
    readSingleString(formData, ORDER_RETURN_TO_FIELD),
    parsed.orderId,
  );

  const httpRequestId = await getRequestId();
  // 🔴 log **不記 body 全文**(只記長度)—— 備註是營運內容,長度足以除錯。
  // 🔴 **兩個 id 都記**:冪等鍵已改成表單 token(Sean Q2=C),稽核列的 request_id 因此
  //    不再等於 HTTP `x-request-id` ⇒ 兩者都留才對得回去(`proxy.ts:21-24` 那條決策的可追蹤性補償;
  //    本片的例外已寫在 `proxy.ts:26-33`)。
  console.info('[admin/orders/note] order_note.append.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    note_type: parsed.noteType,
    body_length: [...parsed.body].length,
    is_correction: parsed.correctsNoteId !== null,
  });

  // ③ 寫入。
  let result: NoteResultCode;
  try {
    result = await appendOrderNote({
      orderId: parsed.orderId,
      noteType: parsed.noteType,
      body: parsed.body,
      channel: parsed.channel,
      occurredAt: parsed.occurredAt,
      correctsNoteId: parsed.correctsNoteId,
      actor: authorization.actorId,
      requestToken: parsed.requestToken,
    });
  } catch (error) {
    // 🔴 失敗路徑也要 revalidate:`bug` / `error` 兩支都**可能已經寫進去了**
    //    (RPC 已 commit、回應斷在路上)⇒ 不重取的話員工會停在看不到那筆備註的舊畫面。
    revalidateOrderViews({ orderId: parsed.orderId, returnTo, scope: 'note', requestId: httpRequestId });
    if (error instanceof OrderNoteCallerBugError) {
      console.error('[admin/orders/note] 呼叫端契約違反', {
        request_id: httpRequestId,
        request_token: parsed.requestToken,
        message: error.message.slice(0, 200),
      });
      return noteFailure('bug', parsed.body, parsed.requestToken);
    }
    // 🔴 只記 code 與 message 前 200 字 —— **不得**記 `details` / `hint`:
    //    PG 23514 的 DETAIL 會帶整列內容 = 備註全文進 Vercel log。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error('[admin/orders/note] 備註寫入失敗', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
    });
    return noteFailure('error', parsed.body, parsed.requestToken);
  }

  revalidateOrderViews({ orderId: parsed.orderId, returnTo, scope: 'note', requestId: httpRequestId });

  const failure = classifyResult(result);
  if (failure) return noteFailure(failure, parsed.body, parsed.requestToken);

  // ④ 成功才 PRG。🔴 在 try 之外(見檔頭 R2-3)。
  //
  // 🔴🔴 **兩個成功碼, 分岔判準只有這一個** —— 更正 = 「員工按的是【更正】那顆鈕」,
  //    而它在 DB 側與新增**完全一樣**(都是 append 一列, 只差 `corrects_note_id` 有沒有值)。
  //    ⇒ 判準只能是 `parsed.correctsNoteId`, 不能問 RPC 回了什麼(它兩種都回 `APPENDED`)。
  //    ⚠️ `DUPLICATE_REQUEST` 也會走到這裡(`classifyResult` 把它當成功)——
  //       而那把 token 是同一張表單送的 ⇒ `correctsNoteId` 也是同一個值 ⇒ 分岔仍然正確。
  //    逐字字面與「為什麼不共用一句」寫在 `note-action-state.ts` 的 `NOTE_UPDATED_RESULT_CODE`。
  const successCode =
    parsed.correctsNoteId !== null ? NOTE_UPDATED_RESULT_CODE : NOTE_ADDED_RESULT_CODE;
  redirect(appendResultQuery(returnTo, `r=${successCode}`));
}

// ══ 貼板 138:軟刪除 server action ══════════════════════════════════════════
//
// 🔴🔴 **授權走 `authorizeManagerMutation()`,不是 `authorizeAdminMutation()`** ——
//    刪除限管理者(plan §4.3)。抄的是既有兩個先例,不自創:
//    `lib/mail/dead-letter-actions.ts:46`、`lib/orders/manual-cancel-notice-actions.ts:70`。
//
// 🛑 **而這道閘的強度上限受 `ADMIN_REQUIRE_REAL_IDENTITY` 那顆 env 影響**
//    (`lib/session/authorize.ts` 該函式上方 docstring;那顆 env 在 Vercel 是 Secret 型、
//     **連 Sean 本人也讀不到值**,只查得到存不存在)。
//    ⚠️ **而「拿掉旗標 ⇒ 這道閘退化成裝飾」那句話【說滿了】**(codex 2026-09-13 nit 2 證偽)——
//       實際條件是**三件同時成立**:旗標關閉 **且** 那張票是**沒有具名身分的舊票**
//       **且** 因此走到 picker 分支。拿著合法 `v:2` 票的非 manager,就算 picker cookie 填 manager,
//       身分仍取票上的 `staff_id`(`lib/session/actor.ts:134` 先處理 `v:2`)⇒ manager 查核照樣拒他。
//    ⇒ 本檔**不宣稱**「非 manager 一定擋得住」——那句仍然誠實;
//      說滿的是旁邊那句無條件的退化宣稱,已收窄。RPC 那一端更是完全不查 staff。
//
// 🔴 **形狀與 append 那支【刻意不同】的兩處**:
//    ① 成功後 PRG 帶 `NOTE_DELETED_RESULT_CODE`(另一個碼)—— 兩個動作的成功橫幅不共用一句話。
//    ② 失敗訊息**不共用**(見 `note-action-state.ts` 那組的註解)。
//       ⚠️ 而差別**比我第一版寫的小**(codex 2026-09-13 nit 3 證偽):兩組 `bug` 都是先叫他
//       重新整理去看、沒生效再通知維護;兩組 `error` 都是叫他確認後再決定要不要重送。
//       **真正的差別只有一句**:新增那組的 `bug` 多寫了「不要直接重複按送出」,
//       因為新增重按的代價是**多一筆刪不掉的備註**,而刪除重按是冪等的。
//       ⛔ ~~原本寫「新增叫停手、刪除叫重新整理」~~ —— 那把一句話的差別說成了兩種語氣。

/** 7 碼 → 成功型回 null,其餘回失敗碼。 */
function classifyDeleteResult(code: NoteDeleteResultCode): NoteDeleteFailureCode | null {
  switch (code) {
    // 🔴 `DUPLICATE_REQUEST` 是成功型:RPC 已查驗過「同 request + 指向本則 + 同一個人 +
    //    **而且那一則現在確實是刪除狀態**」才會回它(`20260913020000` 步 7)。
    case 'DELETED':
    case 'DUPLICATE_REQUEST':
      return null;
    // 🔴 `ALREADY_DELETED` **不是**成功型 —— 這一則已經是收起狀態,而本次沒有寫入任何東西。
    //    ⚠️ **不要推定是「別人」刪的**(codex 2026-09-13 nit 1):同一個人開兩個分頁、
    //       或成功後回應掉了再重載拿新 token 重送,也會走到這裡,而 `deleted_by` 記的就是他自己。
    case 'ALREADY_DELETED':
    case 'REASON_TOO_LONG':
    case 'INVALID_INPUT':
    case 'ORDER_NOT_FOUND':
    case 'NOTE_NOT_FOUND':
      return code;
  }
}

/** 失敗時要帶回的兩個值(讀法與解析器一致:讀不出恰一筆 ⇒ 理由回空、token 另產一把)。 */
function carryBackDelete(formData: FormData): { reason: string; requestToken: string } {
  const reason = readSingleString(formData, NOTE_DELETE_REASON_FIELD);
  const token = readSingleString(formData, NOTE_REQUEST_TOKEN_FIELD);
  return {
    reason: reason ?? '',
    requestToken: token !== null && token !== '' ? token : generateNoteRequestToken(),
  };
}

export async function softDeleteOrderNoteAction(
  _prev: NoteDeleteActionState,
  formData: FormData,
): Promise<NoteDeleteActionState> {
  // ① 授權閘。🔴 絕對第一,連讀一個欄位都在它之後(同 append 那支的理由)。
  const authorization = await authorizeManagerMutation();
  if (!authorization) return noteDeleteFailure('denied', '', generateNoteRequestToken());

  const carried = carryBackDelete(formData);

  // ② 解析。🔵 刪除表單只有四顆欄位 ⇒ 就地解析,不另開一支 `*-form.ts`
  //    (那支存在的理由是「九個可改輸入型錯誤要逐一分類」,這裡沒有那個問題)。
  const orderId = readSingleString(formData, NOTE_ORDER_ID_FIELD);
  const noteId = readSingleString(formData, NOTE_DELETE_ID_FIELD);
  const token = readSingleString(formData, NOTE_REQUEST_TOKEN_FIELD);
  // 🔴🔴 **理由要用三態的 `readSingle`,不能用 `readSingleString`**(codex 2026-09-13 must-fix)。
  //    `readSingleString` 把「沒送」與「送壞了」(同名欄位兩份 / 送的是 File)**都收斂成 `null`**,
  //    而本欄的 `null` 在下游代表「**選填、沒寫**」⇒ 送壞的理由會被當成沒寫
  //    ⇒ **備註照樣被收起、理由與稽核原因整個不見,而畫面報成功。**
  //    📌 `single-value.ts` 檔頭逐字預告過這個形狀:「呼叫端若有『空值 ⇒ 跳過某個檢查』的欄位,
  //       只換 `readSingleString` 會把 `invalid` 收斂成 `null`、繞過那族守門」——**本欄正是那一種。**
  //    ⇒ 判準:**沒送可以接受,送了但形狀錯要拒。**
  const reasonRead = readSingle(formData, NOTE_DELETE_REASON_FIELD);
  if (
    orderId === null ||
    !isUuid(orderId) ||
    noteId === null ||
    !isUuid(noteId) ||
    token === null ||
    !isNoteRequestToken(token) ||
    reasonRead.kind === 'invalid'
  ) {
    return noteDeleteFailure('invalid', carried.reason, carried.requestToken);
  }

  // 🔵 理由是**選填**:沒送、或送了但只有空白 ⇒ 一律 `null`,不要讓 DB 去判什麼叫「沒寫」。
  //    ⚠️ 這裡只剝 JS 的 `trim()`(ASCII + 常見 Unicode 空白);RPC 那一端另有一套更寬的
  //    零寬字集正規化 ⇒ **兩層都會把「看不見的內容」判成沒寫,而 RPC 那一層才是權威。**
  const reason =
    reasonRead.kind === 'value' && reasonRead.value.trim() !== '' ? reasonRead.value : null;

  const returnTo = parseOrderReturnTo(
    readSingleString(formData, ORDER_RETURN_TO_FIELD),
    orderId,
  );

  const httpRequestId = await getRequestId();
  // 🔴 log **不記理由全文**(只記長度)—— 理由是員工打的營運內容,可能帶客人資訊。
  console.info('[admin/orders/note] order_note.soft_delete.attempt', {
    request_id: httpRequestId,
    request_token: token,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: orderId,
    note_id: noteId,
    reason_length: reason === null ? 0 : [...reason].length,
  });

  // ③ 寫入。
  let result: NoteDeleteResultCode;
  try {
    result = await softDeleteOrderNote({
      orderId,
      noteId,
      reason,
      actor: authorization.actorId,
      requestToken: token,
    });
  } catch (error) {
    // 🔴 失敗路徑也要 revalidate:`bug` / `error` 兩支都**可能已經刪掉了**
    //    (RPC 已 commit、回應斷在路上)⇒ 不重取的話員工會停在還看得到那則備註的舊畫面,
    //    而那正是他會再按一次的原因。
    revalidateOrderViews({ orderId, returnTo, scope: 'note', requestId: httpRequestId });
    if (error instanceof OrderNoteCallerBugError) {
      console.error('[admin/orders/note] 刪除:呼叫端契約違反', {
        request_id: httpRequestId,
        request_token: token,
        message: error.message.slice(0, 200),
      });
      return noteDeleteFailure('bug', carried.reason, token);
    }
    // 🔴 只記 code 與 message 前 200 字 —— **不得**記 `details` / `hint`(PG 的 DETAIL 會帶整列內容)。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error('[admin/orders/note] 備註刪除失敗', {
      request_id: httpRequestId,
      request_token: token,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
    });
    return noteDeleteFailure('error', carried.reason, token);
  }

  revalidateOrderViews({ orderId, returnTo, scope: 'note', requestId: httpRequestId });

  const failure = classifyDeleteResult(result);
  if (failure) return noteDeleteFailure(failure, carried.reason, token);

  // ④ 成功才 PRG。🔴 在 try 之外(同 append:`redirect()` 是拋 NEXT_REDIRECT,
  //    包進 try 會被 catch 吞掉、把已經成功的刪除分類成 `error`)。
  redirect(appendResultQuery(returnTo, `r=${NOTE_DELETED_RESULT_CODE}`));
}
