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
 * 全量分頁上限(繞 PostgREST/Supabase「Max rows = 1000」硬上限)。
 * MAX_PAGES 防呆:50 × 1000 = 5 萬件上限(遠超現況、防迴圈失控)。
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/**
 * 全量分頁撈取:以連續 `.range(from,to)` 視窗撈到底、繞 PostgREST/Supabase「Max rows = 1000」硬上限。
 * listAllByCategory / listAllProducts 共用(鐵則 6 抽出、兩處分頁迴圈不重複)。
 *
 * `runPage(from, to)` 由呼叫端提供:在 base query 疊自己的過濾與**穩定排序**(`.order('id')`,PK uuid)
 * 後回 PostgREST 結果;listAllByCategory 疊 `.eq('category_id')`、listAllProducts 不疊。
 *
 * 分頁正確性(審查點):
 * - 呼叫端 `.order('id')`(PK uuid 唯一、穩定)+ 連續非重疊 `.range` 視窗 → 無重複 / 無漏行。
 * - 末頁 `batch.length < PAGE_SIZE` 即停(含「恰為 PAGE_SIZE 整數倍」時多撈一次空頁正常停)。
 * - `MAX_PAGES` 防呆上限:命中則 `console.warn`(不靜默截斷、no silent caps)、回已撈部分。
 * - error → throw(fail-closed、對齊各 read method)。
 *
 * 回傳 `unknown[]`:products_public view + embed 投射的 rich-Json wire shape 由呼叫端
 * `as SupabaseProductRow[]` narrow(對齊 findSingle JSDoc 的 rich-Json 邊界說明)。
 */
export async function fetchAllPaginated(
  runPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await runPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw error;
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return rows; // 末頁、撈完
    }
  }
  console.warn(
    `[${label}] 達 MAX_PAGES=${MAX_PAGES}(${MAX_PAGES * PAGE_SIZE} 件)上限、結果可能截斷;需改 server-side 分頁(#51)`,
  );
  return rows;
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
