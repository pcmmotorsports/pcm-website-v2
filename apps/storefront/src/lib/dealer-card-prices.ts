// lib/dealer-card-prices.ts —— 經銷站列表卡片換成經銷價(B2B 計畫第四版 C 節片 5,F 節 Q4 已定:經銷商看經銷價、其他人看一般價)。
//
// 用在不走經銷目錄 RPC 的列表:/search 搜尋結果(含品牌俗名替代結果)、首頁與會員中心「最新商品」、商品頁「相關商品」。
// - 不是 store ⇒ 原樣回傳(一般站在片 9 起一律 general,不會進來)。
// - 卡片顯示的方式與經銷目錄那條路一致:price 直接是經銷價,不劃原價、不標特價、不掛等級標籤。
// - 🔴 取不到經銷價 ⇒ price = null(卡片顯示「—」,5d 會改成「價格暫時無法取得」),**不退回一般價**:
//   結帳收的是經銷價,畫面印一般價就是「看到的與被收的不同」(cac121efb 同一條規矩)。整段失敗也一樣全部 null。
// - 快取的物件不能就地改(會把經銷價留在共用快取裡給下一個人):一律回新物件。
import type { MemberTier } from '@pcm/domain';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import { fetchProductIdsByHandles } from '@/lib/products';
import { fetchEffectivePrices, priceKey } from '@/lib/tier-prices';

// get_effective_prices 一次最多收的 id 數(同商品頁 app/products/[slug]/page.tsx 的 RPC_MAX_IDS)。
const RPC_MAX_IDS = 200;

export async function withDealerCardPrices(items: readonly CatalogCardProduct[], tier: MemberTier): Promise<CatalogCardProduct[]> {
  if (tier !== 'store' || items.length === 0) return [...items];
  let priced = new Map<string, number>();
  let idOf = new Map<string, string>(); // slug ⇒ product uuid
  try {
    const missing = items.filter((p) => !p.productId).map((p) => p.slug);
    const looked = missing.length > 0 ? await fetchProductIdsByHandles([...new Set(missing)]) : new Map<string, string>();
    idOf = new Map(items.map((p) => [p.slug, p.productId ?? looked.get(p.slug) ?? '']));
    const ids = [...new Set([...idOf.values()].filter(Boolean))];
    for (let i = 0; i < ids.length; i += RPC_MAX_IDS) {
      const part = await fetchEffectivePrices({ tier, productIds: ids.slice(i, i + RPC_MAX_IDS), variantIds: [] });
      for (const [k, v] of part) priced.set(k, v);
    }
  } catch (err) {
    console.error('[dealer-card-prices] 取經銷價失敗 ⇒ 這批卡片不印金額(不退回一般價)', {
      count: items.length,
      message: err instanceof Error ? err.message : String(err),
    });
    priced = new Map();
  }
  return items.map((p) => {
    const id = idOf.get(p.slug);
    const amount = id ? priced.get(priceKey('product', id)) : undefined;
    return { ...p, price: amount ?? null, origPrice: null, originalPrice: null, isSale: false, tierLabel: null };
  });
}
