// @vitest-environment jsdom
//
// BrandPageHeader smoke test — D2b(2026-08-04)
//
// 這頁的三段(麵包屑 / 橫幅 / 事實列)最容易出的錯不是「長得醜」,
// 而是幾個**看得見但沒人會紅**的東西:
//   · 沒有橫幅照的品牌用 hidden 藏 <img> ⇒ 全站 reset 的 img{display:block} 會蓋掉,
//     結果上一家的照片留在畫面上(README「品牌介紹頁的橫幅」逐字記過這個坑)
//   · CTA 指向設計稿的 #finder 錨點 ⇒ 正式站沒有那個錨點,按了什麼都不會發生
//   · facts 誤走 BrandRichText / lede 忘了走 ⇒ 標籤原文出現在畫面上
// 所以下面每一條都對著其中一個。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BrandPageHeader, brandCatalogueUrl, brandVehiclePickUrl } from './BrandPageHeader';
import { BRAND_BY_SLUG, BRAND_CONTENT } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

const akrapovic = BRAND_BY_SLUG['akrapovic'] as BrandContent;
const lightech = BRAND_BY_SLUG['lightech'] as BrandContent;

describe('BrandPageHeader · 麵包屑', () => {
  it('三層:首頁 / 品牌專區 / 當前品牌名', () => {
    const { container } = render(<BrandPageHeader brand={akrapovic} />);
    const crumb = container.querySelector('.bp-crumb');
    expect(crumb?.querySelector('a[href="/"]')?.textContent).toBe('首頁');
    expect(crumb?.querySelector('a[href="/brands"]')?.textContent).toBe('品牌專區');
    expect(crumb?.querySelector('.bp-crumb-cur')?.textContent).toBe(akrapovic.name);
  });
});

describe('BrandPageHeader · 橫幅', () => {
  it('有照片:建出 .bp-band-photo、帶正確 src 與 alt、band 不掛 no-photo', () => {
    const { container } = render(<BrandPageHeader brand={akrapovic} />);
    const photo = container.querySelector<HTMLImageElement>('.bp-band-photo');
    expect(photo).not.toBeNull();
    expect(photo?.getAttribute('src')).toBe(`/brand-assets/${akrapovic.band?.src}`);
    expect(photo?.getAttribute('alt')).toBe(akrapovic.band?.alt);
    expect(container.querySelector('.bp-band')?.classList.contains('no-photo')).toBe(false);
  });

  it('🔴 沒有照片:整個 <img> 節點不存在(不是 hidden)', () => {
    // hidden 會被全站 reset 的 img{display:block} 蓋掉 ⇒ 上一家的照片留在畫面上。
    const noBand: BrandContent = { ...akrapovic, band: undefined };
    const { container } = render(<BrandPageHeader brand={noBand} />);
    expect(container.querySelector('.bp-band-photo')).toBeNull();
    expect(container.querySelector('.bp-band')?.classList.contains('no-photo')).toBe(true);
  });

  it('band.focus 寫進 --band-focus(裁切焦點是 per-brand 旋鈕)', () => {
    const { container } = render(<BrandPageHeader brand={akrapovic} />);
    const band = container.querySelector<HTMLElement>('.bp-band');
    expect(band?.style.getPropertyValue('--band-focus')).toBe(akrapovic.band?.focus);
  });

  it('只有設了 align 的品牌才寫 --logo-align(實測 20 家只有 lightech)', () => {
    const withAlign = render(<BrandPageHeader brand={lightech} />);
    expect(
      withAlign.container.querySelector<HTMLElement>('.bp-band-logo')?.style.getPropertyValue('--logo-align'),
    ).toBe('start');
    cleanup();
    const withoutAlign = render(<BrandPageHeader brand={akrapovic} />);
    expect(
      withoutAlign.container.querySelector<HTMLElement>('.bp-band-logo')?.style.getPropertyValue('--logo-align'),
    ).toBe('');
  });

  it('band logo 用 bandLogo 欄、alt = 純品牌名(設計稿 :1642 的 esc(brand.name))', () => {
    const { container } = render(<BrandPageHeader brand={akrapovic} />);
    const logo = container.querySelector<HTMLImageElement>('.bp-band-logo img');
    expect(logo?.getAttribute('src')).toBe(`/brand-assets/${akrapovic.bandLogo}`);
    // 🔴 用 toBe 不用 toContain:原本寫「X 標誌」時 toContain 照樣綠,
    //    偏離設計字面而測試看不見(關卡2 MF3)。
    expect(logo?.getAttribute('alt')).toBe(akrapovic.name);
  });

  it('🔴 三個設計稿字面屬性都在(漏了不會讓任何測試變紅,只會讓 LCP/CLS 變差)', () => {
    // 關卡2 MF3:eager/decoding 來自 brand-page.html:1633-1634,width/height 來自 :1642。
    // 這種漏搬是「畫面一模一樣、指標變差」——單元測試不驗就永遠沒人發現。
    const { container } = render(<BrandPageHeader brand={akrapovic} />);
    const photo = container.querySelector<HTMLImageElement>('.bp-band-photo');
    expect(photo?.getAttribute('loading')).toBe('eager'); // 首屏 LCP,不可 lazy
    expect(photo?.getAttribute('decoding')).toBe('async');
    const logo = container.querySelector<HTMLImageElement>('.bp-band-logo img');
    // width/height 給的是 intrinsic aspect ratio(CSS 已改寬度),沒有就 CLS
    expect(logo?.getAttribute('width')).toBe('380');
    expect(logo?.getAttribute('height')).toBe('92');
  });

  it('lede 走 BrandRichText(標記變成元素,不是印在畫面上)', () => {
    const withMarkup: BrandContent = { ...akrapovic, lede: '<strong>甲</strong>乙' };
    const { container } = render(<BrandPageHeader brand={withMarkup} />);
    const lede = container.querySelector('.bp-lede');
    expect(lede?.querySelectorAll('strong')).toHaveLength(1);
    expect(lede?.textContent).toBe('甲乙');
  });
});

describe('🔴 BrandPageHeader · 兩顆 CTA 的目的地', () => {
  it('「逛全部商品」→ /products?pbrand=<slug>', () => {
    render(<BrandPageHeader brand={akrapovic} />);
    expect(screen.getByText('逛全部商品').closest('a')?.getAttribute('href')).toBe(
      '/products?pbrand=akrapovic',
    );
  });

  it('「只看我的車能裝的」→ 品牌篩選 + ?pick=vehicle(不是設計稿的 #finder)', () => {
    // 🔴 設計稿寫 `{catalogue}#finder`(brand-page.html:1648),但正式站沒有這個錨點:
    //    #vehicle-finder 只在首頁,/products 的入口是 CascadeFilterTop / MobileVehicleSheet。
    //    正確對應 = A2 建的 ?pick=vehicle。這條把 route adaptation 釘住,
    //    免得有人「照設計稿改回去」而做出一顆按了沒反應的鈕。
    render(<BrandPageHeader brand={akrapovic} />);
    const href = screen.getByText('只看我的車能裝的').closest('a')?.getAttribute('href');
    expect(href).toBe('/products?pbrand=akrapovic&pick=vehicle');
    expect(href).not.toContain('#finder');
  });

  it('slug 有做 encodeURIComponent(未來出現需跳脫字元時不會壞掉)', () => {
    expect(brandCatalogueUrl('a b')).toBe('/products?pbrand=a%20b');
    expect(brandVehiclePickUrl('a b')).toBe('/products?pbrand=a%20b&pick=vehicle');
  });
});

describe('BrandPageHeader · 事實列', () => {
  it('筆數 = 資料筆數,且寫進 --fact-n(欄數靠它)', () => {
    for (const brand of [akrapovic, BRAND_BY_SLUG['bonamici'] as BrandContent]) {
      const { container } = render(<BrandPageHeader brand={brand} />);
      expect(container.querySelectorAll('.bp-fact')).toHaveLength(brand.facts.length);
      expect(container.querySelector<HTMLElement>('.bp-facts-inner')?.style.getPropertyValue('--fact-n')).toBe(
        String(brand.facts.length),
      );
      cleanup();
    }
  });

  it('每則 = dt 標籤 + dd 值,小註有才放', () => {
    const brand: BrandContent = {
      ...akrapovic,
      facts: [['Founded', '1991 年', '以賽車排氣系統起家'], ['Made in', '斯洛維尼亞', '']],
    };
    const { container } = render(<BrandPageHeader brand={brand} />);
    const facts = container.querySelectorAll('.bp-fact');
    expect(facts[0]?.querySelector('dt')?.textContent).toBe('Founded');
    expect(facts[0]?.querySelector('dd')?.textContent).toContain('1991 年');
    expect(facts[0]?.querySelector('.bp-fact-s')?.textContent).toBe('以賽車排氣系統起家');
    // 小註空字串 ⇒ 整個 span 不建(不是建一個空的)
    expect(facts[1]?.querySelector('.bp-fact-s')).toBeNull();
  });

  it('🔴 facts 是純文字、不過 BrandRichText(設計稿的 JS 對它走 esc())', () => {
    // 若有人「順手統一」把 facts 也接上 BrandRichText,這條會紅。
    const brand: BrandContent = { ...akrapovic, facts: [['L', '<strong>粗</strong>', '']] };
    const { container } = render(<BrandPageHeader brand={brand} />);
    expect(container.querySelector('.bp-fact dd')?.querySelectorAll('strong')).toHaveLength(0);
    expect(container.querySelector('.bp-fact dd')?.textContent).toBe('<strong>粗</strong>');
  });
});

describe('BrandPageHeader · 20 家全部渲染', () => {
  it('每一家都渲染得出來,且畫面上不留任何 < 或 >', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageHeader brand={brand} />);
      expect(container.querySelector('.bp-title')?.textContent, brand.slug).toBe(brand.name);
      expect(container.querySelectorAll('.bp-fact').length, brand.slug).toBeGreaterThanOrEqual(3);
      const shown = container.textContent ?? '';
      expect(shown.includes('<'), `${brand.slug} 畫面殘留 <`).toBe(false);
      expect(shown.includes('>'), `${brand.slug} 畫面殘留 >`).toBe(false);
      cleanup();
    }
  });

  it('20 家的橫幅照與 logo 都指到 /brand-assets/ 底下', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageHeader brand={brand} />);
      for (const img of container.querySelectorAll('img')) {
        expect(img.getAttribute('src')?.startsWith('/brand-assets/assets/'), brand.slug).toBe(true);
      }
      cleanup();
    }
  });
});
