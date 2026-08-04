// brand-products.ts — 品牌介紹頁商品區的資料來源(D3b;2026-08-04)
//
// 為什麼抽成一支:route(`app/brands/[slug]/page.tsx`)與 dev-preview 兩個掛載點都要撈,
// 而「撈幾筆、怎麼排、用哪個 slug 當篩選鍵」必須是同一份答案 —— 兩邊各寫一次的話,
// 預覽看到的排序與正式站不同,而版面問題正是靠預覽發現的。
//
// 🔴 資料**不是 snapshot**:走與 `/products` 完全同一支 `fetchCatalogPage`
//    (`search_catalog_by_vehicle` RPC → `products_list_public` view)。
//    既有的 `dev-preview/brands/[slug]` 用的是 `BRAND_FIXTURES` 靜態快照(計畫 §5.3 註記),
//    那是舊 showcase 線的東西,本線不沿用。
//
// 🔴 `perPage: 5` 是白名單外的值,但**不是特殊路徑**(信箱 C-26-A 特別要求確認):
//    `CATALOG_PER_PAGE_VALUES`([25,50,75,100])只在 `parseCatalogQuery` 把關**使用者輸入**;
//    本檔是自己組 `CatalogQuery` 物件,不經過那道。RPC 側對 `p_limit` 的處理是
//    `LIMIT LEAST(GREATEST(p_limit, 1), 100)`(migration `20260719150000_catalog_product_image_trim.sql:110,172`)
//    ⇒ 5 落在 [1,100] 內、被原值採用,與白名單值走的是同一條 SQL、無 clamp、無降級。
//
// ⚠️ 每個品牌會多出一組 `unstable_cache` 鍵(key = `JSON.stringify(query)`,見 `lib/products.ts`)。
//    20 家 × 一組、每組只有 5 筆卡片 DTO,離單條 2MB 上限很遠
//    (memory `reference_next16-unstable-cache-force-dynamic-2mb`)。

import type { MockProduct } from '@/data/mock-products';
import { fetchCatalogPage } from '@/lib/products';
import { BRAND_PRODUCT_SLOTS } from '@/lib/brand-url';


/**
 * 該品牌的前 N 筆商品(推薦序)。撈不到或出錯一律回空陣列 —— 呼叫端據此**整區不渲染**,
 * 絕不留一排空骨架(計畫 §7 R7:版面要容忍空槽、不得寫死假值)。
 *
 * 🔴 目前 20 家裡有 5 家在目錄中是 0 筆(dbk / gilles / kineo / rizoma / wrs,2026-08-04 實測),
 *    ⇒ 這條路徑**真的會走到**,不是理論分支。那 5 家的品牌頁怎麼呈現待 Sean 拍(backlog #315)。
 */
export async function fetchBrandTopProducts(brandSlug: string): Promise<MockProduct[]> {
  const { products, error } = await fetchCatalogPage({
    page: 1,
    perPage: BRAND_PRODUCT_SLOTS,
    sort: 'recommend',
    brandSlugs: [brandSlug],
  });
  if (error) return [];
  return products;
}
