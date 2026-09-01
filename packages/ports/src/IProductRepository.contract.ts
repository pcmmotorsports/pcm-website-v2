import { describe, it } from 'vitest';
import type { IProductRepository } from './IProductRepository';

/**
 * Reusable contract test framework for IProductRepository.
 *
 * 🔴🔴 **先讀這一段:本檔【不會被執行】。它今天是【文件】, 不是【測試】。**
 * (2026-09-01 線【帳號】`-7a` 實查, 主視窗 `-0a` 派)
 *
 * `runProductRepositoryContract()` **全 repo 零真呼叫端** —— 4 個字面命中裡,
 * 一個是本檔的定義、兩個是本檔 `@example` 的 JSDoc、一個是 `packages/ports/src/index.ts:60` 的註解。
 * ⇒ 🔴 **所以底下那 15 個 `it.todo` 從來沒有被 vitest 收集過** ——
 *   **連「skipped」都不會出現在報告裡**。
 *
 * 🛑 **而 `it.todo` 這個形式在這裡比一句註解【糟】, 這一格要講明白**:
 *   `it.todo` 讀起來像「**一個已登記的待辦**」—— 它有測試框架的外觀、有 runner 的語彙。
 *   ⇒ 而在一個從來不會被收集的函式裡, 它連【被收集】都沒有發生。
 *   ⇒ ⇒ 📌 **它比 `it.skip` 隱形一層:`it.skip` 至少會印一行, 而這個【連行都沒有】。**
 *
 * ⚠️ **而底下每一格的理由「待 SupabaseProductAdapter 落地時實作」今天是【假的】** ——
 *   那支早就落地了(`packages/adapters/src/supabase/SupabaseProductAdapter.ts`)。
 *
 * ✅ **而 15 格【多數今天有別的東西在守】**(2026-09-01 實量, 分母 700 支 `*.test.ts(x)`,
 *   涵蓋 `packages/adapters` `packages/domain` `packages/use-cases` `apps/<app>/src`;
 *   🟢 正對照 `findByHandle` ⇒ 3 支檔 · 🔵 負對照現造方法名 ⇒ 0):
 *   · `findById` / `findByHandle` / `listByCategory` / `listAllProducts` / `listCategories`
 *     / `listByFitment` / `listGeneral` / `searchByKeyword` ⇒ 各有 2-12 支檔命中
 *   🔴 **而兩格值得單獨講, 而它們的結論相反**:
 *     · `listByBrand` —— InMemory 那層有測(`InMemoryProductRepository.test.ts:183`),
 *       **而 Supabase 那支沒有**(`SupabaseProductAdapter.ts:356` 有實作)。
 *       🔴 **而它是活的**:production 真呼叫端 =
 *       `apps/storefront/src/lib/recommendations/rule-based-engine.ts:159-160`(推薦引擎)
 *       ⇒ 而 `rule-based-engine.test.ts` 測的是【引擎】, 它自己 stub 了一個 `listByBrand`
 *       ⇒ ⇒ **引擎有測, 而那句 Supabase 查詢沒有。⇒ 這一格是真缺口。**
 *     · `save` —— 同樣只有 InMemory 那層有測(`InMemoryProductRepository.test.ts:54/259/261`),
 *       **而 production 非測試呼叫端 = 0** ⇒ 🔴 **那是死路** ⇒ 該問的不是「要不要補測試」,
 *       是「它為什麼還在」。
 *   ⚠️ **未查**:那 4 個 year-range 格我只驗到【檔層命中】,
 *     **沒有逐格對照 `InMemoryProductRepository.test.ts`**。
 *
 * 🎯 **⇒ 那為什麼不刪掉本檔**:底下那 15 條是**寫下來的契約文字**, 而那是它今天唯一的價值。
 *   而**接上它**(讓 `runProductRepositoryContract` 真的被呼叫)也不划算 ——
 *   `SupabaseProductAdapter.test.ts` 已經有 974 行, 接上去等於把同一批行為再寫一次。
 * 🔵 **⇒ 而本檔的檔名是 `.contract.ts` 不是 `.test.ts` —— 那一格它是誠實的。**
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

    describe('listAllProducts', () => {
      // 接線 plan C4:回全目錄非下架 product(不綁分類)。真斷言在各 impl 自備 fixture
      // (SupabaseProductAdapter.test.ts 分頁迴圈 mock / InMemoryProductRepository.test.ts 全庫存回傳),
      // 此 framework 維持 it.todo。
      it.todo('SupabaseProductAdapter 接 contract 時實作:.range 分頁迴圈撈全目錄、不綁 category_id、繞 db-max-rows 上限(2026-08-18 實測 2000,~~原寫 1000~~)');
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

    describe('listGeneral', () => {
      it.todo('SupabaseProductAdapter 落地時實作:回 fitments 為空陣列(通用款)的 entity 陣列;fitments 非空(含元素全髒)不算通用');
    });

    describe('searchByKeyword', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:回 Paginated<Product> + empty query 回空 items + offset/limit 分頁');
    });

    describe('save', () => {
      it.todo('main-b SupabaseProductAdapter 落地時實作:create / update 統一入口、wire-level immutability(對齊 ADR-0003 §3.3)');
    });
  });
}
