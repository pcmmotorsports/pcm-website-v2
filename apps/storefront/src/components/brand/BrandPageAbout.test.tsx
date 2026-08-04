// @vitest-environment jsdom
//
// BrandPageAbout smoke test — D2c-1 + D2c-2(2026-08-04)
//
// 這一區最容易靜默壞掉的四件事,下面每一組各對一件:
//   ① 右欄同時出現影片與產品照(設計稿逐字「右欄一次只放一個東西」)
//   ② pull 誤走 BrandRichText(設計稿對它走 esc(),與 lead/tail 相反)
//   ③ no-aside class 掛錯 ⇒ 欄數不對,但 jsdom 不算 grid,元件測試一律綠
//   ④ has-portrait-media 掛錯層 ⇒ 直式影片的三條欄寬規則全部不生效(同樣看不出來)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageAbout } from './BrandPageAbout';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

/** 有 aside 沒 video 的真品牌(8 家之一);找不到就讓測試自己講話,不要 fallback 成別的形狀。 */
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

  it('🔴 有 video 時放影片、**不**渲染產品照(即使 aside 也有資料)', () => {
    // 實測 12 家 video+aside 都有 ⇒ 這條路是常態不是邊界。
    // 少了這個分流,右欄會同時冒出影片與產品照兩個東西。
    expect(withVideo.aside, '前提:挑到的樣本 aside 也要有,否則這條測不到東西').toBeDefined();
    const { container } = render(<BrandPageAbout brand={withVideo} />);
    expect(container.querySelector('.bp-aside-card')).toBeNull();
    expect(container.querySelector('.bp-aside')).toBeNull();
    expect(container.querySelector('.bp-media')).not.toBeNull();
    // 🔴 D2c-2 的翻面點:D2c-1 期間這裡是 toBe(true)(當時右欄真的空著、要收成兩欄)。
    //    影片接上後右欄有東西了 ⇒ 回到設計稿最終狀態 :1966-1968(兩條路都 remove no-aside)。
    expect(container.querySelector('.bp-about-inner')?.classList.contains('no-aside')).toBe(false);
  });

  it('🔴 直式影片才在 inner 掛 has-portrait-media(整列欄寬要重配)', () => {
    // class 掛在 inner 不是掛在影片自己身上(設計稿 :1878-1881)——
    // 掛錯地方的話 CSS 那三條欄寬規則全部不生效,而畫面在 jsdom 看不出差別。
    const portrait: BrandContent = { ...withVideo, video: { ...withVideo.video!, portrait: true } };
    const { container: p } = render(<BrandPageAbout brand={portrait} />);
    expect(p.querySelector('.bp-about-inner')?.classList.contains('has-portrait-media')).toBe(true);
    cleanup();
    // 反面:橫式影片不得掛(掛了會讓 6 家 16:9 的影片吃到 240px 的窄欄)
    const landscape: BrandContent = {
      ...withVideo,
      video: { ...withVideo.video!, portrait: undefined },
    };
    const { container: l } = render(<BrandPageAbout brand={landscape} />);
    expect(l.querySelector('.bp-about-inner')?.classList.contains('has-portrait-media')).toBe(false);
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
    // 🔴 `:not(.bp-aside-title)`:#311 把標題改成 `<p>` 之後這張卡裡有兩個 `<p>`,
    //    裸的 `.bp-aside-card p` 會先撈到標題(實測回傳的是 aside.title 的字)。
    expect(container.querySelector('.bp-aside-card p:not(.bp-aside-title)')?.textContent)
      .toBe('PUSH & PULL');
  });

  it('title 是純文字(設計稿對它走 esc())', () => {
    const brand: BrandContent = {
      ...asideOnly,
      aside: { ...asideOnly.aside!, title: '<strong>標</strong>' },
    };
    const { container } = render(<BrandPageAbout brand={brand} />);
    const title = container.querySelector('.bp-aside-card .bp-aside-title');
    expect(title, '前提:標題節點真的在(選擇器改名後這條最容易空過)').not.toBeNull();
    expect(title?.querySelectorAll('strong')).toHaveLength(0);
    expect(title?.textContent).toBe('<strong>標</strong>');
  });

  it('🔴 產品照卡的標題**不是標題元素**(#311:h1 → h3 → h2 跳級)', () => {
    // 整頁文件序 = h1(品牌名,Header)→ 這一格 → h2(Why)。留成 h3 的話
    // ①從 h1 直接跳到 h3 ②它排在自己「應該屬於」的 h2 之前
    // ⇒ 用標題導覽的人拿到一份對不上內容的大綱(設計稿 :1964 是 h3;Sean 08-04 拍 A)。
    const { container } = render(<BrandPageAbout brand={asideOnly} />);
    // 🔴 兩條缺一不可:只查 h3 的話,改成 h2/h4 照樣全綠(還是標題、階層照樣壞);
    //    只查 .bp-aside-title 的話,`<h3 class="bp-aside-title">` 也全綠。
    expect(
      container.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      'About 區整段不得有任何標題元素',
    ).toBe(0);
    expect(container.querySelector('.bp-aside-title')?.tagName).toBe('P');
    cleanup();
    // 🔴 **右欄有兩條分流,兩條都要驗**(關卡2 R2 must-fix):上面那個樣本是「產品照卡」那條,
    //    只涵蓋 8 家;另外 12 家走 `BrandPageMedia`(materya 從 D2f 起也在裡面)。
    //    只驗一條的話,在 Media 裡加一個 <h3> 圖說 ⇒ h1 直接接 h3、而這條測試全綠。
    const withVideoRender = render(<BrandPageAbout brand={withVideo} />);
    expect(withVideoRender.container.querySelector('.bp-media'), '前提:真的走到影片那條分流')
      .not.toBeNull();
    expect(
      withVideoRender.container.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      '影片分流下 About 區同樣不得有任何標題元素',
    ).toBe(0);
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

  it('產品照卡與影片恰好互補、兩者相加剛好 20 家', () => {
    let card = 0;
    let media = 0;
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageAbout brand={brand} />);
      const hasCard = container.querySelector('.bp-aside-card') !== null;
      const hasMedia = container.querySelector('.bp-media') !== null;
      expect(hasCard, brand.slug).toBe(!brand.video && brand.aside !== undefined);
      expect(hasMedia, brand.slug).toBe(brand.video !== undefined);
      // 🔴 右欄一次只放一個東西 —— 逐家斷言,不是只看總數對得起來
      expect(hasCard && hasMedia, `${brand.slug} 右欄同時出現產品照與影片`).toBe(false);
      if (hasCard) card++;
      if (hasMedia) media++;
      cleanup();
    }
    // 前提斷言:兩邊都不是 0 也不是 20 —— 任一極端都代表分流沒生效而上面那些會空過
    expect(card).toBe(BRAND_CONTENT.filter((b) => !b.video && b.aside).length);
    expect(media).toBe(BRAND_CONTENT.filter((b) => b.video).length);
    expect(card).toBeGreaterThan(0);
    expect(media).toBeGreaterThan(0);
    // 20 家全部有 aside(D1a 實測)⇒ 兩條路加起來必須剛好蓋滿,不能有人兩邊都落空
    expect(card + media).toBe(BRAND_CONTENT.length);
  });
});
