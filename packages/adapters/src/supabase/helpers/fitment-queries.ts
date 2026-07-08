import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEnd, type FitmentSpec } from '@pcm/domain';
import type { Database } from '../database.types';
import type { SupabaseProductRow } from '../mappers/product';

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
