// fitment-match.ts — 商品頁「是否適用我的車」§7 保守比對核心(V-2b;純函式、node 單測)。
//
// 🔴 §7 正確性紅線:錯誤的「✓ 適用」比空白更糟(買錯裝不上=信任毀)。規則:
//  - slug 同源橋接:slugify(fitment.motoBrand/modelCode) vs 消費者 brandId/modelId(皆 taxonomy slug、
//    與 URL/context 同空間;重用 lib/vehicle-taxonomy.slugify、同 ProductPage vehiclePill 先例;
//    禁混空間直接比、禁自寫正規化)。
//  - 年份判定一律呼 domain matchFitmentYear / isYearUnrestricted(年份語意單一來源;storefront 禁自寫
//    任何年份判定行=S4 語意分叉教訓)。使用者單年=退化區間 {yearStart:Y, yearEnd:Y}。
//  - 車種鐵律:零模糊/相似度/AI 猜;查無=保守方向('no-match' ✗ 未列,非 undetermined)。
//  - display-only:呼叫端只顯示、不寫庫、不擋加入購物車。

import { matchFitmentYear, isYearUnrestricted } from '@pcm/domain';
import { slugify } from '@/lib/vehicle-taxonomy';
import type { UIFitment } from '@/data/mock-products';

/** 消費者選車(dict=slug 空間,來自 vehicle-context;free=自由輸入/車庫舊自由文字)。 */
export type FitmentCheckVehicle =
  | { kind: 'dict'; brandId: string; modelId?: string; year?: number }
  | { kind: 'free' };

/**
 * 判定四態(§7):
 * - match       車型+年份命中(或車型命中且含不限年份 fitment)→「✓ 適用」
 * - no-match    車型未列 / 車型列了但該年份不合 →「✗ 未列」
 * - qualified   車型命中、但命中 fitments 皆年份受限而使用者未給年份 → 禁 bare ✓、顯「請確認年份」
 * - undetermined 自由輸入 / brandId·modelId 不齊 → 不自動判定、走「人工確認」
 */
export type FitmentCheckStatus = 'match' | 'no-match' | 'qualified' | 'undetermined';

export function checkFitment(fitments: UIFitment[], v: FitmentCheckVehicle): FitmentCheckStatus {
  // 自由輸入 → 不判定(§7:人工確認)
  if (v.kind === 'free') return 'undetermined';
  // REQUIRED-2:brandId 且 modelId 齊全才判定;缺 modelId(brand-only/選車中途)禁 brand-level ✓
  if (!v.brandId || !v.modelId) return 'undetermined';

  // slug 同源橋接:車型層命中的 fitments(brand+model 皆 slug 相等)
  const modelHits = fitments.filter(
    (f) => slugify(f.motoBrand) === v.brandId && slugify(f.modelCode) === v.modelId,
  );
  if (modelHits.length === 0) return 'no-match'; // 車型未列(安全方向 ✗)

  if (v.year !== undefined) {
    // 使用者給年:退化區間呼 domain matchFitmentYear(不自寫年份比較)
    const actual = { yearStart: v.year, yearEnd: v.year };
    // 🔴 yearEnd 直傳(null=開放式 2025+ 語意;禁 ?? undefined 塌成單年);matchFitmentYear 收 number|null|undefined
    const anyYear = modelHits.some((f) =>
      matchFitmentYear(actual, { yearStart: f.yearStart, yearEnd: f.yearEnd }),
    );
    return anyYear ? 'match' : 'no-match'; // 車型列了但年份不合=✗(REQUIRED-3 反向)
  }

  // 使用者年份未知:唯有命中含不限年份 fitment(domain 判定)才可 bare ✓;否則保守 qualified
  const hasUnrestricted = modelHits.some((f) => isYearUnrestricted(f));
  return hasUnrestricted ? 'match' : 'qualified';
}
