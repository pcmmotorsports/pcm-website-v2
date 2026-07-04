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

    describe('findByHandle', () => {
      // M-1-16c-2:findByHandle 進 port。contract 維持 it.todo(此 framework 全 it.todo、
      // main-b 從未落地真斷言)、記錄契約字面;真測在各 impl 自備 fixture
      // (InMemoryProductRepository.test.ts findByHandle 讀測 + mappers/product.test.ts
      // mapVariantRow 單測)、避免「save 帶 variants→findByHandle 回變體」對兩實作不對稱
      // (Supabase save-variant 16c-2 不做、留 backlog;codex 關卡1 must-fix 1 採納)。
      it.todo('SupabaseProductAdapter 接 contract 時實作:依 handle 回對應 entity(含 variants)、不存在回 null');
    });

    describe('listByCategory', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 CategoryPath.raw 字面 match 回對應 entity 陣列');
    });

    describe('listCategories', () => {
      // 接線 plan C1:回全部分類 + 各分類上架商品數。真斷言在各 impl 自備 fixture
      // (SupabaseProductAdapter.test.ts mock categories + products_public count /
      //  InMemoryProductRepository.test.ts 由庫存 product 推導),此 framework 維持 it.todo。
      it.todo('SupabaseProductAdapter 接 contract 時實作:回全部分類(含空分類 count=0)+ 各分類上架商品數、依 sortOrder 遞增');
    });

    describe('listByBrand', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 brandId 字面 match 回對應 entity 陣列');
    });

    describe('listByFitment', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:依 FitmentSpec(motoBrand + modelCode + 年份)配對 fitments[] 任一筆');

      // year-range matching 嵌套子 describe(M-1-03-prep-audit S2、Sean Q5=E1):
      // 對齊 port public method listByFitment、不暴露 adapter 內部 helper 名(matchFitment 是
      // InMemoryProductRepository private method、main-b SupabaseProductAdapter 用 PG range
      // query 無 matchFitment、contract 級不該知道實作細節)。
      // 規範:docs/lessons-learned.md §12-2、reviews 檔 F2 / F3 / F16(雙視角 Major)
      describe('year-range matching', () => {
        it.todo('main-b 落地時實作:範圍重疊 match');
        it.todo('main-b 落地時實作:yearEnd null 開放式範圍 match');
        it.todo('main-b 落地時實作:spec 無年份 match 任意 yearRange');
        it.todo('main-b 落地時實作:false-positive 防線 - 範圍無交集不 match');
      });

      // cross-車型 false positive 防護(M-1-03-main-c sub-slice 2.5 落地、Sean 業務拍板):
      // product.fitments 含多車型時、server-side prefilter(motoBrand+modelCode @>)為 product
      // 級別、client-side 必須 cross-check 該條 fitment 三條(brand+model+year)全符、
      // 避免 fitment A match brand+model + fitment B match year 交叉觸發 false positive。
      // 規範:M-1-03-main-c sub-slice 2.5 commit body
      it.todo('SupabaseProductAdapter 接 contract 時實作:跨車型 false positive 防護 — fitments=[{Yamaha,R1,2018-2024},{Honda,CBR,2010-2012}] 對 spec=(Honda,CBR,2020) 應 not match(Honda CBR 2010-2012 不 cover 2020、Yamaha R1 brand+model 不對 spec 不算)');
    });

    describe('searchByKeyword', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:回 Paginated<Product> + empty query 回空 items + offset/limit 分頁');
    });

    describe('save', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:create / update 統一入口、wire-level immutability(對齊 ADR-0003 §3.3)');
    });
  });
}
