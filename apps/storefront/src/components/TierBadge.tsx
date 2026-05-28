// TierBadge.tsx — 三級會員徽章(M-1-14e-g-2)
//
// 字面從 design-reference/components/TierComponents.jsx L9-35 直接搬;
// 殼 + CSS class 對齊 design tier.css L1-33(搬至 storefront styles/tier.css)。
//
// 為何收 camelCase MemberTier(packages/domain/src/shared/types.ts L70)而非 design 的
// snake_case `premium_store`:storefront / DB / domain 一律 camelCase 真權威、design 的
// snake_case 是「視覺端歷史字面」、用 schemaTierToDesign 做邊界 mapping(對齊 ADR-0003
// §3.1.1 + designTierToSchema/schemaTierToDesign 既有 helper、不重做 mapping)。
//
// 為何不抽到 packages/ui:packages/ui 目前無 .tsx 元件 + 無 react 依賴、抽會擴 slice scope;
// g-2 只一處用、未來 Phase 2 admin 真需 cross-app 時再升 packages/ui。

import { schemaTierToDesign } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';

export type TierBadgeSize = 'sm' | 'md' | 'lg';

export type TierBadgeProps = {
  tier: MemberTier;
  size?: TierBadgeSize;
};

// 對齊 design TIER_META label 規則(L31):
// - premium_store → en label 「PREMIUM STORE」
// - general / store → zh label 「一般會員」/「店家會員」
const TIER_LABEL: Record<MemberTier, string> = {
  general: '一般會員',
  store: '店家會員',
  premiumStore: 'PREMIUM STORE',
};

// design class 字面(L13/L18/L22)= tier-badge-${designKey},
// 但 premium_store 對應 class 為 tier-badge-premium(非 tier-badge-premium_store、design 既定簡寫);
// 用 schemaTierToDesign 取得 designKey + 簡寫對映、避免重做 camel/snake mapping。
function designClsFromTier(tier: MemberTier): string {
  const designKey = schemaTierToDesign(tier); // 'general' | 'store' | 'premium_store'
  const suffix = designKey === 'premium_store' ? 'premium' : designKey;
  return `tier-badge-${suffix}`;
}

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  return (
    <span className={`tier-badge tier-badge-${size} ${designClsFromTier(tier)}`}>
      {TIER_LABEL[tier]}
    </span>
  );
}
