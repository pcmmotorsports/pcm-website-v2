// @vitest-environment jsdom
//
// BrandPageCategories smoke test — D2e-1(2026-08-04)
//
// 這一區最容易靜默壞掉的三件事(全部三綠 + 肉眼都看不出來):
//   ① `colorIndex === 0` 的 chip 掛了 `data-cat="0"` —— 畫面**現在**一模一樣
//      (`[data-cat="0"]` 這條規則不存在 ⇒ 仍吃基礎規則的 --cat-8),
//      直到哪天有人補了那條規則才會突然變色。實測 52 筆中 2 筆。
//   ② 分類名被當成 rich text 過 parser ⇒ 帶標記的名稱會變成元素(現有 12 種零標記 ⇒ 真資料不可達)。
//   ③ 網址少帶 `&category=` 或沒 encode ⇒ 中文分類名直接進 URL。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageCategories } from './BrandPageCategories';
import { BRAND_CONTENT, BRAND_BY_SLUG } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

const all = BRAND_CONTENT.flatMap((b) => b.categories);

describe('BrandPageCategories · 前提(資料形狀)', () => {
  it('🔴 52 筆 / 12 種名稱 / 每家 1-7 個 / colorIndex 值域 0-11 缺 2', () => {
    // 下面每一條斷言都靠這個形狀 —— 形狀變了(新增品牌、改分類表)要先看這裡再改測試。
    expect(all).toHaveLength(52);
    expect(new Set(all.map(([name]) => name)).size).toBe(12);
    const counts = BRAND_CONTENT.map((b) => b.categories.length);
    expect(Math.min(...counts), '有品牌一個分類都沒有 ⇒ 會渲染出一個空的 .bp-chips').toBe(1);
    expect(Math.max(...counts)).toBe(7);
    expect([...new Set(all.map(([, i]) => i))].sort((a, b) => a - b))
      .toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // 🔴 0 這個值**真的存在於正式資料**(2 筆)—— 沒有它,下面「不掛 data-cat」那條
    //    就是在守一條走不到的路。
    expect(all.filter(([, i]) => i === 0)).toHaveLength(2);
    // 🔴 `key={name}` 依賴「同一家內部名稱不重複」——型別保證不了,只能靠這條。
    //    重複時 React key 撞號,而下面「chip 數 = 分類筆數」那條**不會紅**
    //    (React 仍會渲染兩個節點,只是 reconcile 行為未定義)。磚牆對 slug 有做同款,
    //    兩邊本來不對稱(R1 nit)。
    for (const b of BRAND_CONTENT) {
      const names = b.categories.map(([n]) => n);
      expect(new Set(names).size, `${b.slug} 有重複的分類名`).toBe(names.length);
    }
    // 同一個分類名在 20 家之間必須配到同一個 colorIndex(綁分類 id、不綁排序位置)
    const byName = new Map<string, Set<number>>();
    for (const [name, i] of all) (byName.get(name) ?? byName.set(name, new Set()).get(name)!).add(i);
    for (const [name, set] of byName) expect([...set], `${name} 在不同品牌配到不同色碼`).toHaveLength(1);
  });
});

describe('BrandPageCategories · 版型', () => {
  const brand = BRAND_BY_SLUG['rizoma']!; // 7 個 chip = 最多的那家

  it('🔴 整條巢狀鏈正向斷言(無 class 的 wrapper 拿掉會讓 .bp-chips 直接變成 grid item)', () => {
    const { container } = render(<BrandPageCategories brand={brand} />);
    expect(container.querySelector('.bp-cats > .bp-cats-inner')).not.toBeNull();
    expect(container.querySelectorAll('.bp-cats-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-cats-inner > .bp-sec-label')?.textContent).toBe('Categories');
    expect(container.querySelector('.bp-cats-inner > div > .bp-chips')).not.toBeNull();
  });

  it('chip 數 = 該品牌的分類筆數(1 個到 7 個都要成立)', () => {
    for (const b of BRAND_CONTENT) {
      const { container } = render(<BrandPageCategories brand={b} />);
      expect(container.querySelectorAll('.bp-chip'), b.slug).toHaveLength(b.categories.length);
      cleanup();
    }
  });
});

describe('BrandPageCategories · 色碼', () => {
  it('🔴 colorIndex 0 **不掛** data-cat;非 0 掛對應的值', () => {
    for (const b of BRAND_CONTENT) {
      const { container } = render(<BrandPageCategories brand={b} />);
      const chips = [...container.querySelectorAll('.bp-chip')];
      chips.forEach((el, i) => {
        const [name, idx] = b.categories[i]!;
        expect(el.getAttribute('data-cat'), `${b.slug} / ${name}`)
          .toBe(idx ? String(idx) : null);
      });
      cleanup();
    }
  });

  it('🔴 合成 fixture:0 與 8 兩個值不得長成同一個 DOM(現行 CSS 下畫面一樣,DOM 必須不同)', () => {
    // --cat-8 同時是 `[data-cat="8"]` 的值**和** .bp-chip 的預設值(設計稿 :697 與 :709)。
    // ⇒ 「0 誤寫成 8」在畫面上零症狀、在真資料上也零症狀(0 那 2 筆與 8 那 1 筆都存在但
    //   顏色相同)。只有 DOM 屬性分得出來,所以這條守的是屬性不是顏色。
    const fixture = {
      ...BRAND_BY_SLUG['akrapovic']!,
      categories: [['甲', 0], ['乙', 8]],
    } as unknown as BrandContent;
    const { container } = render(<BrandPageCategories brand={fixture} />);
    const chips = [...container.querySelectorAll('.bp-chip')];
    expect(chips[0]!.hasAttribute('data-cat'), '0 不該掛 data-cat').toBe(false);
    expect(chips[1]!.getAttribute('data-cat')).toBe('8');
  });
});

describe('BrandPageCategories · 網址與跳脫', () => {
  it('🔴 href = /products?pbrand=<slug>&category=<分類名>,兩段都 encode', () => {
    const brand = BRAND_BY_SLUG['rizoma']!;
    const { container } = render(<BrandPageCategories brand={brand} />);
    const chips = [...container.querySelectorAll<HTMLAnchorElement>('.bp-chip')];
    chips.forEach((el, i) => {
      const [name] = brand.categories[i]!;
      expect(el.getAttribute('href'))
        .toBe(`/products?pbrand=${brand.slug}&category=${encodeURIComponent(name)}`);
    });
  });

  it('🔴 encode 那一軸走合成 fixture,不靠「真資料剛好是中文」', () => {
    // ⚠️ 原本這兩條掛在上面那條的真資料上(`toContain('%')` + `not.toContain(名稱)`)——
    //    分類表哪天加了純 ASCII 的名字(例如 "ECU")就會**假紅**,而那不是 bug(R2 nit)。
    //    改成餵一個一定需要跳脫的名字,斷言與資料脫鉤。
    const fixture = {
      ...BRAND_BY_SLUG['akrapovic']!,
      categories: [['排 氣&系統', 10]],
    } as unknown as BrandContent;
    const { container } = render(<BrandPageCategories brand={fixture} />);
    const href = container.querySelector('.bp-chip')!.getAttribute('href')!;
    expect(href).toBe(`/products?pbrand=akrapovic&category=${encodeURIComponent('排 氣&系統')}`);
    // 反面:原字面不得裸著進 URL —— `&` 沒 encode 的話會憑空切出一個新的 query 參數
    expect(href).not.toContain('排 氣&系統');
    expect(href).not.toMatch(/&(?!category=)/);
  });

  it('分類名是純文字(設計稿 :2018 走 esc),不過 BrandRichText', () => {
    // 🔴 fixture 用**白名單內**的 `<strong>` —— 用 `<b>` 的話走哪條路都是純文字、零判別力
    //    (Timeline / Craft 已踩過這個坑)。
    const fixture = {
      ...BRAND_BY_SLUG['akrapovic']!,
      categories: [['<strong>排氣</strong>', 10]],
    } as unknown as BrandContent;
    const { container } = render(<BrandPageCategories brand={fixture} />);
    expect(container.querySelectorAll('strong'), '變成元素代表走了 rich text 路徑').toHaveLength(0);
    expect(container.querySelector('.bp-chip')?.textContent).toBe('<strong>排氣</strong>');
  });

  it('20 家真資料渲染後畫面不留 < > &', () => {
    for (const b of BRAND_CONTENT) {
      const { container } = render(<BrandPageCategories brand={b} />);
      const shown = container.textContent ?? '';
      for (const ch of ['<', '>', '&']) {
        expect(shown.includes(ch), `${b.slug} 畫面殘留 ${ch}`).toBe(false);
      }
      cleanup();
    }
  });
});

// 整頁大綱的不變式清單與推導見 `BrandPageHeader.test.tsx` 檔尾那段(關卡2 R2 補齊 7 支)。
// 🔴 D3a 起另有 `BrandPageRoot.test.tsx` 直接 render 整頁驗大綱,不再只靠這七支局部不變式。
describe('BrandPageCategories · 標題階層(#311)', () => {
  it('🔴 不得出現任何標題元素(chips 區的區塊標籤是 .bp-sec-label 不是標題)', () => {
    const { container } = render(<BrandPageCategories brand={BRAND_CONTENT[0]!} />);
    expect(container.querySelectorAll('h1, h2, h3, h4, h5, h6').length).toBe(0);
  });
});
