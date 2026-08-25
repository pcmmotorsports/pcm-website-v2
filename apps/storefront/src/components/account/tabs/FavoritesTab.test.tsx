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

  it('🔴 沒有圖就不渲 <img>(空 src 會變成一塊看起來壞掉的灰底)', () => {
    const { container } = render(<FavoritesTab favorites={[item({ imageUrl: null })]} />);
    expect(container.querySelector('a.acc-fav')).toBeTruthy();
    expect(container.querySelector('.acc-fav img')).toBeNull();
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
    expect(container.querySelector('.acc-fav-price')).toBeNull();
    expect(container.textContent).not.toContain('NT$');
  });

  // 🔴🔴 這一格記錄的是【現況】,不是我們要的行為 —— 它是一個 tripwire,不是背書。
  //
  // 上面那格的標題原本逐字寫著「也不印『NT$ 0』」,而它**只餵了 null 一種輸入**。
  // `FavoritesTab.tsx:65` 的守門是 `priceGeneral !== null` ⇒ `0 !== null` 為真 ⇒ 0 元照印。
  // ⇒ 那個標題是一句假話,而它的形狀正好會讓【下一個 grep「NT$ 0」找守門的人】停止查
  //   (2026-08-25 已經騙過一個:就是來訂正它的這一班)。
  //
  // 為什麼不順手把守門改成 `> 0`:
  //   同一個洞在 `ProductInfo.tsx:243` / `ProductPage.tsx:324` 也在
  //   (實跑 `mappers/product.ts:206` 的守門條件是 `=== null` 不是 `<= 0`,餵 0 一路通到底),
  //   而四扇門共同繞開的是 **DB 明文允許 0 元**。
  //   🔴 收包複驗時訂正:本段原本寫「無 NOT NULL、無 CHECK」——**後半是假的。**
  //      同一支 migration 裡有一條 CHECK,只是它放行 0:
  //        `ALTER TABLE products ADD CONSTRAINT price_general_non_negative CHECK (`
  //        `  price_general IS NULL OR price_general >= 0 );`
  //      (無 NOT NULL 那半為真,該檔自陳「NOT NULL 推遲 sub-slice 2-X」。)
  //   🔴 而它叫 `price_general_non_negative` —— **名字說的正是它做的事,而它做的事就是允許 0。**
  //      查「這個欄有沒有 CHECK 在守」的人會命中它、看到一個令人安心的名字,然後停止查。
  //      ⇒ 這與本測試檔上面那句假標題是**同一個形狀**:一個讀起來像已經守住了的東西。
  //      ⇒ 找 CHECK 的量法別停在 `grep -c 'CHECK'`(它連註解一起算);
  //        先 `grep -v '^\s*--'` 濾掉註解,再開檔讀那條約束**允許什麼**。
  //   ⇒ 治本刀 = 把既有那條 CHECK 從 `>= 0` 收成 `> 0`,**不是新增一條**(待 Sean 拍板);
  //     在 .tsx 各補一刀 = 承認 0 元是合法資料,
  //     然後在四個地方各自決定要不要顯示它 —— 那正是今天四種不一致的來源。
  //
  // ⚠️ 而截至 2026-08-25 量測(anon 角色 / 正式站 / `products_list_public` 與
  //    `product_variants_public`),`price_general = 0` 的商品 **0 筆**、變體 **0 筆**
  //    ⇒ **今天沒有任何客人走得到這一格。**
  //    🔴 而那個 0 沒有 NOT NULL / 沒有 CHECK 在守 —— **它是現況,不是保證。**
  //
  // 🔴 這一格【紅了】就是好消息:代表洞被補起來了。
  //    那時請把它翻面成 `not.toContain('NT$ 0')`,不要 skip 它。
  it('🔴 已知洞:priceGeneral = 0 目前【擋不住】,會印出「NT$ 0」(修好後這格會紅,翻面別 skip)', () => {
    const { container } = render(<FavoritesTab favorites={[item({ priceGeneral: 0 })]} />);
    expect(container.querySelector('.acc-fav-price')).not.toBeNull();
    expect(container.textContent).toContain('NT$ 0');
  });
});
