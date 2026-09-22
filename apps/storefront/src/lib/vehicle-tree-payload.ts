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

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import { flattenVehicleModels, resolveGarageChip, type GarageVehicleInput } from '@/lib/garage-chip';
import { normalizeVehicleQuery } from '@/lib/vehicle-match';

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

type ProductsPageTreeOpts = { selectedBrandName: string | null; garage: readonly GarageVehicleInput[] };

/** `/products` 那一發要保留年份的牌子 id:URL 已選的 + 車庫相關的。 */
function productsPageKeepIds(motoBrands: MockMotoBrand[], opts: ProductsPageTreeOpts): Set<string> {
  const keep = garageRelatedBrandIds(motoBrands, opts.garage);
  if (opts.selectedBrandName != null) {
    const sel = motoBrands.find((b) => b.name === opts.selectedBrandName);
    if (sel) keep.add(sel.id);
  }
  return keep;
}

/** `/products` 那一發要保留年份的牌子:URL 已選的 + 車庫相關的。 */
export function vehicleTreeForProductsPage(
  motoBrands: MockMotoBrand[],
  opts: ProductsPageTreeOpts,
): MockMotoBrand[] {
  return slimVehicleTree(motoBrands, productsPageKeepIds(motoBrands, opts));
}

/**
 * ⟦db-TAXONOMYVIEW⟧ 接線片(2026-09-22):輸入是【底盤樹】(沒有年份), 要保留年份的那幾個牌子
 * 由 `loadModels` 各補一次年份(一個牌子一發), 其餘牌子照舊 `yearsLoaded: false`。
 * 🔴 **某個牌子補失敗 ⇒ 那個牌子當成「沒保留」**(`yearsLoaded: false`), 頁面照常出來,
 *   瀏覽器選到那個牌子時會自己打 `/api/catalog/vehicle-models` 再補一次(`use-brand-years.ts`)。
 *   ⚠️ 商品頁傳進來的 `loadModels` 是 `fetchModelsWithYearsOrFull`(年份失敗先退回舊完整樹)⇒ 走到這裡
 *   代表【新舊兩條都拿不到完整年份】。Codex 接線片 R2 MF 指出:此時送出 `years: []`, 客人點「我的愛車」
 *   會丟掉存好的年份 ⇒ 這個極少數情況【仍未解】(2026-09-22 R2 後修改, 尚未再審;要 Sean 決定處理方式)。
 *   錯誤照樣 `console.error`, 不靜默。
 * 🔵 `loadModels` 由呼叫端注入 ⇒ 本檔仍然不 fetch(見檔頭), 測試不用 mock 網路。
 */
export async function vehicleTreeWithYearsForProductsPage(
  baseBrands: MockMotoBrand[],
  opts: ProductsPageTreeOpts,
  loadModels: (brand: MockMotoBrand) => Promise<MockMotoModel[]>,
): Promise<MockMotoBrand[]> {
  const loaded = new Map<string, MockMotoModel[]>();
  await Promise.all(
    [...productsPageKeepIds(baseBrands, opts)].map(async (id) => {
      const brand = baseBrands.find((b) => b.id === id);
      if (!brand) return;
      try {
        loaded.set(id, await loadModels(brand));
      } catch (err) {
        console.error('[products] 牌子年份讀取失敗, 改由瀏覽器選到時再補:', err);
      }
    }),
  );
  const merged = baseBrands.map((b) => {
    const models = loaded.get(b.id);
    return models ? { ...b, models } : b;
  });
  return slimVehicleTree(merged, new Set(loaded.keys()));
}

/**
 * 把「別處拿到的帶年份車款」對回底盤那個牌子的車款(接線片;plan 六之二)。
 * 🔴 **執行期對帳(Sean 2026-09-22 選甲,必做)**:底盤那個牌子有 M 個車款, 找得到年份的有 K 個 ⇒
 *   **K < M ⇒ throw**, 不回傳比較少的清單。
 * 🔴 **用車款【名字的正規化鍵】對, 不用 id**(Codex 2026-09-22 接線片 R1 MF-2):
 *   id 帶撞名序號(`mt-09` / `mt-09-2`)而序號看排序;底盤與年份是兩把快取、各自更新 ⇒
 *   中間多一款排在前面的車款, 同一個 id 就指到另一台車。鍵與 `vehicleTaxonomyFromRaw` 分群用的同一把
 *   (`normalizeVehicleQuery`)⇒ 對得上的就是同一台車。
 * 🔵 回傳的是【底盤那一份】的 id / 名字 / 順序, 只換上年份 ⇒ 送到瀏覽器的 id 與頁面解析網址用的 id 同一份。
 *   另一邊多出來的車款(底盤還沒有的)丟掉 —— 底盤是這一頁的基準。
 */
export function reconcileModelYears(brand: MockMotoBrand, withYears: MockMotoModel[]): MockMotoModel[] {
  const byKey = new Map(withYears.map((m) => [normalizeVehicleQuery(m.name), m] as const));
  const missing: string[] = [];
  const out = brand.models.map((m) => {
    const hit = byKey.get(normalizeVehicleQuery(m.name));
    if (!hit) missing.push(m.name);
    return { ...m, years: hit?.years ?? [] };
  });
  if (missing.length > 0) {
    throw new Error(
      `[reconcileModelYears] 牌子「${brand.name}」找得到年份的車款 K=${brand.models.length - missing.length}`
        + ` < 底盤車款 M=${brand.models.length}(缺 ${missing.length} 款)—— 不回傳比較少的清單`,
    );
  }
  return out;
}

