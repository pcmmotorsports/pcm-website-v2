import { test, expect } from '@playwright/test';

/**
 * 多顆分類下側欄選分類要生效(Sean 2026-09-05 `21`「把多顆分類修好」)。
 *
 * 🔴🔴 **本檔存在的理由 = 兩個突變在單元測試層【殺不死】, 而它們住在這一層。**
 *   `products-url-state.hooks.test.tsx` 有 31 格, 而下面兩條防護把它拿掉之後**全綠**:
 *   ① `pendingWrittenCategoryRef`(送出 ≠ 落地)—— 單元測試把 `router` **mock 掉**,
 *      `replace` 永遠「成功」⇒ **「Next 靜默忽略」那個世界在那裡【不存在】。**
 *   ② `cat === null` 不算自選 —— 那個世界到得了(codex R3 指出「同一波改別的軸」可繞過
 *      等值早退, 而我照做造出 ㉚ 了), **而它的錯誤不留下可觀察的痕跡**
 *      (`join(',')` 對 `null` 不產生尾逗號)。
 *   ⇒ 📌 **本檔是那兩條的【驗證欠帳】** —— 這一層有真的 router、真的網址、真的重繪。
 *
 * 🔴 **照本套既有紀律(見 `runner-smoke.spec.ts` 檔頭)**:
 *   **不得**把斷言換成 `response.ok()` 之類的淺斷言 —— `/products` 在資料全壞時
 *   仍回 200 並渲染「載入失敗」。本檔靠的是**網址字面 + 膠囊數 + 件數**三個一起。
 *
 * ⚠️ **本檔【攔不住】什麼**:①它跑在 CI 的資料上, 分類名硬編會隨資料漂
 *   ⇒ 改成**從側欄現場讀**兩顆真的存在的分類, 不寫死名字。
 *   ②它不驗排序、不驗分頁 ③`clearAll` 那一格只等 1.5 秒 ——
 *   **更慢的競態它看不到**(那是「這一次沒撞上」不是「不會撞」)。
 *   🔴 ④**手機版沒有被本檔涵蓋**(2026-09-05 實測:mobile project 跑同一格
 *      ⇒ `button.fs-tree-row.fs-tree-l1` **在 DOM 裡而 `hidden`**)。
 *      成因不是壞掉:手機的分類入口是 **`FilterDrawer`**(ADR-0007 手機決定 7/8, 兩個獨立入口),
 *      側欄 `FilterSide` 在手機是 CSS 藏起來的。⇒ 📌 **那是【另一個元件的另一格】, 不是本格的手機版。**
 *      🛑 而 hook 本體(`use-catalog-filter-url-sync.tsx`)兩邊共用 ⇒ 桌機這一格殺得死 hook 的突變;
 *         **抽屜那條入口自己的接線仍是未覆蓋的缺口**, 明寫在這裡, 不假裝有。
 */
test.skip(({ isMobile }) => !!isMobile, '手機分類入口是 FilterDrawer 不是側欄(見檔頭 ④)');

test('多顆分類:側欄第三顆要 union 進網址, 刪一顆不復活, 清除全部要清乾淨', async ({ page }) => {
  await page.goto('/products');

  // 🔵 從側欄【現場讀】兩顆分類 —— 不寫死名字(CI 的資料會漂)
  const rows = page.locator('button.fs-tree-row.fs-tree-l1');
  await expect(rows.first()).toBeVisible();
  const names: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const raw = (await rows.nth(i).innerText()).trim();
    // 那一列長「名稱\n件數」⇒ 取第一行
    names.push(raw.split('\n')[0]!.trim());
  }
  const [a, b, c] = names as [string, string, string];

  // ① 先造出「多顆」世界:直接用網址帶兩顆(那正是客人多選之後的樣子)
  await page.goto(`/products?categories=${encodeURIComponent(`${a},${b}`)}`);
  await expect(page.locator('.ac-chip')).toHaveCount(2);
  // 🔴 `:visible` + `.first()` 缺一不可 —— 串流重疊窗口裡 `.pp-count` 會**短暫有兩顆**
  //   (一顆看得見、一顆看不見, 字一樣), 而 strict mode 對兩顆是丟例外。
  //   正本量測與病史寫在 `global-setup.ts` 讀件數那一段。
  const ppCount = page.locator('.pp-count:visible').first();
  const countBefore = (await ppCount.innerText()).trim();

  // ② 側欄點第三顆 ⇒ 網址要多一顆、膠囊要三顆
  await rows.nth(2).click();
  await expect(page.locator('.ac-chip')).toHaveCount(3);
  await expect
    .poll(async () => new URL(page.url()).searchParams.get('categories'))
    .toBe(`${a},${b},${c}`);
  // 🔴 件數也要變 —— **只驗網址不夠**:側欄那一列「亮起來」在修好與沒修兩個世界都會發生
  //   (2026-09-05 實測:未修時側欄亮而網址/件數/膠囊三個都不動 = 「半反應」)。
  await expect
    .poll(async () => (await ppCount.innerText().catch(() => '')).trim())
    .not.toBe(countBefore);

  // ③ 刪掉一顆膠囊 ⇒ 少一顆, 而且【不得復活】(⟦search-CHIPDELETEDEADURL⟧ 的回歸)
  await page.locator('.ac-chip', { hasText: b }).click();
  await expect(page.locator('.ac-chip')).toHaveCount(2);
  await page.waitForTimeout(1500);
  await expect(page.locator('.ac-chip')).toHaveCount(2); // 等一下下, 沒有跳回三顆

  // ④ 清除全部 ⇒ 網址清空、膠囊 0, 而且 1.5 秒內不得被寫回
  //   🔵 頁面上有**兩顆**同名按鈕(`fs-clear` 側欄 / `ac-clear-all` 膠囊列)——
  //      2026-09-05 我實走時點錯過一次, 三個數都沒動、看起來像功能壞掉。**用 class 指名。**
  await page.locator('button.ac-clear-all').click();
  await expect(page.locator('.ac-chip')).toHaveCount(0);
  await expect.poll(async () => new URL(page.url()).searchParams.get('categories')).toBeNull();
  await page.waitForTimeout(1500);
  await expect(page.locator('.ac-chip')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('categories')).toBeNull();
});
