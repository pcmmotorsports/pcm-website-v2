// @vitest-environment jsdom
//
// BrandIndex smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。
//
// D3c-2 加一族:目錄零商品的品牌泛白且不可點(Sean 拍板 `C-31-A`、主視窗 `C-33-A` 裁示
// 首頁比照品牌頁磚牆)。這一族守的是**語意上**也不可點,不只是看起來灰 ——
// 只做視覺不做語意 = 鍵盤與報讀器仍到得了那 5 個空入口,是最糟的組合。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BrandIndex } from './BrandIndex';
// 🔴 真的 import 頁尾來比對(見下面那條的理由:兩邊各寫硬字面 = 只改一邊也全綠)。
import { HomeFooter } from './HomeFooter';
import { MOCK_BRANDS } from '../data/mock-brands';

afterEach(cleanup);

/** 全部都有商品(舊行為),讓既有兩條 smoke 的前提維持不變。 */
const ALL: ReadonlySet<string> = new Set(MOCK_BRANDS.map((b) => b.id));

describe('BrandIndex', () => {
  it('should render the authorized brands wall without crashing', () => {
    render(<BrandIndex availableSlugs={ALL} />);
    expect(screen.getByText('Authorized brands · 授權代理')).toBeDefined();
    expect(screen.getByText(MOCK_BRANDS[0]!.name)).toBeDefined();
  });

  it('品牌列導 /products?brand=<slug>(= parseBrandFilterFromUrl 的比對鍵)', () => {
    render(<BrandIndex availableSlugs={ALL} />);
    const first = MOCK_BRANDS[0]!;
    const link = screen.getByText(first.name).closest('a');
    // 每一列 = 「看這個品牌的**商品**」⇒ 維持 `?brand=`,不是品牌介紹頁。
    expect(link?.getAttribute('href')).toBe(`/products?brand=${first.id}`);
  });

  // 🔴 關卡2 R1 must-fix 1/2(D3c-5):這條原本**主動鎖住舊值**(`/products`)、註解還寫
  //    「不再指向不存在的 /brands」—— 而那個前提在 D3c-3 就消失了。
  //    結果:首頁上「品牌專區」出現兩次(本元件表頭 + `HomeFooter`)、指到**兩個不同的地方**,
  //    而全套 4695 綠對這個矛盾完全無感,因為這條測試正是在保護錯的那一半。
  //    ⚠️ 測試名說「與頁尾同一個目的地」就要**真的去比頁尾**,不能兩邊各寫一次硬字面
  //    (關卡2 R2 nit:各寫硬字面時,有人只改一邊仍然兩條都綠 —— 那正是本次缺陷的形狀)。
  it('🔴 表頭「品牌專區」與頁尾同名連結**同一個**目的地(= 已落地的 /brands)', () => {
    const { unmount } = render(<BrandIndex availableSlugs={ALL} />);
    const indexHref = screen.getByText('品牌專區').closest('a')?.getAttribute('href');
    unmount();
    render(<HomeFooter />);
    const footerHref = screen.getByText('品牌專區').closest('a')?.getAttribute('href');
    expect(indexHref, '表頭與頁尾的「品牌專區」指到不同地方').toBe(footerHref);
    expect(indexHref).toBe('/brands');
  });
});

// ── 目錄零商品的品牌:泛白且不可點(D3c-2)────────────────────────────────────
describe('BrandIndex · 零商品品牌泛白不可點', () => {
  // 🔴 2026-08-04 實查(不沿用上一棒的說法):目錄零商品的 5 家**全部都在**這 17 家裡。
  //    方法 = production build + 真 DB 讀 `/products` 側欄品牌清單(16 家)比對本名單。
  const EMPTY = ['dbk', 'gilles', 'kineo', 'rizoma', 'wrs'] as const;
  const IDS = MOCK_BRANDS.map((b) => b.id);
  const AVAILABLE: ReadonlySet<string> = new Set(IDS.filter((id) => !EMPTY.includes(id as never)));

  it('🔴 前提:那 5 個 id 真的在 17 家裡(名單打錯的話整個 describe 會恆真)', () => {
    for (const id of EMPTY) expect(IDS, `${id} 不在 MOCK_BRANDS 裡`).toContain(id);
    expect(AVAILABLE.size).toBe(IDS.length - EMPTY.length);
  });

  it('🔴 沒商品的那幾列不是連結(不是「`<a>` 少了 href」,是根本不渲染成 `<a>`)', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const rows = [...container.querySelectorAll('.ed-brand-list > li > *')];
    expect(rows).toHaveLength(IDS.length);
    const empties = rows.filter((r) => r.classList.contains('is-empty'));
    expect(empties).toHaveLength(EMPTY.length);
    for (const el of empties) {
      expect(el.tagName, '零商品的列仍是 <a> ⇒ 鍵盤與報讀器還是走得到一個沒東西可看的入口').toBe('SPAN');
      expect(el.getAttribute('href'), '不該有 href').toBeNull();
    }
    // 對上號:泛白的正好是那 5 家、不是隨便 5 列
    const names = empties.map((el) => el.querySelector('.ed-brand-name')?.textContent);
    expect(names.sort()).toEqual(
      EMPTY.map((id) => MOCK_BRANDS.find((b) => b.id === id)!.name).sort(),
    );
  });

  it('🔴 有商品的那 12 列照舊是連結、`?brand=` 深連結一字未改', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const links = [...container.querySelectorAll('.ed-brand-list > li > a')];
    expect(links).toHaveLength(IDS.length - EMPTY.length);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^\/products\?brand=[a-z0-9-]+$/);
      expect(a.classList.contains('is-empty')).toBe(false);
    }
  });

  it('🔴 不可點的列帶一句只給報讀器的說明、且**不畫箭頭**(箭頭是「可以去」的 affordance)', () => {
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    const empties = [...container.querySelectorAll('.ed-brand-list > li > .is-empty')];
    for (const el of empties) {
      expect(el.querySelector('.ed-brand-arrow'), '泛白列不該有箭頭').toBeNull();
      expect(el.querySelector('.ed-sr-only')?.textContent).toBe('(暫無商品)');
    }
    // 反面:可點的列有箭頭、沒有那句話(否則報讀器會把 17 家都唸成暫無商品)
    const links = [...container.querySelectorAll('.ed-brand-list > li > a')];
    for (const a of links) {
      expect(a.querySelector('.ed-brand-arrow')).not.toBeNull();
      expect(a.querySelector('.ed-sr-only')).toBeNull();
    }
  });

  it('🔴 空集合(撈取失敗的 fail-closed 路徑)⇒ 17 列全部不可點、零 `<a>`', () => {
    // 反過來設計(失敗時全部放行)會在 DB 一抖時把空入口全放出去,那正是本次要修的東西。
    const { container } = render(<BrandIndex availableSlugs={new Set()} />);
    expect(container.querySelectorAll('.ed-brand-list > li > a')).toHaveLength(0);
    expect(container.querySelectorAll('.ed-brand-list > li > span.is-empty')).toHaveLength(IDS.length);
  });

  it('每一列不論可不可點,編號 / 名稱 / 標語 / 國別四格都還在(泛白不是隱藏)', () => {
    // 少畫的只有箭頭那一格 —— 前四格全在,版面才不會位移(欄寬由 CSS 寫死的五軌決定)。
    const { container } = render(<BrandIndex availableSlugs={AVAILABLE} />);
    for (const row of container.querySelectorAll('.ed-brand-list > li > *')) {
      expect(row.querySelector('.ed-brand-num')).not.toBeNull();
      expect(row.querySelector('.ed-brand-name')).not.toBeNull();
      expect(row.querySelector('.ed-brand-tag')).not.toBeNull();
      expect(row.querySelector('.ed-brand-country')).not.toBeNull();
    }
  });
});
