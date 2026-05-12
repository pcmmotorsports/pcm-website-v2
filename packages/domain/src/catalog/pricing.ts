import type { Product } from './types';
import type { MemberTier, Money } from '../shared/types';
import { toMoneyAmount } from '../shared/types';

/**
 * computeEffectivePrice: tier-aware 顯示價計算(catalog 層 pure function)。
 *
 * **角色:** server-side dispatch、storefront 內算好 effective price、防經銷價洩漏 client bundle
 * (對齊 docs/architecture/supabase-schema-design.md §6.1 priceByTier 不洩漏鐵則 +
 * docs/specs/M-1-03-main-a-刀-4-PRD.md §1.1 Q2=C + Q4=C 拍板)。
 *
 * **字面源(真權威):**
 * - `design-reference/components/Pricing.jsx` L27-42(getPriceForTier 三 tier dispatch + premium_extra_pct fallback 0%)
 * - `docs/architecture/supabase-schema-design.md` §3.1 brands 表 L167 註解(`store × (1 - premium_extra_pct / 100)`)
 * - `docs/architecture/supabase-schema-design.md` §5.1 PriceByTier 設計 L257(`premiumStore` 由 storefront 動態算)
 * - `packages/domain/src/catalog/types.ts` Brand L29 JSDoc(`premium 顯示價 = round(priceByTier.store.amount × (1 - premium_extra_pct / 100))`)
 *
 * **公式:**
 * - `'general'` → `priceByTier.general`
 * - `'store'` → `priceByTier.store`
 * - `'premiumStore'` → `{ amount: Math.round(store.amount × (1 - brand.premium_extra_pct / 100)), currency: store.currency }`
 *
 * **邊界(對齊 design L37-39):** `premium_extra_pct` 非 number 時 fallback 0%、即 premiumStore 顯示價 = store 價。
 *
 * **字面 vs 事實揭示:**
 * 1. design 公式吃 number、本實作收 Product 物件 + 返 Money brand(toMoneyAmount guard)、currency 對齊 store tier
 * 2. design L29 `if (!pbt) return product.price || 0; // legacy fallback` 不採:domain Product.priceByTier 必存、無 legacy 路徑
 * 3. design L114 `Object.assign(window, ...)` prototype 路徑不採、本實作 ES module export
 * 4. design L33 tier 字面 `'premium_store'` snake_case、本實作 `'premiumStore'` camelCase(對齊 shared/types.ts MemberTier enum)
 *
 * @param product Product entity(含 brand + priceByTier)
 * @param tier MemberTier enum(`'general'` | `'store'` | `'premiumStore'`)
 * @returns Money(tier-aware 顯示價、currency 對齊 store tier)
 *
 * @example
 * computeEffectivePrice(product, 'general')      // → product.priceByTier.general
 * computeEffectivePrice(product, 'store')        // → product.priceByTier.store
 * computeEffectivePrice(product, 'premiumStore') // → { amount: round(store × (1 - brand.premium_extra_pct / 100)), currency: 'TWD' }
 *
 * @see design-reference/components/Pricing.jsx L27-42
 * @see docs/architecture/supabase-schema-design.md §3.1 + §5.1
 * @see packages/domain/src/catalog/types.ts Brand.premium_extra_pct
 */
export function computeEffectivePrice(product: Product, tier: MemberTier): Money {
  if (tier === 'general') return product.priceByTier.general;
  if (tier === 'store') return product.priceByTier.store;
  // tier === 'premiumStore'
  const storePrice = product.priceByTier.store;
  const extraPct =
    typeof product.brand.premium_extra_pct === 'number'
      ? product.brand.premium_extra_pct
      : 0;
  const resultAmount = Math.round(storePrice.amount * (1 - extraPct / 100));
  return {
    amount: toMoneyAmount(resultAmount),
    currency: storePrice.currency,
  };
}
