import { test, expect } from '@playwright/test';
import { requireProbe } from './probe';

/**
 * 出過事的點 —— 各補一支迴歸(M-6-05 片 2;Sean 2026-09-14 拍 Q13 甲)。
 *
 * 每一支對著板上一列, 而且只守【客人會看到的那個症狀】, 不守實作:
 *   ① ⟦supply-BRANDFILTERZERO⟧ 品牌頁曾一次印「0 件商品 · 找不到符合條件的商品」而伺服器回 723 件。
 *      ⇒ 守:品牌篩選後「N 件商品」的 N = 畫面上真的畫出來的卡片數, 且 N > 0, 且沒有「找不到」字樣。
 *   ② ⟦db-SEARCHFACETMUTEX⟧ 客人一點篩選, 打的字就被丟掉(關鍵字路與 facet 路互斥)。
 *      ⇒ 守:關鍵字 + 分類同時帶, 只剩那個分類裡標題含那個字的(字被丟掉的話, 整個分類 7 件會全部出來)。
 *   ③ ⟦search-CJKZERO1⟧ 中文關鍵字搜出 0 筆。⇒ 守:搜一個【不是分類名】的中文詞, 有卡片而且第一張命中。
 *   ④ 搜尋改寫(Sean 2026-09-11 拍;`products/page.tsx` Q47 甲):打的字剛好是分類名 ⇒ 變成那個分類的篩選,
 *      原字留在 `q0`。⇒ 守:搜「煞車」落到分類「煞車系統」, 而且有卡片。
 *      🔴 這一格也是②③選詞的理由:「腳踏」「煞車」都會被改寫成分類, 拿它們當關鍵字測會測到別的東西。
 *   ⑤ ⟦search-TAXONOMYTIMEOUT⟧ 車款下拉靜默降級成空的。⇒ 守:目錄頁「選擇廠牌」點開有真的選項(鑽機種子 = Aprilia)。
 *      ⚠️ 只守正面:那條 RPC 在 server 端打, 瀏覽器攔不到 ⇒ 「壞掉時畫面會說」那半住在
 *         products-message-state.tsx 的單測, 不在這裡。
 *
 * 種子(`scripts/storefront-probe/seed.sql`):rizoma 7 件;分類「儀表與控制器」7 件, 其中標題含「鋁合金」的 1 件。
 * 鑽機外(沒 E2E_BASE_URL)整檔 skip。
 */

const CARD = 'main a[href^="/products/"] article';
const COUNT = /^([1-9]\d*) 件商品$/;

async function shownCount(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByRole('main').getByText(COUNT).first().textContent();
  return Number(COUNT.exec(text ?? '')?.[1]);
}

test.describe('目錄出過事的點(鑽機)', () => {
  test.beforeEach(() => requireProbe());

  test('⟦supply-BRANDFILTERZERO⟧ 品牌篩選:件數 = 卡片數, 而且不是 0', async ({ page }) => {
    await page.goto('/products?pbrands=rizoma');
    const n = await shownCount(page);
    expect(n).toBeGreaterThan(0);
    await expect(page.locator(CARD)).toHaveCount(n);
    await expect(page.getByText('找不到符合條件的商品')).toHaveCount(0);
  });

  test('⟦db-SEARCHFACETMUTEX⟧ 關鍵字 + 分類同時帶:字沒有被丟掉', async ({ page }) => {
    await page.goto(`/products?search=${encodeURIComponent('鋁合金')}&category=${encodeURIComponent('儀表與控制器')}`);
    const cards = page.locator(CARD);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('鋁合金腳踏後移組');
    await expect(page).toHaveURL(/search=/); // 字還在網址上, 沒被改寫掉
  });

  test('⟦search-CJKZERO1⟧ 中文關鍵字搜得到', async ({ page }) => {
    await page.goto(`/products?search=${encodeURIComponent('鋁合金')}`);
    expect(await shownCount(page)).toBeGreaterThan(0);
    await expect(page.locator(CARD).first()).toContainText('鋁合金');
  });

  test('搜尋改寫:打分類名 ⇒ 變成那個分類, 而且有貨', async ({ page }) => {
    await page.goto(`/products?search=${encodeURIComponent('煞車')}`);
    await expect(page).toHaveURL(/category=%E7%85%9E%E8%BB%8A%E7%B3%BB%E7%B5%B1/); // 煞車系統
    await expect(page).toHaveURL(/q0=%E7%85%9E%E8%BB%8A/); // 原字留著
    await expect(page.getByRole('heading', { level: 1, name: '煞車系統' })).toBeVisible();
    expect(await shownCount(page)).toBeGreaterThan(0);
  });

  test('⟦search-TAXONOMYTIMEOUT⟧ 車款下拉點開有真的廠牌, 不是空的', async ({ page }) => {
    await page.goto('/products');
    const brand = page.getByRole('combobox', { name: '選擇廠牌' }).first();
    await expect(brand).toBeEnabled();
    await brand.click();
    await expect(page.getByRole('listbox', { name: '選擇廠牌選項' }).getByRole('option', { name: 'Aprilia' })).toBeVisible();
  });
});
