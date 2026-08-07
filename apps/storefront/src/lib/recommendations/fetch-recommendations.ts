import 'server-only';

import { createSupabaseAnonClient, SupabaseProductAdapter } from '@pcm/adapters';
import type { MockProduct } from '@/data/mock-products';
import { RuleBasedRecommendationEngine } from './rule-based-engine';
import type { VehicleSelection } from './types';

/**
 * N°03 相關商品推薦 server 端接線(R3、對齊 plan §5 資料流)。
 *
 * 職責:把 route 已知的 handle + 選定車輛,轉成 domain 反查 → 引擎排序 → client 安全 UIProduct 清單。
 *
 * 🔴 引擎吃 domain Product(codex #3:UI product 無 brand.id uuid、Case B 反查同品牌需之)→
 *   本函式以 `adapter.findByHandle(handle)` 重取 domain Product(route 的 fetchProductByHandle 回的是
 *   已 strip 的 MockProduct)。詳情頁多一次 findByHandle 查詢(handle UNIQUE indexed、成本低;
 *   若未來要省可與 route 主查共用 domain product,stopgap #51)。
 *
 * 🔴 經銷價安全:引擎輸出已 `toUIProduct(p,'general')` strip;本函式只轉 items → MockProduct[]。
 * 🔴 降級:任何 throw(DB 斷線/RLS/找不到)→ 回 `{items:[],hasMore:false}`(推薦區條件隱藏、
 *   不 crash 整頁;引擎內部 repo 呼叫亦已 try/catch,此層再兜一次 findByHandle 與意外)。
 *
 * @param handle    當前商品 handle(= slug);一律排除自身
 * @param vehicle   選定車輛(URL ?vehicle 經 taxonomy 解回原始名);undefined = Case B 同品牌
 * @param limit     上限(N°03 = 8、plan Q2=A)
 */
export async function fetchRecommendedProducts(
  handle: string,
  vehicle: VehicleSelection | undefined,
  limit = 8,
): Promise<{ items: MockProduct[]; hasMore: boolean }> {
  try {
    const client = createSupabaseAnonClient();
    const adapter = new SupabaseProductAdapter(client);
    const product = await adapter.findByHandle(handle); // domain Product(含 brand.id)
    if (!product) return { items: [], hasMore: false };

    const engine = new RuleBasedRecommendationEngine(adapter);
    const result = await engine.recommend({
      placement: 'pdp-related',
      context: { product, vehicle, excludeHandles: [handle] },
      limit,
    });
    return { items: result.items.map((i) => i.product), hasMore: result.hasMore };
  } catch (err) {
    console.error('[fetchRecommendedProducts] recommendation fetch failed:', err);
    return { items: [], hasMore: false };
  }
}
