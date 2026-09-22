import { anyMalformed, readSingleString, type SingleValueFormLike } from '../forms/single-value';
import { ORDER_RETURN_TO_FIELD, parseOrderReturnTo } from './order-return-to';

// item-swap-form.ts — 換商品表單解析(形狀層;是否能換由資料庫函式判斷)。

export const ITEM_SWAP_ORDER_ID_FIELD = 'order_id';
export const ITEM_SWAP_ITEM_ID_FIELD = 'order_item_id';
export const ITEM_SWAP_VERSION_FIELD = 'version';
export const ITEM_SWAP_NEW_VARIANT_FIELD = 'new_variant_id';
/** 畫面打開對話框時產生的操作編號;同一次送出重送時沿用, 資料庫函式靠它回上次的結果。 */
export const ITEM_SWAP_REQUEST_ID_FIELD = 'swap_request_id';
export { ORDER_RETURN_TO_FIELD as ITEM_SWAP_RETURN_TO_FIELD };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT4_MAX = 2147483647;

const SINGLE_FIELDS = [
  ITEM_SWAP_ORDER_ID_FIELD,
  ITEM_SWAP_ITEM_ID_FIELD,
  ITEM_SWAP_VERSION_FIELD,
  ITEM_SWAP_NEW_VARIANT_FIELD,
  ITEM_SWAP_REQUEST_ID_FIELD,
] as const;

export type ItemSwapParseResult =
  | {
      ok: true;
      orderId: string;
      itemId: string;
      expectedVersion: number;
      newVariantId: string;
      requestId: string;
      returnTo: string;
    }
  | { ok: false; orderId: string | null };

export function parseItemSwapForm(form: SingleValueFormLike): ItemSwapParseResult {
  const rawOrderId = readSingleString(form, ITEM_SWAP_ORDER_ID_FIELD);
  const orderId = rawOrderId && UUID_RE.test(rawOrderId) ? rawOrderId : null;
  const fail = (): ItemSwapParseResult => ({ ok: false, orderId });
  if (orderId === null || anyMalformed(form, SINGLE_FIELDS)) return fail();

  const itemId = readSingleString(form, ITEM_SWAP_ITEM_ID_FIELD);
  const newVariantId = readSingleString(form, ITEM_SWAP_NEW_VARIANT_FIELD);
  const requestId = readSingleString(form, ITEM_SWAP_REQUEST_ID_FIELD);
  if (!itemId || !UUID_RE.test(itemId)) return fail();
  if (!newVariantId || !UUID_RE.test(newVariantId)) return fail();
  if (!requestId || !UUID_RE.test(requestId)) return fail();

  const versionRaw = readSingleString(form, ITEM_SWAP_VERSION_FIELD);
  if (versionRaw === null || !/^\d+$/.test(versionRaw)) return fail();
  const expectedVersion = Number(versionRaw);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > INT4_MAX - 1) return fail();

  return {
    ok: true,
    orderId,
    itemId,
    expectedVersion,
    newVariantId,
    requestId: requestId.toLowerCase(),
    returnTo: sameOrderReturnTo(parseOrderReturnTo(readSingleString(form, ORDER_RETURN_TO_FIELD), orderId), orderId),
  };
}

/**
 * 共用的 parseOrderReturnTo 只核對 `panel`, 不核對 `open`;這裡再擋一層:
 * 返回網址若展開的是別張訂單(或 `open` 帶了兩個以上), 就退回這張訂單的詳細頁 ——
 * 否則 A 單的結果提示會出現在 B 單上, 結果不明時員工會核對錯單。
 */
function sameOrderReturnTo(returnTo: string, orderId: string): string {
  const q = returnTo.indexOf('?');
  if (q < 0) return returnTo;
  const opens = new URLSearchParams(returnTo.slice(q + 1)).getAll('open');
  if (opens.length === 0) return returnTo;
  if (opens.length === 1 && opens[0]?.toLowerCase() === orderId.toLowerCase()) return returnTo;
  return `/orders/${orderId}`;
}
