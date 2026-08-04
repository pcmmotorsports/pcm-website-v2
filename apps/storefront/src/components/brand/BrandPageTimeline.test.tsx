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
    expect(first.querySelector('.bp-time-body > h3')?.textContent).toBe(sample.items[0]!.t);
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
