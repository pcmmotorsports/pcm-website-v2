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
 * 🔵 「我確定要上架這支」——【確認】那道的通行證(板 `⟦b4-NOVARIANT1⟧`, Sean `Q2=甲`)。
 *
 * 🔴🔴 **它必須是【員工主動勾的 checkbox】, 不得由畫面自動送**(codex 2026-08-31 R1 #1 must-fix)。
 *    ⛔ ~~我第一版把它做成 hidden 自動夾帶 `'true'`~~ —— 那不是「員工按了我確定」,
 *      是**畫面幫他確定了** ⇒ 📌 **那道確認等於不存在。**
 *    🛑 而最毒的是它【會產生正確的訊號】:畫面上有警示文字、測試裡「帶確認⇒放行」那格是綠的、
 *      commit 訊息寫「加了確認步驟」而字面完全誠實 —— **四個地方都說它在,
 *      而沒有任何一個人做過那個動作。**
 */
export const LISTING_CONFIRM_FIELD = 'confirm_variant_sku_collision';
/**
 * 🔵 員工按下確定的**那一刻,畫面上寫的是哪一支商品**(對方的料號)。
 *
 * 🔴 **為什麼要送它**(codex R1 #5):只送一個布林 ⇒ 畫面顯示 A、而資料在他讀那句話之後變成 B,
 *    action 仍然照放 —— 那是 stale confirmation(TOCTOU)。
 *    ⇒ 送出他**看到的那個值**, server 端比對現在算出來的是不是同一個。
 * 📌 **⇒ 他確認的是【那一句話】, 不是「我要上架」。**
 */
export const LISTING_CONFIRM_OWNER_FIELD = 'confirm_variant_sku_owner';

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
  | {
      ok: true;
      productId: string;
      delisted: boolean;
      note: string | null;
      returnTo: string;
      /** 🔵 員工已經看過「這支看起來是別支商品的規格」並【主動勾了】確定。 */
      confirmed: boolean;
      /** 🔵 他勾的那一刻, 畫面上寫的是哪一支商品(對方料號);沒送 ⇒ `null`。 */
      confirmOwner: string | null;
    }
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
  LISTING_CONFIRM_FIELD,
  LISTING_CONFIRM_OWNER_FIELD,
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
    // 🔴 **只認一個字面 `'true'`** —— 而不是「有沒有這一欄」:
    //    checkbox 沒勾時瀏覽器【根本不送這一欄】, 而勾了送 'on';
    //    我們讓畫面送死值 'true', 任何其他值(含空字串、'on'、'false')一律當【沒確認】。
    //    ⇒ 📌 失敗方向朝「再問一次」, 而不是朝「放行」。
    confirmed: readString(form, LISTING_CONFIRM_FIELD) === 'true',
    // 🔴 原樣帶走, 不做任何正規化 —— 這一欄的用途是【和 server 現在算出來的比對】,
    //    而任何「順手洗一下」都會讓兩邊在不同的字面上比較。
    confirmOwner: readString(form, LISTING_CONFIRM_OWNER_FIELD) || null,
  };
}
