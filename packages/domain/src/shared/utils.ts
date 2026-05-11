/**
 * @module @pcm/domain/shared/utils — 跨層字面 mapping 工具
 *
 * design 視覺真權威(snake_case)與 schema/domain(camelCase)之間的 tier 字面 mapping。
 *
 * 三層字面分歧背景:
 * - schema / wire / TS type: `'premiumStore'`(camelCase、`MemberTier` 列舉真權威、shared/types.ts L70)
 * - 後台 UI / 業務語意:高級店家(中文)
 * - design-handoff 慣例:`'premium_store'`(snake_case、design Pricing.jsx / TierComponents.jsx / WalletTab.jsx 字面)
 *
 * 對齊 lessons-learned.md §12-5 + working-style.md 第 15 條三層字面對應教訓。
 *
 * 跨 package re-export 規則:domain/src/index.ts 必加具名
 * `export { designTierToSchema, schemaTierToDesign }`(對齊 ADR-0003 §3.1.1
 * runtime helper 規則、避免 M-1-02 toMoneyAmount typecheck fail 同類踩坑)。
 *
 * @see docs/lessons-learned.md §12-5
 * @see docs/working-style.md §6.3 第 15 條
 * @see packages/domain/src/shared/types.ts:MemberTier
 * @see design-reference/components/Pricing.jsx
 */

import type { MemberTier } from './types';

/**
 * design 視覺真權威 tier 字面(snake_case)→ schema/domain tier 列舉(camelCase)。
 *
 * design Pricing.jsx / TierComponents.jsx / WalletTab.jsx 用 `'premium_store'` snake_case、
 * schema/domain MemberTier 用 `'premiumStore'` camelCase(對齊 packages/domain/src/shared/types.ts:70)。
 * 對齊 lessons §12-5 + working-style.md 第 15 條三層字面對應教訓。
 *
 * mapping table:
 * - `'general'`       → `'general'`
 * - `'store'`         → `'store'`
 * - `'premium_store'` → `'premiumStore'`
 *
 * 非法輸入處置:throw TypeError、不 fallback 不回 null(對齊 toMoneyAmount 嚴格 guard 慣例)。
 *
 * @param design tier 字面(`'general'` | `'store'` | `'premium_store'`)
 * @returns MemberTier(`'general'` | `'store'` | `'premiumStore'`)
 * @throws TypeError 若 design tier 不在 3 個合法值內
 */
export function designTierToSchema(design: string): MemberTier {
  switch (design) {
    case 'general':
      return 'general';
    case 'store':
      return 'store';
    case 'premium_store':
      return 'premiumStore';
    default:
      throw new TypeError(
        `designTierToSchema: invalid tier ${JSON.stringify(design)}, expected 'general' | 'store' | 'premium_store'`,
      );
  }
}

/**
 * schema/domain MemberTier(camelCase)→ design 視覺真權威 tier 字面(snake_case)。
 *
 * 反向 mapping、storefront 需要傳 tier 字串給 design 元件時用。
 *
 * mapping table:
 * - `'general'`       → `'general'`
 * - `'store'`         → `'store'`
 * - `'premiumStore'`  → `'premium_store'`
 *
 * exhaustive check 用 `never` assertion(TypeScript 編譯時擋未列舉 case;
 * runtime 不應到 default、若到表示 MemberTier 列舉擴張未同步本函式)。
 *
 * @param tier MemberTier(`'general'` | `'store'` | `'premiumStore'`)
 * @returns design tier 字面(`'general'` | `'store'` | `'premium_store'`)
 * @throws TypeError 若 tier 不在 MemberTier 列舉內(unreachable、防 MemberTier 擴張未同步)
 */
export function schemaTierToDesign(
  tier: MemberTier,
): 'general' | 'store' | 'premium_store' {
  switch (tier) {
    case 'general':
      return 'general';
    case 'store':
      return 'store';
    case 'premiumStore':
      return 'premium_store';
    default: {
      // exhaustive check:MemberTier 列舉若擴張、此處 TypeScript 編譯時 fail
      const _exhaustive: never = tier;
      throw new TypeError(
        `schemaTierToDesign: unreachable tier ${String(_exhaustive)}`,
      );
    }
  }
}
