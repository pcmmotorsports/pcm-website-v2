// @vitest-environment jsdom
//
// FavoritesTab smoke(M-4b #191:空狀態 + 真清單)。
//
// 驗:
// - 標題「收藏清單」+ acc-section 殼(data-tab="favorites")
// - favorites=[] → acc-empty「目前尚無收藏商品」+ sub「您的收藏會顯示在此」
// - favorites 有料 → .acc-fav-grid 逐項 = 連到 /products/<handle> 的 <a> + 品牌 / 品名 / 價格
// - 🔴 **不洩 design mock 商品字面**(LIGHTECH / RIZOMA / Akrapovič / NT$ 12,800 等)
//   ⚠️ 這一格守的是「不要拿假資料裝成有收藏」,**不是**「不准出現商品」——
//   所以它只跑在 `favorites=[]` 那個 case 上;下面真清單的 case 用自己的假資料字面。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FavoriteListItem } from '@pcm/domain';
import { FavoritesTab } from './FavoritesTab';

afterEach(cleanup);

const item = (over: Partial<FavoriteListItem['product']> = {}): FavoriteListItem => ({
  favorite: {
    customerUserId: '00000000-0000-4000-8000-000000000001',
    productId: over.id ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-08-18T09:00:00.000Z',
  },
  product: {
    id: '00000000-0000-4000-8000-0000000000aa',
    handle: 'probe-part-1',
    title: '測試零件一號',
    brandName: 'PROBE',
    priceGeneral: 3300,
    imageUrl: 'https://example.test/probe-1.jpg',
    ...over,
  },
});

describe('FavoritesTab(M-4b #191)', () => {
  it('標題「收藏清單」+ acc-section 殼', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(screen.getByText('收藏清單')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="favorites"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('沒有收藏 → acc-empty 文案「目前尚無收藏商品」+ sub「您的收藏會顯示在此」', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(container.querySelector('.acc-fav-grid')).toBeNull();
    expect(screen.getByText('目前尚無收藏商品')).toBeTruthy();
    expect(screen.getByText('您的收藏會顯示在此')).toBeTruthy();
  });

  it('沒有收藏時不洩 design mock 商品字面(防 g-3 反走樣)', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(container.textContent).not.toContain('LIGHTECH');
    expect(container.textContent).not.toContain('RIZOMA');
    expect(container.textContent).not.toContain('Akrapovič');
    expect(container.textContent).not.toContain('AKRAPOVIČ');
    expect(container.textContent).not.toContain('NT$');
  });

  it('🔴 有收藏 → 空狀態消失、改渲 .acc-fav-grid,每項連到 /products/<handle>', () => {
    const { container } = render(<FavoritesTab favorites={[item()]} />);
    expect(container.querySelector('.acc-empty')).toBeNull();
    const cards = container.querySelectorAll('a.acc-fav');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute('href')).toBe('/products/probe-part-1');
    expect(screen.getByText('PROBE')).toBeTruthy();
    expect(screen.getByText('測試零件一號')).toBeTruthy();
    expect(screen.getByText('NT$ 3,300')).toBeTruthy();
    expect(container.querySelector('.acc-fav img')?.getAttribute('src')).toBe(
      'https://example.test/probe-1.jpg',
    );
  });

  /**
   * ⛔ ~~「沒有圖就不渲 `<img>`(空 src 會變成一塊看起來壞掉的灰底)」~~
   * 🔵 **那個判斷【沒有被推翻】—— 它解的是一個現在不存在的問題**:
   *    它比較的是「**空 `src`**」與「不渲染」;而 2026-09-04 起這裡走 `ProductImage`,
   *    它給的是**第三個選項** —— 一張**真的存在的圖**(`/placeholder-product.png`)疊在漸層底上。
   *    ⇒ 🎯 **它要防的那塊「壞掉的灰」在這條路上不會出現。**
   * 🔴 **而改的理由是一致性**(⟦ship-ORDERIMG⟧ 甲案):同一批商品客人在三個地方看到三種東西
   *    —— 明細站內佔位圖 / 訂單卡片空框 / 收藏什麼都沒有。
   * 🛑 **兩個方向都要有**:沒有圖 ⇒ 仍然有一個**有內容的**版位;有真照片 ⇒ **逐字不變**。
   */
  it('🔴 沒有圖 ⇒ 走 ProductImage(有版位、有一張真的存在的圖), 不是空白也不是空 src', () => {
    const { container } = render(<FavoritesTab favorites={[item({ imageUrl: null })]} />);
    expect(container.querySelector('a.acc-fav')).toBeTruthy();
    const img = container.querySelector('.acc-fav img');
    expect(img, '版位塌了 ⇒ 客人看到一張沒有圖的卡, 而那正是這一片要收斂掉的三種樣子之一').toBeTruthy();
    expect(
      img!.getAttribute('src'),
      '🔴 空 `src` ⇒ 那正是原本那句判斷在防的「像壞掉的灰」',
    ).toBe('/placeholder-product.png');
  });

  it('🔵 負對照:有真照片 ⇒ 那個網址逐字不變(不得被佔位圖蓋掉)', () => {
    const REAL = 'https://quote.pcmmotorsports.com/real-product-01.jpg';
    const { container } = render(<FavoritesTab favorites={[item({ imageUrl: REAL })]} />);
    expect(
      container.querySelector('.acc-fav img')!.getAttribute('src'),
      '一張真照片被佔位圖蓋掉了 ⇒ 而那沒有人會回報',
    ).toBe(REAL);
  });

  it('🔴 MAIN-035 ①-1:讀取失敗與「沒有收藏」必須是【兩個畫面】', () => {
    const empty = render(<FavoritesTab favorites={[]} />).container.textContent;
    cleanup();
    const failed = render(<FavoritesTab favorites={[]} loadFailed />).container.textContent;
    expect(empty).toContain('目前尚無收藏商品');
    expect(failed).toContain('收藏清單讀取失敗');
    expect(
      failed,
      '讀取失敗印成「沒有收藏」⇒ 客人會以為他的收藏不見了,而我們也看不出來是哪一種',
    ).not.toContain('目前尚無收藏商品');
    expect(empty).not.toContain('讀取失敗');
  });

  it('讀取失敗那格要讓讀螢幕軟體聽得到(role=alert)', () => {
    const { container } = render(<FavoritesTab favorites={[]} loadFailed />);
    expect(container.querySelector('.acc-empty[role="alert"]')).toBeTruthy();
  });

  it('🔴 priceGeneral 是 null 就不渲價格列(不印「NT$ null」)', () => {
    const { container } = render(<FavoritesTab favorites={[item({ priceGeneral: null })]} />);
    // 🔴 **正向同伴**(`⟦b4-MONEY4⟧` ② 那一批,2026-08-29 線G)。下面兩條都是**負向**的 ——
    //    「沒有價格列 + 沒有 NT$」在**整張卡根本沒渲染**的世界裡**一樣成立**。
    //    ⇒ 先釘住那張卡真的畫出來了,那兩條才是在說「價格列被刻意省掉」。
    expect(
      container.textContent,
      '卡片標題都沒渲染 ⇒ 下面兩條的「沒有」只是「什麼都沒有」',
    ).toContain('測試零件一號');
    expect(container.querySelector('.acc-fav-price')).toBeNull();
    expect(container.textContent).not.toContain('NT$');
  });

  // 🔴🔴 這一格斷言的是【Sean 要的行為】,不是一個洞。**它應該永遠綠。**
  //
  // ── 這段註解 2026-08-25 被整段重寫過,而【斷言一個字都沒動】。原因值得留著 ──
  //   前一版的註解說「印 NT$ 0 是已知洞、修好後這格會紅」。
  //   當天稍晚 Sean 拍板,那個框架整個反過來(見下),而**測試照樣是綠的**。
  //   🔴 **一個測試可以【斷言正確而註解錯誤】,而三綠只看斷言。**
  //      它不會紅、lint 抓不到、突變測試照樣通過 —— 而下一個人是**照註解**理解它的,
  //      那段舊註解會叫他「去把這個洞補起來」,而補起來正好會做出 Sean 明確否決的行為。
  //
  // ── Sean 2026-08-25 拍板(memory `project_0825-sean-zero-price-is-real-print-ntd-zero`)──
  //   Q「我們會不會有 0 元的商品(贈品 / 買一送一的那個『送』/ 試用品)?」⇒ A【乙:會,偶爾有】
  //   ⇒ **0 是合法價格。0 元要印成「NT$ 0」,不是印一條槓、也不是印「贈品」二字**
  //     (「贈品」是端上去的推薦,他沒有選它)。
  //   ⇒ 「要不要把 CHECK 收成 > 0」這一題**當場消失,答案是不要**。
  //
  // ── 佐證:DB 那條 CHECK 一開始就是對的 ──
  //   `supabase/migrations/20260516064013_products_add_price_general_store.sql:13-14`
  //     `ALTER TABLE products ADD CONSTRAINT price_general_non_negative CHECK (`
  //     `  price_general IS NULL OR price_general >= 0 );`
  //   🔴 它叫 `price_general_non_negative`,而**名字說的正是它做的事:允許 0**。
  //      這一格 2026-08-25 收包複驗時被訂正過(原文誤寫「無 CHECK」),
  //      而 Sean 拍板之後它從「尺畫錯一格」升級成「那條約束本來就對」。
  //   ⚠️ 量法留著給下一個人:找 CHECK 別停在 `grep -c 'CHECK'`(它連註解一起算);
  //      先 `grep -v '^\s*--'` 濾掉註解,再開檔讀那條約束**允許什麼**。
  //   (`NOT NULL` 仍然沒有 —— 該 migration 自陳「推遲 sub-slice 2-X」。
  //    ⇒ **「查不到價格」與「0 元」是兩件事,不可合流。**)
  //
  // ── 那個區分落在哪 ──
  //   `FavoritesTab.tsx:65` 的守門是 `priceGeneral !== null`:
  //     null(查不到)⇒ 整列不渲染 ✅   0(贈品)⇒ 印「NT$ 0」✅  **兩個都是要的行為。**
  //   同一個區分在別處的落點(逐一開檔核過):
  //     `ProductInfo.tsx:243` / `ProductPage.tsx:324` —— 詳情頁自己的 NT$ 渲染
  //     `mappers/product.ts:206` —— 上游守門條件是 `=== null` 不是 `<= 0`
  //       ⇒ null 在那裡就被 throw 掉、0 一路通行。**這正好是拍板後要的分工。**
  //
  // 🔴 這一格若哪天【紅了】,代表有人把 0 一起擋掉了 ⇒ 那是回歸,不是修好。
  //    回來讀這段註解,不要改斷言。
  it('🔴 priceGeneral = 0(贈品)要印出「NT$ 0」—— Sean 2026-08-25 拍板;紅了是回歸不是修好', () => {
    const { container } = render(<FavoritesTab favorites={[item({ priceGeneral: 0 })]} />);
    expect(container.querySelector('.acc-fav-price')).not.toBeNull();
    expect(container.textContent).toContain('NT$ 0');
  });
});
