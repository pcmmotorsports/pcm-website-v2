// @vitest-environment jsdom
//
// BrandDirectoryRoot.test.tsx — `/brands` 總覽頁的結構與泛白狀態(D3c-3;2026-08-05)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BrandDirectoryRoot } from './BrandDirectoryRoot';
import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_TRIM_LOGO_SCALE } from '@/data/brand-trim-logo-scale';
import { brandAsset, brandTrimLogo } from '@/lib/brand-asset';

afterEach(cleanup);

const SLUGS = BRAND_CONTENT.map((b) => b.slug);
const ALL: ReadonlySet<string> = new Set(SLUGS);
const EMPTY = ['dbk', 'gilles', 'kineo', 'rizoma', 'wrs'] as const;
const AVAILABLE: ReadonlySet<string> = new Set(SLUGS.filter((s) => !EMPTY.includes(s as never)));

describe('BrandDirectoryRoot · 結構', () => {
  it('🔴 `<main>` 帶 `.bd-page`(色票 scope;漏掉的話整頁色票沉默降級)', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={ALL} />);
    const main = container.querySelector('main');
    expect(main, '根節點不是 <main> ⇒ 與設計稿 :120 的 landmark 對不上').not.toBeNull();
    expect(main!.classList.contains('bd-page')).toBe(true);
  });

  it('🔴 三個區塊都在、順序是 hero → 格子 → 收尾(設計稿 :126 / :135 / :136)', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={ALL} />);
    const sections = [...container.querySelectorAll('main > section')].map((s) => s.className);
    expect(sections).toEqual(['bd-hero', 'bd-directory', 'bd-outro']);
  });

  it('🔴 hero 的 logo 牆 = 20 家、`aria-hidden`、吃的是深色底 logo(不是格子那組)', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={ALL} />);
    const wall = container.querySelector('.bd-hero-wall')!;
    expect(wall.getAttribute('aria-hidden'), '牆沒有 aria-hidden ⇒ 報讀器會把 20 家唸兩次').toBe('true');
    const tiles = [...wall.querySelectorAll('i')];
    expect(tiles).toHaveLength(SLUGS.length);
    // 🔴 逐家比對「牆用 bandLogo(深色底)」——寫成設計稿那個 `brands-dark/<slug>.png` 樣板的話,
    //    本 repo 有 3 家會空掉(gilles/motogadget 是 .svg、samco 整個在別的資料夾)。
    for (const [i, brand] of BRAND_CONTENT.entries()) {
      // 🔴 比**完整路徑**(含 `brandAsset()` 那層 `/brand-assets/` 前綴):只比 `bandLogo`
      //    的話,拿掉那層包裝 ⇒ 20 張圖全 404 而測試照樣綠(關卡2 R1 nit)。
      expect(tiles[i]!.getAttribute('style'), brand.slug).toContain(brandAsset(brand.bandLogo));
    }
    // 前提:那 3 家真的不是 `brands-dark/<slug>.png`,否則上面那條恆真
    const odd = BRAND_CONTENT.filter((b) => b.bandLogo !== `assets/brands-dark/${b.slug}.png`);
    expect(odd.map((b) => b.slug).sort()).toEqual(['gilles', 'motogadget', 'samco']);
  });

  it('🔴 家數與版面欄數綁在一起:20 能被牆的 10 / 5 / 4 整除(設計稿 :66-67 逐字的理由)', () => {
    // 整除不成立時最後一排會缺一角,設計稿說那看起來像「沒做完」而不是「排不下」。
    for (const cols of [10, 5, 4]) {
      expect(SLUGS.length % cols, `${SLUGS.length} 家不能被 ${cols} 欄整除 ⇒ 牆會缺角`).toBe(0);
    }
  });

  it('🔴 家數字面由資料求值,不是寫死的 20(兩處:hero 註腳與格子標頭)', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={ALL} />);
    expect(container.querySelector('.bd-hero-note')!.textContent).toBe(
      `${SLUGS.length} 家合作品牌 · 持續依實際上架狀態更新`,
    );
    expect(container.querySelector('.bd-directory-head span')!.textContent).toBe(`${SLUGS.length} BRANDS`);
  });

  it('🔴 每張卡:編號 / 國別 / logo(帶自己的 --logo-scale)/ 兩個入口', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={ALL} />);
    const cards = [...container.querySelectorAll('.bd-grid > li')];
    expect(cards).toHaveLength(SLUGS.length);
    for (const [i, brand] of BRAND_CONTENT.entries()) {
      const card = cards[i]!;
      const [num, country] = [...card.querySelectorAll('.bd-brand-top > span')].map((s) => s.textContent);
      expect(num, `${brand.slug} 的編號`).toBe(String(i + 1).padStart(2, '0'));
      expect(country, `${brand.slug} 的國別`).toBe(brand.country);
      const logo = card.querySelector('.bd-brand-logo')!.getAttribute('style')!;
      expect(logo, `${brand.slug} 的 logo 路徑`).toContain(brandTrimLogo(brand.slug));
      // 🔴 `toContain` 會被更長的數字滿足(`1` ⊂ `1.18`、`1.1` ⊂ `1.18`;實際 4 家會中)
      //    ⇒ 用「後面不能再接數字或小數點」的邊界(關卡2 R1 nit)。
      expect(logo, `${brand.slug} 的 --logo-scale`).toMatch(
        new RegExp(`--logo-scale: ${String(BRAND_TRIM_LOGO_SCALE[brand.slug]).replace('.', '\\.')}(?![.\\d])`),
      );
      expect(card.querySelector('.bd-brand-about')!.getAttribute('href')).toBe(`/brands/${brand.slug}`);
      expect(card.querySelector('.bd-brand-products')!.getAttribute('href')).toBe(
        `/products?pbrand=${brand.slug}`,
      );
    }
  });

  // 🔴 這條守的是「總覽卡的校正值沒有退化成沿用品牌頁磚牆那份」——兩份是**不同的**光學校正
  //    (實測 20 家有 19 家的值不一樣);沿用的話畫面看起來「有 scale」但 19 家都是錯的大小,
  //    而上一條那種「有沒有輸出 --logo-scale」的斷言完全看不出來。
  it('🔴 卡片的校正值與品牌頁磚牆的 `logoScale` 是兩份(不是沿用)', () => {
    const differing = BRAND_CONTENT.filter((b) => BRAND_TRIM_LOGO_SCALE[b.slug] !== b.logoScale);
    expect(differing.length, '兩份值完全一樣 ⇒ 要嘛有人把總覽改成沿用了、要嘛設計稿改了').toBe(19);
  });

  it('🔴 校正表的鍵集合必須與 `BRAND_CONTENT` 完全一致(新增第 21 家漏加會靜默吃預設 1)', () => {
    expect(Object.keys(BRAND_TRIM_LOGO_SCALE).sort()).toEqual([...SLUGS].sort());
  });
});

describe('BrandDirectoryRoot · 零商品品牌泛白不可點', () => {
  it('🔴 前提:那 5 個 slug 真的在 20 家裡(名單打錯的話整個 describe 會恆真)', () => {
    for (const slug of EMPTY) expect(SLUGS, `${slug} 不在 BRAND_CONTENT 裡`).toContain(slug);
    expect(AVAILABLE.size).toBe(SLUGS.length - EMPTY.length);
  });

  it('🔴 泛白的卡:兩個入口都不是連結,而且卡本身帶 `is-empty`', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={AVAILABLE} />);
    const empties = [...container.querySelectorAll('.bd-brand.is-empty')];
    expect(empties).toHaveLength(EMPTY.length);
    for (const card of empties) {
      for (const cls of ['.bd-brand-about', '.bd-brand-products']) {
        const el = card.querySelector(cls)!;
        expect(el.tagName, `${cls} 仍是 <a> ⇒ 鍵盤與報讀器還是走得到`).toBe('SPAN');
        expect(el.getAttribute('href')).toBeNull();
      }
    }
    // 🔴 **對上號:泛白的正好是那 5 家**(關卡2 R1 must-fix 5)。
    //    第一版寫成「拿 `.bd-brand-top` 的 textContent 比長度」= **恆真** ——
    //    長度上一行已經斷過,而那一格只有編號與國別、**根本不含 slug 或品牌名**
    //    ⇒ `isEmpty` 判到錯的品牌時,全套 25 條沒有任何一條會紅。
    //    改用 logo 的資產路徑認人(那是每張卡唯一帶 slug 的東西)。
    const fadedSlugs = empties
      .map((c) => c.querySelector('.bd-brand-logo')!.getAttribute('style')!)
      .map((style) => SLUGS.find((s) => style.includes(brandTrimLogo(s))))
      .sort();
    expect(fadedSlugs, '泛白的不是那 5 家').toEqual([...EMPTY].sort());
  });

  it('🔴 泛白的卡不放**看得見**的字,只留一句給報讀器的(可見文案是 Sean 的拍板面)', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={AVAILABLE} />);
    for (const card of container.querySelectorAll('.bd-brand.is-empty')) {
      const products = card.querySelector('.bd-brand-products')!;
      // 這一格的可見內容必須只有那句 sr-only(它視覺上不存在)
      expect(products.children).toHaveLength(1);
      expect(products.children[0]!.className).toBe('bd-sr-only');
      // 🔴 釘**逐字**、不用 either-or 的寬鬆比對:字面要與前兩片(磚牆、首頁那排)一致,
      //    寬鬆比對等於允許第四種寫法悄悄長出來(關卡2 R2 nit 1 就是這麼發生的)。
      expect(products.textContent!.endsWith('(暫無商品)'), products.textContent!).toBe(true);
      // 反面:不准有箭頭(箭頭是「可以去」的 affordance)
      expect(products.querySelector('[aria-hidden="true"]')).toBeNull();
    }
  });

  it('🔴 有商品的 15 家照舊兩個入口都是連結、且沒有那句話', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={AVAILABLE} />);
    const live = [...container.querySelectorAll('.bd-brand:not(.is-empty)')];
    expect(live).toHaveLength(SLUGS.length - EMPTY.length);
    for (const card of live) {
      expect(card.querySelector('a.bd-brand-about')).not.toBeNull();
      expect(card.querySelector('a.bd-brand-products')).not.toBeNull();
      expect(card.querySelector('.bd-sr-only')).toBeNull();
    }
  });

  it('🔴 空集合(撈取失敗的 fail-closed 路徑)⇒ 20 張全部不可點、零 `<a>` 進商品', () => {
    const { container } = render(<BrandDirectoryRoot availableSlugs={new Set()} />);
    expect(container.querySelectorAll('.bd-brand.is-empty')).toHaveLength(SLUGS.length);
    expect(container.querySelectorAll('a.bd-brand-products')).toHaveLength(0);
    expect(container.querySelectorAll('a.bd-brand-about')).toHaveLength(0);
  });
});

// 🔴 與 `BrandPageRoot.test.tsx` 同型的守門:CSS import 收斂在 Root 一支 ⇒ 它被刪掉時
//    整頁裸奔而所有元件測試照樣綠。兩個方向都釘:「本檔必須有」與「其餘 src 必須沒有」。
//    ⚠️ 擋不住什麼:認的是「路徑以 `brand-directory.css` 結尾」的 side-effect import;
//       `packages/ui` 與動態 import 不在掃描面內。
describe('BrandDirectoryRoot · `brand-directory.css` 的 import 只有一個入口', () => {
  const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  // 🔴 形狀沿用 `BrandPageRoot.test.tsx`(那支被兩輪審查修過,坑已經踩完):
  //    · **整行錨定**,不是「檔案裡出現過這個字串」—— 否則本檔自己的正規式字面、
  //      註解裡引用的範例都會被算成 importer(我第一版就是這樣、當場自我誤判)。
  //    · 只認**檔名結尾**、不釘 `@/styles/` 別名:相對路徑才是本 repo 的主流寫法
  //      (`app/layout.tsx` 連續十行都是 `import '../styles/*.css'`),釘別名會整條失效。
  const IMPORT_LINE = /^\s*import\s+['"][^'"]*brand-directory\.css['"];?\s*$/;
  const CSS_AT_IMPORT = /@import\s+(?:url\()?\s*['"][^'"]*brand-directory\.css/;

  // 走訪也對齊那支(`readdirSync(dir, { withFileTypes: true })`)—— 關卡2 R2 nit 4:
  // 我原本宣稱「沿用 `BrandPageRoot.test.tsx`」但實作是 `statSync` 逐檔問一次,
  // 行為等價、字面不符。宣稱與事實對齊比較重要,順便省掉每檔一次 syscall。
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(tsx?|css)$/.test(full) ? [full] : [];
    });

  const references = (file: string): boolean => {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.css')) return CSS_AT_IMPORT.test(source);
    return source.split('\n').some((line) => IMPORT_LINE.test(line));
  };

  it('🔴 `brand-directory.css` 的 import 恰好只出現在 `BrandDirectoryRoot.tsx`', () => {
    const importers = sourceFiles(SRC_ROOT)
      .filter(references)
      .map((file) => file.slice(SRC_ROOT.length + 1))
      .sort();
    expect(importers, 'src/** 下 import brand-directory.css 的檔案清單').toEqual([
      'components/brand/BrandDirectoryRoot.tsx',
    ]);
  });

  // 前提斷言:上面那條的判別力建立在「掃描器真的掃到整棵樹」。掃描函式壞掉時上面會紅在
  // 「拿到空陣列」而不是「有人動了 import」—— 失敗訊息會指向錯的方向。
  it('🔴 掃描器真的掃到整棵 src', () => {
    const files = sourceFiles(SRC_ROOT);
    expect(files.length, 'src/** 掃到的 .ts/.tsx/.css 檔數').toBeGreaterThan(370);
    expect(files.some((f) => f.endsWith('styles/brand-directory.css')), 'CSS 面沒掃到').toBe(true);
  });
});
