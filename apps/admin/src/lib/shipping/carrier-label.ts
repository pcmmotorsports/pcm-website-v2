// #10:貨運商代碼 → 中文標籤。
//
// 🔴🔴 **本體已於 2026-08-22 搬到 `packages/domain/src/order/carrier-label.ts`(M-4b E4-b)。**
//    **這支檔刻意留著,而且它不是為了相容性留的。**
//
// 搬的理由:出貨通知信那條鏈整條在 `packages/use-cases` → `apps/storefront`,
// 而 `packages` 不可反向 import app、storefront 也不可 import admin
// ⇒ 值留在 admin 的話,信件那一側只能**再手抄一份**。
// 而本檔原本的檔頭花了 20 行在講「這個值域曾經有五份手抄」,逐字:
//   「**每一次重數都又漏一種形狀,而每次都覺得這次總該數完了**」
// ⇒ 再抄一份就是第六份。**搬走的是值,而理由跟著一起搬過去了。**
//
// 🔴 **為什麼還留這支檔**:那 20 行的讀者是「將來要新增貨運商的人」,而**他會先打開 admin**
//    (三個消費端都在 admin)。整支刪掉的話,他找不到那段理由,只會看到一個 import。
//    ⇒ 這一段就是那個指標。**要改值或加代碼,去 `packages/domain/src/order/carrier-label.ts`。**
//    ⚠️ 而完備性守門(對 DB CHECK 的那一道)仍在 `./carrier-label.test.ts` —— 它經本檔 import,
//      守的是同一個物件。
//
// ⚠️ **不要在這裡加任何邏輯。** 這支檔只准是 re-export;
//    一旦有人在這裡加一個「admin 專用的標籤」,值域就又變成兩份了。

export { CARRIER_LABEL, CARRIER_OPTIONS, carrierLabelOf } from '@pcm/domain';
export type { CarrierCode } from '@pcm/domain';
