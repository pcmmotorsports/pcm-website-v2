/**
 * resolveEnd:解析 yearEnd 三狀態為單一可比較數值。
 *
 * 跨 adapter 共用 helper(InMemory + Supabase 兩端避免雙寫、解 backlog #92)。
 *
 * 對齊 docs/specs/M-1-03-main-b-PRD.md §5.4 + docs/architecture/supabase-schema-design.md §2.4
 * 4 種狀態表(對齊 catalog/types.ts:FitmentSpec yearStart / yearEnd | null + ADR-0004 wrs Q1=A1)。
 *
 * 三狀態:
 * - yearEnd === null → Infinity(開放式範圍 "2025+"、無上限)
 * - yearEnd === undefined → yearStart(單年)
 * - yearEnd === number → yearEnd(範圍上限直接用)
 *
 * 用途:
 * - InMemoryProductRepository.matchFitment 規則 3 計算 actualEnd / specEnd
 * - SupabaseProductAdapter.listByFitment client-side filter matchFitmentYear
 *
 * 跨 package re-export 規則:domain/src/index.ts 必加具名 `export { resolveEnd }`
 * (對齊 ADR-0003 §3.1.1 runtime helper 規則、避免 M-1-02 toMoneyAmount typecheck fail 同類踩坑)。
 *
 * @see docs/specs/M-1-03-main-b-PRD.md §5.4
 * @see docs/architecture/supabase-schema-design.md §2.4
 * @see docs/decisions/0003-domain-entity-naming.md §3.1.1
 * @see packages/domain/src/catalog/types.ts FitmentSpec
 */
export function resolveEnd(
  yearStart: number,
  yearEnd?: number | null,
): number {
  if (yearEnd === null) return Infinity;
  if (yearEnd === undefined) return yearStart;
  return yearEnd;
}

/**
 * 年份範圍重疊判定(V-2b 起升 domain=年份語意單一來源;原 adapters/helpers/fitment.ts、
 * 該處改 re-export 保既有呼叫零漂移)。actual/spec 皆 FitmentSpec 年份區間。
 *
 * 規則邏輯逐字對齊原 adapters 版=**執行期等價**(nit-7 措辭更正:非 byte-identical——參數型別由
 * 原 FitmentSpec **刻意放寬**為結構化年份區間 `{yearStart?; yearEnd?}`,避免 storefront §7 拉整包
 * catalog types;行為/規則等價、簽名放寬,呼叫端零漂移):
 * - 任一邊 yearStart undefined → return true(無年份限制=不限年份)
 * - 否則 actualEnd/specEnd 用 resolveEnd 解析(兩端對稱處理 yearEnd null/undefined)
 * - 範圍重疊:actual.start ≤ spec.end 且 spec.start ≤ actual.end
 *
 * 🔴 只判年份、**不**比對 motoBrand/modelCode(呼叫端自理配對)。使用者單年查詢=退化區間
 * `{yearStart:Y, yearEnd:Y}`;storefront §7 比對禁自寫年份判定、一律呼本顆(S4 語意分叉教訓)。
 *
 * @see resolveEnd
 * @see packages/adapters/src/in-memory/InMemoryProductRepository.ts matchFitment 規則 3
 */
export function matchFitmentYear(
  actual: { yearStart?: number; yearEnd?: number | null },
  spec: { yearStart?: number; yearEnd?: number | null },
): boolean {
  if (actual.yearStart === undefined || spec.yearStart === undefined) return true;
  const actualEnd = resolveEnd(actual.yearStart, actual.yearEnd);
  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
  return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;
}

/**
 * fitment 是否不限年份(yearStart 未定義=該車型全年份適用)。
 * V-2b §7:使用者年份未知時,唯有命中此類 fitment 才可顯無條件「✓ 適用」,否則保守顯 qualified。
 * 抽 domain=年份語意單一來源(storefront 禁自寫 `yearStart === undefined` 判定行)。
 */
export function isYearUnrestricted(spec: { yearStart?: number }): boolean {
  return spec.yearStart === undefined;
}
