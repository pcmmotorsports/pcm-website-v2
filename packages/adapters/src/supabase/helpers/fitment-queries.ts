import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEnd, type FitmentSpec } from '@pcm/domain';
import type { Database } from '../database.types';
import type { SupabaseProductRow } from '../mappers/product';
import { fetchAllPaginated } from './product-query-support';

/**
 * fitment 反查查詢 helpers(R2a 推薦引擎「以車查商品」+ 通用款;鐵則 6 拆檔:
 * SupabaseProductAdapter 逾 400 行、對齊既有 category-queries.ts / product-query-support.ts 抽法)。
 *
 * @see docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §4
 * @see packages/adapters/src/supabase/helpers/fitment.ts matchFitmentYear(語意來源)
 */

/**
 * 年份範圍重疊 PostgREST `.or()` filter 字串(對齊 helpers/fitment.ts matchFitmentYear)。
 *
 * spec 無 yearStart → null(不限年份、對齊 matchFitmentYear 早退 true);否則
 * `[year_start, resolveEnd(year_start,year_end)]` 與 `[specStart, specEnd]` 重疊
 * + `year_start IS NULL`(商品端無年份=通吃)。specEnd=Infinity(開放式 spec)省 lte 段。
 */
export function buildFitmentYearFilter(spec: FitmentSpec): string | null {
  if (spec.yearStart === undefined) return null;
  const specStart = spec.yearStart;
  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
  const endGteStart = `or(year_end.is.null,year_end.gte.${specStart})`;
  const overlap =
    specEnd === Infinity
      ? endGteStart
      : `and(year_start.lte.${specEnd},${endGteStart})`;
  return `year_start.is.null,${overlap}`;
}

/**
 * 依 fitment spec 反查商品(對齊 IProductRepository.listByFitment)。
 *
 * 兩步:① 正規化索引表 `product_fitments` 過濾(moto_brand + model_code 等值 + 年份範圍重疊)
 * 取 distinct product_id(RLS 濾下架 fitment;步①只 select product_id、零金額欄);② `products_public`
 * `.in('id', ids)` 取商品(RLS 二層濾下架 + 經銷價物理排除)。空結果短路、不查 products_public。
 *
 * R2a 由舊 jsonb `.contains` @> + client cross-check 改走此正規化索引;正規化一列一相容 →
 * 結構性消掉舊版跨車型 false-positive(不再需 client `some()` 補救)。
 * 🔴 `.in('id', ids)` 無上限:熱門車型可能配大量商品(URL/參數上限風險、引擎下游 cap;stopgap #51)。
 */
export async function queryProductsByFitment(
  supabase: SupabaseClient<Database>,
  spec: FitmentSpec,
  productSelect: string,
): Promise<SupabaseProductRow[]> {
  let pfQuery = supabase
    .from('product_fitments')
    .select('product_id')
    .eq('moto_brand', spec.motoBrand)
    .eq('model_code', spec.modelCode);

  const yearFilter = buildFitmentYearFilter(spec);
  if (yearFilter !== null) {
    pfQuery = pfQuery.or(yearFilter);
  }

  const { data: pfRows, error: pfError } = await pfQuery;
  if (pfError) {
    throw pfError;
  }

  const productIds = Array.from(
    new Set((pfRows ?? []).map((row) => row.product_id)),
  );
  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('products_public')
    .select(productSelect)
    .in('id', productIds);
  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as SupabaseProductRow[];
}

/**
 * 通用款商品(fitments 空陣列 = 設計上不綁車型、對齊 IProductRepository.listGeneral)。
 *
 * `products_public` + RLS(只回上架、經銷價物理排除);jsonb 等值 `fitments = '[]'`(乾淨、
 * 不觸 array_length abort)。**fitments 非空但元素全髒者不算通用**——Sean 2026-07-08 逐筆判斷
 * 該 9 筆 gbracing(Honda 品牌/車型空白)實為 HONDA MOTO3 賽車專用 + 替換件、非萬用,故排除;
 * 此語意取代 plan §4 原「NOT EXISTS product_fitments」表述(兩者皆滿足 codex #6 免 abort/dead-predicate)。
 * 🔴 PostgREST jsonb 空陣列等值待 R3 整合實測(SQL 層已驗 `fitments = '[]'` → 631 筆)。
 */
/**
 * S1 變體補足(2026-07-12):新表 `product_fitments_effective` 與 RPC `search_products_by_vehicle`
 * 不在生成型別 database.types.ts 內(該檔落後 live schema = 既有 backlog、regen 屬另一 slice,
 * 本片不夾帶無關 schema drift)→ 以下兩查詢用**文件化窄 cast** 收斂為最小結構型別
 * (先例:SupabaseOrderAdapter create_order 的「db-push-pending 窄 cast」模式;regen 後可移除)。
 */

/** RPC search_products_by_vehicle 的最小呼叫面(SETOF jsonb + .range 分頁)。 */
type VehicleRpcClient = {
  rpc(
    fn: 'search_products_by_vehicle',
    args: { p_brand: string; p_model: string | null; p_year: number | null },
  ): {
    range(
      from: number,
      to: number,
    ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
};

/**
 * 以車查商品 —— 走 DB RPC `search_products_by_vehicle`(S1 變體補足、車款篩選下推 DB)。
 *
 * RPC = `product_fitments`(direct、trigger 即時)∪ `product_fitments_effective`(報價單母款
 * 家族樹展開、每日同步)去重 → 繼承件(如掛母款 MT-09 的通用件)也命中子款(MT-09 SP)搜尋。
 * 回傳 jsonb 形狀 = SupabaseProductRow 公開欄(RPC 內 jsonb_build_object 逐欄白名單、無經銷價)。
 *
 * 🔴 分頁必要(codex#2):PostgREST 對 SETOF RPC 套 Max Rows=1000,品牌-only(model=null)
 *   命中可破千被**靜默截斷** → 以 `.range()` 分頁迴圈撈全(RPC 端 ORDER BY p.id 穩定序)。
 * 年份語意(F5、adversarial):`year_end IS NULL` 當開放式(≥year_start)——與推薦引擎
 *   `matchFitmentYear` 一致;client 舊 matchesVehicle 的「yearEnd undefined=單年」語意退場,
 *   1.3% 缺迄年 direct fitment 由「單年」變「開放式」(Sean 拍 codex#1=A、對齊兩引擎)。
 */
export async function queryProductsByVehicle(
  supabase: SupabaseClient<Database>,
  motoBrand: string,
  modelCode?: string,
  year?: number,
): Promise<SupabaseProductRow[]> {
  const rpcClient = supabase as unknown as VehicleRpcClient;
  const rows = await fetchAllPaginated(
    (from, to) =>
      rpcClient
        .rpc('search_products_by_vehicle', {
          p_brand: motoBrand,
          p_model: modelCode ?? null,
          p_year: year ?? null,
        })
        .range(from, to),
    `queryProductsByVehicle(${motoBrand} ${modelCode ?? ''} ${year ?? ''})`,
  );
  return rows as SupabaseProductRow[];
}

/** effective 表 inherited 列的最小讀取面(select + eq 過濾)。 */
type EffectiveFitmentsClient = {
  from(table: 'product_fitments_effective'): {
    select(cols: 'moto_brand, model_code, year_start, year_end'): {
      eq(
        col: 'product_id',
        v: string,
      ): {
        eq(
          col: 'match_source',
          v: 'inherited',
        ): PromiseLike<{
          data:
            | {
                moto_brand: string;
                model_code: string;
                year_start: number | null;
                year_end: number | null;
              }[]
            | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * 查單一商品的「車系相容(推導)」fitment(PDP 兩層顯示、Sean Q4=A)。
 *
 * 讀 `product_fitments_effective` 的 inherited 列(anon SELECT + RLS 濾下架);direct 列不讀
 * (products.fitments 原始值即 direct、provenance 不動)。單商品 inherited 列個位數~數十
 * (Y016=6),單次查詢即可、不分頁。
 * 年份映射:year_start NULL → 無年份;year_end NULL(有 year_start)→ 開放式(domain yearEnd: null)。
 */
export async function queryInheritedFitments(
  supabase: SupabaseClient<Database>,
  productId: string,
): Promise<FitmentSpec[]> {
  const client = supabase as unknown as EffectiveFitmentsClient;
  const { data, error } = await client
    .from('product_fitments_effective')
    .select('moto_brand, model_code, year_start, year_end')
    .eq('product_id', productId)
    .eq('match_source', 'inherited');
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    motoBrand: row.moto_brand,
    modelCode: row.model_code,
    ...(row.year_start != null ? { yearStart: row.year_start } : {}),
    // year_end NULL 且有 year_start = 開放式(domain null);兩者皆 NULL = 無年份(省略)
    ...(row.year_start != null ? { yearEnd: row.year_end } : {}),
    matchSource: 'inherited' as const,
  }));
}

export async function queryGeneralProducts(
  supabase: SupabaseClient<Database>,
  productSelect: string,
): Promise<SupabaseProductRow[]> {
  const { data, error } = await supabase
    .from('products_public')
    .select(productSelect)
    .eq('fitments', '[]');
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as SupabaseProductRow[];
}
