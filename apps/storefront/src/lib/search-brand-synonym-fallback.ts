import { fetchCatalogPage } from '@/lib/products';
import { BRANDS_PARAM, parseCatalogQuery } from '@/lib/catalog-query';
import type { ParsedFacets } from '@/lib/parse-search-facets';
import type { CatalogCardProduct } from '@/lib/catalog-page';

// 品牌俗名退路 —— 搜尋框疊層(`/api/search`)與 `/search` 結果頁共用一份(2026-09-15)。
// 🔴 為什麼抽出來:Sean 2026-09-15 Q3「阿卡、蠍子管、蠍子、碳蠍 都要當 Akrapovič 搜」,
//    而原本只有疊層有這條退路 ⇒ 疊層列出 Akrapovic、按 Enter 到 /search 卻寫「沒有找到」。
//    兩個畫面各寫一份判準 ⇒ 會漂;所以判準與取數只住在這裡。
// 🔵 不另加 `import 'server-only'`:它只呼叫 `@/lib/products`(本身就是 server 端取數), 兩個呼叫端都是 server。
// 🛑 呼叫端只在【文字搜尋 0 筆且沒有出錯】時才呼叫;這裡再擋:只認【俗名】解出來的品牌
//    (客人打真品牌名今天本來就有字面命中,那條路不動)。

/** 回 null = 不走退路(沒有俗名品牌 / 目錄撈失敗);呼叫端照原本的「沒有找到」畫。 */
export async function fetchBrandSynonymFallback(
  parsed: ParsedFacets,
  limit: number,
): Promise<{
  items: CatalogCardProduct[];
  total: Awaited<ReturnType<typeof fetchCatalogPage>>['total'];
  brandIds: readonly string[];
} | null> {
  if (parsed.brandIds.length === 0 || !parsed.usedSynonyms.some((s) => s.kind === 'brand')) {
    return null;
  }
  const byBrand = await fetchCatalogPage(
    parseCatalogQuery(new URLSearchParams({ [BRANDS_PARAM]: parsed.brandIds.join(',') })),
    null,
    'general',
  );
  if (byBrand.error) return null;
  return { items: byBrand.products.slice(0, limit), total: byBrand.total, brandIds: parsed.brandIds };
}
