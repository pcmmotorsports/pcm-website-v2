import type { AdminOrderSummary } from '@pcm/domain';

// order-item-boss-cells.ts — 訂單列表「老闆:成本」六欄的【顯示端】型別 + 讀取入口(A1, 2026-09-14)。
//
// plan `docs/plans/2026-09-14-order-item-cost-columns-plan.md` §1-c / §5:
//   B1(B 窗)= 表 `order_item_costs` + RPC;B2(B 窗)= `cost-repository.ts`(第二發 `.in('order_item_id', ids)`)
//   + `cost-view.ts`(TWD 總計 / 利潤純函式)。A1(本片)只接線:列表照這個型別畫格子。
//
// 🔴 **成本型別不進 `packages/domain`**(plan §1-c 三條紅線是給顧客站也 import 的 domain 用的)⇒ 住 admin 這裡。
// 🔴 **金額一律字串**:成本是 numeric(14,4)、匯率是 numeric;走 JSON number 會丟精度。這裡的字串已經是
//    【顯示用】的樣子(B2 算完、格式化完),表格不再算任何東西 —— 表格零 client、零算式(`orders-table.tsx` 守門)。
// 🔴 `loadOrderItemCostCells` 只准在頁層 **確認過 `isActiveManager` 之後** 呼叫(非管理者不發查詢, plan §1-d)。
//    它吃整份 `orders`(不只 id):利潤 = `line_total − cost_twd`,而 `line_total` 就在 `AdminOrderLine.lineTotal`。

/** 一個品項(`order_items.id`)的六格。缺 = 還沒填成本(畫「—」)。 */
export type OrderItemCostCell = {
  /** 原價(整列, 外幣)。顯示用字串。 */
  costPrice: string;
  /** 運費(整列, 外幣)。 */
  costShipping: string;
  /** 稅金(× 數量, 外幣)。 */
  costTax: string;
  /** 幣別代碼(`EUR` / `USD` / … / `TWD`)。 */
  currency: string;
  /** 寫入當下抄的匯率(顯示用, 例 `35.2`);TWD 是 `1`。 */
  fxRate: string;
  /** 總計 TWD(整數元, 已千分位)。 */
  totalTwd: string;
  /** 利潤 TWD(= line_total − 總計;可為負, 已千分位)。 */
  profitTwd: string;
};

/**
 * `Map<order_items.id, cell>`;`'unreadable'` = 第二發讀失敗 ⇒ 六欄全印「讀不到」,**不讓整頁 500**
 * (plan §1-c 抄 `SupabaseOrderAdapter.ts` 的 `order_balance_base_v` 那條「失敗就落回算不出來」)。
 */
export type OrderItemCostCells = ReadonlyMap<string, OrderItemCostCell> | 'unreadable';

/**
 * 讀這一頁每個品項的成本格。
 *
 * ponytail: B2 還沒到 ⇒ 先回空 Map(= 每一格「—」),讓 A1 的參數 / 閘 / 欄位先接上線。
 * B2 到了把這支換成 `cost-repository` 第二發 + `cost-view` 算 TWD;**簽名不變**,頁層與表格零改。
 */
export async function loadOrderItemCostCells(
  _orders: readonly AdminOrderSummary[],
): Promise<OrderItemCostCells> {
  return new Map();
}
