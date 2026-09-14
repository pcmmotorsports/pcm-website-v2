// lib/vehicle-tree-payload.ts — `/products` 送給 client 的車款樹瘦身(plan
// `docs/plans/2026-09-14-products-payload-vehicle-tree-on-demand-plan.md` P2)。
//
// 為什麼不是「只帶牌子」:做 plan 時漏看了一個消費點 —— 沒選牌子時車款欄是【跨層打字】
// (`vehicle-options.ts` `modelFieldOptions` 的 `crossLayer`:打 r6 直達 YAMAHA YZF-R6),
// 它要**所有牌子的車款名字**。而年份那一層(12,335 列 vs 3,824 款)才是體積的大頭,
// 且年份只在「選了車款之後」才需要 ⇒ 瘦身的刀落在 `years`,不落在 `models`。
//
// 契約:
//   · 每個牌子都在、每個車款的 `id` / `name` 都在(跨層打字、URL 解析、車庫 chip 比對都不缺)。
//   · `years` 只在 `keepYearsFor` 那幾個牌子上保留(URL 已選的牌子、車庫那幾台的牌子 ——
//     server 在 render 當下就知道的),其餘牌子 `years: []` + `yearsLoaded: false`。
//   · 其餘牌子的年份由 client 在選了牌子時打 `/api/catalog/vehicle-models?brand=` 補
//     (`use-brand-years.ts`)。
//
// 🔴 這支只做投影,不 fetch、不快取:資料源與 TTL 一個字沒動(0911 Q1 乙 / Q2 甲不受影響)。

import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { flattenVehicleModels, resolveGarageChip, type GarageVehicleInput } from '@/lib/garage-chip';

/** 把 `keepYearsFor` 以外的牌子的 `years` 拿掉。純函式、不改輸入。 */
export function slimVehicleTree(
  motoBrands: MockMotoBrand[],
  keepYearsFor: ReadonlySet<string>,
): MockMotoBrand[] {
  return motoBrands.map((b) =>
    keepYearsFor.has(b.id)
      ? { ...b, yearsLoaded: true }
      : {
          id: b.id,
          name: b.name,
          models: b.models.map((m) => ({ id: m.id, name: m.name, years: [] })),
          yearsLoaded: false,
        },
  );
}

/**
 * 車庫那幾台會碰到哪些牌子(要保留年份的):
 *   · 字典綁定的(`dictBrandName`)⇒ 那個牌子;
 *   · 自由文字的 ⇒ 跑一次與 client 同一支 `resolveGarageChip`:`apply` ⇒ 那個牌子;
 *     `suggest` ⇒ 建議清單(≤12 筆)那幾個牌子 —— 客人點了建議就要有年份可用。
 * 🔴 用同一支 resolver,不自己再寫一份比對規則(那正是 #953 那種「多份拷貝」)。
 */
export function garageRelatedBrandIds(
  motoBrands: MockMotoBrand[],
  garage: readonly GarageVehicleInput[],
): Set<string> {
  const out = new Set<string>();
  if (garage.length === 0) return out;
  const byName = new Map(motoBrands.map((b) => [b.name, b.id] as const));
  const byLabel = new Map(flattenVehicleModels(motoBrands).map((e) => [e.label, e.brand.id] as const));
  for (const g of garage) {
    const r = resolveGarageChip(motoBrands, g);
    if (r.kind === 'apply') {
      const id = byName.get(r.brand);
      if (id) out.add(id);
    } else {
      for (const label of r.entries) {
        const id = byLabel.get(label);
        if (id) out.add(id);
      }
    }
  }
  return out;
}

/** `/products` 那一發要保留年份的牌子:URL 已選的 + 車庫相關的。 */
export function vehicleTreeForProductsPage(
  motoBrands: MockMotoBrand[],
  opts: { selectedBrandName: string | null; garage: readonly GarageVehicleInput[] },
): MockMotoBrand[] {
  const keep = garageRelatedBrandIds(motoBrands, opts.garage);
  if (opts.selectedBrandName != null) {
    const sel = motoBrands.find((b) => b.name === opts.selectedBrandName);
    if (sel) keep.add(sel.id);
  }
  return slimVehicleTree(motoBrands, keep);
}
