// products-new-arrivals-exclude.test.ts — 新品區排除「維修零件」大類的【兩邊對帳】守門
//
// 🔴 為什麼需要這支:「新品區」有【兩個落點, 兩把不同的尺】——
//    A 新品頁 `/products?filter=new` ⇒ RPC(SQL)
//    B 首頁那排「最新商品」        ⇒ 完全不走 RPC(products_public + created_at desc)
//    ⇒ **只改一邊 = 首頁與新品頁又不同步**, 而那正是 Sean 2026-08-27 抱怨的另一件事
//    ⇒ ⇒ 這片若只做一半, 它會【製造出它要修的那個症狀】。
//    而那個「維修零件」字串在【兩個檔案】各有一份, 沒有任何東西在對帳它們 —— 這支就是那個東西。
//
// ⚠️ 它擋不住什麼:它比的是**原始碼字面**, 不證正式庫真的排掉了那 1631 件。
//    那一格要 Sean 在 SQL Editor 貼回數字才算, 本機拋棄式庫 0 件商品 ⇒ 證不了。
//
// 🔴 而它【不是恆真格】:把任一邊的字串改掉、或把 migration 那半刪掉, 它就會紅
//    (2026-08-27 施工當下用兩發突變演過, 見 commit body)。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 🔴 不 import `lib/products.ts`(它帶 server-only, vitest 一 import 就爆)——
//    與隔壁 products-featured-limit.test.ts 同一種做法:兩邊都讀原始碼字面。
const SRC = readFileSync(new URL('./products.ts', import.meta.url), 'utf8');
const MIGRATION = readFileSync(
  new URL(
    '../../../../supabase/migrations/20260827180000_m4b_storefront_new_arrivals_exclude_repair_parts.sql',
    import.meta.url,
  ),
  'utf8',
);

/** 從 TS 那半取排除的大類字面(不 import, 理由見上)。 */
function tsExcluded(): string {
  const m = SRC.match(/NEW_ARRIVALS_EXCLUDED_CATEGORY\s*=\s*'([^']+)'/);
  expect(m, '找不到 NEW_ARRIVALS_EXCLUDED_CATEGORY ⇒ 下面的比較會拿 undefined 去比').not.toBeNull();
  return m![1]!;
}

/** 從 SQL 那半取排除的大類字面。 */
function sqlExcluded(): string {
  const m = MIGRATION.match(/c_new_arrivals_excluded_category\s+constant\s+text\s*:=\s*'([^']+)'/);
  expect(m, '找不到 c_new_arrivals_excluded_category ⇒ migration 那半沒有這個常數').not.toBeNull();
  return m![1]!;
}

describe('新品區排除大類 — 兩個落點必須說同一件事', () => {
  it('TS 那半與 SQL 那半的大類字面【相同】', () => {
    expect(tsExcluded()).toBe(sqlExcluded());
  });

  it('首頁那排真的把選項傳下去了(常數不是擺著好看)', () => {
    expect(SRC, '首頁 listAllProducts 沒有帶 excludeCategoryFirstSegment ⇒ B 落點沒接上').toMatch(
      /excludeCategoryFirstSegment:\s*NEW_ARRIVALS_EXCLUDED_CATEGORY/,
    );
  });

  // 🔴 這一格釘的是「兩個分支都要套到」——
  //    那兩段 SQL 的【縮排不同】(14 空格 vs 12 空格), 用單一字串比對去改會安靜只改一半,
  //    而 SQL 照樣合法、migration 照樣成功。症狀 = 一按車型篩選, 維修零件就冒回來。
  it('SQL 那半:排除條件在【兩個分支】都在(兩行, 縮排不同)', () => {
    // 🔴 **不數「這個字串總共出現幾次」** —— 第一版我那樣寫, 而它把
    //    `RAISE EXCEPTION '…c_new_arrivals_excluded_category…'` 的錯誤訊息也算了進去
    //    ⇒ 期望 4 實得 5 ⇒ 一把【有人改一句錯誤訊息就會紅】的尺, 量的不是它宣稱的東西。
    //    ⇒ 改成只釘【兩個分支那兩行】—— 那才是「有沒有只改一半」真正的判別式。
    const codeLines = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--'));
    const branchHits = codeLines.filter(
      (l) =>
        /coalesce\(split_part\(p\.category_raw/.test(l) && l.includes('c_new_arrivals_excluded_category'),
    );
    expect(branchHits.length, '兩個 filtered CTE 分支各要有一行 ⇒ 少於 2 表示只改到一半').toBe(2);
  });

  // 🔴 判準必須是「取第一段」不是整串比對 —— 那是 Sean 拍甲的內容(以後多出子類自動跟著排)。
  it('SQL 那半用 split_part 取第一段, 不是整串相等', () => {
    expect(MIGRATION).toMatch(/split_part\(p\.category_raw,\s*' · ',\s*1\)/);
  });

  // ⚠️ 精品螺絲與螺帽是【另一個決定】—— 這一格擋「順手帶進去」。
  it('沒有把精品螺絲順手排掉', () => {
    // 🔴 這裡不能寫「檔案裡沒有出現過『精品螺絲』」—— 檔頭有一句註解正是在講【它留著】,
    //    而那句註解本身是我們要的東西。要釘的是【它沒有被拿去當排除值】。
    expect(tsExcluded()).not.toContain('精品螺絲');
    expect(sqlExcluded()).not.toContain('精品螺絲');
  });
});
