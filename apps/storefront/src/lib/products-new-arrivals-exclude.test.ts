// products-new-arrivals-exclude.test.ts — 新品區「只有一條路」的守門
//
// 🔴 **[2026-09-09 · 這支的題目換了, 而換題本身就是這片的重點]**
//   ⛔ ~~原本它是【兩邊對帳】~~:「新品區」曾經有兩個落點、兩把不同的尺 ——
//      A 新品頁 `/products?filter=new` 走 RPC, B 首頁那排「最新商品」完全不走 RPC
//      (`products_public` + `created_at desc`)⇒ 只改一邊 = 兩頁不同步。
//      那支測試比的是「兩份『維修零件』字面一不一致」。
//   🛑 **而它擋不住真正咬人的那個差別** —— 兩邊不同步的成因【不只】維修零件:
//      RPC 那側還有 ① 7 天新品視窗 ② **供應商批次日整天排除** ③ 未來時戳排除,
//      而首頁那條路一道都沒有 ⇒ 📌 Sean 2026-09-09 親眼看到的症狀。
//   ✅ 修法不是再加一格對帳, 是**把 B 那條路拆掉**:首頁改用 `parseCatalogQuery('filter=new')`
//      + `fetchCatalogPage` ⇒ 與新品頁同一個 query、同一個快取鍵、同一份快照。
//   ⇒ 🎯 **所以現在該釘的是「別再長出第二條路」**, 不是「兩條路要說同一句話」。
//
// ⚠️ 它擋不住什麼:它比的是**原始碼字面**, 不證正式庫真的排掉了那些商品,
//    也不證兩頁畫面上的前 10 顆逐字相同 —— 那要開瀏覽器走一次。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 🔴 不 import `lib/products.ts`(它帶 server-only, vitest 一 import 就爆)——
//    與隔壁 products-featured-limit.test.ts 同一種做法:讀原始碼字面。
const SRC = readFileSync(new URL('./products.ts', import.meta.url), 'utf8');
const MIGRATION = readFileSync(
  new URL(
    '../../../../supabase/migrations/20260827180000_m4b_storefront_new_arrivals_exclude_repair_parts.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('新品區 — 首頁那排與新品頁必須是【同一條路】', () => {
  it('首頁「最新商品」用新品頁自己的解析器組 query(filter=new)', () => {
    expect(SRC, '沒有用 parseCatalogQuery ⇒ 首頁又在自己組條件了').toMatch(
      /parseCatalogQuery\(new URLSearchParams\(FEATURED_QUERY_STRING\)\)/,
    );
    expect(SRC, "FEATURED_QUERY_STRING 不是 'filter=new' ⇒ 與 CTA 的網址對不起來").toMatch(
      /FEATURED_QUERY_STRING = 'filter=new'/,
    );
  });

  it('首頁「最新商品」走 fetchCatalogPage(= 新品頁那條 RPC 路)', () => {
    expect(SRC, '沒有走 fetchCatalogPage ⇒ 不會命中新品頁的同一份快照').toMatch(
      /fetchCatalogPage\(query, null, 'general'\)/,
    );
  });

  // 🔴 這一格是**回歸鎖**:舊那條路只要有人寫回來, 三道條件就又少了。
  // 🔴 **要先把註解剝掉再比** —— 檔裡那段留痕(`⛔ ~~listAllProducts({… orderBy:'created_desc' …})~~`)
  //    逐字寫著舊寫法, 而**那正是我們要留給下一個人看的東西**。連註解一起比 =
  //    這把尺會因為「有人把病史寫下來」而變紅, 量的不是它宣稱的東西。
  it('舊那條路沒有復活(listAllProducts + created_desc 不再餵首頁)', () => {
    const code = SRC.split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code, "orderBy: 'created_desc' 回來了 ⇒ 首頁又繞過 RPC 了").not.toMatch(
      /orderBy:\s*'created_desc'/,
    );
    expect(code, 'excludeCategoryFirstSegment 回來了 ⇒ 那個字面又有第二份了').not.toMatch(
      /excludeCategoryFirstSegment:/,
    );
  });
});

// ── SQL 那一半照舊釘 —— 它現在是【唯一】那把尺, 更該有人看著 ──────────────────
describe('新品區排除大類 — SQL 那一半', () => {
  // 🔴 這一格釘的是「兩個分支都要套到」——
  //    那兩段 SQL 的【縮排不同】(14 空格 vs 12 空格), 用單一字串比對去改會安靜只改一半,
  //    而 SQL 照樣合法、migration 照樣成功。症狀 = 一按車型篩選, 維修零件就冒回來。
  it('排除條件在【兩個分支】都在(兩行, 縮排不同)', () => {
    // 🔴 **不數「這個字串總共出現幾次」** —— 第一版那樣寫, 而它把
    //    `RAISE EXCEPTION '…c_new_arrivals_excluded_category…'` 的錯誤訊息也算了進去
    //    ⇒ 一把【有人改一句錯誤訊息就會紅】的尺, 量的不是它宣稱的東西。
    const codeLines = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--'));
    const branchHits = codeLines.filter(
      (l) =>
        /coalesce\(split_part\(p\.category_raw/.test(l) && l.includes('c_new_arrivals_excluded_category'),
    );
    expect(branchHits.length, '兩個 filtered CTE 分支各要有一行 ⇒ 少於 2 表示只改到一半').toBe(2);
  });

  // 🔴 判準必須是「取第一段」不是整串比對 —— 那是 Sean 拍甲的內容(以後多出子類自動跟著排)。
  it('用 split_part 取第一段, 不是整串相等', () => {
    expect(MIGRATION).toMatch(/split_part\(p\.category_raw,\s*' · ',\s*1\)/);
  });

  // ⚠️ 精品螺絲與螺帽是【另一個決定】—— 這一格擋「順手帶進去」。
  it('沒有把精品螺絲順手排掉', () => {
    const m = MIGRATION.match(/c_new_arrivals_excluded_category\s+constant\s+text\s*:=\s*'([^']+)'/);
    expect(m, '找不到 c_new_arrivals_excluded_category ⇒ 下面的比較會拿 undefined 去比').not.toBeNull();
    expect(m![1]!).not.toContain('精品螺絲');
  });
});
