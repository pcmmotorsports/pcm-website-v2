import { test, expect } from '@playwright/test';

/**
 * 「合完 `main` 之後客人會看到什麼」裡**唯讀、不用登入**的那幾條, 做成可以跑的格。
 * 正本清單 = `~/pcm-mailbox/dev→main-一張紙-20260905.md` §②/§⑤(線 `-auth` 列, 線 `-f3` 做成走查表)。
 *
 * 🔴 **本檔存在的理由 = 它們是【外部模式】唯一有意義的那一種格**:
 *   `PCM_E2E_BASE_URL=https://…` ⇒ 同一支 spec 就對著那台機器問同樣的問題。
 *   ⚠️ 而**外部模式的綠證明的是「那台機器現在的行為」, 不是「這棵樹的碼對」**(見 config 檔頭)。
 *
 * 🛑 **兩格都不寫入**:只 `goto` + 讀畫面。不登入、不加購物車、不按任何送出。
 *   ⇒ 所以它們對**正式站**跑是安全的, 而那正是「合完之後走一遍」要的。
 */

// ═══ ① ⟦search-BRANDMULTIWORD⟧:打完整品牌名不再 0 筆 ═══
//   🔬 病史(板列 340):`DBK` ⇒ 8 筆, 而 `DBK SPECIAL` ⇒ **0 筆**, 型錄裡有 1,508 件。
//     成因已用 x-vercel-id 對 runtime log 實證:型錄命中 >1000 ⇒ 超過 `RPC_ID_CAP` ⇒ 退回舊路,
//     而舊路那四欄 ILIKE **沒有品牌那一塊**。修法 `a01b61674`(在 `dev`, 合 `main` 之前正式站仍是舊行為)。
//   🎯 **⇒ 這一格是「main 到底換了沒」最會說話的那一個** —— 舊碼 0 筆 / 新碼有筆數, 兩個世界印不同的東西。
//   🔴 **不用搜尋浮層量** —— 它上限 8(`lib/search.ts` `SEARCH_OVERLAY_LIMIT`)⇒ 在 8 飽和,
//     而 2026-09-05 就是因為那個飽和, 三個不同的輸入印出同一個 `8` 而看起來像「三格全過」。
//     `/search` 這一頁印的是**共 N 件**, 它不飽和。
test('搜尋「DBK SPECIAL」要撈得到, 而且撈回來的每一張都是那個品牌', async ({ page }) => {
  await page.goto('/search?q=' + encodeURIComponent('DBK SPECIAL'));

  // 🔴 **選 `article.pcard` 而不是那個 `<a>`**(2026-09-05 實測踩到):
  //   搜尋結果頁的連結是 `<a style="display:contents">` ⇒ **它沒有 layout box**,
  //   `toBeVisible()` 對它不成立 ⇒ 第一版用 `a[href^="/products/"]` 的那一發**紅了, 而資料是對的**
  //   (同一發 curl 回的 HTML 逐字有 `共 1508 件,顯示前 25 件` 與 `/products/dbk-gr06`)。
  //   ⇒ 📌 **那一紅的訊息會讀成「還是舊碼」, 而真正的成因是我挑了一個看不見的節點。**
  const cards = page.locator('.pp-grid article.pcard');

  // 🔴🔴 **這一格的紅有【三個世界】, 而我第一版只寫了兩個 —— 第三個當場就撞到了。**
  //   2026-09-05 本機這一發:0 張卡, 而 server log 印 `[searchProducts] searchByKeyword failed`
  //   × 2 與 16 次 `canceling statement due to statement timeout`
  //   ⇒ 🎯 **那不是舊碼、也不是型錄沒貨, 是【搜尋那條路這一次整個失敗了】。**
  //   ✅ 而那個世界**畫面上分得出來** —— `search/page.tsx:69-72` 對「這次撈失敗」畫的是
  //      `<p role="status">搜尋暫時無法使用…</p>`, 與「沒有找到」是**兩句不同的字**(那是刻意的)。
  //   ⇒ 📌 **把畫面上那句字讀進失敗訊息, 這一紅才指得出方向** ——
  //      不然它會叫下一個人去查「main 合了沒」, 而真正的成因是資料庫那一刻在逾時。
  // 🔴 **讀畫面要在【expect 失敗之後】**(code-reviewer nit-6):`expect` 會重試,
  //   而在它之前取的那一份是「重試開始前那一刻」的畫面 —— 兩者在慢的世界裡不是同一個東西。
  try {
    await expect(cards.first()).toBeVisible();
  } catch {
    const onScreen = (await page.locator('.pp-page p').allInnerTexts().catch(() => [])).join(' / ');
    // 🔴🔴 **這一格的紅有【四個世界】, 而我第一版只寫了兩個 —— 第三個當場就撞到了。**
    //   2026-09-05 本機那一發:0 張卡, 而 server log 印 `[searchProducts] searchByKeyword failed`
    //   ×2 與 18 次 `canceling statement due to statement timeout`
    //   ⇒ 🎯 **那不是舊碼、也不是型錄沒貨, 是【搜尋那條路這一次整個失敗了】。**
    //   ✅ 而那個世界**畫面上分得出來** —— `search/page.tsx:69-72` 對「這次撈失敗」畫的是
    //      `<p role="status">搜尋暫時無法使用…</p>`, 與「沒有找到」是**兩句不同的字**(那是刻意的)。
    //   🔵 第四個世界(nit-7):**一段字都沒讀到** —— 頁面沒載到 / 被保護頁擋住,
    //      它與「載到了而文字不認得」原本印同一句, 現在分開。
    //   ⇒ 📌 **把畫面上那句字讀進失敗訊息, 這一紅才指得出方向** ——
    //      不然它會叫下一個人去查「main 合了沒」, 而真正的成因是資料庫那一刻在逾時。
    const world =
      onScreen === ''
        ? '④【整頁一段字都沒讀到】—— 頁面沒載到 / 被保護頁擋住, 先確認 baseURL 與 share token'
        : onScreen.includes('搜尋暫時無法使用')
          ? '③【搜尋那條路這次失敗了】(畫面逐字「搜尋暫時無法使用」)—— 多半是 DB 逾時, 與 main 合了沒無關, 重跑一次'
          : onScreen.includes('沒有找到')
            ? '①舊碼(舊路不比對品牌名)或 ②型錄裡今天沒有這家的貨 —— 用 `/search?q=DBK` 分辨(它不經過品牌那條路)'
            : `讀到字而四句都不認得, 原文:「${onScreen.slice(0, 80)}」`;
    throw new Error(`一張卡都沒有 ⇒ ${world}`);
  }

  const n = await cards.count();
  // ⛔ ~~`expect(n).toBeGreaterThan(0)`~~ —— 上一行 `toBeVisible()` 過了就保證 `count() >= 1`
  //   ⇒ 那是一條**任何世界都不會紅**的斷言(code-reviewer 2026-09-05 N-1)。拿掉, 不留裝飾。

  // 🔵 第二把尺:頁面自己印的「共 N 件」——它**不飽和**(卡片數被一頁 25 筆夾住, 這個數不會)。
  //   🔴🔴 **解析必須抓群組, 不能把非數字全刪**(code-reviewer must-fix, 而它是恆真的):
  //   那顆 `<p>` 逐字是 `共 1508 件,顯示前 25 件` ⇒ **同一段裡有兩個數字**
  //   ⇒ `replace(/[^\d]/g,'')` 會接成 `150825`, 而 `> 0` 對它照樣成立
  //   ⇒ 📌 **一把把兩個數字黏起來的尺, 在「只問大於 0」的斷言下永遠不會出聲。**
  //   ⚠️ 而 `total > 25` 時才印尾巴 ⇒ 這個世界(1508 件)**恆走那一支**, 不是邊角。
  const totalText = (await page.locator('.pp-page p', { hasText: /共 [\d,]+ 件/ }).first().innerText()).trim();
  const m = /共 ([\d,]+) 件/.exec(totalText);
  expect(m, `「${totalText}」裡找不到「共 N 件」`).not.toBeNull();
  const total = Number((m?.[1] ?? '').replace(/,/g, ''));
  expect(total, `「${totalText}」解出的總數不是大於 0 的數`).toBeGreaterThan(0);
  // 🔵 兩把尺要**互相對得上**:一頁 25 筆 ⇒ 卡片數不可能多於總數。
  expect(n, `卡片 ${n} 張 > 總數 ${total} ⇒ 兩把尺打架, 兩把都不能用`).toBeLessThanOrEqual(total);

  // 🔴 只驗「有幾筆」不夠:一個把所有商品都回來的壞修法也會讓筆數 > 0。
  //   ⇒ 逐張問**品牌那一格**(`.pcard-brand`, `ProductCard.tsx:261`)——
  //   ⛔ ~~量整張卡的 innerText~~ 會連**商品名稱**裡有 DBK 的別家貨一起放過(code-reviewer N-2)。
  for (let i = 0; i < n; i += 1) {
    const brand = (await cards.nth(i).locator('.pcard-brand').innerText()).trim();
    expect(brand, `第 ${i + 1} 張卡的品牌是「${brand}」, 不是 DBK`).toContain('DBK');
  }
});

// ═══ ② 分頁標題:站名統一成中文(Sean 2026-09-05 `20 甲`)═══
//   🔴 挑 `/stores` 而**不是** `/account`:`/account` 要登入, 而登入對正式站是一個真的動作。
//     這一格要能安全地對正式站跑 ⇒ 受詞換成**同一片改到、而不用登入**的那一頁
//     (`src/app/stores/page.tsx` 的 `metadata.title`)。
//   ⚠️ **它證不到 `/account` 那一頁** —— 那一格今天沒有人在守, 明寫在這裡, 不假裝有。
test('分頁標題印中文站名, 不再印 PCM MOTOR PARTS', async ({ page }) => {
  await page.goto('/stores');
  const title = await page.title();
  expect(title, `標題逐字:「${title}」`).toContain('PCM重機零件販售');
  expect(title, '還印著英文站名 ⇒ 那一片沒上').not.toContain('PCM MOTOR PARTS');
});
