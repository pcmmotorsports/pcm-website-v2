// vehicle-options.ts — 車款下拉選項的排序/攤平規則(桌機選車列與手機選車面板共用)。
//
// 存在理由:ADR-0007 桌機決定 3 與手機決定 3 都要求「年份最新在前」。若兩邊各自
// `[...years].sort((a, b) => b - a)`,日後只改一邊 = 桌機新到舊、手機舊到新,而兩邊
// 的測試各自都是綠的(沒有任何一條會比較兩者)。故排序只有一個定義點。
//
// 🔴 車種鐵律:本檔不做任何猜測或改寫 —— 只排序與攤平,候選恆為字典字面
//   (比對邏輯一律在 lib/vehicle-match、攤平在 lib/garage-chip,本檔不重複實作)。

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import { flattenVehicleModels } from '@/lib/garage-chip';

/**
 * 車型的年份、最新在前。
 *
 * 不 mutate 傳入的 `years`(字典物件跨元件共用、就地 sort 會污染其他消費端,
 * 包含 server 端快取的 taxonomy)。model 未定 / 無年份 → 空陣列
 * (呼叫端據此走「不限年份」出口)。
 */
export function yearsNewestFirst(model: MockMotoModel | undefined): number[] {
  return [...(model?.years ?? [])].sort((a, b) => b - a);
}

/**
 * 車型欄的選項空間 —— **尚未選廠牌時改為跨層**(V-1f「打 r6 直達車款」)。
 *
 * 🔴 為什麼要共用:桌機選車列與手機選車面板都要這個行為(Sean 2026-07-30 逐字
 * 「電腦版也要可以直接輸入車款,目前只有輸入廠牌」)。兩邊各寫一份 = 兩份車款比對邏輯,
 * 正是交接檔明文禁止的「第二套車款比對」。字面空間一律取自 `garage-chip.flattenVehicleModels`
 * (與愛車建議清單同一顆),本檔不自己攤平、不自己比對。
 *
 * @param brandName 已選定的廠牌字面;null = 未選 → 跨層
 */
export function modelFieldOptions(
  motoBrands: MockMotoBrand[],
  brandName: string | null,
): { crossLayer: boolean; options: string[] } {
  const brand = brandName != null ? motoBrands.find((b) => b.name === brandName) : undefined;
  if (brand !== undefined) {
    return { crossLayer: false, options: brand.models.map((m) => m.name) };
  }
  return { crossLayer: true, options: flattenVehicleModels(motoBrands).map((e) => e.label) };
}

/**
 * 車型欄選定後要落成哪一組 brand/model。
 * 跨層時 `picked` 是「品牌 車型」label ⇒ 反查字典項、同時補上廠牌(字典字面直出、零猜);
 * 非跨層時 `picked` 就是車型名、廠牌沿用傳入值。查無 → null(呼叫端不套用)。
 */
export function resolveModelPick(
  motoBrands: MockMotoBrand[],
  brandName: string | null,
  picked: string,
): { brand: string; model: string } | null {
  const { crossLayer } = modelFieldOptions(motoBrands, brandName);
  if (!crossLayer) {
    return brandName === null ? null : { brand: brandName, model: picked };
  }
  const entry = flattenVehicleModels(motoBrands).find((e) => e.label === picked);
  return entry ? { brand: entry.brand.name, model: entry.model.name } : null;
}
