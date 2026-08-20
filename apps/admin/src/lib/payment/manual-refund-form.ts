// manual-refund-form.ts — M-4b E10 D3:非卡退款登記表單的純解析器(無 IO / 無 Next 依賴)。
//
// 只做「形狀」(同 refund-form.ts 檔頭紀律):業務判定(actor 是否啟用、金額是否超過
// 帳本未登記額、request_id 是否重送)單一真相在 RPC(admin_record_manual_refund),
// 本檔不重做。可主張的是「經過本解析器的欄位不會觸發 RPC 步 1-2 的形狀類 RAISE」。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  isManualRefundRequestToken,
} from './manual-refund-action-state';

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/** 值域對齊 DB CHECK(order_manual_refunds.rail):刻意不含 card。 */
export const MANUAL_REFUND_RAILS = ['bank_transfer', 'cash'] as const;
export type ManualRefundRail = (typeof MANUAL_REFUND_RAILS)[number];

/** PG integer 上界(對齊 refund-form.ts 的 MAX_AMOUNT,RPC 的 p_refund_amount 同型)。 */
const MAX_AMOUNT = 2_147_483_647;
const AMOUNT_RE = /^[1-9]\d{0,9}$/;
/** 原因欄長度上限:DB 端無 CHECK,本欄比照既有退款原因欄(refund-form.ts:121)取 200 —
 *  不是 RPC 要求,是與既有欄位維持一致的 UI 決定。 */
const MAX_REASON_LENGTH = 200;

/** 鏡像 POSIX cntrl(同 refund-form.ts 檔頭紀律的射程)。逐碼位掃描而非正規表達式
 *  字元類 —— 避免在原始碼裡放進不可見控制位元組本身。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export type ManualRefundParse =
  | {
      ok: true;
      orderId: string;
      rail: ManualRefundRail;
      amount: number;
      reason: string;
      /** ISO 字串;由 <input type="datetime-local"> 值轉換(見呼叫端)。 */
      occurredAt: string;
      requestToken: string;
    }
  | { ok: false };

export const MANUAL_REFUND_SINGLE_FIELDS = [
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
] as const;

export function parseManualRefundForm(form: FormLike): ManualRefundParse {
  if (anyMalformed(form, MANUAL_REFUND_SINGLE_FIELDS)) return { ok: false };

  const orderId = readString(form, MANUAL_REFUND_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  const requestToken = readString(form, MANUAL_REFUND_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isManualRefundRequestToken(requestToken)) return { ok: false };

  const railRaw = readString(form, MANUAL_REFUND_RAIL_FIELD);
  if (railRaw === null || !(MANUAL_REFUND_RAILS as readonly string[]).includes(railRaw)) {
    return { ok: false };
  }
  const rail = railRaw as ManualRefundRail;

  const amountRaw = readString(form, MANUAL_REFUND_AMOUNT_FIELD);
  if (amountRaw === null || !AMOUNT_RE.test(amountRaw)) return { ok: false };
  const amount = Number(amountRaw);
  if (amount > MAX_AMOUNT) return { ok: false };

  const reasonRaw = readString(form, MANUAL_REFUND_REASON_FIELD);
  if (reasonRaw === null) return { ok: false };
  const reason = reasonRaw.trim();
  if (reason === '' || [...reason].length > MAX_REASON_LENGTH || hasControlChar(reason)) {
    return { ok: false };
  }

  const occurredAtRaw = readString(form, MANUAL_REFUND_OCCURRED_AT_FIELD);
  if (occurredAtRaw === null) return { ok: false };
  // <input type="datetime-local"> 送出的是無時區的 YYYY-MM-DDTHH:mm;
  // 按員工所在時區(瀏覽器本機時區)解讀 —— 與 new Date(string) 的原生解析規則一致,
  // 不在這裡另外假設 UTC(RPC 只驗範圍、不驗時區來源,由 Date 建構子的形狀檢查把關即可)。
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return { ok: false };

  return {
    ok: true,
    orderId,
    rail,
    amount,
    reason,
    occurredAt: occurredAtDate.toISOString(),
    requestToken,
  };
}
