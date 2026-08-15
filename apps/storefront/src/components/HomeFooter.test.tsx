// @vitest-environment jsdom
//
// HomeFooter smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeFooter } from './HomeFooter';
import { OPENING_HOURS, STORE_ADDRESS } from '@/lib/site-config';

afterEach(cleanup);

/**
 * 門市地址那個 `<p>`(`HomeFooter.tsx` 的「門市」欄第一段)。
 *
 * 🔴 **從欄名走過去、不用行號也不加 test-only 屬性**:那顆 `<p>` 沒有自己的 class,
 * 而在 `container` 上比對會把整個頁尾都算進來(E-627 nit3)。
 * 找不到就 throw ⇒ **markup 變了要紅**,不要靜默退回整個元件(那會讓這格恢復成寬鬆版)。
 */
function storeAddressNode(container: HTMLElement): HTMLElement {
  const col = Array.from(container.querySelectorAll('.ed-footer-cols > div')).find(
    (d) => d.querySelector('.ed-footer-h')?.textContent === '門市',
  );
  if (!col) throw new Error('找不到「門市」那一欄 —— 頁尾 markup 變了,這格的選法要跟著更新');
  // 🔴 E-630 nit1:本 helper 取的是**第一個** `<p>`,那是位置相依的。
  //    有人在地址上面插一段(公休公告之類)⇒ 會靜默取到營業時間那段,
  //    測試照樣紅、但訊息會是「地址的『1樓』不見了」⇒ **紅在錯的成因上**,
  //    看到的人會去找地址被誰改掉,而地址根本沒動。
  //    ⇒ 把「地址是第一段」這個結構假設變成**會自己叫的東西**,不要讓它靜默成立。
  const ps = col.querySelectorAll('p');
  if (ps.length !== 3) {
    throw new Error(
      `「門市」欄的 <p> 由 3 段變成 ${ps.length} 段 —— 本 helper 取第一段當地址。` +
        '請先確認地址還是第一段(是的話把這個數字改成新的;不是的話改選法),再看其他紅。',
    );
  }
  return ps[0] as HTMLElement;
}

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
    it('🔴 版權列 = 「© {當年} PCM MOTOR PARTS LTD 版權所有」', () => {
      render(<HomeFooter />);
      expect(screen.getByText(`© ${new Date().getFullYear()} PCM MOTOR PARTS LTD 版權所有`)).toBeDefined();
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
        expect(screen.getByText('© 2031 PCM MOTOR PARTS LTD 版權所有'), '年份被寫死了').toBeDefined();
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

  // 🔴 D-040(2026-08-15):在此之前,頁尾地址字面**零守門** ——
  //    它硬寫在 `HomeFooter.tsx`、不吃 `lib/site-config.ts` 的 `STORE_ADDRESS`,
  //    所以改常數不會動到它、改它也不會有任何一格轉紅。這格補的就是那個零訊號。
  //    斷言打在**渲染出來的文字**上,不是打在常數上 —— 釘常數擋不住顯示層再正規化一次。
  // 🔴 E-627 MF2(2026-08-15):上面那段的第一版**只釘字面複本** ——
  //    渲染點硬寫、斷言也硬寫同一個字面 ⇒ **改 `site-config.ts` 的 SSoT,這格不會紅。**
  //    **實跑驗過**(不是推的):把 `STORE_ADDRESS.street` 改成 `化成路999巷99號9樓`、
  //    渲染點一個字不動 ⇒ 這兩支測試檔 **19 passed、零紅**。
  //    ⇒ 下面第二條斷言接 SSoT 本體,才追得到漂移。
  //    (`HomeFooter.tsx:41` 早就 import 過 site-config,不是零到一。)
  // 🔴 E-627 nit3:反面斷言收窄到門市地址那個節點,不打在 `container` 上 ——
  //    打在整個元件上的話,將來任何**合法**的「一樓」(展示間一樓、分店、活動文案)
  //    都會讓它紅,而看到紅的人第一反應會是「地址被改回去了」= 紅在對的方向、錯的位置。
  it('🔴 門市地址是「1樓」不是「一樓」,且與 SSoT 一致(釘的是【本公司】地址,不是客人收件地址)', () => {
    const { container } = render(<HomeFooter />);
    const addr = storeAddressNode(container);
    const text = addr.textContent ?? '';

    // ① Sean 2026-08-15 逐字拍板阿拉伯數字「1樓」;反面 = 舊字面復活。
    //    曾有文件寫反方向(「一樓才對」)⇒ 那個方向已作廢,別照舊文件改回去。
    expect(text, '頁尾門市地址的「1樓」不見了').toContain('736 巷 18 號1樓');
    expect(text, '門市地址出現「一樓」⇒ 有人照過期的舊字面改回去了').not.toContain('一樓');

    // ② 🔴 追 SSoT 漂移:比對前把空白抹掉,**正規化放在斷言側、不動排版**。
    //    站上是 `新北市新莊區化成路<br/>736 巷 18 號1樓`(有空格有換行),
    //    SSoT 分三欄存 ⇒「逐字等於」不成立,但「不能跟 SSoT 比對」是假的做不到。
    //
    // 🔴 E-630 MF:第一版只比 `street` **一個欄位** —— 而這個 `<p>` 印的是
    //    `region + locality + street` 三個。改 SSoT 的 `region` ⇒ 前台照印「新北市」、三條全綠。
    //    **同一個病換一個欄位。**(E 自己認了它的處方作用域本身就窄;而我照收沒問
    //    「它涵蓋幾個欄位」—— 那一步是我的。兩筆分開記,不相消。)
    // 🔴 用 `toBe` 不用 `toContain`,順帶關掉方向性缺口:
    //    **`toContain` 只證「渲染沒少掉 SSoT 有的」,不證「渲染沒多出 SSoT 沒有的」** ——
    //    SSoT 若拿掉樓層,渲染字串仍然包含它 ⇒ 全綠,而紙上多印一個 SSoT 已經不認的樓層。
    // ⚠️ `postalCode` / `country` **刻意不納入比對**:頁尾根本沒渲染它們,
    //    比了會變成一條恆假的斷言。
    expect(text.replace(/\s/g, ''), '頁尾地址與 site-config 的 STORE_ADDRESS 漂開了').toBe(
      STORE_ADDRESS.region + STORE_ADDRESS.locality + STORE_ADDRESS.street,
    );
  });

  // 🔴🔴 E-63x R3(2026-08-15):R3 查的是「過寬」(地址斷言會不會誤紅),
  //    結論是**不會**;但同一批突變挖出**另一個欄位的同款病 —— 營業時間**。
  //    `lib/site-config.ts:38` 有 `OPENING_HOURS`,而且**已有三個消費端**:
  //      `MobileMenu.tsx:73` / `data/legal-content.ts:67`(法律頁)/ `lib/org-jsonld.ts:55-57`(搜尋引擎)
  //    本檔與 `ComingSoon.tsx` 卻**硬寫**「週一-週六 10:00-19:00」。
  //    ⇒ 改 SSoT ⇒ 那三處變、這兩處不變 ⇒ **同一個事實站上兩種說法**。
  //    E 實測:突變 `OPENING_HOURS.opens`/`.closes` ⇒ 這兩支測試檔 **19 passed、零訊號**。
  //    🔴 比地址那次嚴重一級:地址是「靜默不同步」,營業時間是**同一頁面群裡兩處講不同的話**
  //      (其中一處是**法律頁**)。
  //
  // 🔴🔴 **本格守的【不是】「SSoT 漂移」—— 那個已經被構造消滅了。**
  //    渲染點改吃 `OPENING_HOURS` 之後,突變 SSoT 會讓兩邊一起變 ⇒ **本格對那發恆綠**
  //    (實測:改 `closes` ⇒ 21 passed,不紅)。**寫在這裡是因為恆綠格比沒有更糟,
  //    而讀的人有權知道它到底守得住什麼。**
  //    ⇒ **它守的是「有人把它硬寫回去」** —— 那是漂移唯一能復活的路(重構、照 OD 抄、複製貼上)。
  //    實測負向對照:把渲染改回硬寫且值與 SSoT 不同(`09:00-18:00`)
  //    ⇒ **兩支都紅**(`Test Files 2 failed`),訊息即下面那句。
  //    ⚠️ 若哪天有人「簡化」成直接比字面常數,本格就會退化成恆綠 —— 期望值必須來自 SSoT。
  it('🔴 頁尾營業時間與 site-config 的 OPENING_HOURS 一致(本檔硬寫、三個消費端吃 SSoT)', () => {
    const { container } = render(<HomeFooter />);
    const col = Array.from(container.querySelectorAll('.ed-footer-cols > div')).find(
      (d) => d.querySelector('.ed-footer-h')?.textContent === '門市',
    );
    if (!col) throw new Error('找不到「門市」那一欄 —— 頁尾 markup 變了');
    // 門市欄第 2 段是營業時間(第 1 段地址、第 3 段電話);段數守門在 `storeAddressNode`。
    const hours = col.querySelectorAll('p')[1]?.textContent ?? '';
    expect(hours.replace(/\s/g, ''), '頁尾營業時間與 OPENING_HOURS 漂開了').toBe(
      `週一-週六${OPENING_HOURS.opens}-${OPENING_HOURS.closes}`,
    );
  });
});
