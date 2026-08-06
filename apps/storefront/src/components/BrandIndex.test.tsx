// @vitest-environment jsdom
//
// BrandIndex(首頁 N°06 品牌磚牆)—— D5f / 首頁對齊批 H2 重寫,2026-08-06。
//
// 這支守三族:
//   ① 資料源真的換成 `BRAND_CONTENT` 20 家、而且每一磚的三個資料位都吃得到值
//      (前一版是 `MOCK_BRANDS` 17 家 —— 換錯資料源會**看起來很正常**、只是少三家)
//   ② 目錄零商品的品牌泛白且**語意上**不可點(Sean 2026-08-04 拍板;不是只有灰)
//   ③ logo 資產與校正值由資料求出:漏一家不會是「缺一張圖」而是**靜默吃預設 1**
//      ⇒ 用鍵集合對帳,不靠肉眼
//
// ⚠️ **它擋不住什麼**:jsdom 不算 cascade、也不套 media query ⇒ 「磚長什麼樣」在這裡看不到
//    (那一半在 `styles/home.test.ts` 的文字層 + 真瀏覽器)。這支只證 DOM 與網址契約。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BrandIndex } from './BrandIndex';
// 🔴 真的 import 頁尾來比對(D3c-5 的教訓:兩邊各寫硬字面 = 只改一邊也全綠)。
import { HomeFooter } from './HomeFooter';
import { BRAND_CONTENT } from '../data/brand-content';
import { BRAND_TRIM_LOGO_SCALE } from '../data/brand-trim-logo-scale';

afterEach(cleanup);

const SLUGS = BRAND_CONTENT.map((b) => b.slug);
/** 全部都有商品:讓「泛白」那一族的負向斷言有對照組。 */
const ALL: ReadonlySet<string> = new Set(SLUGS);

describe('BrandIndex · 20 家 logo 磚牆(D5f)', () => {
  it('🔴 前提:資料源是 BRAND_CONTENT(20 家),不是退場的 MOCK_BRANDS(17 家)', () => {
    // 前提斷言:家數一旦不是 20,下面每一條「20 塊磚」的斷言都會變成在數別的東西。
    expect(BRAND_CONTENT.length, 'BRAND_CONTENT 不是 20 家 ⇒ 版面 5×4 與本檔全部斷言都要重算').toBe(20);
    const { container } = render(<BrandIndex availableSlugs={ALL} />);
    // 磚 = 20 塊 + 1 塊 CTA
    expect(container.querySelectorAll('.b-brand-wall > li')).toHaveLength(21);
    expect(container.querySelectorAll('.b-brand-wall > li.is-cta')).toHaveLength(1);
    // 對上號:磚的順序 = 資料的順序(編號是位置標記)
    const nums = [...container.querySelectorAll('.b-brand-num')].map((el) => el.textContent);
    expect(nums).toEqual(SLUGS.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  it('🔴 每一磚的三個資料位都吃到值:產地 / 品類描述 / logo 檔名都對得上那一家', () => {
    const { container } = render(<BrandIndex availableSlugs={ALL} />);
    const tiles = [...container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > *')];
    expect(tiles).toHaveLength(BRAND_CONTENT.length);
    tiles.forEach((tile, i) => {
      const brand = BRAND_CONTENT[i]!;
      expect(tile.querySelector('.b-brand-country')?.textContent, `${brand.slug} 產地不對`)
        .toBe(brand.country);
      // 🔴 `textContent` 對泛白磚會多一句 sr-only ⇒ 用 startsWith,不是 toBe
      //    (toBe 會讓這條在 availableSlugs 變動時假紅、訓練人忽略它)。
      expect(
        tile.querySelector('.b-brand-tag')?.textContent?.startsWith(brand.wallTagline),
        `${brand.slug} 的品類描述不是 wallTagline`,
      ).toBe(true);
      // 🔴 磚上唯一看得見的品牌身分就是這張圖 ⇒ 檔名錯 = 客人看到別家的 logo,而且
      //    每一張都畫得出來、不會有破圖訊號。
      expect(
        tile.querySelector('.b-brand-logo')?.getAttribute('style'),
        `${brand.slug} 的 logo 路徑不對`,
      ).toContain(`/brand-assets/assets/brands-trim/${brand.slug}.png`);
    });
  });

  it('🔴 `--logo-scale` 逐家寫進 inline style,且校正表的鍵集合 = 20 家(漏一家會靜默吃預設 1)', () => {
    // 這條守的是「新增第 21 家時忘了加校正值」那一族:漏掉不會破圖、只會小一號,
    // 肉眼與其他測試都看不出來 ⇒ 用鍵集合對帳。
    expect(Object.keys(BRAND_TRIM_LOGO_SCALE).sort()).toEqual([...SLUGS].sort());
    const { container } = render(<BrandIndex availableSlugs={ALL} />);
    const tiles = [...container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > *')];
    tiles.forEach((tile, i) => {
      const brand = BRAND_CONTENT[i]!;
      const style = tile.querySelector('.b-brand-logo')?.getAttribute('style') ?? '';
      // 尾綴 `(?![.\d])` 防 `1` 命中 `1.18`(同 BrandDirectoryRoot.test.tsx 那條)
      expect(style, `${brand.slug} 的 --logo-scale 不是 ${BRAND_TRIM_LOGO_SCALE[brand.slug]}`)
        .toMatch(new RegExp(`--logo-scale: ?${String(BRAND_TRIM_LOGO_SCALE[brand.slug]).replace('.', '\\.')}(?![.\\d])`));
    });
  });

  it('🔴 每一磚導**品牌介紹頁** `/brands/<slug>`(= OD 的 `#brand-about` 契約在本 repo 的 A 案)', () => {
    const { container } = render(<BrandIndex availableSlugs={ALL} />);
    const links = [...container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > a')];
    expect(links).toHaveLength(BRAND_CONTENT.length);
    links.forEach((a, i) => {
      const brand = BRAND_CONTENT[i]!;
      expect(a.getAttribute('href')).toBe(`/brands/${brand.slug}`);
      // 磚上沒有可見的品牌名 ⇒ 報讀器要靠 aria-label 才知道是哪一家(OD 組裝 :1149 字面)
      expect(a.getAttribute('aria-label')).toBe(`${brand.name}｜${brand.wallTagline}`);
    });
    // 反面:不得回到 legacy 的商品目錄深連結(前一版每一列是 `/products?brand=<id>`)
    expect(container.innerHTML, '還留著退場的 legacy `?brand=` 深連結').not.toContain('/products?brand=');
  });

  it('🔴 CTA 磚「看全部品牌」與頁尾「品牌專區」**同一個**目的地(= /brands)', () => {
    const { container, unmount } = render(<BrandIndex availableSlugs={ALL} />);
    const ctaHref = container.querySelector('.b-brand-wall > li.is-cta a')?.getAttribute('href');
    expect(screen.getByText('看全部品牌')).toBeDefined();
    unmount();
    render(<HomeFooter />);
    const footerHref = screen.getByText('品牌專區').closest('a')?.getAttribute('href');
    // 兩邊各寫硬字面時,有人只改一邊仍然兩條都綠 —— 那正是 D3c-5 抓到的缺陷形狀。
    expect(ctaHref, 'CTA 磚與頁尾同名入口指到不同地方').toBe(footerHref);
    expect(ctaHref).toBe('/brands');
  });

  it('🔴 表頭不報家數(Sean 2026-08-05 拍板;OD 字面是「品牌專區 20」)', () => {
    const { container } = render(<BrandIndex availableSlugs={ALL} />);
    expect(screen.getByText('Brands · 品牌專區')).toBeDefined();
    // 🔴 R1 F1 更正:上一版這裡抄 `app/page.test.tsx` 的家數 regex
    //    `[0-9０-９]+\s*[多餘]?\s*[大家個]` —— 實測它對**這條規則要擋的那個字面**
    //    「Brands · 品牌專區 20」回 **false**(它抓的是「20 家 / 20 多家」)。
    //    ⇒ 那個寫法對本條的威脅**恆真**。改成錨在表頭那顆 `<span>`:它是純標籤,
    //      任何數字進來都是家數(或版本號之類同樣不該出現在版面上的東西)。
    const label = [...container.querySelectorAll('.ed-section-label span')]
      .find((el) => !el.classList.contains('ed-mono'));
    expect(label?.textContent, '找不到表頭標籤 ⇒ 下面的負向斷言恆真').toBe('Brands · 品牌專區');
    expect(label?.textContent, '表頭出現數字 ⇒ 家數宣稱回來了').not.toMatch(/[0-9０-９]/);
    // 磚上那 20 句品類描述也不得夾帶家數(它們是資料層的字,改資料就會漏進版面)
    expect(
      [...container.querySelectorAll('.b-brand-tag')].map((el) => el.textContent).join(' '),
      '品類描述裡出現家數宣稱',
    ).not.toMatch(/[0-9０-９]+\s*[多餘]?\s*[大家個]/);
  });
});

// ── 目錄零商品的品牌:泛白且不可點(D3c-2 拍板,D5f 沿用到磚牆)──────────────
describe('BrandIndex · 零商品品牌泛白不可點', () => {
  // 2026-08-04 實查(production build + 真 DB 讀 `/products` 側欄品牌清單)的那 5 家。
  const EMPTY = ['dbk', 'gilles', 'kineo', 'rizoma', 'wrs'] as const;
  const AVAILABLE: ReadonlySet<string> = new Set(SLUGS.filter((s) => !EMPTY.includes(s as never)));

  it('🔴 前提:那 5 個 slug 真的在 20 家裡(名單打錯的話整個 describe 會恆真)', () => {
    for (const slug of EMPTY) expect(SLUGS, `${slug} 不在 BRAND_CONTENT 裡`).toContain(slug);
    expect(AVAILABLE.size).toBe(SLUGS.length - EMPTY.length);
  });

  it('🔴 沒商品的那幾磚不是連結(不是「`<a>` 少了 href」,是根本不渲染成 `<a>`)', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const tiles = [...container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > *')];
    expect(tiles).toHaveLength(SLUGS.length);
    const empties = tiles.filter((t) => t.classList.contains('is-empty'));
    expect(empties).toHaveLength(EMPTY.length);
    for (const el of empties) {
      expect(el.tagName, '零商品的磚仍是 <a> ⇒ 鍵盤與報讀器還是走得到一個沒東西可看的入口').toBe('SPAN');
      expect(el.getAttribute('href'), '不該有 href').toBeNull();
    }
    // 對上號:泛白的正好是那 5 家、不是隨便 5 塊
    const emptySlugs = tiles
      .map((t, i) => (t.classList.contains('is-empty') ? SLUGS[i] : null))
      .filter(Boolean);
    expect(emptySlugs.sort()).toEqual([...EMPTY].sort());
  });

  it('🔴 有商品的那 15 磚照舊是連結、`/brands/<slug>` 一字未改', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const links = [...container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > a')];
    expect(links).toHaveLength(SLUGS.length - EMPTY.length);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^\/brands\/[a-z0-9-]+$/);
      expect(a.classList.contains('is-empty')).toBe(false);
    }
  });

  it('🔴 泛白磚帶一句**含品牌名**的報讀器說明(磚上看不到品牌名,只說「暫無商品」沒有主詞)', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const empties = [...container.querySelectorAll('.b-brand-wall > li > .is-empty')];
    expect(empties).toHaveLength(EMPTY.length);
    for (const el of empties) {
      const note = el.querySelector('.ed-sr-only')?.textContent ?? '';
      expect(note, `只有「(暫無商品)」沒有主詞:${note}`).toMatch(/.+\(暫無商品\)$/);
      const slug = EMPTY.find((s) => note.startsWith(BRAND_CONTENT.find((b) => b.slug === s)!.name));
      expect(slug, `這句說明的品牌名對不上任何一家泛白品牌:${note}`).toBeDefined();
    }
    // 反面:可點的磚沒有那句話(否則報讀器會把 20 家都唸成暫無商品)
    for (const a of container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > a')) {
      expect(a.querySelector('.ed-sr-only')).toBeNull();
    }
  });

  it('🔴 空集合(撈取失敗的 fail-closed 路徑)⇒ 20 磚全部不可點,但 CTA 磚仍在', () => {
    // 反過來設計(失敗時全部放行)會在 DB 一抖時把空入口全放出去。
    const { container } = render(<BrandIndex availableSlugs={new Set()} />);
    expect(container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > a')).toHaveLength(0);
    expect(container.querySelectorAll('.b-brand-wall > li > span.is-empty')).toHaveLength(SLUGS.length);
    // 🔴 CTA 不吃泛白邏輯:`/brands` 總覽頁本身永遠有東西可看,連它也關掉 = 首頁完全沒有品牌入口。
    expect(container.querySelector('.b-brand-wall > li.is-cta a')?.getAttribute('href')).toBe('/brands');
  });

  it('泛白不是隱藏:每一磚不論可不可點,編號 / 產地 / logo / 品類描述四格都還在', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    for (const tile of container.querySelectorAll('.b-brand-wall > li:not(.is-cta) > *')) {
      expect(tile.querySelector('.b-brand-num')).not.toBeNull();
      expect(tile.querySelector('.b-brand-country')).not.toBeNull();
      expect(tile.querySelector('.b-brand-logo')).not.toBeNull();
      expect(tile.querySelector('.b-brand-tag')).not.toBeNull();
    }
  });
});
