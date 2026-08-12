/**
 * @module @pcm/domain/order/display-id — 人類可讀訂單編號的**驗證**(不再負責產生)
 *
 * ## 兩種格式永久並存(2026-07-30 Sean 拍板 Q1=A)
 *
 * - **舊格式** `PCM-YYYY-NNNN`：2026-07-30 以前由 `create_order` RPC 的序號產生器產出，
 *   正式站現存 30 張。
 * - **新格式** 6 碼亂碼：E10 §5.4a 合約(28 字元字母表、無前綴)，
 *   由 **`public.pcm_generate_display_id()`** 產出。動機 = 客人不能從編號推測年營業量。
 *
 * 🔴 **本模組必須永久同時接受兩種格式。** 舊的 30 張訂單不會被改號
 * (`docs/specs/2026-07-30-order-renumber-instead-of-delete.md` 拍板 Q1=A)，
 * 而 `assertDisplayId` 是 `createOrder` factory 的建構守門(`order.ts`)——
 * 只認新格式會讓 Order entity **無法承載真實的舊訂單**。
 *
 * ⚠️ 規格 `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.4b 的 N2 字面
 * 寫「換成新格式 only」，那個字面**建立在 N3c 會把 DB CHECK 收緊的前提上**；
 * Q1=A 之後 N3c 不做 ⇒ 該字面已作廢，改為兩收。理由詳
 * `docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md` §2a。
 *
 * ## 為什麼這裡不再有「產號」與「解析」
 *
 * - ~~`formatDisplayId(year, seq)`~~ **已刪除**：唯一功能是組舊格式，且零生產呼叫端。
 *   產號從此**只有一個生產者** = DB 的 `pcm_generate_display_id()`；
 *   TS 側不該有能力生單號(生出來的號碼不經 `orders_display_id_key` 就沒有唯一性保證)。
 * - ~~`parseDisplayId(value)`~~ **已刪除**：「從編號反推年份 / 流水號」只對舊格式有意義，
 *   新格式**刻意不帶任何可推導資訊**(那正是改制的目的)。留著它等於留一個
 *   對新格式必然失敗、且語意上不該存在的 API。
 *
 * 🔴 **搜尋既有訂單請用關鍵字搜尋**(`admin_search_orders` 的 #1 新單號 / #12 舊單號 分支)——
 * 原本那支 `./order-number-search` 已隨 #347-B(Q-347-B1=B)刪除,兩條 regex 移到
 * `./order-number-format`。本模組只做「這個字串是不是一個合法的 displayId」這件事。
 *
 * @see packages/domain/src/order/order-number-format.ts — 兩條 regex 的唯一來源
 * @see packages/domain/src/order/types.ts:DisplayId
 * @see docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.4a — 新格式合約
 */

import type { DisplayId } from './types';
import { OrderError } from './errors';
import { LEGACY_ORDER_NUMBER_RE, ORDER_NUMBER_RE } from './order-number-format';

/**
 * isValidDisplayId：檢查字串是否為合法訂單編號(新舊兩種格式皆可)。不 throw。
 *
 * 🔴 **regex 刻意 import 自 `order-number-format`、不在本檔重寫一份**：
 * 同一組形狀原本會散落三處(D0 migration 的 CHECK、搜尋、本檔)。
 * CHECK 那份活在 DB 裡無法共用，但 TS 這兩份沒有理由不共用 ——
 * 各寫一份的結局必然是某天改了字母表卻只改到其中一處(`feedback_claimed-sync-but-only-patched-touched-lines`)。
 * 共用之後，「改字母表」在 TS 側只有**一個**落點。
 */
export function isValidDisplayId(value: string): boolean {
  return ORDER_NUMBER_RE.test(value) || LEGACY_ORDER_NUMBER_RE.test(value);
}

/**
 * assertDisplayId：驗證並回傳 branded `DisplayId`；非法 throw。
 *
 * 先 `typeof` 守門：封 `new String('PCM-…')` wrapper —— `RegExp.test` 會把 wrapper
 * 強制轉字串而誤判合法，但 wrapper 帶隱藏 `toJSON` 可在 `JSON.stringify(order)` 偷渡序列化字串。
 * (此守門與格式無關，換格式後**照樣必要**。)
 *
 * @throws OrderError code `invalid_display_id`
 */
export function assertDisplayId(value: string): DisplayId {
  if (typeof value !== 'string' || !isValidDisplayId(value)) {
    throw new OrderError(
      'invalid_display_id',
      `displayId must be 6-char new format or legacy PCM-YYYY-NNNN, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}
