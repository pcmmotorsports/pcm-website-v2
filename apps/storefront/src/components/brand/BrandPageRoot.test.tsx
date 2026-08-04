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
import type { MockProduct } from '@/data/mock-products';
import { BRAND_PRODUCT_SLOTS } from '@/lib/brand-url';

afterEach(cleanup);

/**
 * 商品區 fixture(D3b)。**恰好 `BRAND_PRODUCT_SLOTS` 筆** —— 常數改了這裡要跟著改,
 * 所以下面有一條前提斷言把兩者釘在一起,而不是各寫一個 5。
 * 🔴 大綱測試吃這份 fixture:商品區帶一個 `<h2>熱門商品</h2>`,而「新區塊以 h2 起頭時
 *    大綱仍合法」正是本檔抬頭申報的能力邊界 —— 這裡等於把那句話跑一次給人看。
 */
const PRODUCTS: MockProduct[] = Array.from({ length: BRAND_PRODUCT_SLOTS }, (_, i) => ({
  id: i + 1,
  slug: `fixture-product-${i + 1}`,
  brand: 'AKRAPOVIČ',
  name: `測試商品 ${i + 1}`,
  fits: 'Yamaha MT-09',
  price: 12000 + i,
  origPrice: null,
  isNew: false,
  isSale: false,
  inStock: true,
  category: '排氣系統',
  color: 'silver',
  imgTone: 'neutral',
}));

/** D3c-1:磚牆需要「哪些品牌有商品」;這些 case 一律餵全 20 家(不可點那條路徑另有專測)。 */
const ALL_SLUGS: ReadonlySet<string> = new Set(BRAND_CONTENT.map((b) => b.slug));

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
    // D3b:fixture 筆數與 `BRAND_PRODUCT_SLOTS` 綁死 —— 常數改成 4 而 fixture 還是 5 的話,
    // 下面「渲染出 N 張卡」那條會量到一個與正式站不同的數字卻照樣綠。
    expect(PRODUCTS).toHaveLength(BRAND_PRODUCT_SLOTS);
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
      const { container } = render(<BrandPageRoot brand={brand} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
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
    const { container } = render(<BrandPageRoot brand={BRAND_CONTENT[0]!} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
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
      const { container } = render(<BrandPageRoot brand={brand} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
      const levels = outlineOf(container);
      expect(firstOutlineBreak(levels), `${brand.slug} 的大綱 [${levels.join(',')}]`).toBeNull();
      cleanup();
    }
  });

  it('🔴 恰一個 h1、內容 = 品牌名(多一個 h1 = 兩份大綱,螢幕閱讀器會當成兩篇文章)', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
      const h1s = [...container.querySelectorAll('h1')];
      expect(h1s.map((h) => h.textContent), brand.slug).toEqual([brand.name]);
      cleanup();
    }
  });

  it('🔴 標題只用到 h1-h3(h4 以下沒有對應的設計稿層級 ⇒ 出現就是有人自己加的)', () => {
    for (const brand of BRAND_CONTENT) {
      const { container } = render(<BrandPageRoot brand={brand} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
      const used = [...new Set(outlineOf(container))].sort((a, b) => a - b);
      // 🔴 用「集合相等」而不是 arrayContaining(關卡2 R1 nit 6:後者對 h4 完全不設限、
      //    整條斷言的重量全壓在下一行,等於白寫)。h3 是選填(有些品牌沒有第三層)。
      expect(used.every((level) => level >= 1 && level <= 3), `${brand.slug} 用到 ${used.join(',')}`).toBe(true);
      expect(used.slice(0, 2), brand.slug).toEqual([1, 2]);
      cleanup();
    }
  });
});

describe('BrandPageRoot · 商品區(D3b)', () => {
  const AKRAPOVIC = BRAND_CONTENT.find((b) => b.slug === 'akrapovic')!;

  it('🔴 0 筆 → 整區不渲染(不留空骨架、也不自己編一句「目前沒有商品」)', () => {
    const { container } = render(<BrandPageRoot brand={AKRAPOVIC} products={[]} availableSlugs={ALL_SLUGS} />);
    expect(container.querySelector('.bp-products'), '0 筆時商品區仍在 ⇒ 客人看到一排空格').toBeNull();
    expect(container.querySelector('.bp-grid')).toBeNull();
    // 🔴 這條路徑**真的會走到**:2026-08-04 實測 20 家裡有 5 家在目錄中是 0 筆
    //    (dbk / gilles / kineo / rizoma / wrs)⇒ 不是理論分支。
  });

  it(`🔴 有商品 → 渲染 ${BRAND_PRODUCT_SLOTS} 張既有 ProductCard(不是設計稿的骨架槽)`, () => {
    const { container } = render(<BrandPageRoot brand={AKRAPOVIC} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
    expect(container.querySelectorAll('.bp-grid > *')).toHaveLength(BRAND_PRODUCT_SLOTS);
    // 卡片必須是既有元件的 `.pcard`(設計稿 :1468-1469 逐字:「直接用既有的商品列表元件」)
    expect(container.querySelectorAll('.pcard')).toHaveLength(BRAND_PRODUCT_SLOTS);
    // 反向:骨架槽的 class 一個都不該出現 —— 出現就代表有人把設計稿的假卡片也搬進來了
    expect(container.querySelectorAll('.bp-slot, .bp-bar, .bp-slot-img, .bp-slot-info')).toHaveLength(0);
    // 🔴 **祖孫關係**要釘住(關卡2 R1 must-fix 2):窄螢幕的隱藏規則其中一條是
    //    `.bp-grid > :nth-child(n+4) .pcard`,它成立的前提是「卡片被包在一層裡」。
    //    哪天 ProductCard 不再包 `<Link>`(`href` 是 optional),那條就落空、而 CSS 文字守門
    //    與上面兩條計數斷言**全都不會紅**。這一行把那個前提變成會紅的東西。
    expect(
      container.querySelectorAll('.bp-grid > * > .pcard'),
      'ProductCard 不再包一層 ⇒ CSS 的後代選擇器落空、窄螢幕會變回 5 張',
    ).toHaveLength(BRAND_PRODUCT_SLOTS);
  });

  it('標題是 h2「熱門商品」(設計稿 :1476);區塊落在分類與磚牆之間(設計稿 :1470-1489)', () => {
    const { container } = render(<BrandPageRoot brand={AKRAPOVIC} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
    const head = container.querySelector('.bp-prod-head h2')!;
    expect(head.textContent).toBe('熱門商品');
    // 位置:用 compareDocumentPosition 驗真實順序,不是靠我在測試裡自己排一次
    const sections = [...container.querySelectorAll('.bp-cats, .bp-products, .bp-others')].map(
      (el) => [...el.classList].find((c) => c.startsWith('bp-')),
    );
    expect(sections).toEqual(['bp-cats', 'bp-products', 'bp-others']);
  });

  it('🔴「查看全部」指向該品牌的目錄網址(設計稿 :2028 的 `catalogue(brand.slug)`)', () => {
    const { container } = render(<BrandPageRoot brand={AKRAPOVIC} products={PRODUCTS} availableSlugs={ALL_SLUGS} />);
    const link = container.querySelector('.bp-prod-head a')!;
    expect(link.getAttribute('href')).toBe('/products?pbrand=akrapovic');
    expect(link.textContent).toContain('查看全部');
    // 箭頭是純裝飾 ⇒ 必須對輔助技術隱藏(設計稿 :1478 的 `aria-hidden="true"`)
    expect(container.querySelector('.bp-prod-head .ed-link-arrow')!.getAttribute('aria-hidden')).toBe('true');
  });
});
