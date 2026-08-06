// products-home-limit.test.ts — 首頁 N°02 取數必須 > 桌機軌道格數(H6 / D-131 連動;2026-08-06)
//
// 🔴 為什麼需要這支:Sean 2026-08-06 拍板「首頁版面忠實照 OD、不因資料現況遷就」之後,
//    首頁取數從共用的 4 筆獨立出來。**取數與格數是兩個檔案裡的兩個數字** ——
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

/** 從原始碼取首頁取數(不 import,理由見上)。 */
function homeLimit(): number {
  const m = SRC.match(/HOME_FEATURED_LIMIT\s*=\s*(\d+)/);
  expect(m, '找不到 HOME_FEATURED_LIMIT ⇒ 下面的比較會拿 undefined 去比').not.toBeNull();
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

  it('🔴 首頁取數 > 桌機格數(**等於**只是剛好填平、軌道仍然捲不動)', () => {
    const cols = desktopColumns();
    const limit = homeLimit();
    expect(
      limit,
      `首頁取 ${limit} 筆、桌機 ${cols} 格 ⇒ 填不滿或剛好填平,橫捲捲不動、右邊會空`,
    ).toBeGreaterThan(cols);
  });

  it('🔴 會員中心那份**不受影響**(兩頁的「要幾筆」是各自的版面決定)', () => {
    // 兩個 cache key 必須分開:共用一把會讓先進來的那一頁決定另一頁拿到幾筆
    expect(SRC, '兩份取數共用 cache key ⇒ 筆數會互相污染').toMatch(/'featured-ui-products-v2'/);
    expect(SRC, '首頁取數沒有自己的 cache key').toMatch(/'home-featured-ui-products-v1'/);
    expect(SRC, '會員中心的 4 筆被動掉了').toMatch(/ACCOUNT_FEATURED_LIMIT = 4/);
    // 首頁那支真的被首頁用到(不然這整支守的是一個沒人呼叫的常數)
    const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
    expect(page, '首頁沒有改用 fetchHomeFeaturedProducts').toMatch(/fetchHomeFeaturedProducts\(\)/);
  });
});
