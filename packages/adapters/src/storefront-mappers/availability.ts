// packages/adapters/src/storefront-mappers/availability.ts
//
// storefront mapper:design 字面 `inStock: boolean` ↔ domain
// `ProductAvailability = 'in-stock' | 'out-of-stock'` 雙向轉換。
//
// 業務拍板(Sean 2026-05-20 M-1-13e-pre-2 Q2=A):
//   M-1-13e Buy Row 真撞 inStock 顯示時抽出、避免 storefront component 散寫
//   `availability === 'in-stock' ? ... : ...` ternary;放 packages/adapters/
//   storefront-mappers/(對齊 backlog #82 預期解法位置、跨 package 共用準備、
//   未來 mobile app / admin UI 消費同 mapper、單一真值源)。
//
// server-only 紀律:純函式、無 server resource / cookies 依賴、不加
// `import 'server-only';`(對齊 packages/adapters/src/supabase/mappers/product.ts
// 既有 mapper 慣例;lib/products.ts 既有 `typeof window` runtime guard 足夠擋
// client bundle 引入)。
//
// 命名沿用 backlog #82 預期解法字面(availabilityToBool / boolToAvailability)、
// 不擅改名 avoid drift。

import type { ProductAvailability } from '@pcm/domain';

/**
 * domain `ProductAvailability` → design 字面 `inStock: boolean`。
 *
 * @param availability - domain string union 字面
 * @returns `true` if `'in-stock'`、`false` if `'out-of-stock'`
 *
 * @see boolToAvailability(反向)
 * @see apps/storefront/src/lib/products.ts toUIProduct L100 用點
 */
export function availabilityToBool(availability: ProductAvailability): boolean {
  return availability === 'in-stock';
}

/**
 * design 字面 `inStock: boolean` → domain `ProductAvailability`。
 *
 * @param inStock - design boolean 字面
 * @returns `'in-stock'` if `true`、`'out-of-stock'` if `false`
 *
 * @see availabilityToBool(反向)
 */
export function boolToAvailability(inStock: boolean): ProductAvailability {
  return inStock ? 'in-stock' : 'out-of-stock';
}
