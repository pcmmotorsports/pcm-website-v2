// lib/breadcrumb-jsonld.ts — 商品詳情頁的 schema.org/BreadcrumbList(M-4b GEO)
//
// 🔵 **為什麼這一格不是「為了分數硬加」**:站上**畫面本來就有麵包屑**
//   (`components/ProductBreadcrumb.tsx` 的 `nav`)⇒ 補結構化資料是**如實描述已經存在的東西**。
//   ⇒ 📌 與「加一個假作者 / 假發布日」分屬兩類:那些是造一個站上不存在的事實。
//
// 🔴🔴 **JSON-LD 走的是【正規路徑】,不是畫面上那條會變的麵包屑。**
//   畫面那條吃 `?from=` 共 8 種來源(從品牌進來、從搜尋進來、從推薦進來…)⇒ **同一顆商品
//   會有 8 種麵包屑**。而 `BreadcrumbList` 要講的是「這一頁在網站結構裡的位置」,那只有一個。
//   ⇒ 首頁 › 商品目錄 › 分類主 › 分類次 › 商品名。
//   ⇒ 🛑 拿畫面那條去餵,等於告訴 Google「這頁的位置取決於客人從哪裡點進來」——那不成立。
//
// 🔴 **分類的拆法與畫面共用同一支** `splitProductCategory()`(見下)——
//   `ProductBreadcrumb.tsx` 原本自己 `.split('·')`,而**各寫一份的那天不會有東西叫**:
//   兩邊都畫得出麵包屑,只是層級不一樣。

import type { MockProduct } from '@/data/mock-products';
import { safeJsonLd } from '@/lib/json-ld';

/**
 * `'引擎部品 · 排氣管'` → `{ main: '引擎部品', sub: '排氣管' }`。
 *
 * 🔵 **單一定義點**:`ProductBreadcrumb.tsx` 與本檔吃同一支。
 *   ⚠️ 空字串 / 無分隔號的行為與原字面逐字相同:`main` 退回 `'商品'`、`sub` 為 `''`。
 *   (原字面在 `ProductBreadcrumb.tsx:33-34`,本函式是把那兩行搬出來、行為未改。)
 */
export function splitProductCategory(category: string | undefined): { main: string; sub: string } {
  return {
    main: (category || '').split('·')[0]?.trim() || '商品',
    sub: (category || '').split('·')[1]?.trim() || '',
  };
}

type Crumb = { name: string; path?: string };

/**
 * 商品詳情頁的 BreadcrumbList。
 *
 * @param base `resolveSiteUrl()`;`undefined` ⇒ 回 `null`(不吐相對網址的麵包屑,
 *   與 canonical / OG 那幾格的休眠一致)。
 *
 * 🔵 **最後一階(商品本身)刻意不帶 `item`** —— Google 的 breadcrumb 指南:最後一個是
 *   當前頁,不需要連回自己。中間每一階都帶絕對網址。
 * 🔴 **分類階只在分類真的存在時才放** —— 硬塞一個「商品」層等於發明一個站上沒有的分類頁。
 */
export function buildBreadcrumbJsonLd(
  product: MockProduct,
  base: string | undefined,
): Record<string, unknown> | null {
  if (!base) return null;

  const { main, sub } = splitProductCategory(product.category);
  const crumbs: Crumb[] = [
    { name: '首頁', path: '/' },
    { name: '商品目錄', path: '/products' },
  ];
  // 分類頁的網址形狀與目錄頁的 canonical 同一套(`?categories=`,見 `catalog-canonical.ts`)。
  if (product.category) {
    if (main !== '商品') crumbs.push({ name: main, path: `/products?categories=${encodeURIComponent(main)}` });
    if (sub) crumbs.push({ name: sub, path: `/products?categories=${encodeURIComponent(sub)}` });
  }
  crumbs.push({ name: product.name });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: `${base}${c.path}` } : {}),
    })),
  };
}

/** 序列化(escape `<` 防 `</script>` breakout,與 Product / Organization 同源)。 */
export function serializeBreadcrumbJsonLd(
  product: MockProduct,
  base: string | undefined,
): string | null {
  const jsonLd = buildBreadcrumbJsonLd(product, base);
  return jsonLd ? safeJsonLd(jsonLd) : null;
}
