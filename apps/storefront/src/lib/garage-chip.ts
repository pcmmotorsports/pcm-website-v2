// garage-chip.ts — 愛車 chip 點擊決策(V-1c/V-1d 邏輯單一來源)。
// 首頁 VehicleFinder(V-1c)+ 型錄「我的愛車」鈕(V-1e)共用同一顆決策腦、外殼依掛載點變形。
//
// 🔴 車種鐵律:只做字面正規化比對(NFKC/prefix/substring,經 vehicle-match),零模糊/相似度/AI 猜。
// 分支順序逐字對齊原 VehicleFinder.onGarageChip(18877be):
//   dict 精確 lookup 快路徑 → REQUIRED-2 唯一精確命中(全名→車型名雙鍵)→ 多/零命中建議清單。
// 年份閘門(車庫 year=自由文字 → 僅四位數字且在字典年份內才帶入)一併收進本函式,
//   外殼不得自行 parse year(值班台 nit-1:回傳 year 恆為已通過閘門的 number | undefined)。

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import { filterVehicleOptions, uniqueExactMatch, vehicleLabel } from '@/lib/vehicle-match';

/** 愛車 chip 決策所需的車庫最小面(序列化收窄、無 PII)。 */
export type GarageVehicleInput = {
  name: string;
  year: string;
  dictBrandName: string | null;
  dictModelName: string | null;
};

/** 套用結果:已解析的品牌/車型名稱字面 + 已通過閘門的年份。 */
export type GarageChipApply = {
  kind: 'apply';
  brand: string;
  model: string;
  year: number | undefined;
};

/** 多/零命中:展開建議清單讓客人明選(entries=字典 label 字面)。 */
export type GarageChipSuggest = {
  kind: 'suggest';
  query: string;
  entries: string[];
  garageYear: number | undefined;
};

export type GarageChipResult = GarageChipApply | GarageChipSuggest;

/** 攤平字典一項:每車型 brand+model 與「品牌 車型」label(跨層搜尋/建議清單共用字面空間)。 */
export type FlatVehicleEntry = { brand: MockMotoBrand; model: MockMotoModel; label: string };

/**
 * 攤平字典:每車型一項(brand+model 與「品牌 車型」label)。
 * 愛車 chip 建議清單(本檔)+ 手機抽屜跨層直搜(FilterDrawerVehicleTab、V-1f)共用同一顆——
 * 打字在「品牌 車型」字面空間跨層命中(打 r6 直達車款),車種鐵律零猜、字典字面直出。
 */
export function flattenVehicleModels(motoBrands: MockMotoBrand[]): FlatVehicleEntry[] {
  return motoBrands.flatMap((b) =>
    b.models.map((m) => ({ brand: b, model: m, label: vehicleLabel(b.name, m.name) })),
  );
}

/** 車庫 year=自由文字 → 僅四位數字才為候選年份、其餘 undefined(零猜)。 */
function parseGarageYear(raw: string): number | undefined {
  const t = raw.trim();
  return /^\d{4}$/.test(t) ? Number(t) : undefined;
}

/** 已定 brand/model + 車庫候選年份 → 年份僅在字典 years 內才帶入。 */
function resolveApply(
  brand: MockMotoBrand,
  model: MockMotoModel,
  garageYear: number | undefined,
): GarageChipApply {
  const year = garageYear != null && model.years.includes(garageYear) ? garageYear : undefined;
  return { kind: 'apply', brand: brand.name, model: model.name, year };
}

/**
 * 愛車 chip 點擊 → 套用 or 建議清單(決策腦、無 React/DOM 依賴 → node 單測)。
 */
export function resolveGarageChip(
  motoBrands: MockMotoBrand[],
  garage: GarageVehicleInput,
): GarageChipResult {
  const entries = flattenVehicleModels(motoBrands);
  const garageYear = parseGarageYear(garage.year);

  // V-1d 分流:dict 欄有值(存車時 server 已驗)→ 名稱字面精確 lookup 直套(零比對);
  // lookup 查無(字典演化:改名/下架)→ 降級走下方 REQUIRED-2 字面比對流、零猜不硬配。
  if (garage.dictBrandName !== null && garage.dictModelName !== null) {
    const brand = motoBrands.find((b) => b.name === garage.dictBrandName);
    const model = brand?.models.find((m) => m.name === garage.dictModelName);
    if (brand && model) {
      return resolveApply(brand, model, garageYear);
    }
  }

  // 唯一精確命中(正規化=trim/大小寫/全形半形)才自動套用:先比「品牌 車型」全名、再比車型名。
  const exact =
    uniqueExactMatch(entries, garage.name, (e) => e.label) ??
    uniqueExactMatch(entries, garage.name, (e) => e.model.name);
  if (exact) return resolveApply(exact.brand, exact.model, garageYear);

  // 多/零命中 → 建議清單(字典字面經正規化 substring 過濾;客人明選=零猜)。
  const hits = filterVehicleOptions(entries, garage.name, (e) => e.label);
  return {
    kind: 'suggest',
    query: garage.name,
    entries: hits.slice(0, 12).map((e) => e.label),
    garageYear,
  };
}

/**
 * V-2h/MF-5 車庫自動預填(spec §2「登入會員有唯一車或 primary 車 → 預填」):
 * 唯一車(garage.length===1)或 primary 車 → 經 resolveGarageChip 唯一精確解析成 dict apply 才回;
 * 否則 null(>1 台且無 primary=不猜 / 無法唯一解析〔free 文字·字典演化〕=不預填、車種鐵律零猜)。
 * 純函式、無 React 依賴 → node 單測;呼叫端(CartView)只補未填列、不覆蓋 search 帶入。
 */
export function resolveGaragePrefillVehicle(
  motoBrands: MockMotoBrand[],
  garage: (GarageVehicleInput & { isPrimary: boolean })[],
): GarageChipApply | null {
  if (garage.length === 0) return null;
  const chosen = garage.length === 1 ? garage[0] : garage.find((g) => g.isPrimary);
  if (!chosen) return null; // >1 台且無 primary → 不猜
  const r = resolveGarageChip(motoBrands, chosen);
  return r.kind === 'apply' ? r : null; // 無法唯一解析(free 文字/字典演化)→ 不預填
}

/**
 * 建議清單點選:label(字典字面)→ entry → apply(garageYear 同閘門帶入)。
 * label 查無(理論不達:entries 恆源自 flattenVehicleModels)→ null,呼叫端不套用。
 */
export function resolveSuggestionLabel(
  motoBrands: MockMotoBrand[],
  label: string,
  garageYear: number | undefined,
): GarageChipApply | null {
  const entry = flattenVehicleModels(motoBrands).find((e) => e.label === label);
  return entry ? resolveApply(entry.brand, entry.model, garageYear) : null;
}
