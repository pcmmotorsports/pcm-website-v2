// @vitest-environment jsdom
//
// HomeFooter smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeFooter } from './HomeFooter';

afterEach(cleanup);

describe('HomeFooter', () => {
  it('should render the footer without crashing', () => {
    render(<HomeFooter />);
    expect(screen.getByAltText('PCM MOTOR PARTS')).toBeDefined();
    expect(screen.getByText('商品目錄')).toBeDefined();
  });

  it('should render real contact phone and tax id from site-config (A4、非佔位假值)', () => {
    render(<HomeFooter />);
    // 真值來自 lib/site-config SSoT(Sean 2026-06-21 提供);防回歸 design 佔位 02-2998-xxxx / xxxxxxxx
    expect(screen.getByText('0930-531-867')).toBeDefined();
    // D7(2026-08-05):字面由「統編 · 90003020」改成 OD 全站頁尾逐字的「統一編號 90003020」。
    expect(screen.getByText('統一編號 90003020')).toBeDefined();
    expect(screen.queryByText(/2998/)).toBeNull();
    expect(screen.queryByText(/xxxxxxxx/)).toBeNull();
  });

  // 🔴 D7 版權列與 logo 守門。這兩件事原本是被上面兩條 smoke 的 `getByText('PCM MOTORSPORTS')`
  //    與「統編 · 」字面**偶然**守住的;D7 把兩者都換掉之後,若不補這組,
  //    「年份寫死回 2026」「羅馬數字復活」「logo 指到 on-light 版(深底配深字=看不見)」
  //    全部不會有任何測試轉紅。
  describe('D7 版權列與頁尾 logo', () => {
    it('🔴 版權列 = 「© {當年} PCM MOTOR PARTS LTD. 版權所有」', () => {
      render(<HomeFooter />);
      expect(screen.getByText(`© ${new Date().getFullYear()} PCM MOTOR PARTS LTD. 版權所有`)).toBeDefined();
      // 反面:羅馬數字寫法 R2-3 明文作廢。
      expect(screen.queryByText(/MMXXVI/), '羅馬數字版權列復活了').toBeNull();
    });

    // 🔴 上一條**證不了「年份是算出來的」**:今年就是 2026,把 `new Date().getFullYear()`
    //    寫死成 `2026` 那條照樣全綠 —— 而那正是 R2-3「年份程式產生」要防的東西,
    //    症狀要等到跨年才出現(那時沒有人在看這支測試)。
    //    ⇒ 唯一分得出來的做法是**把系統時間搬走**,看渲染出來的年份跟不跟。
    it('🔴 年份真的跟著系統時間走(把時鐘撥到 2031,版權列就該是 2031)', () => {
      // shouldAdvanceTime:本 describe 目前沒有 findBy*/waitFor,但假時鐘會讓它們永久卡死;
      // 帶上這個旗標讓時間照常前進,只有「現在幾點」被替換 —— 日後有人加非同步斷言不會踩雷。
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.setSystemTime(new Date('2031-06-15T00:00:00Z'));
        render(<HomeFooter />);
        expect(screen.getByText('© 2031 PCM MOTOR PARTS LTD. 版權所有'), '年份被寫死了').toBeDefined();
        expect(screen.queryByText(/© 2026/), '撥到 2031 卻還印 2026 ⇒ 年份是寫死的').toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('🔴 頁尾 logo = stacked-bicolor-**on-dark**(深底頁尾放 on-light 版等於看不見)', () => {
      const { container } = render(<HomeFooter />);
      const img = container.querySelector('.ed-footer-logo img');
      expect(img, '頁尾 logo 沒有 <img>(退回文字了?)').not.toBeNull();
      expect(img!.getAttribute('src')).toBe('/pcm-stacked-bicolor-on-dark.png');
      expect(img!.getAttribute('alt')).toBe('PCM MOTOR PARTS');
      // 反面:on-light / compact / master 三種都不該出現在深底頁尾。
      expect(img!.getAttribute('src'), '頁尾用到了非 stacked-on-dark 的變體')
        .not.toMatch(/on-light|compact|master|italian/);
      expect(img!.getAttribute('width'), '缺 width ⇒ 沒有 aspect-ratio 佔位').toBe('1384');
      expect(img!.getAttribute('height'), '缺 height ⇒ 沒有 aspect-ratio 佔位').toBe('902');
    });
  });

  it('should render live social links from site-config (Q2=A、#136 supersede)', () => {
    render(<HomeFooter />);
    // 三顆社群 = 真連結 <a>(新分頁 + noopener 防 tabnabbing);三顆同構逐一驗
    const expected: Array<[string, string | RegExp]> = [
      ['Facebook', 'https://www.facebook.com/partscheaper'],
      ['Instagram', 'https://www.instagram.com/pcm_officialtw/'],
      ['LINE', /^https:\/\//], // LINE_ADD_URL 走 line-cta SSoT、驗協定不重複寫死短網址
    ];
    for (const [label, href] of expected) {
      const a = screen.getByText(label).closest('a')!;
      if (typeof href === 'string') expect(a.getAttribute('href')).toBe(href);
      else expect(a.getAttribute('href')).toMatch(href);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    // 聯絡客服仍 disabled(拍板範圍外)
    expect(screen.getByLabelText('聯絡客服(尚未上線)')).toBeDefined();
  });

  // 🔴 D3c-5:「購物」那欄四個目的地原本**零守門** —— 本片把「品牌專區」從 `/products`
  //    改回 `/brands`(D3c-3 那條 route 落地後,當年指 /products 的前提消失),
  //    而**改之前跑全套是全綠的**:也就是說改錯方向同樣不會有人知道。
  //    形狀對齊 `Header.test.tsx` 的導覽對照表 —— 那兩顆現在是同一個目的地,要一起鎖。
  it('🔴「購物」欄三個連結的目的地(品牌專區 = 已落地的 /brands)', () => {
    render(<HomeFooter />);
    const expected: [string, string][] = [
      ['商品目錄', '/products'],
      ['品牌專區', '/brands'],
      ['新品上架', '/products?filter=new'],
      // 🔴 「特價專區」2026-08-11 移除(#269-a;Sean:特價概念還不存在)。留註解行,恢復者先讀前提。
      // ['特價專區', '/products?filter=sale'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByText(label).closest('a')?.getAttribute('href'), label).toBe(href);
    }
  });

  // 🔴 D3a 加了 optional `tagline`(品牌頁的頁尾標語每家不同,設計稿
  //    `pcm-home-redesign/brand-page.html:1510-1512` 註解 + `:2029` 灌值)。這兩條是成對的:
  //    只留下面那條的話,有人把預設值刪掉、讓首頁頁尾標語變空也會全綠。
  // 🔴 D-136 清尾片 R1 MF1(2026-08-06):**這條的期望值不要改**。
  //    首頁頁尾標語當天照 OD 改成「專業重機零件・改裝精品/一站式服務」,但那是**首頁一頁**的事,
  //    走 `app/page.tsx` 的 `tagline` prop、守門在 `app/page.test.tsx`。
  //    OD 另外 13 支頁稿全部逐字保留下面這句當預設值 ⇒ 這顆共用元件的預設值不變、本條不動。
  //    (第一版把預設值改掉、也把本條期望值一起改掉了 —— 那會讓 15 頁反向偏離 OD。)
  it('🔴 不給 tagline 時,那句預設標語字面完全不變', () => {
    const { container } = render(<HomeFooter />);
    const p = container.querySelector('.ed-footer-tagline')!;
    expect(p.textContent).toContain('改裝不只是升級配件,');
    expect(p.textContent).toContain('是風格與態度的延伸。');
    // 換行是設計字面的一部分(兩句分兩行),不是可有可無的空白
    expect(p.querySelectorAll('br')).toHaveLength(1);
  });

  it('🔴 給 tagline 時取代預設值(不是疊加 —— 疊加會變成兩句話同時出現)', () => {
    const { container } = render(<HomeFooter tagline={<>先把金屬做好。</>} />);
    const p = container.querySelector('.ed-footer-tagline')!;
    expect(p.textContent).toBe('先把金屬做好。');
    expect(p.textContent).not.toContain('改裝不只是升級配件');
  });
});
