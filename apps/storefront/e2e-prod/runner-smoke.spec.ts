import { test, expect } from '@playwright/test';

/**
 * #288-a 接線驗證 —— 證明「production build E2E 這條管線跑得起來,而且真的接到資料」。
 *
 * 🔴 為什麼**不能**只驗首頁(code-reviewer R1 MF-5,已實測坐實):
 *   首頁三個資料來源全都自帶 catch 並 fallback 成空 ——
 *   `lib/products.ts` 的 `fetchFeaturedProducts`(:249-256)/ `fetchCategories`(:482-489)/
 *   taxonomy(:535-542),外加 `app/page.tsx:85-88` 的 garage 區塊。
 *   ⇒ **資料庫完全沒設定時,首頁照樣 200 + 骨架可見** → 只驗首頁的 smoke 會綠。
 *   合併「GitHub secret 未設定會內插成空字串」這個事實,整條 CI 會在零資料庫下全綠。
 *   那正是本片要防的假綠,卻差點由本片自己製造出來。
 *
 * 🔴 **`/products` 一樣有 fallback ——防線不是「沒有 fallback」,是下面那兩個斷言**
 *   (Fable 審查 F2 更正;本檔前一版寫「/products 沒有吞錯誤的 fallback」= **假宣稱**):
 *   `lib/products.ts:387-390` 的 `catch` 會回 `{ products: [], total: 0, error: true }`,
 *   `ProductsPage.tsx` 隨即渲染「載入失敗、請稍後再試」,**HTTP 仍是 200**。
 *   ⇒ 只驗 `response.ok()` 在資料庫全壞時**會綠**。本檔之所以會紅,靠的是:
 *     ①`.pp-grid` 內找不到商品卡 → `toBeVisible()` 逾時
 *     ②`.pp-count` 在 error 態顯示 `0 件商品` → `total > 0` 不成立
 *   🔴 **後續片作者注意:不得把這兩個斷言換成 `response.ok()` 之類的淺斷言。**
 *
 * ⇒ 選 `/products` 而非首頁的真正理由:它是 `force-dynamic`(app/products/page.tsx:30)、
 *   每次請求真打 Supabase,且**錯誤態在畫面上留下可斷言的痕跡**(件數歸零、無卡片)。
 *
 * 🔴 精確字面(codex #288-a MF4 指正,原「DB 壞掉會紅」句式範圍過大、已更正):
 *   本檔只斷言卡片數 >0 與 `.pp-count` >0,精確攔住的是
 *   **「CI 冷快取下,核心商品 RPC 無法提供非零商品」**這一種情況。
 *   **攔不住**:①taxonomy/分類/品牌統計個別失敗、但核心商品 RPC 本身成功
 *   ②錯接到另一個「也有商品」的 Supabase project ③本機殘留 warm cache 掩蓋失敗。
 *
 * 本檔只做「管線 + 資料連通」的最低保證,**不守任何篩選行為**
 * (品牌 / 分頁 / 選車 / 深連結依序在 #288-c / d / e)。
 */
test('production build 起得來,且 /products 真的取到目錄資料', async ({ page, isMobile }) => {
  const response = await page.goto('/products');
  expect(response?.ok(), '/products 應回 2xx').toBe(true);

  // ① 商品卡真的被 SSR 出來(限縮在 .pp-grid 內,避免抓到頁面其他 /products/ 連結)
  const cards = page.locator('.pp-grid a[href^="/products/"]');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count(), '目錄第 1 頁應至少有 1 張商品卡').toBeGreaterThan(0);

  // ② 件數顯示是「真的數字且大於 0」——資料庫斷線時這裡會是 0 或不存在
  const countText = await page.locator('.pp-count').innerText();
  const total = Number(countText.replace(/[^\d]/g, ''));
  expect(Number.isFinite(total) && total > 0, `.pp-count 應顯示大於 0 的件數,實得「${countText}」`)
    .toBe(true);

  // ③ #288-b:SSR 的 <html data-mobile> 必須反映 device 的 UA class
  //    (app/layout.tsx:83 以 UA regex /iPhone|Android|Mobile/i 判定、與 viewport 無關)。
  //    本斷言在兩個 project 下各驗一次 —— chromium(Desktop Chrome)→ 'false'、
  //    mobile(Pixel 5、UA 含 Android)→ 'true'。比「只驗 mobile=true」更強:
  //    也擋「mobile project 誤配到桌面 UA」與「桌面請求被誤判成 mobile」兩種回歸。
  //    isMobile fixture = project use 的 isMobile 旗標(Desktop Chrome=false / Pixel 5=true),
  //    與該 preset 的 UA 對齊,故可當「這個 project 該不該是 mobile」的期望來源。
  const dataMobile = await page.locator('html').getAttribute('data-mobile');
  expect(dataMobile, `html[data-mobile] 應反映 device UA class(isMobile=${isMobile})`).toBe(
    isMobile ? 'true' : 'false',
  );
});
