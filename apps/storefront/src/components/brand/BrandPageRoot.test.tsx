// @vitest-environment jsdom
//
// BrandPageRoot test — D3a(2026-08-04)
//
// 這支關掉三個一直沒有機制守住的缺口:
//
// ① 🔴 **`.bp-page` scope**(backlog #314 的「`.bp-page` scope 上機制、不靠人記」那條前置,
//    `docs/phase-1-backlog.md:8403`):整頁色票掛在 `.bp-page` 上,漏掛時只有兩處有 fallback、
//    其餘沉默降級,而三綠 / CSS 守門 / 八支元件測試**全部不會紅**。
//    D3a 把 class 與 `brand-page.css` 的 import 綁進本元件 ⇒ 這裡驗「根節點真的帶那個 class」。
//
// ② 🔴 **收斂後的新單點**(關卡2 R1 must-fix 1):八支元件的 CSS import 收成一行之後,
//    **刪掉那一行 → 整頁裸奔而全套測試照樣綠**(審查者實測:11 檔 180 測全過)。
//    ⇒ 下面有一條**讀原始碼**的守門,兩個方向都釘:本檔必須有、其餘 `src/**` 必須沒有。
//
// ③ 🔴 **整頁標題大綱**(#311;`BrandPageHeader.test.tsx` 檔尾記載的缺口):
//    在 D3a 之前沒有正式路由,唯一的組裝點是 dev-preview 那支 server component ——
//    「在測試裡照同樣順序自己排一次」= 守門與真實頁面會各自漂移,所以當時拆成七支局部不變式。
//    **那個前提現在消失了**:`BrandPageRoot` 就是正式 route 與 dev-preview 共用的組裝點,
//    render 它 = render 真實頁面。
//    ⚠️ **但它的能力有邊界**(關卡2 R1 nit 7 更正,我原本寫成「新增第 8 支不必補不變式」):
//    現行大綱是 `h1 → {h2,h3}*`,新區塊若以 `<h2>` 起頭,大綱**仍合法、本測試仍綠**。
//    真正被攔下的是「以 `<h3>` 起頭」那一類(在 About / Media 裡插 `<h3>`,h1 直接接 h3 = R2 的洞)。
//    七支局部不變式因此保留:定位更精準,兩層是刻意冗餘、不是重複。

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageRoot } from './BrandPageRoot';
import { BRAND_CONTENT } from '@/data/brand-content';

afterEach(cleanup);

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 遞迴列出 `src/**` 下的 .ts / .tsx / .css(排除產物目錄)。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * side-effect import 的兩種寫法。
 * 🔴 **路徑不釘 `@/styles/`**(關卡2 R2 must-fix 1):第一版只認別名寫法,審查者實測在
 *    `BrandPageWhy.tsx` 加 `import '../../styles/brand-page.css';` → 守門 10/10 全綠。
 *    而**相對路徑才是本 repo 的主流寫法**(`app/layout.tsx:37-46` 連續十行都是
 *    `import '../styles/*.css'`),也沒有 `no-restricted-imports` 擋 ⇒ 最可能的破壞方式
 *    (照既有慣例把它加進 `layout.tsx` 變全域)當時完全守不到。改成只認檔名結尾。
 */
const IMPORT_LINE = /^\s*import\s+['"][^'"]*brand-page\.css['"];?\s*$/;
/** CSS 側的 `@import`(同一個機制的第二條路;`brand-page.css` 自己不會 import 自己)。 */
const CSS_AT_IMPORT = /@import\s+(?:url\()?\s*['"][^'"]*brand-page\.css/;

const referencesBrandPageCss = (file: string): boolean => {
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) return CSS_AT_IMPORT.test(source);
  return source.split('\n').some((line) => IMPORT_LINE.test(line));
};

/** 依文件順序取標題層級序列,如 [1,2,3,2,3]。 */
function outlineOf(root: ParentNode): number[] {
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
}

/** 回傳第一個「跳級」的位置描述;無跳級回 null。首項必須是 1。 */
function firstOutlineBreak(levels: number[]): string | null {
  if (levels.length === 0) return '零標題';
  if (levels[0] !== 1) return `首個標題是 h${levels[0]}、不是 h1`;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i]! > levels[i - 1]! + 1) return `第 ${i} 個標題 h${levels[i - 1]} → h${levels[i]} 跳級`;
  }
  return null;
}

describe('BrandPageRoot · 前提(這支測試有沒有判別力)', () => {
  // 🔴 沒有這一段,下面「20 家全綠」可能只是因為資料剛好走不到某條分流
  //    (memory `feedback_fixture-value-makes-guard-vacuous`)。
  it('🔴 20 家真資料,且 About 右欄的兩條分流都真的被走到', () => {
    expect(BRAND_CONTENT).toHaveLength(20);
    // About 右欄:有影片走 BrandPageMedia、無影片有 aside 走產品照卡。
    // 關卡2 R2 的洞就是「只驗了 aside 那 8 家、另 12 家走 Media 的零守門」⇒ 兩邊都要非空。
    const withVideo = BRAND_CONTENT.filter((b) => b.video);
    const withAside = BRAND_CONTENT.filter((b) => !b.video && b.aside);
    expect(withVideo.length, 'Media 分流零樣本 ⇒ 大綱守門對它全盲').toBeGreaterThan(0);
    expect(withAside.length, '產品照卡分流零樣本 ⇒ 大綱守門對它全盲').toBeGreaterThan(0);
    expect(withVideo.length + withAside.length).toBe(20);
    // 年表是選填(實查 2 家)⇒ 有無兩種組裝順序都要被 render 到。
    const withTimeline = BRAND_CONTENT.filter((b) => b.timeline);
    expect(withTimeline.length).toBeGreaterThan(0);
    expect(withTimeline.length).toBeLessThan(20);
  });

  // 🔴 守門本身抓不抓得到問題,要用**已知壞掉的輸入**證明,不是靠「跑了 20 家都綠」。
  //    (memory `feedback_negative-test-harness-self-false-green`)
  it('🔴 `firstOutlineBreak` 對已知的壞大綱會回報,對好的回 null', () => {
    expect(firstOutlineBreak([1, 2, 3, 2, 3])).toBeNull();
    expect(firstOutlineBreak([1, 2, 2, 2])).toBeNull();
    expect(firstOutlineBreak([1, 3])).toMatch(/跳級/); // 這就是「在 Media 裡加個 h3」的形狀
    expect(firstOutlineBreak([2, 3])).toMatch(/不是 h1/);
    expect(firstOutlineBreak([1, 2, 4])).toMatch(/跳級/);
    expect(firstOutlineBreak([])).toBe('零標題');
  });
});

describe('BrandPageRoot · CSS import 的單一落點(關卡2 R1 must-fix 1)', () => {
  // 🔴 這條**讀原始碼**、不 render —— 因為 vitest 對 CSS import 是 no-op,
  //    「有沒有 import」在任何渲染測試裡都觀察不到。兩個方向都要釘:
  //      · 本檔沒有了 ⇒ 正式站整頁裸奔(而畫面「有東西」、零錯誤)
  //      · 別的檔又加回去 ⇒ 「拿得到樣式就一定有 scope」這個機制當場破功
  it('🔴 `brand-page.css` 的 import 恰好只出現在 `BrandPageRoot.tsx`', () => {
    const importers = sourceFiles(SRC_ROOT)
      .filter(referencesBrandPageCss)
      .map((file) => relative(SRC_ROOT, file).split('\\').join('/'))
      .sort();
    expect(importers, 'src/** 下 import brand-page.css 的檔案清單').toEqual([
      'components/brand/BrandPageRoot.tsx',
    ]);
  });

  // 🔴 前提斷言:上面那條的判別力建立在「掃描器真的掃到整棵樹」上。掃描函式壞掉(路徑組錯、
  //    提早 return)時,上面那條會紅在「拿到空陣列」而不是「有人動了 import」—— 失敗訊息會
  //    指向錯的方向,而且如果哪天有人把它「修」成允許空陣列,整條守門就無聲失效。
  //    門檻取實測檔數(2026-08-04 = 411)的九成,不是隨手寫個小數字。
  it('🔴 掃描器真的掃到整棵 src(否則上一條的失敗訊息會指向錯的方向)', () => {
    const files = sourceFiles(SRC_ROOT);
    expect(files.length, 'src/** 掃到的 .ts/.tsx/.css 檔數(2026-08-04 實測 411)').toBeGreaterThan(370);
    expect(files.some((f) => f.endsWith('components/brand/BrandPageRoot.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('styles/brand-page.css')), 'CSS 面沒掃到').toBe(true);
  });
});

describe('BrandPageRoot · `.bp-page` scope(#314 的 `.bp-page` scope 前置)', () => {
  it('🔴 根節點帶 `.bp-page`,而且是 `<main>` —— 20 家逐一驗', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} />);
      const root = container.firstElementChild;
      expect(root, `${brand.slug}:BrandPageRoot 沒有渲染出任何元素`).not.toBeNull();
      expect(
        root!.classList.contains('bp-page'),
        `${brand.slug}:根節點少了 .bp-page ⇒ 整頁色票沉默降級、畫面「有東西」但顏色全錯`,
      ).toBe(true);
      // 設計稿 `brand-page.html:1354` 的 `<main>` 恰好包住麵包屑(:1356)到磚牆(:1504)
      // = 本元件的範圍(鐵則 1);站台其他頁也都有 main landmark。
      expect(root!.tagName, `${brand.slug}:少了 main landmark`).toBe('MAIN');
      cleanup();
    }
  });

  // ⚠️ 這條只講**本元件自己的輸出**。`dev-preview/brand-page/[slug]` 另外包了一個
  //    `<div className="bp-page">` 給底部的預覽切換列 —— 那是刻意的(切換列用的 `--f-mono` /
  //    `--c-ember-ink` 是 scoped 色票,放在外面就吃不到)。
  //    🔴 為什麼並排兩個沒有視覺差:`styles/brand-page.css:80-81` 的 `.bp-page` **除了自訂屬性
  //    還有 `background: var(--c-surface)` 與 `color: var(--c-text)`**(關卡2 R2 must-fix 7 更正
  //    ——我原本寫成「只宣告自訂屬性」,那是假的)。兩塊拿到的是同一組值 ⇒ 相鄰兩塊背景與文字色
  //    相同、看不出接縫;它們是**兄弟不是巢狀**,所以也沒有值被覆寫的問題。正式 route 只有一個。
  it('🔴 本元件自己不巢狀第二個 `.bp-page`(巢狀會讓 scope 內的 fallback 判斷不可推理)', () => {
    const { container } = render(<BrandPageRoot brand={BRAND_CONTENT[0]!} />);
    expect(container.querySelectorAll('.bp-page')).toHaveLength(1);
  });
});

describe('BrandPageRoot · 整頁標題大綱(#311)', () => {
  // 🔴 站台殼(Header / HomeFooter / MobileTabBar)必須零標題,否則「本元件的大綱 = 整頁大綱」
  //    這個前提就不成立了。原本這只是一行註解裡的宣稱 —— 註解不會紅(關卡2 R1 nit 8)。
  it('🔴 站台殼三支元件的原始碼裡零 h1-h6', () => {
    const shells = ['components/Header.tsx', 'components/HomeFooter.tsx', 'components/MobileTabBar.tsx'];
    for (const rel of shells) {
      const source = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(source.length, `${rel} 讀不到內容 ⇒ 路徑可能改了`).toBeGreaterThan(0);
      expect(source, `${rel} 長出標題元素 ⇒ 整頁大綱不再等於 BrandPageRoot 的大綱`).not.toMatch(
        /<h[1-6][\s/>]/,
      );
    }
  });

  it('🔴 20 家全部:首個標題是 h1、其後不跳級', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} />);
      const levels = outlineOf(container);
      expect(firstOutlineBreak(levels), `${brand.slug} 的大綱 [${levels.join(',')}]`).toBeNull();
      cleanup();
    }
  });

  it('🔴 恰一個 h1、內容 = 品牌名(多一個 h1 = 兩份大綱,螢幕閱讀器會當成兩篇文章)', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} />);
      const h1s = [...container.querySelectorAll('h1')];
      expect(h1s.map((h) => h.textContent), brand.slug).toEqual([brand.name]);
      cleanup();
    }
  });

  it('🔴 標題只用到 h1-h3(h4 以下沒有對應的設計稿層級 ⇒ 出現就是有人自己加的)', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} />);
      const used = [...new Set(outlineOf(container))].sort((a, b) => a - b);
      // 🔴 用「集合相等」而不是 arrayContaining(關卡2 R1 nit 6:後者對 h4 完全不設限、
      //    整條斷言的重量全壓在下一行,等於白寫)。h3 是選填(有些品牌沒有第三層)。
      expect(used.every((level) => level >= 1 && level <= 3), `${brand.slug} 用到 ${used.join(',')}`).toBe(true);
      expect(used.slice(0, 2), brand.slug).toEqual([1, 2]);
      cleanup();
    }
  });
});
