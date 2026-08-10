'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
// #365 片②:單值欄位的唯一讀法。
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { parseOrderNoteForm } from './note-form';
import {
  NOTE_ADDED_RESULT_CODE,
  NOTE_BODY_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  generateNoteRequestToken,
  noteFailure,
  type NoteActionState,
  type NoteFailureCode,
} from './note-action-state';
import {
  OrderNoteCallerBugError,
  appendOrderNote,
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
  redirect(appendResultQuery(returnTo, `r=${NOTE_ADDED_RESULT_CODE}`));
}
