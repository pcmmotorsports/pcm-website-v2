// products-featured-limit.test.ts — 「最新商品」取數必須 > 首頁桌機軌道格數(H6 / D-131→D-132;2026-08-06)
//
// 🔴 為什麼需要這支:Sean 2026-08-06 拍板「首頁版面忠實照 OD、不因資料現況遷就」之後,
//    取數從 4 筆提高。**取數與格數是兩個檔案裡的兩個數字** ——
//    有人改了其中一個,畫面會退回「橫捲捲不動、右邊空一格」,而三綠全綠。
//    這條把兩邊釘在一起,而且**格數是從 CSS 現算的**(不寫死 5)。
//
// ⚠️ 它擋不住什麼:它只證「取數的上限夠大」,不證資料庫真的有那麼多商品 ——
//    真站商品不足時畫面照樣填不滿,那是資料面的事、不是版面。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 🔴 **不 import `lib/products.ts`**:它帶 `server-only`,在 vitest 環境一 import 就爆
//    (repo 既有同款坑,`brand-url.ts` 的 `BRAND_PRODUCT_SLOTS` doc 記過)。
//    這條守門要比的是「兩個檔案裡的兩個數字」⇒ 兩邊都讀原始碼字面,與 CSS 那半同一種做法。
const SRC = readFileSync(new URL('./products.ts', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles/home.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** 從原始碼取「最新商品」取數(不 import,理由見上)。 */
function featuredLimit(): number {
  const m = SRC.match(/FEATURED_LIMIT\s*=\s*(\d+)/);
  expect(m, '找不到 FEATURED_LIMIT ⇒ 下面的比較會拿 undefined 去比').not.toBeNull();
  return Number(m![1]);
}

/** 從 `.b-carousel-item` 的 flex-basis 算式反推桌機格數(OD:`calc((100% - 64px) / 5)`)。 */
function desktopColumns(): number {
  const m = CSS.replace(/\s+/g, ' ').match(/\.b-carousel-item\s*\{[^}]*flex:\s*0 0 calc\(\(100% - \d+px\) \/ (\d+(?:\.\d+)?)\)/);
  expect(m, '找不到桌機軌道的格數算式 ⇒ 下面的比較會拿 undefined 去比').not.toBeNull();
  return Number(m![1]);
}

describe('首頁 N°02 取數 vs 軌道格數', () => {
  it('🔴 前提:桌機格數真的解析得出來(解析失敗會讓下面那條恆真)', () => {
    const cols = desktopColumns();
    expect(cols).toBeGreaterThan(0);
    expect(Number.isFinite(cols)).toBe(true);
  });

  it('🔴 取數 > 首頁桌機格數(**等於**只是剛好填平、軌道仍然捲不動)', () => {
    const cols = desktopColumns();
    const limit = featuredLimit();
    expect(
      limit,
      `取 ${limit} 筆、首頁桌機 ${cols} 格 ⇒ 填不滿或剛好填平,橫捲捲不動、右邊會空`,
    ).toBeGreaterThan(cols);
  });

  it('🔴 兩頁共用同一個取數(Sean `D-132-A` 更正:一起變多),而且常數真的被讀到', () => {
    // 🔴 提高筆數而不換 cache key ⇒ 舊的 4 筆快取會讓新筆數 15 分鐘內看不到(那會被當成「沒生效」)
    expect(SRC, 'cache key 沒換版 ⇒ 舊的 4 筆快取還在供應').toMatch(/'featured-ui-products-v3'/);
    expect(SRC, '取數沒有被 adapter 真的讀到 ⇒ 常數只是擺著好看').toMatch(/limit:\s*FEATURED_LIMIT/);
    // 兩個消費端都走同一支(首頁 + 會員中心)
    const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
    const account = readFileSync(new URL('../app/account/page.tsx', import.meta.url), 'utf8');
    expect(page, '首頁沒有用 fetchFeaturedProducts').toMatch(/fetchFeaturedProducts\(\)/);
    expect(account, '會員中心沒有用 fetchFeaturedProducts ⇒ 兩頁不會一起變多').toMatch(/fetchFeaturedProducts\(\)/);
  });
});
