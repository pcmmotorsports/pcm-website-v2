import { describe, it } from 'vitest';
import type { IProductRepository } from './IProductRepository';

/**
 * Reusable contract test framework for IProductRepository.
 *
 * 任何 IProductRepository 實作(InMemory / Supabase / 等)都應通過此 contract 驗收。
 *
 * 對齊 docs/architecture/testing-strategy.md §3.4「in-memory 樣板不搬到真實 adapter」:
 * - contract 為純黑箱、不從 InMemory 偷 implementation 邏輯
 * - 各 adapter 自備 fixture、不共用 mock 樣板
 *
 * 本 framework 為純架子(M-1-03-prep 件 #3 子項 B 落地、Sean Q1=A3 拍板):
 * - 6 method 各 1 個 it.todo(待 main-b SupabaseProductAdapter 落地時實作)
 * - matchFitment year-range 段 4 個 it.todo(與件 #4 InMemoryProductRepository.test.ts 連動、
 *   contract 級 marker 對齊 in-memory 級實際 test)
 *
 * 對齊 backlog #86 thematic1 三軸合一:
 * - 軸 1:M-1-02-audit Q2/E2/E5 落地 testing-strategy §3.4 字面(✅ 已落地)
 * - 軸 2:本 contract framework(本檔)
 * - 軸 3:件 #4 InMemoryProductRepository.test.ts 4 個 yearRange test case
 *
 * @example
 * ```ts
 * import { describe } from 'vitest';
 * // 必走 subpath '@pcm/ports/contract'、不走 '@pcm/ports' main entry
 * // (M-1-03-prep-audit S1 修正:阻斷 vitest 經 main entry 洩漏 production bundle)
 * import { runProductRepositoryContract } from '@pcm/ports/contract';
 * import { SupabaseProductAdapter } from './SupabaseProductAdapter';
 *
 * describe('SupabaseProductAdapter', () => {
 *   runProductRepositoryContract(() => new SupabaseProductAdapter(client));
 * });
 * ```
 *
 * @param factory - lazy 建構 adapter instance(各 describe 內呼叫一次、避免共用 state)
 *
 * @see docs/architecture/testing-strategy.md §3.4
 * @see docs/phase-1-backlog.md #86
 */
export function runProductRepositoryContract(
  factory: () => IProductRepository
): void {
  // factory 於 main-b 落地時各 describe 內 invoke、純架子 phase 不執行;
  // 此 void 釋放保留 signature 對齊 Sean Q1=A3 字面 + 避免未來啟 noUnusedParameters 撞
  void factory;

  describe('IProductRepository contract', () => {
    describe('findById', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 ProductId 回對應 entity、不存在回 null');
    });

    describe('listByCategory', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 CategoryPath.raw 字面 match 回對應 entity 陣列');
    });

    describe('listByBrand', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 brandId 字面 match 回對應 entity 陣列');
    });

    describe('listByFitment', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 FitmentSpec(motoBrand + modelCode + 年份)配對 fitments[] 任一筆');
    });

    describe('searchByKeyword', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:回 Paginated<Product> + empty query 回空 items + offset/limit 分頁');
    });

    describe('save', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:create / update 統一入口、wire-level immutability(對齊 ADR-0003 §3.3)');
    });

    describe('matchFitment year-range', () => {
      it.todo('與件 #4 InMemoryProductRepository.test.ts 連動:yearStart/yearEnd 範圍重疊 match');
      it.todo('與件 #4 InMemoryProductRepository.test.ts 連動:yearEnd null 開放式範圍 match');
      it.todo('與件 #4 InMemoryProductRepository.test.ts 連動:spec 無年份 match 任意 yearRange');
      it.todo('與件 #4 InMemoryProductRepository.test.ts 連動:false-positive(actual 2018-2020 vs spec 2025)應不 match');
    });
  });
}
