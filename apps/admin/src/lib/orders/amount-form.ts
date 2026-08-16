// amount-form.ts — 後台「改品項金額」server action 的純函式核心(M-4b E10 #13 片1c-1;
// 可單測、無 'use server' / next 依賴)。形狀抄 `workflow-form.ts`。
//
// 🔴 **本檔只定「要收哪些值」,不定「畫成幾個輸入框」**(片1c-1 硬約束 1)——
//    後台介面由 OD 重新設計時,版面怎麼排不該讓這支跟著改。
// 🔴 **本檔只出「形狀對不對」,不出任何文案**(硬約束 2)。給員工看的字留給 1c-2,
//    因為那些字會隨改版被重寫,而「收哪些值」不會。
//
// 語意 fail-closed 的權威在 `admin_update_order_item_amount` RPC
// (`supabase/migrations/20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql`)。
// 本檔做的是**形狀層 + 員工手滑層**,不是契約層 —— 兩邊都要在,理由見下方零元那段。

import type { AdminOrderItemAmountPatch } from '@pcm/domain';
// #365 片②:單值欄位的唯一讀法(見 `lib/forms/single-value.ts` 檔頭)。
import {
  type SingleValueFormLike,
  anyMalformed,
  readSingle,
  readSingleString,
} from '../forms/single-value';
// #350d:`return_to` 的守門集中在 order 域共用解析器(五支 action 的 choke point)。
import { ORDER_RETURN_TO_FIELD, parseOrderReturnTo } from './order-return-to';

// ── 表單欄名 ──────────────────────────────────────────────────────────────────
// ⚠️ 這幾顆是 **wire 契約**:改名等於改表單協定,不是重構。
export const AMOUNT_ORDER_ID_FIELD = 'order_id';
export const AMOUNT_ORDER_ITEM_ID_FIELD = 'order_item_id';
export const AMOUNT_VERSION_FIELD = 'version';
export const AMOUNT_UNIT_PRICE_FIELD = 'unit_price';
export const AMOUNT_ZERO_PRICE_REASON_FIELD = 'zero_price_reason';
export { ORDER_RETURN_TO_FIELD as AMOUNT_RETURN_TO_FIELD } from './order-return-to';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** int4 上限;`order_items.unit_price` / `line_total` 與 `orders.subtotal` / `total` 都是 integer。 */
const INT4_MAX = 2147483647;

export type AmountFormLike = SingleValueFormLike;

export type AmountParseResult =
  | {
      ok: true;
      orderId: string;
      expectedVersion: number;
      patch: AdminOrderItemAmountPatch;
      returnTo: string;
    }
  | {
      ok: false;
      /**
       * 🔴 **best-effort 的訂單 id,只為了「被擋下來時導回哪一頁」**(R3/fable F3)。
       *
       * 1c-1 讓 `invalid` 導去 `/orders`(列表),當時**合理** ——
       * 那一片沒有畫面,`invalid` 幾乎只可能是「hidden 欄被竄改」。
       * 🔴 **而 1c-2 讓 `invalid` 變成「員工打字就到得了」** —— 零元忘填原因、打 `1,200`、全形數字…
       * ⇒ **繼承那個決定而沒有重審它,就是「前提已消失的繼承」。**
       *
       * ⚠️ **只在字面是 UUID 時才給值**(否則 `null`)—— 它會被拼進網址,不得原樣信任。
       */
      orderId: string | null;
    };

/**
 * 十進位非負整數字串 ⇒ number;不是的話回 `null`。
 *
 * 🔴 **判的是「值」不是「字串長度」**(2026-08-15 codex 關卡2 R1 must-fix 1):
 * 相鄰的 `workflow-form.ts` 用 `/^\d{1,10}$/`,那條**把 `"00000000001"` 也擋掉了** ——
 * 它是合法的 `1`,只是多了前導零。**擋掉合法值 = 員工看到 `invalid` 而不知道自己錯在哪。**
 * ⚠️ 那支既有檔有同一個誤擋面,**本片沒有動它**(不是本片範圍);記在這裡,免得下一個人
 * 以為兩支不一致是這裡寫錯。
 *
 * 形狀:`/^\d+$/` 先排除小數點 / 負號 / 千分位 / 指數 / 前後空白 / Unicode 數字
 * (`\d` 在 JS 預設只吃 ASCII 0-9);再用 `Number.isSafeInteger` 擋掉長到失去精度的輸入
 * —— 那種輸入**不能**只靠上限比較,因為它在轉成 number 的當下就已經不是原來那個數了。
 */
function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄退回「三態各自處理」,仍 fail-closed 但變成靜默不送、員工看不到 `invalid`
 *    ⇒ 測試拿手寫清單比對這顆常數當完整性守門(同 `WORKFLOW_SINGLE_FIELDS` 先例)。
 * ⚠️ `return_to` **刻意不在清單內**:它決定不了寫什麼、只決定寫完停在哪一頁,
 *    非法值有自己的 fail-closed(`parseOrderReturnTo` 退回本單明細頁)。
 */
export const AMOUNT_SINGLE_FIELDS = [
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_ZERO_PRICE_REASON_FIELD,
] as const;

/** 只認「恰一筆、且字面是 UUID」的 `order_id`;其餘一律 `null`。 */
function bestEffortOrderId(form: AmountFormLike): string | null {
  const raw = readSingleString(form, AMOUNT_ORDER_ID_FIELD);
  return raw && UUID_RE.test(raw) ? raw : null;
}

/**
 * 表單 → `{ orderId, expectedVersion, patch }`(形狀層 + 員工手滑層)。
 *
 * - `order_id` / `order_item_id` 須 UUID;`version` 須 1..2147483646 整數;否則 `ok:false`。
 * - 🔴 `unit_price` **必須是十進位非負整數**且 ≤ int4 上限。
 *   小數 / 負號 / 千分位 / 空白 ⇒ `ok:false`。
 *   ⚠️ 這一條是 backlog `#517`:RPC 只驗 `IS NULL OR < 0`(`:361`)、**沒有驗整數**,
 *   而 TypeScript 的 `number` 不保證整數。**本檔把那條路關掉,但沒有回答「RPC 端會怎樣」**
 *   —— `#517` 因此**不得標為已解**(見該條目)。
 * - 🔴 `zero_price_reason` 的兩道互斥規則(對齊 RPC `:366` / `:371`):
 *   · `unit_price === 0` ⇒ 原因**必須非空白**,否則 `ok:false`;
 *   · `unit_price > 0` ⇒ 原因**必須空白或未提供**,否則 `ok:false`;通過時送**顯式 `null`**。
 *   ⚠️ **這是刻意的重複,不是把契約複製了兩份**:RPC 那兩道是 **API 契約閘**(任何呼叫端都擋),
 *   本檔這兩道是**員工手滑閘**(讓員工看到 `invalid` 而不是一個技術錯誤)。
 *   🔴 **兩邊都要在。** 只留 RPC 那半 ⇒ 員工被擋時只會拿到 `error`;
 *   只留本檔這半 ⇒ 換一個呼叫端就繞過去了。
 * - `return_to`:只接受站內 `/orders...`,否則退回本單明細頁。
 */
export function parseAmountForm(form: AmountFormLike): AmountParseResult {
  const fallbackOrderId = bestEffortOrderId(form);
  const fail = (): AmountParseResult => ({ ok: false, orderId: fallbackOrderId });
  // 🔴 重複 / 非字串欄位在語意層之前擋掉:`zero_price_reason` 是「空 = 沒有原因」的語意,
  //    不先擋就會把形狀錯誤讀成「員工沒填原因」。
  if (anyMalformed(form, AMOUNT_SINGLE_FIELDS)) return fail();

  const orderId = readSingleString(form, AMOUNT_ORDER_ID_FIELD);
  if (!orderId || !UUID_RE.test(orderId)) return fail();

  const orderItemId = readSingleString(form, AMOUNT_ORDER_ITEM_ID_FIELD);
  if (!orderItemId || !UUID_RE.test(orderItemId)) return fail();

  const versionRaw = readSingleString(form, AMOUNT_VERSION_FIELD);
  const expectedVersion = parseNonNegativeInt(versionRaw);
  if (expectedVersion === null || expectedVersion < 1 || expectedVersion > INT4_MAX - 1) {
    return fail();
  }

  // 🔴 #517:整數閘(RPC 只驗 `IS NULL OR < 0`、沒有驗整數)。
  const unitPrice = parseNonNegativeInt(readSingleString(form, AMOUNT_UNIT_PRICE_FIELD));
  if (unitPrice === null || unitPrice > INT4_MAX) return fail();

  // 🔴 零元原因:兩道互斥。未提供該欄 = 沒有原因(與提供空字串同義)。
  const reasonRead = readSingle(form, AMOUNT_ZERO_PRICE_REASON_FIELD);
  const reasonRaw = reasonRead.kind === 'value' ? reasonRead.value.trim() : '';
  if (unitPrice === 0 && reasonRaw === '') return fail();
  if (unitPrice > 0 && reasonRaw !== '') return fail();

  const patch: AdminOrderItemAmountPatch = {
    orderItemId,
    unitPrice,
    // 🔴 送**顯式 null**、不送 undefined:讓「忘了帶」在 adapter 那層變成編譯錯誤
    //    (`Required<…Args>`,見 `SupabaseOrderAdapter.updateAdminOrderItemAmount`)。
    zeroPriceReason: reasonRaw === '' ? null : reasonRaw,
  };

  return {
    ok: true,
    orderId,
    expectedVersion,
    patch,
    returnTo: parseOrderReturnTo(readSingleString(form, ORDER_RETURN_TO_FIELD), orderId),
  };
}
