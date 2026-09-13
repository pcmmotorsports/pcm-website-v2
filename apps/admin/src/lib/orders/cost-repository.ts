import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { CostWriteRow, OrderItemCost } from './cost-view';

// cost-repository.ts — `order_item_costs` 的讀(第二發 `.in`)與寫(RPC)。plan §1-b / §1-c。
//
// 🔴 **不併進 `admin_order_list_v`、不進 `ADMIN_ORDER_LIST_SELECT`**:那個 select 被 byte-equal + forbidden-token
//    守門釘死('cost' 是永久 forbidden token, `SupabaseOrderAdapter.test.ts:529-540`)。這裡是列表之外的第二發,
//    只有 `?boss=1` 且 manager 才發(A1 那片的閘;本檔不判身分 —— 表本身 service_role 讀得到,閘在 app 層)。
// 🔴 金額 `::text` 取回:PostgREST 把 numeric 當 JSON number 吐, 4 位小數過 number 會走樣。
// 🔴 讀失敗 ⇒ `readFailed: true` + 讀到一半的 Map,不讓整頁 500 —— 同 `SupabaseOrderAdapter.ts:1470-1500` 那條 `order_balance_base_v` 的寫法。
//    ⚠️ 20260914010000 沒貼的正式庫 ⇒ 42P01 ⇒ `readFailed`。**呼叫端(A2 的 cost-cells island)看到 `readFailed` 要印
//       「成本讀取失敗」而且不開編輯格** —— 「讀不到」與「沒填」是兩個世界,把空格當 0 元送出去會把老闆填過的數蓋掉
//       (codex 2026-09-14 R1 must-fix)。貼了沒的判準在 `scripts/is-migration-applied.sh`。

type LooseClient = {
  from(table: string): {
    select(cols: string): {
      in(col: string, values: readonly string[]): Promise<{ data: unknown; error: unknown }>;
    };
  };
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<{ data: unknown; error: unknown }>;
};

function client(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

const COST_SELECT =
  'order_item_id, cost_price::text, cost_shipping::text, cost_tax::text, currency, fx_rate::text, fx_rate_id, updated_by, updated_at';

/** PostgREST `in` 一次最多帶幾個 id(網址長度);列表一頁 20 張單 × 品項數,遠低於此。 */
const IN_CHUNK = 200;

export type OrderItemCostsRead = {
  costs: Map<string, OrderItemCost>;
  /** true = 至少一批讀失敗;`costs` 是讀到一半的(可能少)。畫面要標「讀取失敗」、不得當「沒填」。 */
  readFailed: boolean;
};

export async function loadOrderItemCosts(orderItemIds: readonly string[]): Promise<OrderItemCostsRead> {
  const out = new Map<string, OrderItemCost>();
  const ids = [...new Set(orderItemIds)];
  if (ids.length === 0) return { costs: out, readFailed: false };
  try {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await client()
        .from('order_item_costs')
        .select(COST_SELECT)
        .in('order_item_id', ids.slice(i, i + IN_CHUNK));
      if (error) throw error;
      if (!Array.isArray(data)) continue;
      for (const r of data) {
        const row = toCostRow(r);
        if (row !== null) out.set(row.orderItemId, row);
      }
    }
  } catch (e) {
    console.error('[admin/orders] 品項成本讀取失敗(畫面標「讀取失敗」,不當「沒填」)', e);
    return { costs: out, readFailed: true };
  }
  return { costs: out, readFailed: false };
}

function toCostRow(r: unknown): OrderItemCost | null {
  const o = r as Record<string, unknown>;
  if (typeof o !== 'object' || o === null) return null;
  if (
    typeof o.order_item_id !== 'string' ||
    typeof o.cost_price !== 'string' ||
    typeof o.cost_shipping !== 'string' ||
    typeof o.cost_tax !== 'string' ||
    typeof o.currency !== 'string' ||
    typeof o.fx_rate !== 'string' ||
    typeof o.updated_by !== 'string' ||
    typeof o.updated_at !== 'string'
  ) {
    return null;
  }
  return {
    orderItemId: o.order_item_id,
    costPrice: o.cost_price,
    costShipping: o.cost_shipping,
    costTax: o.cost_tax,
    currency: o.currency,
    fxRate: o.fx_rate,
    fxRateId: typeof o.fx_rate_id === 'number' ? o.fx_rate_id : null,
    updatedBy: o.updated_by,
    updatedAt: o.updated_at,
  };
}

const MANAGER_GATE_MESSAGE = '無權執行此操作';

/** RPC 回的三種可預期結果;其餘 throw(呼叫端 log + 印一般錯誤)。`message` 是 RPC 的人話(例:「EUR 還沒設過匯率…」)。 */
export type CostWriteOutcome =
  | { kind: 'ok'; written: number }
  | { kind: 'denied' }
  | { kind: 'rejected'; message: string };

export async function setOrderItemCostsViaRpc(
  actorId: string,
  rows: readonly CostWriteRow[],
  requestId: string,
): Promise<CostWriteOutcome> {
  const { data, error } = await client().rpc('admin_set_order_item_costs', {
    p_actor: actorId,
    p_rows: rows.map((r) => ({
      order_item_id: r.orderItemId,
      cost_price: r.costPrice,
      cost_shipping: r.costShipping,
      cost_tax: r.costTax,
      currency: r.currency,
    })),
    p_request_id: requestId,
  });
  if (error) {
    const e = error as { code?: unknown; message?: unknown };
    const message = typeof e.message === 'string' ? e.message : '';
    if (e.code === 'P0001' && message.includes(MANAGER_GATE_MESSAGE)) return { kind: 'denied' };
    // RPC 自己 RAISE 的人話(P0001)⇒ 原句給老闆看(它們是為畫面寫的);其餘(42P01 / 42883 / 網路)⇒ throw
    if (e.code === 'P0001' && message !== '') return { kind: 'rejected', message };
    throw error;
  }
  // 🔴 沒 error 不等於寫了:RPC 契約是 `{result:'ok', written:N}` 且 N = 送進去的列數(每列 upsert 一次)。
  //    形狀不對 ⇒ throw(呼叫端印 cost_error),不印「成本存好了」(codex 2026-09-14 R1 nit 3)。
  const d = data as { result?: unknown; written?: unknown } | null;
  if (d?.result !== 'ok' || d.written !== rows.length) {
    throw Object.assign(new Error('admin_set_order_item_costs 回的形狀不對'), { code: 'COST_RPC_SHAPE', data });
  }
  return { kind: 'ok', written: rows.length };
}
