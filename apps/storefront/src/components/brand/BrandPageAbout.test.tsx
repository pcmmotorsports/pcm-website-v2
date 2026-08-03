// @vitest-environment jsdom
//
// BrandPageAbout smoke test — D2c-1(2026-08-04)
//
// 這一區最容易靜默壞掉的三件事,下面每一組各對一件:
//   ① 右欄同時出現影片與產品照(設計稿逐字「右欄一次只放一個東西」)
//      —— D2c-2 接上影片那天才會現形,而那時沒人會回頭看這一片
//   ② pull 誤走 BrandRichText(設計稿對它走 esc(),與 lead/tail 相反)
//   ③ no-aside class 掛錯 ⇒ 欄數不對,但 jsdom 不算 grid,元件測試一律綠

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageAbout } from './BrandPageAbout';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

/** 有 aside 沒 video 的真品牌(9 家之一);找不到就讓測試自己講話,不要 fallback 成別的形狀。 */
const asideOnly = BRAND_CONTENT.find((b) => !b.video && b.aside) as BrandContent;
const withVideo = BRAND_CONTENT.find((b) => b.video) as BrandContent;

describe('BrandPageAbout · 正文', () => {
  it('lead 與 tail 走 BrandRichText(標記變元素)', () => {
    const brand: BrandContent = {
      ...asideOnly,
      about: { lead: '<strong>甲</strong>', pull: '', tail: '<strong>乙</strong>' },
    };
    const { container } = render(<BrandPageAbout brand={brand} />);
    expect(container.querySelectorAll('.bp-body strong')).toHaveLength(2);
  });

  it('🔴 pull 是純文字、不過 BrandRichText(設計稿 :1853 對它走 esc(),與 lead/tail 相反)', () => {
    const brand: BrandContent = {
      ...asideOnly,
      about: { lead: 'L', pull: '<strong>引言</strong>', tail: 'T' },
    };
    const { container } = render(<BrandPageAbout brand={brand} />);
    const pull = container.querySelector('.bp-pull');
    expect(pull?.querySelectorAll('strong')).toHaveLength(0);
    expect(pull?.textContent).toBe('<strong>引言</strong>');
  });

  it('pull 空字串 → 整個 <p class="bp-pull"> 不建(不是建一個空的)', () => {
    const brand: BrandContent = { ...asideOnly, about: { ...asideOnly.about, pull: '' } };
    const { container } = render(<BrandPageAbout brand={brand} />);
    expect(container.querySelector('.bp-pull')).toBeNull();
  });

  it('段落順序 = lead → pull → tail', () => {
    const brand: BrandContent = { ...asideOnly, about: { lead: 'A', pull: 'B', tail: 'C' } };
    const { container } = render(<BrandPageAbout brand={brand} />);
    const texts = [...container.querySelectorAll('.bp-body p')].map((p) => p.textContent);
    expect(texts).toEqual(['A', 'B', 'C']);
  });
});

describe('🔴 BrandPageAbout · 右欄一次只放一個東西', () => {
  it('有 aside 沒 video → 出產品照卡,且 inner 不掛 no-aside', () => {
    const { container } = render(<BrandPageAbout brand={asideOnly} />);
    // 🔴 `.bp-aside` 這層包裹**必須**正向斷言:它是 grid item,
    //    ≤1180 的 `grid-column:2` 與 ≤960 的 `grid-column:auto` 兩條守門全掛在它身上。
    //    只驗 `.bp-aside-card` 的話,有人把包裹層改名/拿掉 ⇒ 元件測試全綠、
    //    CSS 測試也全綠(它們只讀 CSS 原文)⇒ 整條守門鏈同時變成死的。
    expect(container.querySelector('.bp-aside')).not.toBeNull();
    expect(container.querySelector('.bp-aside-card')).not.toBeNull();
    expect(container.querySelector('.bp-about-inner')?.classList.contains('no-aside')).toBe(false);
  });

  it('🔴 有 video 時**不**渲染產品照(即使 aside 也有資料)', () => {
    // 實測 11 家 video+aside 都有 ⇒ 這條路是常態不是邊界。
    // 少了這個分流,D2c-2 接上影片那天右欄會同時冒出兩個東西。
    expect(withVideo.aside, '前提:挑到的樣本 aside 也要有,否則這條測不到東西').toBeDefined();
    const { container } = render(<BrandPageAbout brand={withVideo} />);
    expect(container.querySelector('.bp-aside-card')).toBeNull();
    expect(container.querySelector('.bp-aside')).toBeNull();
    // 🔴 **D2c-1 這一刻**右欄真的空著(影片元件還沒接)⇒ 要掛 no-aside、收成兩欄。
    //    不掛的話這 11 家會保留三軌卻只有兩個子元素,正文被壓進 .8fr、第三軌整片空。
    //    ⚠️ D2c-2 接上影片後這裡要翻面(改成 toBe(false))—— 那是預期中的同步改動,
    //       不是回歸。設計稿最終狀態見 :1967-1968(有 video 也 remove no-aside)。
    expect(container.querySelector('.bp-about-inner')?.classList.contains('no-aside')).toBe(true);
  });

  it('🔴 兩者皆無 → 掛 no-aside(收成兩欄;現有 20 家資料走不到這條路)', () => {
    const bare: BrandContent = { ...asideOnly, aside: undefined, video: undefined };
    const { container } = render(<BrandPageAbout brand={bare} />);
    expect(container.querySelector('.bp-aside')).toBeNull();
    expect(container.querySelector('.bp-about-inner')?.classList.contains('no-aside')).toBe(true);
  });
});

describe('BrandPageAbout · 產品照卡', () => {
  it('圖 lazy(不是首屏)、alt 走資料、路徑帶 /brand-assets/ 前綴', () => {
    const { container } = render(<BrandPageAbout brand={asideOnly} />);
    const img = container.querySelector<HTMLImageElement>('.bp-aside-card img');
    expect(img?.getAttribute('loading')).toBe('lazy'); // 與橫幅照的 eager 刻意相反
    expect(img?.getAttribute('alt')).toBe(asideOnly.aside?.alt);
    expect(img?.getAttribute('src')).toBe(`/brand-assets/${asideOnly.aside?.src}`);
  });

  it('note 走 BrandRichText(全站唯一帶標記的 aside.note = lightech 的 PUSH &amp; PULL)', () => {
    const brand: BrandContent = {
      ...asideOnly,
      aside: { ...asideOnly.aside!, note: 'PUSH &amp; PULL' },
    };
    const { container } = render(<BrandPageAbout brand={brand} />);
    expect(container.querySelector('.bp-aside-card p')?.textContent).toBe('PUSH & PULL');
  });

  it('title 是純文字(設計稿對它走 esc())', () => {
    const brand: BrandContent = {
      ...asideOnly,
      aside: { ...asideOnly.aside!, title: '<strong>標</strong>' },
    };
    const { container } = render(<BrandPageAbout brand={brand} />);
    expect(container.querySelector('.bp-aside-card h3')?.querySelectorAll('strong')).toHaveLength(0);
  });
});

describe('BrandPageAbout · 20 家實資料', () => {
  it('每家都渲染得出正文,且畫面不留 < 或 >', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageAbout brand={brand} />);
      expect(container.querySelectorAll('.bp-body p').length, brand.slug).toBeGreaterThanOrEqual(2);
      const shown = container.textContent ?? '';
      expect(shown.includes('<'), `${brand.slug} 畫面殘留 <`).toBe(false);
      expect(shown.includes('>'), `${brand.slug} 畫面殘留 >`).toBe(false);
      cleanup();
    }
  });

  it('產品照卡恰出現在「有 aside 且無 video」的那幾家(實測 9 家)', () => {
    let shown = 0;
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageAbout brand={brand} />);
      const has = container.querySelector('.bp-aside-card') !== null;
      expect(has, brand.slug).toBe(!brand.video && brand.aside !== undefined);
      if (has) shown++;
      cleanup();
    }
    // 前提斷言:不是 0 也不是 20 —— 兩個極端都代表分流沒生效而上面那條會空過
    expect(shown).toBe(BRAND_CONTENT.filter((b) => !b.video && b.aside).length);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(BRAND_CONTENT.length);
  });
});
