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
