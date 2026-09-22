import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { AdminOrderDetail } from '@pcm/domain';
import { getManualOrderCatalogHitsByVariantIds } from './manual-order-catalog';

// item-swap-offers.ts — 訂單頁要對哪些品項顯示「換商品」入口, 以及原商品目前的目錄價(plan 2026-09-22)。
//
// 🔴 這只決定【畫面上給不給入口】;真正能不能換由資料庫函式 admin_swap_order_item 在鎖住之後判斷
//    (migration 20260922100000 第 4 節那一串條件)。這裡照同一串條件先篩一次, 目的是
//    「給了入口就不會因為這些原因必然被擋」—— 條件改了要兩邊一起改。
// 🔴 寧可少給:任何一發讀取失敗 ⇒ 回 null ⇒ 整張單都不顯示入口, 員工照舊用取消重建。

export type ItemSwapOffer = {
  /** 原商品目前的一般售價(含稅);null = 沒有定價。 */
  sourceCatalogGeneral: number | null;
  /** 原商品目前的經銷價(未稅);null = 沒有經銷價。 */
  sourceCatalogDealerUntaxed: number | null;
};

type LooseResult = Promise<{ data: unknown; error: unknown }>;
type LooseQuery = {
  eq(col: string, value: string): LooseQuery;
  in(col: string, values: readonly string[]): LooseQuery;
  is(col: string, value: null): LooseQuery;
  limit(n: number): LooseQuery;
} & LooseResult;
type LooseClient = { from(table: string): { select(cols: string): LooseQuery } };

function client(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

/** 每一發最多讀幾列;讀滿就當成「可能被截斷」⇒ 丟錯 ⇒ 整張單不給入口(不拿不完整的資料下判斷)。 */
const ROW_CAP = 500;

async function rows(q: LooseQuery): Promise<Record<string, unknown>[]> {
  const { data, error } = await q.limit(ROW_CAP);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('回傳不是陣列');
  if (data.length >= ROW_CAP) throw new Error(`讀到 ${data.length} 列, 可能被截斷`);
  return data as Record<string, unknown>[];
}

const REFUNDED_STATUSES: readonly string[] = ['refunded', 'partiallyRefunded'];

export async function readItemSwapOffers(
  detail: Pick<AdminOrderDetail, 'id' | 'cancelledAt' | 'paymentStatus' | 'items'>,
): Promise<ReadonlyMap<string, ItemSwapOffer> | null> {
  const none = new Map<string, ItemSwapOffer>();
  if (detail.cancelledAt !== null || REFUNDED_STATUSES.includes(detail.paymentStatus)) return none;
  const itemIds = detail.items.map((i) => i.id);
  if (itemIds.length === 0) return none;
  try {
    const c = client();
    const [orders, items, summaries, procurements, shipments, cancels, amountRequests, refunds, refundJobs, manualRefunds] =
      await Promise.all([
        rows(c.from('orders').select('tier_at_checkout').eq('id', detail.id)),
        rows(c.from('order_items').select('id, variant_id').eq('order_id', detail.id)),
        rows(
          c
            .from('order_item_quantity_summary')
            .select('order_item_id, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity')
            .in('order_item_id', itemIds),
        ),
        rows(c.from('order_item_procurement').select('order_item_id').in('order_item_id', itemIds)),
        rows(c.from('shipment_items').select('order_item_id').in('order_item_id', itemIds)),
        rows(c.from('order_cancellation_items').select('order_item_id').eq('order_id', detail.id)),
        rows(c.from('order_amount_requests').select('order_item_id').eq('order_id', detail.id)),
        rows(c.from('order_refunds').select('id').eq('order_id', detail.id)),
        rows(c.from('order_refund_jobs').select('id').eq('order_id', detail.id)),
        rows(c.from('order_manual_refunds').select('id').eq('order_id', detail.id).is('voided_at', null)),
      ]);
    const tier = orders[0]?.tier_at_checkout;
    if (orders.length !== 1 || typeof tier !== 'string') throw new Error('讀不到這張單的會員等級');
    // 整張單有任何退款紀錄 ⇒ 全部不給(品項層的退款明細一定掛在這兩張表頭底下)。
    if (refunds.length > 0 || refundJobs.length > 0 || manualRefunds.length > 0) return none;

    const blocked = new Set<string>();
    for (const r of [...procurements, ...shipments, ...cancels, ...amountRequests]) {
      if (typeof r.order_item_id !== 'string') throw new Error('關聯列缺 order_item_id');
      blocked.add(r.order_item_id);
    }
    for (const s of summaries) {
      if (typeof s.order_item_id !== 'string') throw new Error('摘要列缺 order_item_id');
      const qty = [s.ordered_quantity, s.instock_quantity, s.cancelled_quantity, s.shipped_quantity];
      if (qty.some((n) => typeof n !== 'number')) throw new Error('摘要列數量不是數字');
      if (qty.some((n) => n !== 0)) blocked.add(s.order_item_id);
    }

    const variantByItem = new Map<string, string>();
    for (const it of items) {
      if (typeof it.id !== 'string') throw new Error('品項列缺 id');
      // 原商品規格已被刪(variant_id 是 null)⇒ 無法確認同價 ⇒ 不給。
      if (typeof it.variant_id === 'string') variantByItem.set(it.id, it.variant_id);
    }
    const hits = await getManualOrderCatalogHitsByVariantIds([...new Set(variantByItem.values())]);
    const hitByVariant = new Map(hits.map((h) => [h.variantId, h]));

    const offers = new Map<string, ItemSwapOffer>();
    for (const id of itemIds) {
      if (blocked.has(id)) continue;
      const variantId = variantByItem.get(id);
      const hit = variantId === undefined ? undefined : hitByVariant.get(variantId);
      if (hit === undefined) continue;
      // 與資料庫同一套取價(store ⇒ 經銷價, 沒有就一般價;其他 ⇒ 一般價);取不到 ⇒ 必定被擋 ⇒ 不給。0 元是合法價格。
      const catalogPrice = tier === 'store' ? (hit.dealerPriceUntaxed ?? hit.unitPrice) : hit.unitPrice;
      if (catalogPrice === null) continue;
      offers.set(id, { sourceCatalogGeneral: hit.unitPrice, sourceCatalogDealerUntaxed: hit.dealerPriceUntaxed });
    }
    return offers;
  } catch (e) {
    console.error('[admin/orders/item-swap] 換商品入口的資料讀不到(整張單不顯示入口)', e);
    return null;
  }
}
