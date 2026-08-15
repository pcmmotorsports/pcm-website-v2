// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminOrderFilter } from '@pcm/domain';
import { OrderFilterChips } from './order-filter-chips';
import { ORDER_DENSITY_DEFAULT } from '../../lib/orders/order-list-view';

// order-filter-chips.test.tsx — `#484` 片 B-1。
// 🔴 本檔守三件:①chip 的 href 帶對軸值且不洗掉其他篩選 ②選中態(含**兩個方向**)
//    ③`.fchip` 的樣式與 OD 逐字相同(postcss 走 AST,不做字串比對)。

afterEach(cleanup);

const DEN = { density: ORDER_DENSITY_DEFAULT } as const;
const chips = (c: HTMLElement) => [...c.querySelectorAll('a.fchip')] as HTMLAnchorElement[];
const byLabel = (c: HTMLElement, label: string) =>
  chips(c).find((a) => a.textContent === label) ?? null;

const renderChips = (filter: AdminOrderFilter) =>
  render(<OrderFilterChips filter={filter} display={DEN} />);

describe('#484 B-1 — 快速篩選 chip', () => {
  it('本片恰兩顆:全部 / 未到貨(另外兩顆各有去處,不是漏做)', () => {
    const { container } = renderChips({});
    expect(chips(container).map((a) => a.textContent)).toEqual(['全部', '未到貨']);
  });

  it('🔴 「未到貨」= none + ordered(Sean 拍甲案),兩個值都要進 URL', () => {
    const { container } = renderChips({});
    const href = byLabel(container, '未到貨')!.getAttribute('href')!;
    const params = new URLSearchParams(href.split('?')[1]);
    // 🔴 `getAll` 不是 `get` —— `get` 只回第一個,漏掉第二個值時這一格會綠。
    expect(params.getAll('goods_axis')).toEqual(['none', 'ordered']);
  });

  it('「全部」= 清掉那一軸(不是帶一個空值)', () => {
    const { container } = renderChips({ goodsAxes: ['none', 'ordered'] });
    const href = byLabel(container, '全部')!.getAttribute('href')!;
    expect(new URLSearchParams(href.split('?')[1] ?? '').getAll('goods_axis')).toEqual([]);
  });

  // 🔴 這一格守的是本族最貴的病:按 chip 把使用者其他篩選洗掉。
  //    `order-list-view.ts` 檔頭為它記過三次,而症狀是**安靜的**。
  it('🔴 其他篩選軸原樣帶著走(按 chip 不得洗掉付款狀態/來源/日期)', () => {
    const filter: AdminOrderFilter = {
      paymentStatus: 'paid',
      orderSources: ['web'],
      includeUnpaidCardOrders: true,
    };
    const { container } = renderChips(filter);
    const params = new URLSearchParams(byLabel(container, '未到貨')!.getAttribute('href')!.split('?')[1]);
    expect(params.get('payment_status')).toBe('paid');
    expect(params.getAll('order_source')).toEqual(['web']);
    expect(params.get('show_unpaid_card')).toBe('1');
  });

  // 選中態:**兩個方向都測**。只測「該亮的亮了」的話,「全部恆亮」也會過。
  it('🔴 沒篩 ⇒ 全部亮、未到貨暗', () => {
    const { container } = renderChips({});
    expect(byLabel(container, '全部')!.getAttribute('aria-current')).toBe('true');
    expect(byLabel(container, '未到貨')!.getAttribute('aria-current')).toBeNull();
  });

  it('🔴 篩 none+ordered ⇒ 未到貨亮、全部暗', () => {
    const { container } = renderChips({ goodsAxes: ['none', 'ordered'] });
    expect(byLabel(container, '未到貨')!.getAttribute('aria-current')).toBe('true');
    expect(byLabel(container, '全部')!.getAttribute('aria-current')).toBeNull();
  });

  // 🔴 從「出貨狀態」下拉選了別的值(單值)⇒ **兩顆都不該亮**。
  //    少了這一格,「未到貨」在任何有值的狀態下亮起來都不會被抓到。
  it('🔴 篩單一值(例如已出貨)⇒ 兩顆都不亮', () => {
    const { container } = renderChips({ goodsAxes: ['shipped'] });
    for (const a of chips(container)) expect(a.getAttribute('aria-current')).toBeNull();
  });

  // 🔴 URL 是使用者可以手改的:順序反過來是同一件事。
  it('🔴 值的順序反過來仍算選中(URL 可手改)', () => {
    const { container } = renderChips({ goodsAxes: ['ordered', 'none'] });
    expect(byLabel(container, '未到貨')!.getAttribute('aria-current')).toBe('true');
  });

  it('空陣列視為不限 ⇒ 全部亮', () => {
    const { container } = renderChips({ goodsAxes: [] });
    expect(byLabel(container, '全部')!.getAttribute('aria-current')).toBe('true');
  });

  // 🔴 **零 JS 是本片的硬條件**(chip 是 server component)。
  //    `'use client'` 一旦混進來,整排就會變成 client bundle 的一部分,而那是安靜的。
  it("🔴 元件檔不得有 'use client'", () => {
    const src = readFileSync(join(__dirname, 'order-filter-chips.tsx'), 'utf8');
    expect(src).not.toContain("'use client'");
  });
});

describe('#484 B-1 — `.fchip` 樣式逐字對 OD', () => {
  const CSS = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
  const ROOT = postcss.parse(CSS);
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim();
  const declsOf = (selector: string) => {
    const out = new Map<string, string>();
    ROOT.walkRules((rule) => {
      if (norm(rule.selector) !== selector) return;
      rule.walkDecls((d) => {
        out.set(d.prop, norm(d.value));
      });
    });
    return out;
  };

  // 🔴 **數量寫死是刻意的**:OD 那條規則跨兩行,只讀第一行會抄成 5 個而且看起來正常
  //    (`.kb` 已經在同一份 OD 裡踩過一次)。這一格會在「有人補漏抄的那幾個」時紅,
  //    那時要回頭確認補的是不是 `<a>` 真的需要的。
  it('常態 6 個宣告(OD 8 個扣掉 cursor/font-family —— 兩個都因 <a> vs <button> 而不搬)', () => {
    const d = declsOf('.fchip');
    expect([...d.keys()].sort()).toEqual(
      ['background', 'border', 'border-radius', 'color', 'font-size', 'padding'].sort(),
    );
    // 🔴 **2026-08-16:從 `999px` 改成 `var(--radius)`,而這一格是【紅了才被改】的** —— 那是它該做的事。
    //    依據:設計參照 §6.5.4 裁決「**形狀傳達的是【可不可以互動】,不是【重不重要】**」
    //    ⇒ chip 渲染成 `<Link>`(可以點)= 控制項 ⇒ 跟所有控制項一起直角化;
    //      **只能看的狀態膠囊維持 pill**(那些用 `rounded-full`,不吃 `--radius`)。
    //    ⚠️ **這一格改成釘「它必須跟著 `--radius` 走」,不釘具體值** ——
    //      釘死 `0` 會讓日後恢復圓角時這格紅得莫名其妙,而那時它本來就該跟著變。
    expect(d.get('border-radius')).toBe('var(--radius)');
    expect(d.get('padding')).toBe('3px 11px');
    expect(d.get('font-size')).toBe('12px');
    expect(d.get('border')).toBe('1px solid var(--border)');
  });

  it('選中 4 個宣告;值是 token 映射、不是逐字相同', () => {
    const d = declsOf(".fchip[aria-current='true']");
    expect([...d.keys()].sort()).toEqual(
      ['background', 'border-color', 'color', 'font-weight'].sort(),
    );
    // 🔴 **不是 OD 的 `#fff`**(R1 must-fix 1):`--foreground` 在 dark 是白的 ⇒ 白底白字。
    //    `--primary-foreground` 在 light 恰為 `oklch(1 0 0)` = 與 OD 等值、在 dark 自動翻黑。
    //    ⇒ 這一格順便擋「有人為了對齊 OD 字面把它改回 `#fff`」——那會讓 dark 模式的標籤消失。
    expect(d.get('color'), '硬寫 #fff ⇒ dark 模式白底白字,標籤整個看不見').toBe(
      'var(--primary-foreground)',
    );
    expect(d.get('background')).toBe('var(--foreground)');
    // 數值型的才是逐字相同。
    expect(d.get('font-weight')).toBe('600');
  });

  // 🔴 `aria-pressed` 在 `<a>` 上是無效 ARIA(MDN:Used in roles 只有 button)。
  //    這一格擋的是「有人照 OD 字面把選擇器改回去」——改回去之後樣式**不會**生效,
  //    因為我們的元件掛的是 `aria-current`;症狀是選中態整個不見,而 CSS 看起來很對。
  // ⚠️ **掃的是選擇器,不是整份檔案字串** —— 第一版寫 `expect(CSS).not.toContain('aria-pressed')`
  //    當場紅,因為**我自己的註解裡就有這個字**(解釋為什麼不用它)。
  //    「解釋為什麼不做 X」與「做了 X」在純字串掃描下長得一樣,這是本檔的第一個實例。
  it('🔴 不得留下綁 aria-pressed 的選擇器(掃選擇器,不掃註解)', () => {
    const bad: string[] = [];
    ROOT.walkRules((rule) => {
      if (rule.selector.includes('aria-pressed')) bad.push(norm(rule.selector));
    });
    expect(bad, 'CSS 裡有選擇器綁 aria-pressed ⇒ 對我們的 <a> 永遠不會命中').toEqual([]);
  });
});

// ── `#484` B-1:`order-filter-bar` 的映射(R1 must-fix 2 的另一半)─────────────
// 🔴 這一格補的是**突變測試量出來的空白**:把 `order-filter-bar.tsx` 改成
//    `filter.goodsAxes?.slice(0, 1)` 時,全套測試**照樣綠** —— 沒有任何一格走過那條映射。
//    症狀:chip 選了兩個值、下拉顯示第一個值,而下一步任何操作都會把第二個值送丟。
// ⚠️ **這是原始碼掃描,不是行為測試,判別力比較弱** —— 換個寫法達成同樣的折平(例如
//    `[filter.goodsAxes?.[0] ?? ""]`)它抓不到。之所以只能到這裡:`OrderFilterBar` import 了
//    server action 模組,在測試環境 render 會擲
//    「This module cannot be imported from a Client Component module」(實跑過)。
//    要真的行為測,得把映射抽成一支純函式 —— 那是獨立一片,不夾帶在 B-1。
describe('#484 B-1 — filter → 篩選列的映射不得折平(原始碼掃描)', () => {
  const SRC = readFileSync(join(__dirname, 'order-filter-bar.tsx'), 'utf8');

  it('🔴 goodsAxes 原樣傳陣列,不得折平', () => {
    expect(SRC).toContain('goods: filter.goodsAxes ?? []');
  });

  it('🔴 不得對 goodsAxes 取單值或切片', () => {
    expect(SRC).not.toMatch(/goodsAxes\?*\.\[0\]/);
    expect(SRC).not.toMatch(/goodsAxes\?*\.slice\(/);
  });
});
