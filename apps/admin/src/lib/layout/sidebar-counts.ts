import 'server-only';
import { cache } from 'react';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { listRefundExceptions } from '../payment/refund-read';

// sidebar-counts.ts — W1-077:側欄軌上三格數字的唯讀查詢。`app/layout.tsx`(根)每一頁都會渲染,
// 三支查詢因此每次進站都跑。
//
// 🔴 用 React `cache()` 包住 export 的入口(`getSidebarCounts`):同一次 render pass 內對零參數
//    只真的打一次 DB —— 首頁 `page.tsx:36` 本來就會呼叫 `loadTodaySummary()`,
//    而根 layout 又要另外查一次退款異常,不包的話同一組查詢在首頁會跑兩份。
//    下一次 navigation = 新的 request = 新的 cache 生命週期,不會讓數字變舊。
//    admin 全樹當場查證(`grep -rn "from 'react'" apps/admin | grep -w cache`)零既有消費端,
//    只有「別對 idempotency token 用它」的警告(`lib/orders/cancel-request-token.ts:124`)
//    —— 那是反例,不是先例,故本檔照 React 官方 API 自行接、不抄別支檔。
//
// 🔴 訂單那格是三支裡最重的:拋棄式 PG、2000 orders / 6000 order_items 種子量測
//    (EXPLAIN ANALYZE,單發、無 PostgREST/連線開銷,5 次重跑 17.3-18.9ms;
//    2000 是交辦給定值,不是成長推算,正式站現在 19 張單)——
//    `goods_axis` 是逐列相關子查詢,走不了索引,成本隨 orders × items 數量線性長,不是常數。
//    成長軌跡見 backlog #782。
// 🔴 已取消的單不算「未訂貨」:`admin_order_list_v` migration COMMENT(20260814140000:171)
//    逐字要求「A2 下推 goods_axis 時必須同時加 cancelled_at IS NULL」——
//    正式站 2026-08-20 實測 7/19(37%)已取消,不是理論風險。
//
// 🔴 退款異常沿用 `listRefundExceptions()`(../payment/refund-read.ts),不另寫一份述詞。
//    `truncated=true` 時**不得**顯示精確數字:上限 200/50 兩支各自可能被截,
//    合成的 `rows.length` 在截斷時是一個看起來精確的假數字(actionable=5、stuck=51 ⇒
//    顯示「55」,真相 ≥56)。顯示端要靠 `refundExceptionTruncated` 強制降級成「99+」。
//
// 🔴 已下架的商品不算「缺貨」:`products.delisted_at IS NULL` = 上架中,是全站既有慣例
//    (`lib/products/product-repository.ts` 的 `resolveListingState`,rpm-reconcile.ts:101
//    同款軟下架寫法)。已下架的商品不可能被賣、沒有動作可做,算進去會跟「已取消的單不算未訂貨」
//    是同一種假警訊 —— 差別是那格有 migration COMMENT 明文要求,這格只有這行註解當契約。
// 🔴 商品那格沒有可用索引可以幫忙(W1-077 plan §2 效能註記):
//    `idx_products_availability`(`20260507004826_init_products.sql:60`)是 **partial 索引、
//    只蓋 `availability = 'in-stock'`**,查 `out-of-stock` 走不到它、是全表掃。
//    現階段商品數量小(拋棄式量測見下方)可接受;**別讓下一個人以為它有索引可用**。

export type SidebarCounts = {
  /** 未訂貨(goods_axis='none' 且未取消)訂單數;null = 讀取失敗。 */
  unorderedOrderCount: number | null;
  /** 待處理退款異常筆數;null = 讀取失敗。`truncated=true` 時這個數字是下限,不是總數。 */
  refundExceptionCount: number | null;
  refundExceptionTruncated: boolean;
  /** 缺貨商品數;null = 讀取失敗。 */
  outOfStockProductCount: number | null;
  /** 三格全部成功的那一刻(ISO);任一格失敗 ⇒ null(顯示端印「讀取失敗」,不是舊時間戳)。 */
  syncedAt: string | null;
};

/** 把一個「平常回 `{ data, error }`、但 transport 出事會 reject」的 thenable 收成值。 */
function settle<T extends { error: unknown }>(
  p: PromiseLike<T>,
): Promise<T | { data: null; count: null; error: unknown }> {
  return Promise.resolve(p).then(
    (v) => v,
    (error: unknown) => ({ data: null, count: null, error }),
  );
}

/** PostgREST 的 `count` 欄安全轉整數;不是安全整數(含 undefined/型別不對)一律 null = 失敗。 */
function readCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}

/**
 * 側欄三格的資料。三支查詢平行跑、各自獨立失敗:一支掛掉只讓那一格是 `null`,
 * 另外兩格照常顯示(同構 `today-read.ts` 的 `loadTodaySummary`)。
 */
async function loadSidebarCountsUncached(): Promise<SidebarCounts> {
  const supabase = createSupabaseServiceClient();
  const [orders, products, exceptions] = await Promise.all([
    settle(
      supabase
        .from('admin_order_list_v')
        .select('id', { count: 'exact', head: true })
        .eq('goods_axis', 'none')
        .is('cancelled_at', null),
    ),
    settle(
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('availability', 'out-of-stock')
        .is('delisted_at', null),
    ),
    listRefundExceptions().then(
      (r) => ({ ok: true as const, ...r }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  const unorderedOrderCount = orders.error ? null : readCount(orders.count);
  const outOfStockProductCount = products.error ? null : readCount(products.count);
  const refundExceptionCount = exceptions.ok ? exceptions.rows.length : null;
  const refundExceptionTruncated = exceptions.ok ? exceptions.truncated : false;

  if (orders.error) console.error('[sidebar-counts] 訂單讀取失敗', orders.error);
  if (products.error) console.error('[sidebar-counts] 商品讀取失敗', products.error);
  if (!exceptions.ok) console.error('[sidebar-counts] 退款異常讀取失敗', exceptions.error);

  const anyFailed =
    unorderedOrderCount === null || outOfStockProductCount === null || refundExceptionCount === null;

  return {
    unorderedOrderCount,
    refundExceptionCount,
    refundExceptionTruncated,
    outOfStockProductCount,
    syncedAt: anyFailed ? null : new Date().toISOString(),
  };
}

/** 測試直接呼叫這支(未包 `cache()`,每次呼叫都是新的一發)。 */
export const loadSidebarCounts = loadSidebarCountsUncached;

/** `app/layout.tsx` 呼叫這支 —— 同一次 render pass 內去重。 */
export const getSidebarCounts = cache(loadSidebarCountsUncached);
