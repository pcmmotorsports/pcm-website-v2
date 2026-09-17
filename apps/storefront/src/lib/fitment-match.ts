// fitment-match.ts — 商品頁「是否適用我的車」§7 保守比對核心(V-2b;純函式、node 單測)。
//
// 🔴 §7 正確性紅線:錯誤的「✓ 適用」比空白更糟(買錯裝不上=信任毀)。規則:
//  - 名稱字面 NFKC 精確比對(V-2h/MF-1):checkFitment 吃車款「名稱字面」(brandName/modelName),
//    以 vehicle-match.normalizeVehicleQuery(trim+NFKC 全形半形+小寫)對 fitment.motoBrand/modelCode
//    做精確全等比對。**廢除 slugify 橋接**——slugify 會把「MT 09」與「MT-09」壓成同一 slug(mt-09),
//    而 taxonomy uniqueId 對撞加序號(mt-09 / mt-09-2)後名稱字面才是消歧的唯一真相;回 slug 比對
//    會丟失序號 → 選 A 車命中 B 車 fitment 的假 ✓(codex MF-1)。名稱字面 NFKC 保留「空白≠連字號」
//    的區分,是「比對一律回字典字面」(vehicle-context 檔頭原契約)的正解;slug 僅留 URL/id 用途。
//  - 年份判定一律呼 domain matchFitmentYear / isYearUnrestricted(年份語意單一來源;storefront 禁自寫
//    任何年份判定行=S4 語意分叉教訓)。使用者單年=退化區間 {yearStart:Y, yearEnd:Y}。
//  - 車種鐵律:零模糊/相似度/AI 猜;查無=保守方向('no-match' ✗ 未列,非 undetermined)。
//  - display-only:呼叫端只顯示、不寫庫、不擋加入購物車。

import { matchFitmentYear, isYearUnrestricted } from '@pcm/domain';
import { isOpenEndedYear } from '@/lib/open-ended-year';
import { normalizeVehicleQuery } from '@/lib/vehicle-match';
import type { UIFitment } from '@/data/mock-products';

/** 消費者選車(dict=名稱字面,來自 vehicle-context.brandName/modelName;free=自由輸入/車庫舊自由文字)。 */
export type FitmentCheckVehicle =
  | { kind: 'dict'; brandName: string; modelName?: string; year?: number }
  | { kind: 'free' };

/**
 * 判定四態(§7):
 * - match       車型+年份命中(或車型命中且含不限年份 fitment)→「✓ 適用」
 * - no-match    車型未列 / 車型列了但該年份不合 →「✗ 未列」
 * - qualified   車型命中、但命中 fitments 皆年份受限而使用者未給年份 → 禁 bare ✓、顯「請確認年份」
 * - undetermined 自由輸入 / brandName·modelName 不齊 → 不自動判定、走「人工確認」
 */
export type FitmentCheckStatus = 'match' | 'no-match' | 'qualified' | 'undetermined';

/**
 * 名稱字面 NFKC 精確比對:車型層命中的 fitments(brand+model 名稱字面正規化後全等)。
 * 🔴 判定(checkFitment)與顯示層的「開放年提示」(hasOpenEndedHit)共用**同一份命中集** ——
 *    兩邊各寫一次過濾 = 兩份比對,遲早漂(S4 語意分叉教訓)。
 */
function modelHitsOf(fitments: UIFitment[], v: FitmentCheckVehicle): UIFitment[] {
  if (v.kind === 'free' || !v.brandName || !v.modelName) return [];
  const bn = normalizeVehicleQuery(v.brandName);
  const mn = normalizeVehicleQuery(v.modelName);
  return fitments.filter(
    (f) => normalizeVehicleQuery(f.motoBrand) === bn && normalizeVehicleQuery(f.modelCode) === mn,
  );
}

/**
 * 命中這台車的 fitment 裡有沒有**開放年**(供應商只寫起始年、沒寫結束年)。
 * 顯示層拿它把「✓ 適用您的 2027 F850GS」從我們的保證,改成轉述供應商的說法
 * (Sean 2026-09-17 拍乙)。🔴 **不影響判定** —— checkFitment 回什麼一個字都沒變。
 */
export function hasOpenEndedHit(fitments: UIFitment[], v: FitmentCheckVehicle): boolean {
  return modelHitsOf(fitments, v).some(isOpenEndedYear);
}

export function checkFitment(fitments: UIFitment[], v: FitmentCheckVehicle): FitmentCheckStatus {
  // 自由輸入 → 不判定(§7:人工確認)
  if (v.kind === 'free') return 'undetermined';
  // REQUIRED-2:brandName 且 modelName 齊全才判定;缺 modelName(brand-only/選車中途)禁 brand-level ✓
  if (!v.brandName || !v.modelName) return 'undetermined';

  const modelHits = modelHitsOf(fitments, v);
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
