// product-listing-form.ts — 後台上下架 server action 的純函式核心(M-4b `#20`;可單測、無 'use server'/next 依賴)。
//
// authz(session / Origin / actor)在 action 檔;本檔只做「表單 → RPC 參數」的**形狀層**。
// 語意 fail-closed 的權威在 `admin_set_product_listing` RPC(migration `20260819040000`),此處是縱深不是唯一防線。
//
// 🔴 **與 tier 樣板【刻意不同】的一件:變更原因是【選填】。**
//    樣板 `tier-form.ts:66` 逐字 `if (note === '' …) return { ok: false }` —— 那是 Sean `Q2=A` 對 tier 拍的必填。
//    而上下架**沒有那個拍板**,migration `20260819040000` 的 `1b` 逐字寫明理由:
//      「上下架是**每天會做很多次**的操作,而 Sean 沒有對它拍過『必填』」
//    ⇒ 這裡照 RPC 的設計做成選填。**要改成必填的話,RPC 那邊也是一行**(同段註解逐字寫了)。
//
// 🔴 **為什麼 delisted 用 hidden input 帶字面,不用原生 checkbox**:
//    原生 checkbox 未勾時**整個欄位不送**、勾了送 `'on'` ⇒ 兩種都不是 `'true'`/`'false'`
//    ⇒ 每一次都會 `ok:false`。既有前例=`staff-edit-row.tsx` 的 `String(!current)`
//    (`docs/phase-1-backlog.md` 的 S3b-3「開工前必讀」②逐字記過這個坑)。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';

// ── 表單欄名(商品詳情頁「上架狀態」那一格的表單用)──
export const LISTING_PRODUCT_ID_FIELD = 'product_id';
export const LISTING_DELISTED_FIELD = 'delisted';
export const LISTING_NOTE_FIELD = 'note';
export const LISTING_RETURN_TO_FIELD = 'return_to';

/**
 * 🔴 上下架線**專屬**的結果碼:同狀態再按一次、而員工**打了備註** ——
 * RPC 走 `NO_CHANGE` 零寫入 ⇒ **那段字哪裡都沒有**(2026-08-19 拋棄式 PG 實測:
 * 稽核表裡提到那句備註的列數 = `0`)。
 *
 * ⚠️ **不能與裸 `noop` 共用一則** —— 那會讓員工以為他留了紀錄,而世界上沒有。
 * (命名與「有常數就用常數」的體例照 `NOTE_ADDED_RESULT_CODE` / `REFUND_SUBMITTED_RESULT_CODE`。)
 */
export const LISTING_NOOP_NOTE_DROPPED_RESULT_CODE = 'listing_noop_note_dropped';

/** 變更原因長度上限(與 RPC `1b` 的 `char_length(v_note) > 200` 一致)。 */
export const LISTING_NOTE_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListingToggleParseResult =
  | { ok: true; productId: string; delisted: boolean; note: string | null; returnTo: string }
  | { ok: false };

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 *
 * ⚠️ 而這裡**確實需要**擋門(不是照抄樣板):`note` 是**選填**,
 * 它的 `null` 在下游代表**放行**(送 NULL 給 RPC)而不是「形狀錯」
 * ⇒ 少了擋門的話,`note` 送兩份會被 `readSingleString` 收斂成 `null`
 *   ⇒ **同一欄送兩份反而比送一份更容易通過**。
 * (判準逐字在 `lib/forms/single-value.ts` 檔頭:「先問這個欄位的 null 在下游代表放行還是代表拒」。)
 */
export const LISTING_SINGLE_FIELDS = [
  LISTING_PRODUCT_ID_FIELD,
  LISTING_DELISTED_FIELD,
  LISTING_NOTE_FIELD,
  LISTING_RETURN_TO_FIELD,
] as const;

/** 只接受站內 `/products` 路徑(鏡像 `parseCustomersReturnTo`);非法 → 退 `/products`。 */
export function parseProductsReturnTo(raw: FormDataEntryValue | null): string {
  const v = typeof raw === 'string' ? raw : null;
  return v && !v.includes('..') && /^\/products(\/[^\s]*)?(\?[^\s]*)?$/.test(v) ? v : '/products';
}

/**
 * 表單 → `{ productId, delisted, note }`(形狀層;語意權威在 RPC):
 * - `product_id` 須 UUID,否則 `ok:false`;
 * - `delisted` 須**嚴格等於** `'true'` 或 `'false'`(`'on'` / `'1'` / 缺席一律 `ok:false`);
 * - `note` **選填**:未給或 trim 後為空 ⇒ `null`;>200 字 ⇒ `ok:false`;
 * - `return_to` 只接受站內 `/products` 路徑。
 */
export function parseListingToggleForm(form: FormLike): ListingToggleParseResult {
  if (anyMalformed(form, LISTING_SINGLE_FIELDS)) return { ok: false };

  const productId = readString(form, LISTING_PRODUCT_ID_FIELD);
  if (!productId || !UUID_RE.test(productId)) return { ok: false };

  const delistedRaw = readString(form, LISTING_DELISTED_FIELD);
  if (delistedRaw !== 'true' && delistedRaw !== 'false') return { ok: false };

  const noteRaw = (readString(form, LISTING_NOTE_FIELD) ?? '').trim();
  if (noteRaw.length > LISTING_NOTE_MAX) return { ok: false };
  // 🔴 零寬/格式字:JS `trim()` 吃 Unicode White_Space 全集,而 NEL/零寬/格式字**不算** whitespace
  //    ⇒ 「看似空白」的原因在此收斂成 `null`,而不是送一串隱形字給 RPC。
  //    語意權威=RPC 的 `v_ws` 31 字元全集(`20260819040000` 的 `1b`)。
  const noteVisible = noteRaw.replace(/[\u0085\u180E\u200B\u200C\u200D\u2060\uFEFF]/g, '').trim();
  const note = noteVisible === '' ? null : noteRaw;

  return {
    ok: true,
    productId,
    delisted: delistedRaw === 'true',
    note,
    returnTo: parseProductsReturnTo(readString(form, LISTING_RETURN_TO_FIELD)),
  };
}
