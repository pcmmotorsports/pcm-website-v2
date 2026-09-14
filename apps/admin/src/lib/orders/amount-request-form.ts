// amount-request-form.ts — M-4b-03 員工「申請改品項單價」表單的解析層(純函式, 零 I/O)。
// 🔴 底層直接復用 `parseAmountForm`(訂單 / 品項 / version / 單價 / 0 元理由 / return_to 那六格一字不重寫),
//    本檔只多兩格:`request_reason`(為什麼要改, 1-500 字)+ `amount_request_id`(冪等鍵, server 渲染時發的 uuid)。
import { readSingle, readSingleString } from '../forms/single-value';
import { parseAmountForm, type AmountFormLike, type AmountParseResult } from './amount-form';

export const AMOUNT_REQUEST_REASON_FIELD = 'request_reason';
export const AMOUNT_REQUEST_ID_FIELD = 'amount_request_id';
export const AMOUNT_REQUEST_REASON_MAX = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AmountRequestParseResult =
  | (Extract<AmountParseResult, { ok: true }> & { reason: string; requestId: string })
  | Extract<AmountParseResult, { ok: false }>;

export function parseAmountRequestForm(form: AmountFormLike): AmountRequestParseResult {
  const base = parseAmountForm(form);
  if (!base.ok) return base;
  const fail = (): AmountRequestParseResult => ({ ok: false, orderId: base.orderId });
  const reasonRead = readSingle(form, AMOUNT_REQUEST_REASON_FIELD);
  if (reasonRead.kind !== 'value') return fail();
  const reason = reasonRead.value.trim();
  if (reason === '' || reason.length > AMOUNT_REQUEST_REASON_MAX) return fail();
  const requestId = readSingleString(form, AMOUNT_REQUEST_ID_FIELD);
  if (!requestId || !UUID_RE.test(requestId)) return fail();
  return { ...base, reason, requestId: requestId.toLowerCase() };
}
