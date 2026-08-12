// order-number-format.ts — 訂單編號的**兩條形狀 regex**(新格式 + 舊格式)的唯一 TS 來源。
//
// 🔴 **為什麼這兩條要自己一個檔、不直接寫進 `display-id.ts`**:
//    同一組形狀原本散落三處(D0 migration 的 CHECK、搜尋正規化、`display-id.ts`)。
//    CHECK 那份活在 DB 裡無法共用,但 TS 側沒有理由有兩份 —— 各寫一份的結局必然是
//    某天改了字母表卻只改到其中一處。`display-id.test.ts` 有一組**原始碼掃描守門**
//    釘住這件事:`display-id.ts` 必須 import、且檔內不得出現 regex 字面。
//    ⇒ 把它們搬進 `display-id.ts` 會讓那道守門失去對象,所以它們留在獨立模組。
//
// ⚠️ **本檔的來歷(#347-B)**:這兩條原本住在 `order/order-number-search.ts`。
//    那支模組隨 Sean 拍板 Q-347-B1=B(收掉訂單編號專用搜尋欄)整支刪除,
//    但**它匯出的不只是搜尋用的正規化函式** —— 這兩條 regex 有一個與搜尋無關的活消費者
//    (`display-id.ts` 的 `isValidDisplayId`)。⇒ 搬到這裡、名字改成它真正在做的事。
//    🔴 教訓:盤「這支模組還有沒有人用」時,要逐一盤**它的每個匯出**,
//       不能只盤那個代表性的函式名 —— 我第一輪就是這樣把它誤判成孤兒的。

/**
 * 舊格式:`PCM-YYYY-NNNN`(年份 4 碼 + 流水號至少 4 碼)。
 * 與 D0 migration 的 `orders_legacy_display_id_format` CHECK 同一形狀。
 */
export const LEGACY_ORDER_NUMBER_RE = /^PCM-\d{4}-\d{4,}$/;

/**
 * 新格式:固定 6 碼、28 字元字母表(去 `0O1IL` 易混淆、去 `AEU` 母音;v2 §5.4a)。
 * 與 D0 migration 放寬後的 `orders_display_id_format` CHECK 新格式分支同一形狀。
 */
export const ORDER_NUMBER_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/;
