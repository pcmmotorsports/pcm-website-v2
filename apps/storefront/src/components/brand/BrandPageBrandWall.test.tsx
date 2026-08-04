// @vitest-environment jsdom
//
// BrandPageBrandWall smoke test — D2e-1(2026-08-04)
//
// 這一區最容易靜默壞掉的四件事:
//   ① 把當前品牌從清單濾掉 —— 看起來「合理」,但設計稿 :2024-2026 是**留著並標記**。
//      濾掉之後 20 家變 19 家,最後一列的 justify-content:center 整排偏移,而且客人
//      在磚牆上找不到自己在哪一家。這是「畫面看起來很正常」的那種壞法。
//   ② `--logo-scale` 無條件輸出(13 家會多一個沒作用的 inline style)或漏掉那 7 家
//      —— 漏掉的話 logo 大小不一致,而那正是 Sean 說的「歪歪的、比例不一」。
//   ③ logo 路徑拿到 `brands-dark/`(橫幅那組)或 `brands/`(原始檔)——
//      三組同名 20 檔,拿錯不會紅、只會在真機上看到深色 logo 壓在白磚上。
//   ④ aria-current 掛在非當前品牌 / 一個都沒掛。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandPageBrandWall } from './BrandPageBrandWall';
// D3c-3 起 `brandTrimLogo` 住在 `lib/brand-asset.ts`(第二個消費端 = `/brands` 總覽卡片)。
import { brandTrimLogo } from '@/lib/brand-asset';
import { BRAND_CONTENT } from '@/data/brand-content';

afterEach(cleanup);

const SLUGS = BRAND_CONTENT.map((b) => b.slug);
// C-16-STOP 量出來的極端值:長寬比 1.32(k-speed)到 8.0(materya)差 6 倍,
// 加上 scale 的兩端(materya 1.08 / kineo 0.88)。抽樣驗收挑這幾家。
const EXTREMES = ['materya', 'motogadget', 'extreme', 'k-speed', 'kineo'];

/**
 * D3c-1:磚牆多了 `availableSlugs`(目錄裡真的有商品的品牌)。既有這些 case 全部餵
 * **20 家都有商品**,好讓它們維持原本的前提(每一磚都是連結)——
 * 「有幾磚不可點」那條路徑另有專門的 describe 在檔尾。
 */
const ALL_SLUGS: ReadonlySet<string> = new Set(BRAND_CONTENT.map((b) => b.slug));

describe('BrandPageBrandWall · 前提(資料形狀)', () => {
  it('🔴 20 家、slug 不重複、logoScale 恰 7 家非 1(範圍 0.88-1.08)', () => {
    expect(SLUGS).toHaveLength(20);
    expect(new Set(SLUGS).size, 'slug 重複會讓 React key 撞號').toBe(20);
    const scaled = BRAND_CONTENT.filter((b) => b.logoScale !== 1);
    expect(scaled.map((b) => b.slug).sort())
      .toEqual(['eazi-grip', 'evotech', 'extreme', 'gilles', 'kineo', 'materya', 'wrs']);
    expect(Math.min(...scaled.map((b) => b.logoScale))).toBe(0.88);
    expect(Math.max(...scaled.map((b) => b.logoScale))).toBe(1.08);
    // 驗收抽樣的那幾家真的在名單裡(打錯字的話下面的抽樣斷言會空跑)
    for (const slug of EXTREMES) expect(SLUGS, `${slug} 不在資料裡`).toContain(slug);
  });
});

describe('BrandPageBrandWall · 版型', () => {
  it('🔴 整條巢狀鏈正向斷言(無 class 的 wrapper 拿掉會讓 h2 與磚牆各自變 grid item)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={ALL_SLUGS} />);
    expect(container.querySelector('.bp-others > .bp-others-inner')).not.toBeNull();
    expect(container.querySelectorAll('.bp-others-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-others-inner > .bp-sec-label')?.textContent).toBe('Brands');
    expect(container.querySelector('.bp-others-inner > div > h2')?.textContent).toBe('品牌介紹');
    expect(container.querySelector('.bp-others-inner > div > .bp-others-list')).not.toBeNull();
  });

  it('🔴 每一家當作當前品牌時,磚都還是 20 塊(不把自己濾掉)', () => {
    for (const slug of SLUGS) {
      const { container } = render(<BrandPageBrandWall currentSlug={slug} availableSlugs={ALL_SLUGS} />);
      expect(container.querySelectorAll('.bp-others-list > a'), slug).toHaveLength(20);
      cleanup();
    }
  });

  it('🔴 恰一塊掛 is-cur + aria-current="page",且就是當前那家', () => {
    for (const slug of SLUGS) {
      const { container } = render(<BrandPageBrandWall currentSlug={slug} availableSlugs={ALL_SLUGS} />);
      const cur = [...container.querySelectorAll('.is-cur')];
      expect(cur, slug).toHaveLength(1);
      expect(cur[0]!.getAttribute('aria-current'), slug).toBe('page');
      expect(cur[0]!.getAttribute('href'), slug).toBe(`/brands/${slug}`);
      // 反面:其他 19 塊都不得掛 aria-current
      expect(container.querySelectorAll('[aria-current]'), slug).toHaveLength(1);
      cleanup();
    }
  });

  it('slug 不在名單裡時,20 塊全部不標記(不是丟錯或標到第一家)', () => {
    // D3 的路由會先 notFound,所以這條路在正式站走不到 —— 但元件自己不該假設呼叫端擋過。
    const { container } = render(<BrandPageBrandWall currentSlug="不存在的品牌" availableSlugs={ALL_SLUGS} />);
    expect(container.querySelectorAll('.bp-others-list > a')).toHaveLength(20);
    expect(container.querySelectorAll('.is-cur')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('磚裡只有 logo 與品牌名兩格(Sean 2026-08-02 否掉短描述)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={ALL_SLUGS} />);
    for (const a of container.querySelectorAll('.bp-others-list > a')) {
      expect(a.children).toHaveLength(2);
      expect(a.children[0]!.className).toBe('bp-others-logo');
      expect(a.children[1]!.className).toBe('bp-others-name');
    }
  });
});

describe('BrandPageBrandWall · logo', () => {
  it('🔴 路徑是 brands-trim/(不是 brands-dark/ 也不是 brands/),alt = 品牌名,lazy', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={ALL_SLUGS} />);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs).toHaveLength(20);
    imgs.forEach((img, i) => {
      const b = BRAND_CONTENT[i]!;
      expect(img.getAttribute('src')).toBe(`/brand-assets/assets/brands-trim/${b.slug}.png`);
      expect(img.getAttribute('alt')).toBe(b.name);
      expect(img.getAttribute('loading'), '這 20 張在頁尾,與橫幅那張 eager 相反').toBe('lazy');
      // 反面:不得指到另外兩組同名資產
      expect(img.getAttribute('src')).not.toContain('brands-dark/');
      expect(img.getAttribute('src')).not.toMatch(/\/assets\/brands\//);
    });
  });

  it('🔴 --logo-scale 只在非 1 那 7 家輸出(無條件輸出 = 13 家多一個沒作用的 inline style)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={ALL_SLUGS} />);
    const frames = [...container.querySelectorAll<HTMLElement>('.bp-others-logo')];
    frames.forEach((el, i) => {
      const b = BRAND_CONTENT[i]!;
      const declared = el.style.getPropertyValue('--logo-scale');
      if (b.logoScale === 1) expect(declared, `${b.slug} 不該輸出 --logo-scale`).toBe('');
      else expect(declared, b.slug).toBe(String(b.logoScale));
    });
    // 前提斷言:真的有輸出到(全部都空的話上面那圈只證了 else 分支從沒跑過)
    expect(frames.filter((el) => el.style.getPropertyValue('--logo-scale')).length).toBe(7);
  });

  it('驗收抽樣的極端值逐家點名(materya 1.08 / kineo 0.88 / k-speed 與 motogadget 無 scale)', () => {
    // C-16-STOP 的抽樣清單。真機驗收看的是這幾磚,測試先把 DOM 這一半釘死。
    const { container } = render(<BrandPageBrandWall currentSlug="materya" availableSlugs={ALL_SLUGS} />);
    const byIndex = new Map(BRAND_CONTENT.map((b, i) => [b.slug, i]));
    const frames = [...container.querySelectorAll<HTMLElement>('.bp-others-logo')];
    for (const slug of EXTREMES) {
      const b = BRAND_CONTENT[byIndex.get(slug)!]!;
      const el = frames[byIndex.get(slug)!]!;
      expect(el.style.getPropertyValue('--logo-scale'), slug)
        .toBe(b.logoScale === 1 ? '' : String(b.logoScale));
      expect(el.querySelector('img')?.getAttribute('src'), slug).toBe(brandTrimLogo(slug));
    }
  });
});

// 整頁大綱的不變式清單與推導見 `BrandPageHeader.test.tsx` 檔尾那段(關卡2 R2 補齊 7 支)。
// 🔴 D3a 起另有 `BrandPageRoot.test.tsx` 直接 render 整頁驗大綱,不再只靠這七支局部不變式。
describe('BrandPageBrandWall · 標題階層(#311)', () => {
  it('🔴 第一個標題是 h2、其餘只到 h3', () => {
    const { container } = render(<BrandPageBrandWall currentSlug={SLUGS[0]!} availableSlugs={ALL_SLUGS} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => Number(h.tagName[1]));
    expect(levels.length, '前提:真的有標題可驗').toBeGreaterThan(0);
    expect(levels[0], '本區第一個標題必須是 h2').toBe(2);
    expect(levels.filter((l) => l !== 2 && l !== 3), '只准出現 h2 與 h3').toEqual([]);
  });
});

// ── 目錄零商品的品牌:泛白且不可點(D3c-1;Sean 2026-08-04 拍板,信箱 C-31-A)────────
// 🔴 這一族守的是「**語意上**也不可點」,不只是看起來灰。只做視覺不做語意 = 鍵盤與報讀器
//    仍然到得了那 5 個空入口,是最糟的組合。
//    ⚠️ 用詞:「空入口」不是「死連結」(關卡2 R2 nit 1)—— `/brands/<slug>` 那 5 頁**會正常
//    渲染**,壞的是進去零商品、CTA 再動一下篩選就滑成全站目錄。
describe('BrandPageBrandWall · 零商品品牌泛白不可點', () => {
  const EMPTY = new Set(['dbk', 'gilles', 'kineo', 'rizoma', 'wrs']);
  const AVAILABLE: ReadonlySet<string> = new Set(SLUGS.filter((s) => !EMPTY.has(s)));

  it('🔴 前提:那 5 個 slug 真的在 20 家裡(名單打錯的話整個 describe 會恆真)', () => {
    for (const slug of EMPTY) expect(SLUGS, `${slug} 不在 BRAND_CONTENT 裡`).toContain(slug);
    expect(AVAILABLE.size).toBe(SLUGS.length - EMPTY.size);
  });

  it('🔴 不可點的磚帶一句只給報讀器的說明(否則那 5 家只是靜默消失)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={AVAILABLE} />);
    const notes = [...container.querySelectorAll('.bp-others-list > .is-empty .bp-sr-only')];
    expect(notes).toHaveLength(EMPTY.size);
    for (const n of notes) expect(n.textContent).toBe('(暫無商品)');
    // 反面:可點的磚不該有這句
    expect(container.querySelectorAll('.bp-others-list > a .bp-sr-only')).toHaveLength(0);
  });

  it('🔴 沒商品的那幾磚不是連結(不是「`<a>` 少了 href」,是根本不渲染成 `<a>`)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={AVAILABLE} />);
    const tiles = [...container.querySelectorAll('.bp-others-list > *')];
    expect(tiles).toHaveLength(SLUGS.length);
    const empties = tiles.filter((t) => t.classList.contains('is-empty'));
    expect(empties).toHaveLength(EMPTY.size);
    for (const el of empties) {
      expect(el.tagName, '零商品的磚仍是 <a> ⇒ 鍵盤與報讀器還是走得到一個沒東西可看的入口').toBe('SPAN');
      expect(el.getAttribute('href'), '不該有 href').toBeNull();
      // title 也不給:滑鼠停留跳出連結提示會與「不可點」互相打架
      expect(el.getAttribute('title')).toBeNull();
    }
  });

  it('🔴 有商品的那 15 磚照舊是連結、指向自己的品牌頁', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={AVAILABLE} />);
    const links = [...container.querySelectorAll('.bp-others-list > a')];
    expect(links).toHaveLength(SLUGS.length - EMPTY.size);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^\/brands\/[a-z0-9-]+$/);
      expect(a.classList.contains('is-empty')).toBe(false);
    }
  });

  it('🔴 客人正在看的就是那 5 家之一時,`is-cur` 與 `is-empty` 兩個狀態並存', () => {
    // 不能因為它沒商品就在磚牆上失去「你在這裡」—— 那正是磚牆存在的理由。
    const { container } = render(<BrandPageBrandWall currentSlug="rizoma" availableSlugs={AVAILABLE} />);
    const cur = container.querySelector('[aria-current="page"]')!;
    expect(cur.tagName).toBe('SPAN');
    expect(cur.classList.contains('is-cur')).toBe(true);
    expect(cur.classList.contains('is-empty')).toBe(true);
  });

  it('🔴 空集合(撈取失敗的 fail-closed 路徑)⇒ 20 磚全部不可點、零 `<a>`', () => {
    // 反過來設計(失敗時全部放行)會在 DB 一抖時把 5 個空入口全放出去,
    // 那正是本次要修掉的東西 —— 這條把方向釘住。
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={new Set()} />);
    expect(container.querySelectorAll('.bp-others-list > a')).toHaveLength(0);
    expect(container.querySelectorAll('.bp-others-list > span.is-empty')).toHaveLength(SLUGS.length);
  });

  it('每一磚不論可不可點,logo 與品牌名都還在(泛白不是隱藏)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" availableSlugs={AVAILABLE} />);
    const tiles = [...container.querySelectorAll('.bp-others-list > *')];
    // 前提:沒有這一行,磚全沒渲染時下面的迴圈跑 0 圈、照樣綠(關卡2 R1 nit 9)。
    expect(tiles).toHaveLength(SLUGS.length);
    for (const tile of tiles) {
      expect(tile.querySelector('.bp-others-logo img')).not.toBeNull();
      expect(tile.querySelector('.bp-others-name')?.textContent).toBeTruthy();
    }
  });
});
