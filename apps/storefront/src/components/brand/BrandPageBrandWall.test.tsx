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
import { BrandPageBrandWall, brandTrimLogo } from './BrandPageBrandWall';
import { BRAND_CONTENT } from '@/data/brand-content';

afterEach(cleanup);

const SLUGS = BRAND_CONTENT.map((b) => b.slug);
// C-16-STOP 量出來的極端值:長寬比 1.32(k-speed)到 8.0(materya)差 6 倍,
// 加上 scale 的兩端(materya 1.08 / kineo 0.88)。抽樣驗收挑這幾家。
const EXTREMES = ['materya', 'motogadget', 'extreme', 'k-speed', 'kineo'];

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
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" />);
    expect(container.querySelector('.bp-others > .bp-others-inner')).not.toBeNull();
    expect(container.querySelectorAll('.bp-others-inner > *')).toHaveLength(2);
    expect(container.querySelector('.bp-others-inner > .bp-sec-label')?.textContent).toBe('Brands');
    expect(container.querySelector('.bp-others-inner > div > h2')?.textContent).toBe('品牌介紹');
    expect(container.querySelector('.bp-others-inner > div > .bp-others-list')).not.toBeNull();
  });

  it('🔴 每一家當作當前品牌時,磚都還是 20 塊(不把自己濾掉)', () => {
    for (const slug of SLUGS) {
      const { container } = render(<BrandPageBrandWall currentSlug={slug} />);
      expect(container.querySelectorAll('.bp-others-list > a'), slug).toHaveLength(20);
      cleanup();
    }
  });

  it('🔴 恰一塊掛 is-cur + aria-current="page",且就是當前那家', () => {
    for (const slug of SLUGS) {
      const { container } = render(<BrandPageBrandWall currentSlug={slug} />);
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
    const { container } = render(<BrandPageBrandWall currentSlug="不存在的品牌" />);
    expect(container.querySelectorAll('.bp-others-list > a')).toHaveLength(20);
    expect(container.querySelectorAll('.is-cur')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('磚裡只有 logo 與品牌名兩格(Sean 2026-08-02 否掉短描述)', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" />);
    for (const a of container.querySelectorAll('.bp-others-list > a')) {
      expect(a.children).toHaveLength(2);
      expect(a.children[0]!.className).toBe('bp-others-logo');
      expect(a.children[1]!.className).toBe('bp-others-name');
    }
  });
});

describe('BrandPageBrandWall · logo', () => {
  it('🔴 路徑是 brands-trim/(不是 brands-dark/ 也不是 brands/),alt = 品牌名,lazy', () => {
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" />);
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
    const { container } = render(<BrandPageBrandWall currentSlug="akrapovic" />);
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
    const { container } = render(<BrandPageBrandWall currentSlug="materya" />);
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
describe('BrandPageBrandWall · 標題階層(#311)', () => {
  it('🔴 第一個標題是 h2、其餘只到 h3', () => {
    const { container } = render(<BrandPageBrandWall currentSlug={SLUGS[0]!} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => Number(h.tagName[1]));
    expect(levels.length, '前提:真的有標題可驗').toBeGreaterThan(0);
    expect(levels[0], '本區第一個標題必須是 h2').toBe(2);
    expect(levels.filter((l) => l !== 2 && l !== 3), '只准出現 h2 與 h3').toEqual([]);
  });
});
