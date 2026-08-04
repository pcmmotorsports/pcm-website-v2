// @vitest-environment jsdom
//
// BrandPageCraft smoke test — D2d-2(2026-08-04)
//
// 這一區最容易靜默壞掉的四件事:
//   ① 影片列與圖片列分流走錯 —— 只有 rizoma 兩列是影片,18 家看不到這條路
//   ② 影片列被當成 D2c-2 那種「點了才掛」的品牌影片(它是原生 controls、preload=none)
//   ③ `d` 誤當純文字 / `step`·`t`·`alt` 誤走 BrandRichText(方向相反的那組)
//   ④ 資產路徑漏了 /brand-assets/ 前綴 ⇒ 破圖,而破圖不會讓任何流程變紅

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageCraft } from './BrandPageCraft';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandContent } from '@/data/brand-content-types';

afterEach(cleanup);

/** 全站唯一有影片列的品牌(rizoma 兩列);挑不到就讓測試自己講話。 */
const withVideoRow = BRAND_CONTENT.find((b) => b.craft.rows.some((r) => r.video)) as BrandContent;
/** 純圖片列的品牌。 */
const imageOnly = BRAND_CONTENT.find((b) => b.craft.rows.every((r) => !r.video)) as BrandContent;
/** 有裁切焦點的那幾列(5 列)。 */
const withFocus = BRAND_CONTENT.find((b) => b.craft.rows.some((r) => r.focus)) as BrandContent;

describe('BrandPageCraft · 步驟面板', () => {
  it('🔴 整條巢狀鏈正向斷言(無 class 的 wrapper 拿掉會讓標題與格線各自變 grid item)', () => {
    const { container } = render(<BrandPageCraft brand={imageOnly} />);
    expect(container.querySelector('.bp-craft > .bp-craft-inner')).not.toBeNull();
    expect(container.querySelectorAll('.bp-craft-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-craft-inner > .bp-sec-label')?.textContent).toBe('Craft');
    expect(container.querySelector('.bp-craft-inner > div > .bp-craft-head > h2')?.textContent)
      .toBe(imageOnly.craft.title);
    expect(container.querySelector('.bp-craft-inner > div > .bp-craft-grid')).not.toBeNull();
  });

  it('🔴 React key 依賴的欄位在每家內必須唯一(型別保證不了,只能靠這條)', () => {
    // key={row.t}:今天 20 家全唯一,但那是**資料依賴**。新增一列同名步驟就會靜默出現
    // duplicate key —— React 只在 console 警告,測試與三綠全綠(關卡2 nit)。
    for (const brand of BRAND_CONTENT) {
      const titles = brand.craft.rows.map((r) => r.t);
      expect(new Set(titles).size, `${brand.slug} 有重複的步驟標題`).toBe(titles.length);
    }
  });

  it('🔴 步數必須是偶數(版面是 2 欄格線,奇數會在右下留一個像沒做完的角)', () => {
    // 型別檔 :92-94 記過這條;實測 20 家是 2 或 4 步。這裡把它變成會轉紅的斷言。
    for (const brand of BRAND_CONTENT) {
      expect(brand.craft.rows.length % 2, `${brand.slug} 有 ${brand.craft.rows.length} 步`).toBe(0);
    }
  });

  it('每面板 = 媒體 + 步號 + 標題 + 內文四件,順序固定', () => {
    const { container } = render(<BrandPageCraft brand={imageOnly} />);
    const panel = container.querySelector('.bp-craft-panel')!;
    const kids = [...panel.children].map((el) => el.className || el.tagName.toLowerCase());
    expect(kids).toEqual(['bp-craft-media', 'bp-craft-step', 'h3', 'p']);
  });

  it('🔴 d 走 BrandRichText、step/t/alt 是純文字(方向相反)', () => {
    // 🔴 fixture 必須用**白名單內**的標記(`<strong>`)。第一版用 `<b>` ——
    //    而 parseBrandRichText 的白名單只有 strong / br,`<b>` 兩條路都當純文字
    //    ⇒ 「step 誤走 BrandRichText」那個突變零紅(實測),這條測試沒有判別力。
    const brand: BrandContent = {
      ...imageOnly,
      craft: {
        ...imageOnly.craft,
        rows: [
          {
            ...imageOnly.craft.rows[0]!,
            step: '<strong>S</strong>', t: '<strong>T</strong>',
            alt: '<strong>A</strong>', d: '<strong>D</strong>',
          },
          imageOnly.craft.rows[1]!,
        ],
      },
    };
    const { container } = render(<BrandPageCraft brand={brand} />);
    const panel = container.querySelector('.bp-craft-panel')!;
    // 純文字路徑:標記原樣留在畫面上、不得變成元素
    expect(panel.querySelector('.bp-craft-step')?.textContent).toBe('<strong>S</strong>');
    expect(panel.querySelector('.bp-craft-step')?.querySelectorAll('strong')).toHaveLength(0);
    expect(panel.querySelector('h3')?.textContent).toBe('<strong>T</strong>');
    expect(panel.querySelector('h3')?.querySelectorAll('strong')).toHaveLength(0);
    expect(panel.querySelector('img')?.getAttribute('alt')).toBe('<strong>A</strong>');
    // d 這條相反:標記要變成真的元素,而且整個面板只有它那一個
    expect(panel.querySelectorAll('p strong')).toHaveLength(1);
    expect(panel.querySelectorAll('strong')).toHaveLength(1);
  });
});

describe('🔴 BrandPageCraft · 影片列 vs 圖片列', () => {
  it('影片列用原生 <video>:controls + loop + preload="none",且**不**自動播', () => {
    // 設計稿 :1995-1996 逐字:面板小、不值得再寫一套點播邏輯;兩支同時跑很吵。
    // 🔴 這與 D2c-2 的 About 影片(點了才掛 iframe、autoplay)是**不同的處理**,
    //    順手統一成任一邊都是錯的。
    const { container } = render(<BrandPageCraft brand={withVideoRow} />);
    const video = container.querySelector('.bp-craft-media video');
    expect(video, '前提:挑到的樣本真的有影片列').not.toBeNull();
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.getAttribute('preload')).toBe('none');
    expect(video?.hasAttribute('autoplay'), '自動播會讓兩支同時跑').toBe(false);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    // 封面走 poster(不是另建一個 <img>),名稱掛 aria-label(報讀器對 <video> 只念得到它)
    const row = withVideoRow.craft.rows.find((r) => r.video)!;
    expect(video?.getAttribute('poster')).toBe(`/brand-assets/${row.img}`);
    expect(video?.getAttribute('src')).toBe(`/brand-assets/${row.video}`);
    expect(video?.getAttribute('aria-label')).toBe(row.alt);
    // 🔴 `title` **刻意不掛**(#312 第二條;設計稿 :1999 兩個都給同一個字串)——
    //    同字串時部分輔具會先念 name 再念 description = 同一句聽兩次。
    //    ⚠️ 這條與上一行是一組:只留這條的話,把 aria-label 也刪掉會全綠而影片變無名元素;
    //       只留上一行的話,把 title 加回去也全綠。
    expect(video?.hasAttribute('title'), 'title 與 aria-label 同字串 ⇒ 只留一個').toBe(false);
  });

  it('影片列不建 <img>、圖片列不建 <video>(同一格只放一個)', () => {
    const { container: v } = render(<BrandPageCraft brand={withVideoRow} />);
    const videoPanel = [...v.querySelectorAll('.bp-craft-panel')]
      .find((p) => p.querySelector('video'))!;
    expect(videoPanel.querySelectorAll('img')).toHaveLength(0);
    cleanup();
    const { container: i } = render(<BrandPageCraft brand={imageOnly} />);
    expect(i.querySelectorAll('video')).toHaveLength(0);
    expect(i.querySelectorAll('.bp-craft-media img').length).toBe(imageOnly.craft.rows.length);
  });

  it('圖片列 lazy + 走資產前綴', () => {
    const { container } = render(<BrandPageCraft brand={imageOnly} />);
    const img = container.querySelector<HTMLImageElement>('.bp-craft-media img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('src')).toBe(`/brand-assets/${imageOnly.craft.rows[0]!.img}`);
  });

  it('focus 有值才寫 object-position,沒有的列不得有 inline style(圖片列與影片列各一)', () => {
    // 🔴 樣本必須**同時**有帶 focus 與不帶 focus 的列(gilles 就是 1/2)——
    //    全部都帶的話「沒有的列不得有」那半恆真,把 style 寫成無條件也照樣綠。
    const mixed = withFocus.craft.rows.filter((r) => r.focus).length;
    expect(mixed, '前提:樣本要有帶 focus 的列').toBeGreaterThan(0);
    expect(mixed, '前提:樣本也要有不帶 focus 的列,否則反面那半恆真')
      .toBeLessThan(withFocus.craft.rows.length);

    const row = withFocus.craft.rows.find((r) => r.focus)!;
    const { container } = render(<BrandPageCraft brand={withFocus} />);
    const media = [...container.querySelectorAll<HTMLElement>('.bp-craft-media img, .bp-craft-media video')];
    const withStyle = media.filter((el) => el.style.objectPosition);
    expect(withStyle).toHaveLength(mixed);
    expect(withStyle[0]!.style.objectPosition).toBe(row.focus);
    cleanup();

    // 🔴 影片列走的是**另一個分支**,要單獨測 —— rizoma 兩列都沒有 focus,
    //    所以上面那條(圖片列的樣本)對影片分支零覆蓋:把影片那邊寫成無條件 style
    //    在第一版突變裡是「零紅」的,而那並不代表守住了,只代表沒測到。
    const { container: v } = render(<BrandPageCraft brand={withVideoRow} />);
    const videos = [...v.querySelectorAll<HTMLElement>('.bp-craft-media video')];
    expect(videos.length).toBeGreaterThan(0);
    expect(withVideoRow.craft.rows.filter((r) => r.video && r.focus)).toHaveLength(0); // 前提
    for (const el of videos) expect(el.style.objectPosition, '影片列沒有 focus 就不該有 inline style').toBe('');
  });
});

describe('BrandPageCraft · 20 家實資料', () => {
  it('每家的面板數 = rows 數,畫面不留 < 或 >,影片列恰 2 列(只有 rizoma)', () => {
    let videoRows = 0;
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageCraft brand={brand} />);
      expect(container.querySelectorAll('.bp-craft-panel'), brand.slug)
        .toHaveLength(brand.craft.rows.length);
      videoRows += container.querySelectorAll('.bp-craft-media video').length;
      const shown = container.textContent ?? '';
      expect(shown.includes('<'), `${brand.slug} 畫面殘留 <`).toBe(false);
      expect(shown.includes('>'), `${brand.slug} 畫面殘留 >`).toBe(false);
      cleanup();
    }
    // 前提斷言:不是 0(分流沒生效那條會空過)也不是全部
    expect(videoRows).toBe(BRAND_CONTENT.reduce((n, b) => n + b.craft.rows.filter((r) => r.video).length, 0));
    expect(videoRows).toBeGreaterThan(0);
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

describe('BrandPageCraft · 標題階層(#311)', () => {
  it('🔴 第一個標題是 h2、其餘只到 h3', () => {
    const { container } = render(<BrandPageCraft brand={imageOnly} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => Number(h.tagName[1]));
    expect(levels.length, '前提:真的有標題可驗').toBeGreaterThan(0);
    expect(levels[0], '本區第一個標題必須是 h2').toBe(2);
    expect(levels.filter((l) => l !== 2 && l !== 3), '只准出現 h2 與 h3').toEqual([]);
    expect(levels.includes(3), '步驟標題必須是 h3').toBe(true);
  });
});
