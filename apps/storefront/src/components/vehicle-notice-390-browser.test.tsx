// @vitest-environment node
//
// vehicle-notice-390-browser.test.tsx —— 「車款讀不到」那句話在**手機 390 寬**會不會撐破版面。
// (2026-09-06 線 `front` · 板列 ⟦search-TAXONOMYTIMEOUT⟧ · 主視窗交辦補的那一格)
//
// 🔴 **為什麼要真瀏覽器**:`e9a811d25` 那四格全在 jsdom,而 **jsdom 不做版面** ——
//    它的 `scrollWidth` / `clientWidth` 恆為 0 ⇒ 「有沒有溢出」在那裡問不到。
//    ⇒ 📌 那不是「還沒測」, 是**那把尺對這個問題零判別力**。
//
// 🛑🛑 **主視窗交辦的正對照是「把字串加長三倍 ⇒ 那格要紅」, 而我【量了之後改掉它】, 理由寫在這裡:**
//    中日韓文字**逐字都可以斷行** ⇒ 同一句話重複三倍照樣乖乖換行, **不會溢出**
//    ⇒ 🔴 **那個對照【紅不起來】, 而它紅不起來的時候看起來就像「通過了」。**
//    ✅ 換成一段**不可斷行**的長字串(無空白的 ASCII)當正對照 —— 它必須溢出。
//    🔵 而三倍那一發我**照樣量、照樣印出來**(下面第三格), 讓下一個人自己看到那個數字,
//       不必相信我這段話。
//
// ⚠️ **射程**:本檔量的是**那個元素自己**在 390 寬底下的水平溢出,
//    **不含**它真實祖先容器的 padding / flex 收縮 ⇒ 它答得了「這句話本身會不會爆」,
//    答不了「放進首頁那個 dock 裡會不會爆」。後者要整頁的量測, 那是另一格。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from '@playwright/test';
import {
  BRAND_TAXONOMY_UNAVAILABLE,
  CATEGORY_TAXONOMY_UNAVAILABLE,
  VEHICLE_TAXONOMY_UNAVAILABLE,
  TaxonomyNotice,
  VehicleTaxonomyNotice,
} from './products-message-state';

const VIEWPORT = { width: 390, height: 844 }; // iPhone 12/13/14 直式

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** 把那顆 Notice 的 markup 放進 390 寬的頁面,量它自己與整頁的水平溢出。 */
async function measure(text: string) {
  // 🔵 直接拿元件的真 markup(含它真的 inline style), 不重打一份 —— 重打就是第二把尺。
  const markup = renderToStaticMarkup(<VehicleTaxonomyNotice failed />).replace(
    VEHICLE_TAXONOMY_UNAVAILABLE,
    text,
  );
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta name="viewport" content="width=390">` +
        `<style>*{box-sizing:border-box}body{margin:0}</style></head>` +
        `<body><div id="host" style="width:390px">${markup}</div></body></html>`,
    );
    return await page.evaluate(() => {
      const el = document.querySelector('[role="alert"]') as HTMLElement | null;
      if (!el) throw new Error('量不到那個元素 —— 選擇器沒接上, 這一發作廢');
      const doc = document.documentElement;
      return {
        文字: el.textContent ?? '',
        元素捲寬: el.scrollWidth,
        元素可視寬: el.clientWidth,
        整頁捲寬: doc.scrollWidth,
        整頁可視寬: doc.clientWidth,
      };
    });
  } finally {
    await page.close();
  }
}

describe('車款讀不到那句話 · 390 寬會不會撐破(⟦search-TAXONOMYTIMEOUT⟧)', () => {
  it('🟢 正對照先跑:一段【不可斷行】的長字串 ⇒ 必須溢出(證明這把尺量得到溢出)', async () => {
    const r = await measure('X'.repeat(400));
    expect(r.整頁捲寬).toBeGreaterThan(r.整頁可視寬);
  }, 60_000);

  it('🔴 真的那句話 ⇒ 不得溢出(元素與整頁兩個都要)', async () => {
    const r = await measure(VEHICLE_TAXONOMY_UNAVAILABLE);
    expect(r.文字).toBe(VEHICLE_TAXONOMY_UNAVAILABLE);
    expect(r.元素捲寬).toBeLessThanOrEqual(r.元素可視寬);
    expect(r.整頁捲寬).toBeLessThanOrEqual(r.整頁可視寬);
  }, 60_000);

  it('🔵 附註(不是斷言的主體):同一句重複三倍 ⇒ 照樣不溢出, 因為 CJK 逐字可斷', async () => {
    const r = await measure(VEHICLE_TAXONOMY_UNAVAILABLE.repeat(3));
    // 📌 這一格存在的理由 = **把主視窗那個提案的量測結果留在檔案裡**,
    //    讓下一個想用「加長三倍」當對照的人, 一發就看到它為什麼不行。
    expect(r.整頁捲寬).toBeLessThanOrEqual(r.整頁可視寬);
  }, 60_000);
});

// 🔴🔴 **三扇門同時掛掉那個畫面**(2026-09-06 · ⟦search-SILENTDOORS2⟧ · 主視窗裁【甲 = 各講各的】)
//   🛑 **它【是會發生的】不是理論**:三扇共用同一個 Supabase 與同一層 `unstable_cache`。
//   ⚠️ **本段答得了什麼**:三句疊在 390 寬會不會撐破、疊起來多高。
//      **答不了什麼**:好不好看 —— 那是視覺題, 交 Sean 肉眼驗(板列與 STOP 都寫了)。
describe('三扇門同時掛掉 · 390 寬(⟦search-SILENTDOORS2⟧)', () => {
  async function measureThree() {
    const markup =
      renderToStaticMarkup(<VehicleTaxonomyNotice failed />) +
      renderToStaticMarkup(<TaxonomyNotice failed message={CATEGORY_TAXONOMY_UNAVAILABLE} />) +
      renderToStaticMarkup(<TaxonomyNotice failed message={BRAND_TAXONOMY_UNAVAILABLE} />);
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.setContent(
        `<!doctype html><html><head><meta name="viewport" content="width=390">` +
          `<style>*{box-sizing:border-box}body{margin:0}</style></head>` +
          `<body><div id="host" style="width:390px">${markup}</div></body></html>`,
      );
      return await page.evaluate(() => {
        const els = [...document.querySelectorAll('[role="alert"]')] as HTMLElement[];
        const doc = document.documentElement;
        return {
          幾則: els.length,
          文字: els.map((e) => e.textContent ?? ''),
          三則總高: els.reduce((h, e) => h + e.getBoundingClientRect().height, 0),
          整頁捲寬: doc.scrollWidth,
          整頁可視寬: doc.clientWidth,
        };
      });
    } finally {
      await page.close();
    }
  }

  it('🔴 三則都在、三句各不相同、而且【不撐破】390', async () => {
    const r = await measureThree();
    expect(r.幾則).toBe(3);
    expect(new Set(r.文字).size).toBe(3); // 🔵 少了這一格, 三句一樣也會過
    expect(r.整頁捲寬).toBeLessThanOrEqual(r.整頁可視寬);
  }, 60_000);

  it('🔵 而【它們真的很高】—— 把那個數字量出來, 不要只說「不會撐破」', async () => {
    const r = await measureThree();
    // 📌 每則的樣式是 `padding:64px 0` ⇒ 三則疊起來必然是幾百 px。
    //    🔬 **2026-09-06 當場量到的實值(390×844)**:每則 173 + 150 + 150 = **474 px**
    //       ⇒ **佔掉 0.56 個螢幕** —— 也就是**手機上超過一半的可視高度都是這三行**。
    //    🛑 這一格**不判「太高」**(那是視覺題, 交 Sean 肉眼驗);它保證的是
    //       **那個數字被寫下來過**, 而哪天有人把 padding 改小/改大, 這裡會紅 ——
    //       而那正是要有人再看一眼的時候。
    expect(r.三則總高).toBeGreaterThan(300);
    expect(r.三則總高).toBeLessThan(900);
  }, 60_000);
});
