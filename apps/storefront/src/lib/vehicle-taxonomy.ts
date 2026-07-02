// vehicle-taxonomy.ts — 從商品 fitment「動態衍生」品牌→車型→年份 車輛篩選清單
//
// 車種鐵律(memory project_storefront-content-model-design):車種走 fitment_parsed 直出、
// AI 不碰車種。本函式即該鐵律的前台實作 —— 篩選清單完全由「當下目錄商品的 fitment」衍生,
// 商品匯入(每日同步進商城庫)後清單自動更新、零手動維護;只列「真的有商品的車」(無死選項)。
//
// 輸出 MockMotoBrand[](與既有 CascadeFilterTop / FilterSide / FilterDrawer / VehicleFinder
// 契約相同)→ 篩選元件本身零改、drop-in 取代 MOCK_MOTO_BRANDS。
//
// 年份三態(對齊 domain FitmentSpec / data/mock-products UIFitment 註解):
//   - yearStart == null            → 該 fitment 不貢獻年份(無年份步驟)
//   - yearEnd === undefined(省略)  → 單年 [yearStart]
//   - yearEnd === null(開放式 "2025+")→ yearStart..maxYear(maxYear=全目錄資料上界、避免展到無商品的未來年)
//   - yearEnd: number(明確範圍)    → yearStart..yearEnd
//
// 排序 = 品牌 / 車型依名稱升冪、年份升冪(對齊 design mock years 升冪慣例);中性預設,
// 視覺/熱門排序 Sean 後續 design skill 可調。
//
// #211 誠實揭示:fitment 字串未在匯入端正規化;本函式直出、僅 trim 前後空白、不做其他清洗
// (大小寫/連字號變體會裂成獨立選項節點、id 加序號保唯一;treat 為上游資料品質問題、非此層修)。
// 比對端 products-filter-logic matchesVehicle 同樣 trim 後比對、兩端對稱(防「選項出現、選了比不中」)。

import type { MockProduct } from '@/data/mock-products';
import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';

/** 衍生只需 fitments 欄(server 端輕量查詢可餵、不必完整 MockProduct;ProductsPage 傳全型別自然相容)。 */
type FitmentSource = Pick<MockProduct, 'fitments'>;

/** 單一 fitment 年份範圍展開上限(防單筆髒 yearEnd 產出數萬 DOM 年份選項凍結頁面;真資料 span 最大 17 年)。 */
const MAX_YEAR_SPAN = 60;

/**
 * 名稱 → URL/DOM 安全 slug(id 用);空字串兜底 'x'。
 * export 供跨頁消費者(ProductPage vehiclePill)以同一規則把 fitment 字串對回 URL slug。
 */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'x';
}

/** 於同一 scope 內保證 slug 唯一(collision 加序號),供 React key / URL round-trip 不撞。 */
function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

export function buildVehicleTaxonomy(products: FitmentSource[]): MockMotoBrand[] {
  // 資料上界年:開放式範圍("2025+")展開的 cap;純資料衍生、確定性(不看系統時間)。
  let maxYear = 0;
  for (const p of products) {
    for (const f of p.fitments ?? []) {
      if (typeof f.yearStart === 'number') maxYear = Math.max(maxYear, f.yearStart);
      if (typeof f.yearEnd === 'number') maxYear = Math.max(maxYear, f.yearEnd);
    }
  }

  // brand name → (model name → Set<year>);以名稱為鍵(與 fitment 同源、比對端一致)。
  const brands = new Map<string, Map<string, Set<number>>>();
  for (const p of products) {
    for (const f of p.fitments ?? []) {
      const brand = f.motoBrand?.trim();
      const model = f.modelCode?.trim();
      if (!brand || !model) continue;

      let models = brands.get(brand);
      if (!models) {
        models = new Map();
        brands.set(brand, models);
      }
      let years = models.get(model);
      if (!years) {
        years = new Set();
        models.set(model, years);
      }

      const ys = f.yearStart;
      if (typeof ys === 'number') {
        let ye: number;
        if (f.yearEnd === undefined) ye = ys; // 單年
        else if (f.yearEnd === null) ye = Math.max(ys, maxYear); // 開放式 → cap 資料上界
        else ye = f.yearEnd; // 明確範圍
        ye = Math.min(ye, ys + MAX_YEAR_SPAN); // 防髒資料展開失控(見 MAX_YEAR_SPAN)
        for (let y = ys; y <= ye; y++) years.add(y);
      }
    }
  }

  // Map → MockMotoBrand[](brand / model id 皆去重:#211 未正規化來源若兩名 slugify 撞同
  // slug、加序號保唯一,防 React key 撞 + parseVehicleFromUrl 只命中第一筆)
  const out: MockMotoBrand[] = [];
  const usedBrandIds = new Set<string>();
  for (const [brandName, models] of brands) {
    const usedModelIds = new Set<string>();
    const modelList: MockMotoModel[] = [];
    for (const [modelName, yearSet] of models) {
      modelList.push({
        id: uniqueId(slugify(modelName), usedModelIds),
        name: modelName,
        years: [...yearSet].sort((a, b) => a - b),
      });
    }
    modelList.sort((a, b) => a.name.localeCompare(b.name, 'en')); // locale 固定:SSR/client 排序一致、防 hydration mismatch
    out.push({ id: uniqueId(slugify(brandName), usedBrandIds), name: brandName, models: modelList });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return out;
}
