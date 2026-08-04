// @vitest-environment jsdom
//
// BrandPageWhy smoke test — D2d-1(2026-08-04)
//
// 這一區最容易靜默壞掉的四件事,下面每一組各對一件:
//   ① lead 誤走 BrandRichText(設計稿 :1974 對它走 textContent,與同物件裡的 card.d 相反)
//   ② `--num-n` 或 `data-n` 漏設一個 —— 只在「3 個數字的那 6 家 × 特定寬度」現形,
//      而且看起來像「線畫歪了」不像 bug
//   ③ 沒有 stats 的 6 家留了一個空的 .bp-nums ⇒ 卡片下面憑空多一條 border-top
//   ④ 卡片編號沒補零(1 2 3 4 vs 01 02 03 04),等寬字左緣參差

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageWhy } from './BrandPageWhy';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

/** 有 stats 的與沒 stats 的各挑一家真資料;挑不到就讓測試自己講話。 */
const withStats = BRAND_CONTENT.find((b) => b.stats) as BrandContent;
const noStats = BRAND_CONTENT.find((b) => !b.stats) as BrandContent;
/** 只有 3 個數字的那幾家 —— ②③ 兩條的真實形狀都在這裡。 */
const threeStats = BRAND_CONTENT.find((b) => b.stats?.items.length === 3) as BrandContent;

describe('BrandPageWhy · 卡片', () => {
  it('🔴 lead 是純文字、card.d 走 BrandRichText(同一個物件裡兩種處理,方向相反)', () => {
    const brand: BrandContent = {
      ...withStats,
      highlights: {
        title: 'T',
        lead: '<strong>前言</strong>',
        cards: [{ t: '甲', d: '<strong>內文</strong>' }],
      },
    };
    const { container } = render(<BrandPageWhy brand={brand} />);
    // lead:標記原樣留在畫面上(因為設計稿對它走 textContent)
    const lead = container.querySelector('.bp-why-lead');
    expect(lead?.querySelectorAll('strong')).toHaveLength(0);
    expect(lead?.textContent).toBe('<strong>前言</strong>');
    // card.d:標記變成真的元素
    expect(container.querySelectorAll('.bp-why-card strong')).toHaveLength(1);
  });

  it('card.t 是純文字(設計稿 :1977 對它走 esc())', () => {
    const brand: BrandContent = {
      ...withStats,
      highlights: { ...withStats.highlights, cards: [{ t: '<strong>標</strong>', d: 'x' }] },
    };
    const { container } = render(<BrandPageWhy brand={brand} />);
    expect(container.querySelector('.bp-why-card h3')?.querySelectorAll('strong')).toHaveLength(0);
  });

  it('🔴 編號補零到兩位、依序 01 02 03 04', () => {
    const { container } = render(<BrandPageWhy brand={withStats} />);
    const nums = [...container.querySelectorAll('.bp-why-num')].map((n) => n.textContent);
    expect(nums).toEqual(['01', '02', '03', '04']);
  });

  it('🔴 編號對報讀器隱藏(#308 同族:它是視覺對齊、不帶資訊)', () => {
    // 元件註解自己講的:01 02 03 04 是等寬字的**視覺對齊**。留著會讓報讀器在
    // 每張卡標題前多唸一次「零一」「零二」(設計稿 :1976 沒有 aria-hidden;Sean 08-04 拍 A)。
    const { container } = render(<BrandPageWhy brand={withStats} />);
    const nums = [...container.querySelectorAll('.bp-why-num')];
    expect(nums.length, '前提:真的有編號可驗').toBe(4);
    // 🔴 逐個驗、不用 querySelectorAll('[aria-hidden]').length —— 後者在「只有第一張掛到」
    //    時也會是非零;而漏掛的那幾張就是會被唸出來的那幾張。
    for (const [i, n] of nums.entries()) {
      expect(n.getAttribute('aria-hidden'), `第 ${i + 1} 張卡的編號`).toBe('true');
    }
  });

  it('🔴 整條巢狀鏈都要正向斷言 —— 它們扛的是格線與斷點,而 jsdom 不算 grid', () => {
    // 關卡2 M2:原本只驗 `.bp-why-grid` 存在 ⇒ 把**無 class 的那層 wrapper**整層刪掉,
    // 元件測試與 CSS 測試會全綠(CSS 測試只讀原文)—— 而少了那層,h2/lead/卡片/數字條
    // 會各自變成 `.bp-why-inner` 的 grid item、排成一直排,200px 標籤欄那一格也被吃掉。
    // 同形狀還有兩個:section 改名、`.bp-why-inner` 改名 —— 一起用整條選擇器釘死。
    const { container } = render(<BrandPageWhy brand={withStats} />);
    expect(container.querySelector('.bp-why > .bp-why-inner')).not.toBeNull();
    // 標籤欄 + 內容 wrapper 恰兩個子元素:多一個就等於多一欄,少一個就是塌掉
    expect(container.querySelectorAll('.bp-why-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-why-inner > .bp-sec-label')?.textContent).toBe('Why');
    expect(container.querySelector('.bp-why-inner > div > .bp-why-grid')).not.toBeNull();
    expect(container.querySelectorAll('.bp-why-grid > .bp-why-card')).toHaveLength(4);
    expect(container.querySelector('.bp-why-inner > div > .bp-nums')).not.toBeNull();
  });
});

describe('🔴 BrandPageWhy · 數字條', () => {
  it('--num-n 與 data-n 兩個都要設,且都等於實際個數', () => {
    // 兩者守不同的事:--num-n 決定欄數(寫死 4 會讓 3 個數字的 6 家多一格空白 +
    // 一條斷掉的分隔線);data-n 給 ≤1024 兩欄版判斷最後一列是一格還是兩格。
    for (const brand of [withStats, threeStats]) {
      const { container } = render(<BrandPageWhy brand={brand} />);
      const nums = container.querySelector<HTMLElement>('.bp-nums');
      const n = brand.stats!.items.length;
      expect(nums?.dataset.n, brand.slug).toBe(String(n));
      expect(nums?.style.getPropertyValue('--num-n'), brand.slug).toBe(String(n));
      expect(container.querySelectorAll('.bp-num'), brand.slug).toHaveLength(n);
      cleanup();
    }
    // 前提斷言:兩個樣本的個數真的不同,否則上面那圈跑兩次是同一件事
    expect(withStats.stats!.items.length).not.toBe(threeStats.stats!.items.length);
  });

  it('🔴 沒有 stats 的 6 家:整個 .bp-nums 不建(不是建一個空的)', () => {
    // 空的 div 會讓 border-top 憑空多畫一條線在卡片下面(設計稿 :1987 是 remove 不是 hide)。
    const { container } = render(<BrandPageWhy brand={noStats} />);
    expect(container.querySelector('.bp-nums')).toBeNull();
    // 前提:卡片那半仍照常渲染 —— 否則這條可能是整個元件沒渲染而「通過」
    expect(container.querySelectorAll('.bp-why-card')).toHaveLength(4);
  });

  it('plus 為真才補 <sup>+</sup>,沒有的格不得有', () => {
    const brand: BrandContent = {
      ...withStats,
      stats: { items: [{ n: '9', l: 'A', s: 's', plus: true }, { n: '8', l: 'B', s: 's' }] },
    };
    const { container } = render(<BrandPageWhy brand={brand} />);
    const cells = container.querySelectorAll('.bp-num-n');
    expect(cells[0]?.querySelector('sup')?.textContent).toBe('+');
    expect(cells[1]?.querySelector('sup')).toBeNull();
    // 反面:值本身不得被 + 汙染(把 plus 直接串進數字裡的寫法)
    expect(cells[1]?.textContent).toBe('8');
  });

  it('n / l / s 三格都是純文字(設計稿 :1985-1986 全走 esc)', () => {
    const brand: BrandContent = {
      ...withStats,
      stats: { items: [{ n: '<b>1</b>', l: '<b>2</b>', s: '<b>3</b>' }] },
    };
    const { container } = render(<BrandPageWhy brand={brand} />);
    expect(container.querySelectorAll('.bp-nums b')).toHaveLength(0);
    expect(container.querySelector('.bp-num-l')?.textContent).toBe('<b>2</b>');
  });
});

describe('BrandPageWhy · 20 家實資料', () => {
  it('每家都渲染得出四張卡,畫面不留 < 或 >', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageWhy brand={brand} />);
      expect(container.querySelectorAll('.bp-why-card'), brand.slug).toHaveLength(4);
      const shown = container.textContent ?? '';
      expect(shown.includes('<'), `${brand.slug} 畫面殘留 <`).toBe(false);
      expect(shown.includes('>'), `${brand.slug} 畫面殘留 >`).toBe(false);
      // 🔴 `&` 只掃**純文字那幾條路徑**,不掃整棵樹(關卡2 R2 nit):
      //    `card.d` 走 BrandRichText,而它會**正確**把 `&amp;` 解成 `&`
      //    (`lib/brand-rich-text.ts`;真實文案已有這種字 —— lightech 的「PUSH &amp; PULL」)
      //    ⇒ 掃整棵樹的話,哪天某家的卡片內文出現這個字就是**假紅**。
      //    純文字路徑 = lead / card.t / 數字三格:它們沒有解碼,`&amp;` 會原樣印在畫面上。
      const plain = [...container.querySelectorAll('.bp-why-lead, .bp-why-card h3, .bp-num-n, .bp-num-l, .bp-num-s')]
        .map((el) => el.textContent ?? '').join('');
      expect(plain.includes('&'), `${brand.slug} 純文字路徑殘留 &`).toBe(false);
      cleanup();
    }
  });

  it('數字條恰出現在有 stats 的那 14 家,且欄數各自正確', () => {
    let shown = 0;
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageWhy brand={brand} />);
      const nums = container.querySelector<HTMLElement>('.bp-nums');
      expect(nums !== null, brand.slug).toBe(brand.stats !== undefined);
      if (nums) {
        shown++;
        expect(nums.dataset.n, brand.slug).toBe(String(brand.stats!.items.length));
      }
      cleanup();
    }
    // 前提斷言:不是 0 也不是 20 —— 兩個極端都代表分流沒生效而上面那條會空過
    expect(shown).toBe(BRAND_CONTENT.filter((b) => b.stats).length);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(BRAND_CONTENT.length);
    // 實測分佈:14 家有、其中 6 家只有 3 個數字(3 個那組正是 data-n 分流的理由)
    expect(BRAND_CONTENT.filter((b) => b.stats?.items.length === 3).length).toBeGreaterThan(0);
  });
});

// ── #311 標題階層:整頁大綱的守門拆成「每支元件各自的局部不變式」 ──────────────
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

describe('BrandPageWhy · 標題階層(#311)', () => {
  it('🔴 第一個標題是 h2、其餘只到 h3(多一階或跳級都會讓整頁大綱壞掉)', () => {
    const { container } = render(<BrandPageWhy brand={withStats} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => Number(h.tagName[1]));
    expect(levels.length, '前提:真的有標題可驗').toBeGreaterThan(0);
    expect(levels[0], '本區第一個標題必須是 h2').toBe(2);
    expect(levels.filter((l) => l !== 2 && l !== 3), '只准出現 h2 與 h3').toEqual([]);
    expect(levels.includes(3), '卡片標題必須是 h3').toBe(true);
  });
});
