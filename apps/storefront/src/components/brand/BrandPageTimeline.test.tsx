// @vitest-environment jsdom
//
// BrandPageTimeline smoke test — D2d-2(2026-08-04)
//
// 🔴 這一區的特殊處境:**20 家裡只有 2 家有 timeline**(akrapovic / gb-racing)。
//    「20 家都正常」對這一區完全沒有證明力 —— 18 家根本不渲染它。
//    所以下面的斷言全部針對那 2 家的真資料 + 合成 fixture,不做全家掃描。
//
// 最容易靜默壞掉的三件事:
//   ① `is-key` 掛錯或全掛 —— 設計稿逐字:「每條都標等於沒標」
//   ② 深色場的兩條標籤覆寫漏掉 ⇒ 深底黑字(CSS 那半在 brand-page.test.ts 守)
//   ③ `d` 缺席時建了一個空的 <p>(現有 26 列全都有 d ⇒ 真資料不可達)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageTimeline } from './BrandPageTimeline';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandTimeline } from '@/data/brand-content-types';

afterEach(cleanup);

const withTimeline = BRAND_CONTENT.filter((b) => b.timeline);
const sample = withTimeline[0]!.timeline as BrandTimeline;

describe('BrandPageTimeline · 前提', () => {
  it('🔴 只有 2 家有年表 —— 這一區的覆蓋面本來就窄,不要用 20 家當驗收', () => {
    expect(withTimeline.map((b) => b.slug)).toEqual(['akrapovic', 'gb-racing']);
    // 兩家各 13 列、各 4 列標 key、26 列全都有 d(2026-08-04 求值)
    for (const brand of withTimeline) {
      const t = brand.timeline!;
      expect(t.items.length, brand.slug).toBe(13);
      expect(t.items.filter((i) => i.key).length, brand.slug).toBe(4);
      expect(t.items.every((i) => i.d), brand.slug).toBe(true);
      // 🔴 React key 依賴的欄位組合在每家內必須唯一(型別保證不了,只能靠這條)。
      //    Craft 已有同款守門,關卡2 R2 指出 Timeline 漏了 —— 同一個 nit 只套到兩支的其中一支。
      const keys = t.items.map((i) => `${i.y}-${i.t}`);
      expect(new Set(keys).size, `${brand.slug} 有重複的 年份+標題`).toBe(keys.length);
    }
  });
});

describe('BrandPageTimeline · 版型', () => {
  it('🔴 整條巢狀鏈正向斷言(無 class 的 wrapper 拿掉會讓標題與列表各自變 grid item)', () => {
    const { container } = render(<BrandPageTimeline timeline={sample} />);
    expect(container.querySelector('.bp-time > .bp-time-inner')).not.toBeNull();
    expect(container.querySelectorAll('.bp-time-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-time-inner > .bp-sec-label')?.textContent).toBe('Timeline');
    expect(container.querySelector('.bp-time-inner > div > h2')?.textContent).toBe(sample.title);
    expect(container.querySelector('.bp-time-inner > div > .bp-time-list')).not.toBeNull();
  });

  it('每列 = 年份 + 內文兩格,列數等於資料筆數', () => {
    const { container } = render(<BrandPageTimeline timeline={sample} />);
    const items = container.querySelectorAll('.bp-time-item');
    expect(items).toHaveLength(sample.items.length);
    const first = items[0]!;
    expect(first.querySelector('.bp-time-y')?.textContent).toBe(sample.items[0]!.y);
    // 🔴 用 endsWith 不用 toBe:#312 之後,標 key 的列在 h3 開頭多一個只給報讀器的
    //    `.bp-sr-only`(視覺上不存在)⇒ 那幾列的 textContent 帶前綴。
    //    可見文字仍必須是資料原字串收尾、且不得被改寫。
    //    (用 endsWith 不用 new RegExp:標題是資料字串,帶正規式特殊字元就會誤判。)
    expect(first.querySelector('.bp-time-body > h3')?.textContent?.endsWith(sample.items[0]!.t))
      .toBe(true);
  });

  it('🔴 is-key 恰掛在標 key 的那幾列(每條都標 = 等於沒標)', () => {
    const { container } = render(<BrandPageTimeline timeline={sample} />);
    const items = [...container.querySelectorAll('.bp-time-item')];
    items.forEach((el, i) => {
      expect(el.classList.contains('is-key'), `第 ${i} 列`).toBe(sample.items[i]!.key === true);
    });
    // 前提斷言:不是 0 也不是全部 —— 兩個極端都代表上面那圈在空轉
    const keyed = items.filter((el) => el.classList.contains('is-key')).length;
    expect(keyed).toBeGreaterThan(0);
    expect(keyed).toBeLessThan(items.length);
  });

  it('🔴 is-key 同時要有**語意**標記,不能只有顏色(#312 / WCAG 1.4.1)', () => {
    // `is-key` 在視覺上只有顏色差異(圓點白→橘、年份半透明→全白;手機只有年份變色)
    // ⇒ 用讀屏的人拿到 13 條完全一樣的年表,設計上想強調的那 4 條在語意層不存在。
    // 這是資訊遺失、不是冗贅(設計稿 :2011 沒有這個 span;Sean 08-04 拍 A)。
    const { container } = render(<BrandPageTimeline timeline={sample} />);
    const items = [...container.querySelectorAll('.bp-time-item')];
    let marked = 0;
    items.forEach((el, i) => {
      // 🔴 查 `h3 > .bp-sr-only` 不是 `.bp-time-item .bp-sr-only`:標記搬到 h3 外面
      //    (例如掛在 .bp-time-y 旁)時,用標題跳讀的人照樣聽不到 —— 而寬鬆的選擇器全綠。
      const marker = el.querySelector('.bp-time-body > h3 > .bp-sr-only');
      const isKey = sample.items[i]!.key === true;
      expect(Boolean(marker), `第 ${i} 列:標記與 is-key 必須同進同退`).toBe(isKey);
      if (marker) {
        marked += 1;
        // 空的 span 對報讀器等於沒有 ⇒ 內容必須真的有字。
        expect((marker.textContent ?? '').trim().length, `第 ${i} 列的標記是空的`)
          .toBeGreaterThan(0);
      }
    });
    // 前提斷言:上面那圈真的驗到了東西(0 條標記時 forEach 仍會逐條 toBe(false) 全過)
    expect(marked, '標記數必須等於 key 列數').toBe(sample.items.filter((i) => i.key).length);
  });

  it('🔴 沒有 d 的列不建 <p>(合成 fixture:現有 26 列全都有 d ⇒ 真資料走不到)', () => {
    const timeline: BrandTimeline = {
      title: 'T',
      items: [{ y: '1990', t: '有內文', d: '內文' }, { y: '1991', t: '沒內文', d: '' }],
    };
    const { container } = render(<BrandPageTimeline timeline={timeline} />);
    const bodies = container.querySelectorAll('.bp-time-body');
    expect(bodies[0]?.querySelector('p')?.textContent).toBe('內文');
    expect(bodies[1]?.querySelector('p'), '空字串要整個 <p> 不建,不是建一個空的').toBeNull();
  });

  it('title / y / t / d 四個都是純文字(設計稿 :2008-2012 全走 esc;與 Craft 的 d 相反)', () => {
    // 🔴 fixture 一律用**白名單內**的 `<strong>`。第一版 title/y/t 用 `<b>` ——
    //    而 parseBrandRichText 的白名單只有 strong / br,`<b>` 走哪條路都是純文字
    //    ⇒ 那三個欄位的斷言零判別力(Craft 那邊剛修掉同一個坑,這裡復發了;關卡2 nit)。
    const timeline: BrandTimeline = {
      title: '<strong>標</strong>',
      items: [{ y: '<strong>1990</strong>', t: '<strong>T</strong>', d: '<strong>D</strong>' }],
    };
    const { container } = render(<BrandPageTimeline timeline={timeline} />);
    expect(container.querySelectorAll('strong'), '任何一格變成元素都代表走錯路徑').toHaveLength(0);
    expect(container.querySelector('h2')?.textContent).toBe('<strong>標</strong>');
    expect(container.querySelector('.bp-time-y')?.textContent).toBe('<strong>1990</strong>');
    expect(container.querySelector('.bp-time-body h3')?.textContent).toBe('<strong>T</strong>');
    expect(container.querySelector('.bp-time-body p')?.textContent).toBe('<strong>D</strong>');
  });

  it('兩家真資料都渲染得出來,畫面不留 < 或 >', () => {
    for (const brand of withTimeline) {
      const { container } = render(<BrandPageTimeline timeline={brand.timeline!} />);
      expect(container.querySelectorAll('.bp-time-item'), brand.slug).toHaveLength(13);
      const shown = container.textContent ?? '';
      expect(shown.includes('<'), `${brand.slug} 畫面殘留 <`).toBe(false);
      expect(shown.includes('>'), `${brand.slug} 畫面殘留 >`).toBe(false);
      expect(shown.includes('&'), `${brand.slug} 畫面殘留 &`).toBe(false);
      cleanup();
    }
  });
});

// ── #311 標題階層:整頁大綱的守門拆成「每支元件各自的局部不變式」 ──────────────
// 🔴 **D3a(2026-08-04)更新:下面這段的前提已經不成立了。** 正式路由已建 ⇒ 組裝點 =
//    `BrandPageRoot.tsx`,`BrandPageRoot.test.tsx` 已補上「render 整頁再驗大綱」的守門
//    (render 組裝點 = render 真實頁面、不會各自漂移)。本檔的局部不變式**保留**:
//    定位更精準(壞掉時直接指到是哪一支),兩層是刻意冗餘、不是重複。
// 🔴 為什麼不寫一支「渲染整頁再驗大綱」的測試(關卡2 nit 8 指出這個缺口):
//    正式路由要到 D3 才有,現在唯一的組裝點是 dev-preview 那支 server component;
//    在測試裡「照同樣順序自己排一次」= 守門與真實頁面會各自漂移,綠了也不代表頁面對。
//    改成**頁面上的每一支**元件各自保證(`dev-preview/brand-page/[slug]/page.tsx:37-44` 共 7 支):
//      · Header 恰一個 h1 且無其他標題
//      · About 零標題 —— **兩條右欄分流都要驗**(產品照卡 8 家 / 影片 12 家)
//      · Media / Categories 零標題
//      · Why · Craft · Timeline · BrandWall 第一個標題是 h2、最深只到 h3
//    序列 = [1] ++ [] ++ B ++ B ++ B? ++ [] ++ B,每個 B 首項=2 且 ⊆ {2,3}
//    ⇒ 1→2 是 +1、{2,3} 內部只有 +1 或下降 ⇒ 無跳級,且**與組裝順序無關**。
//    🔴 關卡2 R2 抓到第一版只守了 5 支:About 的斷言只跑 `asideOnly`(8 家),
//       另外 12 家走的是 `BrandPageMedia`,而它與 Categories / BrandWall 三支**零守門**
//       ⇒ 在 Media 裡加一個 <h3> 圖說,h1 直接接 h3、5 條測試全綠。

describe('BrandPageTimeline · 標題階層(#311)', () => {
  it('🔴 第一個標題是 h2、其餘只到 h3', () => {
    const { container } = render(<BrandPageTimeline timeline={sample} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => Number(h.tagName[1]));
    expect(levels.length, '前提:真的有標題可驗').toBeGreaterThan(0);
    expect(levels[0], '本區第一個標題必須是 h2').toBe(2);
    expect(levels.filter((l) => l !== 2 && l !== 3), '只准出現 h2 與 h3').toEqual([]);
    expect(levels.includes(3), '每列標題必須是 h3').toBe(true);
  });
});
