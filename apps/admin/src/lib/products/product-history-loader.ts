import 'server-only';
import { getAdminAuditLogReader } from '../orders/order-repository';
import { listAllStaff } from '../staff';
import {
  PRODUCT_HISTORY_ACTIONS,
  PRODUCT_HISTORY_LIMIT,
  productHistoryTarget,
  toProductHistoryRows,
  type ProductHistoryRow,
} from './product-history';

// product-history-loader.ts — 商品頁「最近的變更」的讀取(server 端)。顯示層在 `product-history.ts`(純函式、可單測)。
// 🔴 讀不到 ⇒ loadFailed,畫面講「載入失敗」,不吞成空陣列(那會印成「目前沒有變更紀錄」)。
// 員工名單只是快照名字缺失時的備援(20260914110000 起每列自帶名字)⇒ 名單讀不到不算整塊失敗。

export async function loadProductHistory(
  productId: string,
  /** 商品頁乙 C4:把分類變更的 id 翻成名字;沒給就寫「另一個分類」。 */
  categories: readonly { id: string; label: string }[] | null = null,
): Promise<{ rows: ProductHistoryRow[]; loadFailed: boolean }> {
  try {
    const [logs, staff] = await Promise.all([
      getAdminAuditLogReader().listForTarget(
        { target: productHistoryTarget(productId), actions: PRODUCT_HISTORY_ACTIONS },
        PRODUCT_HISTORY_LIMIT,
      ),
      listAllStaff().catch((error: unknown) => {
        console.error('[admin/products/[id]] 員工名單讀取失敗(變更紀錄改用快照名字)', error);
        return [];
      }),
    ]);
    return { rows: toProductHistoryRows(logs, staff, new Map((categories ?? []).map((c) => [c.id, c.label]))), loadFailed: false };
  } catch (error) {
    console.error('[admin/products/[id]] 變更紀錄讀取失敗', error);
    return { rows: [], loadFailed: true };
  }
}
