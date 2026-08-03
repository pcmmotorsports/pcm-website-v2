import type { AdminOrderItemProcurement } from '@pcm/domain';
import { sortSuppliersByLabel, type SupplierOption } from '../supplier';
import type { ProcurementSupplierChoice } from './procurement-view';

// procurement-suppliers.ts — M-4b E10 A10b:採購表單的供應商選單合併。
//
// 🔴🔴 **本檔只能在 server component 用**:它 import `lib/supplier.ts`(→ `supplier-repository.ts`
//    → `import 'server-only'`)。client 端要的純函式在 `procurement-view.ts`,兩檔刻意分開。
//    (施工當場踩到:原本兩者同檔,一被 client 表單 import 就會把 server-only 拖進 bundle。)
//
// 🔴 為什麼不自己排序:`supplier.ts:44-52` 明文 `sortSuppliersByLabel` 是**本專案唯一排序入口**,
//    另建一份 collator 會讓兩組「結果順序」測試同時綠、而它們排的是兩份可各自漂移的規則。

export type { SupplierOption };

/**
 * 合併供應商選單 = 啟用中的供應商 ∪ 本品項既有採購已指向的供應商(即使已停用)。
 *
 * 🔴 **停用的供應商必須留在選單裡**(前提是本品項已經有一列指向它):
 *    S1b `:183` 明文業務鍵不阻止採購指向已停用者,而 A5a 只擋「新建」與「調升 allocated」
 *    —— 事實記錄欄(回覆狀態 / 單號 / 異常原因 / 預計到貨)**照常可以更新**,
 *    而且停用之後往往正是要密集記錄「這家怎麼了」的時候(A5a `:326` 逐字)。
 *    ⇒ 若照 `listSuppliers()` 的啟用清單直接畫選單,那一列就**永遠改不了**了。
 *
 * 🔴 `supplierLabel` 為 null(A9a-2:內嵌沒回來)時用 id 前 8 碼當顯示名 ——
 *    不得省略該項(同樣會讓那列改不了),也不得顯示成空白(選單上「看不見卻選得到」)。
 */
export function buildSupplierChoices(
  activeSuppliers: readonly SupplierOption[],
  procurements: readonly AdminOrderItemProcurement[],
): ProcurementSupplierChoice[] {
  const byId = new Map<string, ProcurementSupplierChoice>();
  for (const s of activeSuppliers) {
    byId.set(s.id, { id: s.id, label: s.label, inactive: false });
  }
  for (const p of procurements) {
    if (byId.has(p.supplierId)) continue;
    byId.set(p.supplierId, {
      id: p.supplierId,
      label: p.supplierLabel ?? `(未知供應商 ${p.supplierId.slice(0, 8)})`,
      // 🔴 `supplierIsActive === null` = 內嵌沒回來 = **不知道**,不得靜默當啟用中
      //    (A9a-2 domain 型別註解逐字)⇒ 一律標記,由 A5a 當第二道。
      inactive: p.supplierIsActive !== true,
    });
  }
  return sortSuppliersByLabel([...byId.values()]);
}
