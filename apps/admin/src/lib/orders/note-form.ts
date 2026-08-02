// note-form.ts — M-4b E10 A9d2-1:訂單備註表單的純解析器(無 IO / 無 Next 依賴)。
//
// 🔴🔴 **本檔會被 client 端 import**(同 `supplier-form.ts` 的理由)⇒ 不得引入 `server-only`。
//
// 🔴 **鏡像範圍(不說滿)**:本檔只做「形狀」與「型別分流」,**刻意不重做** A6 的值域判定 ——
//    界外年份 / 未來時間 / body 全空白 / 4000 碼位上限的**單一真相在 RPC**
//    (`20260802150000:164-167`),重做一份就會有兩份會漂移的規格。
//    ⚠️ 範圍**不含** `:162-163` 的配對規則 —— 那兩條本檔**有**鏡像(型別分流),寫進來會與下面自相矛盾。
//    ⇒ 可主張的是「經由本解析器的欄位不會觸發 RPC 步 1 的 RAISE」,**不是**「RPC 所有 RETURN 碼都不可達」。
//
// 🔴 **型別分流不是風格偏好**:`order_notes` 的配對規則 CHECK(`20260729030000:116-127`)是
//    internal ⇒ channel 與 occurred_at **都必須 NULL**;非 internal ⇒ **都不得 NULL**。
//    用「有填就送」的寫法會在 internal 帶著空字串時撞 `INTERNAL_FIELDS_FORBIDDEN`。

import { rpcTrim } from '../supplier-form';
import {
  NOTE_BODY_FIELD,
  NOTE_CHANNEL_FIELD,
  NOTE_CORRECTS_FIELD,
  NOTE_OCCURRED_AT_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_TYPE_FIELD,
  isNoteRequestToken,
  isUuid,
} from './note-action-state';

/** 最小 FormData 介面(同 `supplier-form.ts` 慣例:測試不必造真 FormData)。 */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
}

/** 三種備註型別(鏡像 `order_notes_type_check`、`20260729030000:87-88`)。 */
export const NOTE_TYPES = ['internal', 'contact_log', 'customer_notified'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** 五種聯絡管道(鏡像 `order_notes_channel_check`、`20260729030000:129-130`)。 */
export const NOTE_CHANNELS = ['line', 'phone', 'email', 'in_person', 'other'] as const;
export type NoteChannel = (typeof NOTE_CHANNELS)[number];

/**
 * 🔴 `occurred_at` 必須帶時區偏移(關卡1 Fable F6 —— 本片最容易靜默寫錯資料的一條)。
 *
 * `<input type="datetime-local">` 的 value **不帶偏移**(`2026-08-02T14:30`),而 server 跑在 **UTC**
 * ⇒ 直接 `new Date(value)` 會把員工心裡的**台北 14:30 存成 UTC 14:30 = 台北 22:30**:
 * 差 8 小時、落在 RPC 的 2020-2100 與 now+5min 界內 ⇒ **靜默接受** ⇒ append-only 永久留存,
 * 而這一欄正是 U6 告知義務的**證據時間**。
 * ⇒ 這裡**拒收不帶偏移的字面**(fail-closed),**絕不**自行假設 `Asia/Taipei` 補上去
 *   —— 那等於用猜的去寫一筆法律證據。A10a 負責產帶偏移的 ISO。
 * 🔴 `Z` 結尾算合法偏移(`toISOString()` 的產物,是 A10a 最自然的產法)。
 */
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function readString(form: FormLike, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw : null;
}

export type NoteParse =
  | {
      ok: true;
      orderId: string;
      noteType: NoteType;
      /** 🔴 **原文**(未正規化):A6 的 `body_sha256` 冪等比對量的是原文,這層改寫內容會讓重送被判「內容不符」而 RAISE */
      body: string;
      channel: NoteChannel | null;
      occurredAt: string | null;
      correctsNoteId: string | null;
      requestToken: string;
    }
  | { ok: false };

/**
 * 解析備註表單。任一欄形狀不合 → `{ ok: false }`(呼叫端回 `invalid` state)。
 *
 * 🔴 誠實邊界:回傳只有單一 `ok: false`,**空白 / 形狀錯 / 缺 token 在 UI 上分不出來**
 *    (同 `supplier-form.ts` 的已知取捨);要分得出來得先擴回傳型別,本片不做。
 */
export function parseOrderNoteForm(form: FormLike): NoteParse {
  const orderId = readString(form, NOTE_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  const requestToken = readString(form, NOTE_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isNoteRequestToken(requestToken)) return { ok: false };

  const noteTypeRaw = readString(form, NOTE_TYPE_FIELD);
  if (noteTypeRaw === null || !(NOTE_TYPES as readonly string[]).includes(noteTypeRaw)) {
    return { ok: false };
  }
  const noteType = noteTypeRaw as NoteType;

  const body = readString(form, NOTE_BODY_FIELD);
  // 🔴 用 `rpcTrim` 不用 `.trim()`:`.trim()` 不剝 U+200B / U+180E / U+2060,而 RPC 會剝
  //    ⇒ 純由零寬字組成的內容在 `.trim()` 下是「非空」,會通過這裡、到 RPC 才被判 INVALID_BODY。
  //    (更寬的那組「肉眼全白」碼位〔U+2800 / U+3164 / U+00AD〕**刻意不在這層擋** ——
  //     單一真相在 RPC `:166`,這層只擋最常見的那組。)
  if (body === null || rpcTrim(body) === '') return { ok: false };

  const correctsRaw = readString(form, NOTE_CORRECTS_FIELD);
  const correctsNoteId =
    correctsRaw === null || correctsRaw === '' ? null : correctsRaw;
  if (correctsNoteId !== null && !isUuid(correctsNoteId)) return { ok: false };

  // 🔴 型別分流(見檔頭):internal 一律送 null,不看表單上那兩欄填了什麼。
  if (noteType === 'internal') {
    return {
      ok: true,
      orderId,
      noteType,
      body,
      channel: null,
      occurredAt: null,
      correctsNoteId,
      requestToken,
    };
  }

  const channelRaw = readString(form, NOTE_CHANNEL_FIELD);
  if (channelRaw === null || !(NOTE_CHANNELS as readonly string[]).includes(channelRaw)) {
    return { ok: false };
  }
  const occurredAt = readString(form, NOTE_OCCURRED_AT_FIELD);
  if (occurredAt === null || !ISO_WITH_OFFSET_RE.test(occurredAt)) return { ok: false };

  return {
    ok: true,
    orderId,
    noteType,
    body,
    channel: channelRaw as NoteChannel,
    occurredAt,
    correctsNoteId,
    requestToken,
  };
}
