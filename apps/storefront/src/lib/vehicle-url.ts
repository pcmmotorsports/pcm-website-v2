// vehicle-url.ts — URL vehicle 參數解析(純函式、無 React hooks)。
//
// 🔴 R3 抽出理由:parseVehicleFromUrl 原在 components/products-url-state.tsx,但該檔含 React hooks
//   (useState/useEffect)、無 'use client' directive;商品詳情頁 route(Server Component)需 server 端
//   解 ?vehicle slug→原始名(推薦引擎 Case A),import 含 hooks 的模組進 Server Component 會被 Next
//   擋(「hooks 只能在 Client Component」)。故把純解析邏輯搬到本無 hooks 模組,client(products-url-state
//   內部 hook)與 server(詳情頁 route)共用同一份=id 空間一致(對齊 buildVehicleTaxonomy 共用精神)。
//   邏輯自 products-url-state.tsx 原樣搬入、零動。

import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { readVehicleContext, type VehicleContextValue } from '@/lib/vehicle-context';
import { looseVehicleKey } from '@/lib/vehicle-match';

/** 只認 name/value 讀取介面(相容 ReadonlyURLSearchParams、URLSearchParams 與 route 的 shim) */
export type SearchParamsLike = { get(name: string): string | null };

// 解析 URL vehicle 參數 → VehicleSelection(name-based、對齊 reducer 介面;#6 拆檔時自
// ProductsPage.tsx 原樣搬入、邏輯零動)
// Q1=C 雙格式:短版 ?vehicle=brandId:modelId[:year] 優先、長版 ?brand=&model=&year= fallback
// S2(2026-07-03)起 VehicleFinder 亦改 push 短版(id 空間統一衍生清單)→ 站內兩個
// producer(ProductCard href / VehicleFinder)皆短版;長版分支僅吸收書籤舊連結、可日後刪。
export function parseVehicleFromUrl(
  searchParams: SearchParamsLike,
  motoBrands: MockMotoBrand[],
): { brand: string; model?: string; year?: number } | null {
  const v = searchParams.get('vehicle');
  let brandId: string | null = null;
  let modelId: string | null = null;
  let yearStr: string | null = null;
  if (v) {
    const parts = v.split(':');
    brandId = parts[0] || null;
    modelId = parts[1] || null;
    yearStr = parts[2] || null;
  } else {
    brandId = searchParams.get('brand');
    modelId = searchParams.get('model');
    yearStr = searchParams.get('year');
  }
  if (!brandId) return null;
  const brandObj = motoBrands.find((b) => b.id === brandId);
  if (!brandObj) return null;
  const modelObj = modelId
    ? brandObj.models?.find((m) => m.id === modelId)
    : null;
  const year = yearStr ? Number.parseInt(yearStr, 10) : undefined;
  return {
    brand: brandObj.name,
    model: modelObj?.name,
    year: year != null && Number.isFinite(year) ? year : undefined,
  };
}

// ── :901 網址車款判斷(plan `docs/plans/2026-09-20-vehicle-url-silent-drop-plan.md` §9-2)────────
//   Sean 2026-09-22:網址車款只差空白、橫線、大小寫就自動選那一台;差更多就不猜,列同品牌最接近的 3 台讓客人點。

export type VehicleSuggestion = { brandId: string; modelId: string; label: string; segment: string };

export type UrlVehicleResolution =
  | { kind: 'none' }
  | {
      kind: 'ok';
      vehicle: { brand: string; model?: string; year?: number };
      /** 正規寫法 `brandId[:modelId[:year]]` */
      segment: string;
      /** 網址本來就是正規寫法(短版、字面等於 segment) */
      canonical: boolean;
    }
  | { kind: 'notFound'; input: string; brandName?: string; suggestions: VehicleSuggestion[] };

/** 網址上的車款輸入。短版非空優先;短版空才讀長版,而長版要 `brand` 與 `model` 同在(單獨 `brand` 是商品品牌篩選)。 */
function readVehicleInput(
  searchParams: SearchParamsLike,
): { raw: string; brand: string; model: string | null; year: string | null; short: boolean } | null {
  const v = searchParams.get('vehicle');
  if (v) {
    const [brand = '', model = '', year = ''] = v.split(':');
    return { raw: v, brand, model: model || null, year: year || null, short: true };
  }
  const brand = searchParams.get('brand');
  const model = searchParams.get('model');
  if (!brand || !model) return null;
  const year = searchParams.get('year');
  return { raw: [brand, model, year].filter(Boolean).join(':'), brand, model, year: year || null, short: false };
}

/** 先比 id 完全相同;沒有才用寬鬆鍵(NFKC + 小寫 + 去空白與橫線)比 id 與名字,**剛好一個**才算。 */
function matchOne<T extends { id: string; name: string }>(items: readonly T[], input: string): T | null {
  const exact = items.find((x) => x.id === input);
  if (exact) return exact;
  const key = looseVehicleKey(input);
  if (key === '') return null;
  const hits = items.filter((x) => looseVehicleKey(x.id) === key || looseVehicleKey(x.name) === key);
  return hits.length === 1 ? (hits[0] as T) : null;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** 排序用的鍵:寬鬆鍵再去掉所有符號(底線、句點等)——只拿來排順序,不拿來判斷「是不是同一台」。 */
const rankKey = (s: string) => looseVehicleKey(s).replace(/[^\p{L}\p{N}]/gu, '');

/** 同一個牌子裡最接近的 3 台:開頭相同的字數多者優先,再來長度差小者,再依名字。只列、不選。 */
export function suggestVehicleModels(brand: MockMotoBrand, modelInput: string, limit = 3): VehicleSuggestion[] {
  const key = rankKey(modelInput);
  return [...(brand.models ?? [])]
    .map((m) => {
      const k = rankKey(m.name);
      return { m, score: commonPrefixLength(k, key), gap: Math.abs(k.length - key.length) };
    })
    .sort((a, b) => b.score - a.score || a.gap - b.gap || a.m.name.localeCompare(b.m.name, 'en'))
    .slice(0, limit)
    .map(({ m }) => ({
      brandId: brand.id,
      modelId: m.id,
      label: `${brand.name} ${m.name}`,
      segment: `${brand.id}:${m.id}`,
    }));
}

/** 網址車款 ⇒ none / ok / notFound。伺服器與瀏覽器用同一份車款清單呼叫同一支 ⇒ 兩端結果相同。 */
export function resolveVehicleFromUrl(
  searchParams: SearchParamsLike,
  motoBrands: MockMotoBrand[],
): UrlVehicleResolution {
  const input = readVehicleInput(searchParams);
  if (!input) return { kind: 'none' };
  const brandObj = matchOne(motoBrands, input.brand);
  if (!brandObj) return { kind: 'notFound', input: input.raw, suggestions: [] };
  if (!input.model) {
    return {
      kind: 'ok',
      vehicle: { brand: brandObj.name },
      segment: brandObj.id,
      canonical: input.short && input.raw === brandObj.id,
    };
  }
  const modelObj = matchOne(brandObj.models ?? [], input.model);
  if (!modelObj) {
    return {
      kind: 'notFound',
      input: input.raw,
      brandName: brandObj.name,
      suggestions: suggestVehicleModels(brandObj, input.model),
    };
  }
  // 年份照今天:不驗、原樣帶過(與 parseVehicleFromUrl 相同)
  const yearNum = input.year ? Number.parseInt(input.year, 10) : undefined;
  const year = yearNum != null && Number.isFinite(yearNum) ? yearNum : undefined;
  const segment = [brandObj.id, modelObj.id, ...(year != null ? [String(year)] : [])].join(':');
  return {
    kind: 'ok',
    vehicle: { brand: brandObj.name, model: modelObj.name, year },
    segment,
    canonical: input.short && input.raw === segment,
  };
}

/**
 * 設定或清除網址上的車款參數,**短版與長版一起處理**:一律刪 `vehicle`、`model`、`year`;
 * `brand` 只在與 `model` 同在時刪(那是車款長版;單獨的 `brand` 是商品品牌篩選,不能刪)。
 * 規則與 `use-vehicle-url-sync.tsx` 今天寫網址時相同,改成共用。
 */
export function withVehicleParam(params: URLSearchParams, segment: string | null): URLSearchParams {
  const hadLongVehicle = params.get('brand') != null && params.get('model') != null;
  params.delete('vehicle');
  if (hadLongVehicle) params.delete('brand');
  params.delete('model');
  params.delete('year');
  if (segment) params.set('vehicle', segment);
  return params;
}

/** cascade 的 name-based 車輛選擇(reducer 介面);`vehicle-url` 這側只讀不建。 */
export type VehicleSelection = { brand: string; model?: string | null; year?: number | null };

/**
 * cascade 車輛 → URL 短版 slug + 對應的 taxonomy 物件。查無(清單空/資料缺/車款不在字典)→ null。
 *
 * 🔴 單一來源(Q28① R1 MF-1 抽出):`useVehicleUrlSync` 用它算要寫的 URL 與鏡,
 *   `useCatalogFilterUrlSync` 用它判斷「vehicle 這輪會不會被寫進 URL」——兩邊必須是**同一個**判斷,
 *   否則後者會用「還沒有 vehicle」的舊網址算出 next、把前者剛送出的 `router.replace` 覆蓋掉。
 *   邏輯自 `useVehicleUrlSync` 原樣搬入、零動。
 */
export function resolveVehicleForUrl(
  vehicle: VehicleSelection,
  motoBrands: MockMotoBrand[],
): {
  segment: string;
  brandObj: MockMotoBrand;
  modelObj: NonNullable<MockMotoBrand['models']>[number] | null;
} | null {
  const brandObj = motoBrands.find((b) => b.name === vehicle.brand);
  if (!brandObj) return null; // taxonomy 查無(清單空/資料缺)→ 保守不動 URL(鏡同、不寫不清)
  const modelObj =
    vehicle.model != null ? (brandObj.models?.find((m) => m.name === vehicle.model) ?? null) : null;
  if (vehicle.model != null && !modelObj) return null;
  const segs = [brandObj.id];
  if (modelObj) {
    segs.push(modelObj.id);
    if (vehicle.year != null) segs.push(String(vehicle.year));
  }
  return { segment: segs.join(':'), brandObj, modelObj };
}

/**
 * 全站選車鏡(vehicle-context)→ VehicleSelection,供 `/products` 在 URL 無車時回退入站(Q28①)。
 *
 * 🔴 與 `parseVehicleFromUrl` 的差別是刻意的:URL 那側是使用者/連結**明示**的參數,寬鬆降級尚可辯;
 *   鏡這側是**自動套用**,所以三個軸都比 URL 側嚴:
 *   - **brand 查無 → null**(同 URL 側)
 *   - **model 查無 → 整筆 null、不降級成 brand-only**:使用者從沒說過「只看這個廠牌」,
 *     車款改名/下架就降級=拿猜的條件去篩他的清單。
 *   - **year 不在該車型的年份清單 → 丟掉 year、保留 brand+model**(R1 MF-4;URL 側完全不驗 year)。
 *     🔴 這裡與 model 不對稱是**刻意**的:丟 year 只擴大到「這台車的全部年份」,而使用者確實選了這台車;
 *     降級 model 卻會跨到一整個他沒選過的廠牌。失敗情境=鏡存 2019、型錄重匯後該車型年份收斂成
 *     2021+ ⇒ 不驗就會自動套一個清單裡不存在的年、RPC 回 0 筆、年份下拉顯示一個不存在的選項。
 *     車型本身沒有年份清單(`years` 空/缺)= 該車型不分年,照 URL 側慣例不驗、原樣帶過。
 * 鏡壞/缺欄的防禦讀取在 `readVehicleContext` 內(絕不 throw);本函式只做 taxonomy 存在性驗證。
 * ctx 以參數注入(預設讀 sessionStorage)=純函式可測;SSR 端不會呼叫(只在 client mount effect 內)。
 */
export function vehicleFromContext(
  motoBrands: MockMotoBrand[],
  ctx: VehicleContextValue | null = readVehicleContext(),
): { brand: string; model?: string; year?: number } | null {
  if (!ctx) return null;
  const brandObj = motoBrands.find((b) => b.id === ctx.brandId);
  if (!brandObj) return null;
  // 🔴 R1 N-2:鏡的 id 與 taxonomy 的 id **不同源**——PDP 寫鏡用裸 `slugify(name)`
  //   (`ProductFitmentCheck.tsx:171-172`),taxonomy 用 `uniqueId(slugify(name))`
  //   (`vehicle-taxonomy.ts:111,115`,#211 兩名撞同 slug 時加序號)。撞號時鏡的裸 slug 會
  //   `find` 到**第一筆**=另一台車 ⇒ 自動套上錯的車款(車種鐵律零猜的反面)。
  //   名稱字面欄(V-2a REQUIRED-3 additive)在手就複驗一次;舊鏡缺欄=不驗、相容照舊。
  if (ctx.brandName != null && ctx.brandName !== brandObj.name) return null;
  if (ctx.modelId == null) return { brand: brandObj.name };
  const modelObj = brandObj.models?.find((m) => m.id === ctx.modelId);
  if (!modelObj) return null;
  if (ctx.modelName != null && ctx.modelName !== modelObj.name) return null;
  const years = modelObj.years;
  const year =
    ctx.year != null && years != null && years.length > 0 && !years.includes(ctx.year)
      ? undefined
      : ctx.year;
  return { brand: brandObj.name, model: modelObj.name, year };
}

/**
 * URL → 車輛短版 slug 參數字串(`brandId:modelId[:year]`),供「查看全部相容商品」CTA 連車輛 filter。
 *
 * 短版 `?vehicle=` 優先、否則由長版 `?brand=&model=(&year=)` 合成短版(codex R3 r2:長版書籤 Case A 的
 * CTA 不可退成商品品牌 filter=文案「相容」卻連品牌 filter 誤導)。需 brand+model 同在才算車輛(`?brand=`
 * 單獨=商品品牌 filter 語意、不合成)。無 → null。與 parseVehicleFromUrl 同源(brandId/modelId 為 URL slug id)。
 */
export function vehicleUrlParam(searchParams: SearchParamsLike): string | null {
  const short = searchParams.get('vehicle');
  if (short) return short;
  const brand = searchParams.get('brand');
  const model = searchParams.get('model');
  const year = searchParams.get('year');
  if (!brand || !model) return null;
  return [brand, model, year].filter(Boolean).join(':');
}
