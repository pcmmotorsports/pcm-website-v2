/**
 * SupabaseProductAdapter 共用查詢基元(鐵則 6 自 adapter 抽出、行為 byte 等價)。
 *
 * 內容:PostgREST `.single()` not-found 統一處理(findSingle)+ searchByKeyword 的
 * ILIKE filter 組裝(SEARCHABLE_COLUMNS / buildIlikeOrFilter)。
 * 跨 read method 共用、無狀態純函式 / 常數;client 由呼叫端注入。
 */

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
export const PGRST_NOT_FOUND = 'PGRST116';

/** searchByKeyword ILIKE 三欄(對齊 PRD §3.5 + supabase-schema-design.md §2.5 dev 階段)。 */
export const SEARCHABLE_COLUMNS = ['title', 'subtitle', 'description'] as const;

/**
 * 為 PostgREST `.or()` 跨欄 ILIKE filter 組裝 sanitized pattern + filter string。
 *
 * 兩階段 sanitize:
 * 1. 剝除 PostgREST `.or()` filter 語法保留字元(`,` `(` `)` `.` `"`)、避免 user
 *    輸入破壞 filter 解析(例 `Yamaha,price.gte.999` 會被當兩個 filter clause)。
 *    Phase 1 trade-off:這些字元在 ILIKE substring 失準、M-6 切 tsvector + textSearch
 *    時可用真 escape(對齊 backlog #110)。
 * 2. 轉義 ILIKE wildcards(`\` `%` `_`)、`\` 先(否則 `\%` 會被當已轉義)。
 *
 * regex / strip 字元集合為 Code 設計選擇、不歸 PRD 字面源(對齊 lessons §12-3 維度 A)。
 */
export function buildIlikeOrFilter(columns: readonly string[], q: string): string {
  const sanitized = q
    .replace(/[,()."]/g, ' ')
    .replace(/[\\%_]/g, (c) => '\\' + c);
  const pattern = `%${sanitized}%`;
  return columns.map((col) => `${col}.ilike.${pattern}`).join(',');
}

/**
 * `.single()` 結果統一處理(PGRST_NOT_FOUND → null、其他 error → throw、
 * data null fallthrough → null)。對齊 sub-slice 4 audit 第 3 處撞 Defer trigger
 * (findById + resolveCategoryId + save、雙 audit R1/R2/Q6 共識)。
 *
 * #106:client 已 `SupabaseClient<Database>` generic(.from/.select/.eq 欄名查詢 compile 期檢)。
 * 呼叫端 `as T` + read 路徑 `as unknown as SupabaseProductRow[]` **保留**:products_public view
 * + embeds 投射的 wire shape 把 jsonb 欄(fitments→FitmentSpec[] / images→string[] / segments→string[])
 * narrow 成 domain 形,生成型別僅給 `Json`、無法 derive → 此 cast 為 rich-Json 投射的正當邊界
 * (非 type-safety 漏洞;對比簡單 adapter〔customer/address/vehicle/wallet〕已全消 cast)。
 */
export async function findSingle<T>(
  promise: PromiseLike<{
    data: unknown;
    error: { code: string; message: string } | null;
  }>,
): Promise<T | null> {
  const { data, error } = await promise;
  if (error) {
    if (error.code === PGRST_NOT_FOUND) {
      return null;
    }
    throw error;
  }
  return (data ?? null) as T | null;
}
