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
  it('恰三顆,且**順序照 OD**:全部 / 待處理 / 未到貨(退貨中另有去處 `#500`,不是漏做)', () => {
    // 🔴 `#485` 片2:「待處理」**插回 OD 原位**,不是接在後面 —— 順序是 OD 字面的一部分。
    const { container } = renderChips({});
    expect(chips(container).map((a) => a.textContent)).toEqual(['全部', '待處理', '未到貨']);
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
  /**
   * 🔴 **`atRule` 參數是 `#485` 片3 加的,而它動到了守門本身 —— 理由要留著。**
   *
   * 原版寫 `ROOT.walkRules(...)` 掃**全檔**同名選擇器。那在當時是對的(`.fchip` 只有一條),
   * 但它把「**常態**」這件事寄託在「全檔只有一條」這個**沒寫下來的前提**上。
   * 片3 在 `@media (max-width: 767px)` 裡給 `.fchip` 補了 `position: relative`(觸控熱區的載體)
   * ⇒ 原版守門讀到 **7** 個宣告而紅,**而它紅的不是「有人亂動 OD 字面」,是它自己的前提過期了**。
   *
   * ⚠️ **兩條我刻意沒選的路,寫在這裡免得以後有人以為沒想過**:
   *   ①把 `position` 加進下面那份清單 ⇒ 把「熱區機制」混進「OD 逐字」,**守門的語意會糊掉**
   *   ②把 CSS 選擇器改成 `a.fchip` 讓它掃不到 ⇒ **那是繞過守門**,不是修
   * ⇒ 選的是「收窄成它名字本來就說的那個範圍(**常態=頂層**)」+ **下面補一格釘 media 那條**,
   *   **覆蓋只增不減**。
   */
  const declsOf = (selector: string, atRule: string | null = null) => {
    const out = new Map<string, string>();
    ROOT.walkRules((rule) => {
      if (norm(rule.selector) !== selector) return;
      const parent = rule.parent;
      const inAtRule = parent?.type === 'atrule' ? norm((parent as postcss.AtRule).params) : null;
      if (inAtRule !== atRule) return;
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
    expect(d.get('border-radius')).toBe('999px');
    expect(d.get('padding')).toBe('3px 11px');
    expect(d.get('font-size')).toBe('12px');
    expect(d.get('border')).toBe('1px solid var(--border)');
  });

  // 🔴🔴 **`#485` 片3 補的一格 —— 上面那格收窄之後,這格接住被讓出去的範圍。**
  //
  // 釘的是**窄版觸控熱區**。⚠️ **這格的判別力有明確上限,不要讀成「熱區有 44×44」**:
  //   它證明的是「**這幾行字還在 CSS 檔裡**」,而**不是**瀏覽器算出來的命中區真的是 44×44
  //   —— 跨選擇器特異性、`box-sizing`、邊框佔幾 px,postcss 一個都看不到
  //   (同一個坑 `#486` 記過:CSS 字面寫 36、用值是 30)。
  // ⇒ **真正的證據是真瀏覽器量測**:片3 在 390/393/430 三個寬度用 `elementFromPoint` 四向探邊,
  //   量到命中區 48×44 / 60×44 / 60×44,且三發突變各自只翻對應那格(拿掉熱區→回 26;
  //   熱區往上開太大→密度鈕被搶走那格翻紅)。**這格只是防止有人把那幾行整段刪掉。**
  it('🔴 窄版熱區:`position: relative` 與 `::after` 在同一個 media query 裡(少一半就不生效)', () => {
    const MEDIA = '(max-width: 767px)';
    expect([...declsOf('.fchip', MEDIA).entries()]).toEqual([['position', 'relative']]);

    const after = declsOf('.fchip::after', MEDIA);
    expect(after.get('position')).toBe('absolute');
    expect(after.get('content')).toBe("''");
    // 🔴 上下不對稱(6/14)是量出來的,不是手滑:往上只讓 6px,免得吃掉正上方 4px 處的密度鈕。
    expect([after.get('top'), after.get('bottom')]).toEqual(['-6px', '-14px']);
    expect([after.get('left'), after.get('right')]).toEqual(['0', '0']);
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

// ── `#485` 片2:待處理 chip + 「兩份清單合成一份」────────────────────────────
//
// 🔴 **本族守的是片1 交出來的那顆定時彈,而它的病根不是「忘了清」**:
//   【高亮的判準】與【實際生效的篩選集合】從一開始就不是同一個東西。
//   ⇒ 所以下面**不只**測「按全部會清掉待處理」(那只證明現在這一格對),
//   還有一格直接釘住「**chip 設的欄 ⊆ isActive 比對的欄**」——
//   **下一顆 chip 加進來時,漏登記會在那一格紅,不是等人按出來。**
describe('#485 片2 — 待處理 chip', () => {
  it('🔴 待處理 chip 的 href 帶 pending=1', () => {
    const { container } = renderChips({});
    expect(byLabel(container, '待處理')?.getAttribute('href')).toContain('pending=1');
  });

  it('🔴🔴 按「全部」會清掉待處理(片1 交出來的定時彈,本片的 must)', () => {
    // 少了 `...CLEARED_CHIP_FILTER`,`pendingOnly` 會被 `...filter` 原封帶過去
    // ⇒ 高亮跳回全部、清單還是待處理那批,而且**沒有錯誤、沒有空白**。
    const { container } = renderChips({ pendingOnly: true });
    expect(byLabel(container, '全部')?.getAttribute('href')).not.toContain('pending');
  });

  it('🔴 按「未到貨」也會清掉待處理(不是只有「全部」那顆要清)', () => {
    const { container } = renderChips({ pendingOnly: true });
    const href = byLabel(container, '未到貨')?.getAttribute('href') ?? '';
    expect(href).toContain('goods_axis=');
    expect(href).not.toContain('pending');
  });

  it('🔴 按「待處理」會清掉貨品軸(反方向,證明清除不是只做單邊)', () => {
    const { container } = renderChips({ goodsAxes: ['none', 'ordered'] });
    expect(byLabel(container, '待處理')?.getAttribute('href')).not.toContain('goods_axis');
  });

  it('選中態:pendingOnly ⇒ 只有「待處理」亮(兩個方向都驗)', () => {
    const { container } = renderChips({ pendingOnly: true });
    expect(byLabel(container, '待處理')?.getAttribute('aria-current')).toBe('true');
    expect(byLabel(container, '全部')?.getAttribute('aria-current')).toBeNull();
    expect(byLabel(container, '未到貨')?.getAttribute('aria-current')).toBeNull();
  });

  it('🔴 pendingOnly: false 與 undefined 等價 ⇒「全部」要亮', () => {
    // parse 端一律回布林 ⇒ 沒有這條正規化,「全部」在真實流量下**永遠不亮**。
    const { container } = renderChips({ pendingOnly: false });
    expect(byLabel(container, '全部')?.getAttribute('aria-current')).toBe('true');
  });

  it('🔴 其他篩選軸(來源)不得被 chip 洗掉 —— chip 只管自己那幾欄', () => {
    const { container } = renderChips({ orderSources: ['web'] });
    expect(byLabel(container, '待處理')?.getAttribute('href')).toContain('order_source=web');
  });
});

describe('#485 片2 — 單一來源(這格擋的是下一顆 chip)', () => {
  it('🔴🔴 每顆 chip 設的欄都在 isActive 的比對範圍裡', () => {
    // 🔴 **這格不是測現在這三顆,是測「加第四顆時會不會靜默失效」。**
    //   做法:對每顆 chip,先渲染成它自己的狀態,再確認它真的亮 ——
    //   若某顆設了一個 `isActive` 沒比對的欄,它會**永遠不亮**(或永遠亮),這格就紅。
    //   ⚠️ 型別層擋的是另一半(chip 設了沒登記的欄 ⇒ tsc 紅);兩半合起來才是完整的。
    const cases: Array<[string, AdminOrderFilter]> = [
      ['全部', {}],
      ['待處理', { pendingOnly: true }],
      ['未到貨', { goodsAxes: ['none', 'ordered'] }],
    ];
    for (const [label, filter] of cases) {
      const { container } = renderChips(filter);
      expect(byLabel(container, label)?.getAttribute('aria-current'), `「${label}」該亮`).toBe('true');
      // 同時確認**只有它亮** —— 少了這半,一個「全部都亮」的退化也會通過。
      const lit = chips(container).filter((a) => a.getAttribute('aria-current') === 'true');
      expect(lit.map((a) => a.textContent), `只有「${label}」該亮`).toEqual([label]);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `#485` 片4 — **chip 排放不放得下**(窄版容量守門)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴🔴 **為什麼要有這一族:片3 之前用的那支偵測器,在片3 之後對這件事零判別力。**
//
// ```
// 片3 前：chip 擠不下 ⇒ 三顆掉到不同的 top          ← 「換行偵測」抓得到
// 片3 後：chip 組獨佔一行（page.tsx 的 basis-full）
//         ⇒ 再長也不會掉行，改成【字在 chip 裡折】
//         ⇒ 同一支換行偵測全程回「同一行」，一次都不會紅
// ```
// **真瀏覽器實測(390、真版面幾何):把中間那顆加長到 17 字 ⇒**
//   `三顆同一行 = true`(**沒紅**)/ `單顆高 26→44`(紅)/ `餘裕 −10`(紅)
// ⇒ **失敗形狀換了,而偵測器是對著舊形狀寫的。**
// 🔴 **而它從來沒有「變壞」的那一刻 —— 是我們自己的修復讓它失去判別力,**
//    **且失去判別力不會讓任何東西紅。**(這比「恆真守門」難抓:恆真守門第一天就沒用。)
//
// ⚠️ **repo 先前對 chip 版面是零覆蓋** —— 上面說的那支偵測器只活在拋棄式探針裡,
//    不在本 repo。**所以這一族不是「換掉舊的」,是第一支。**
//
// 🔴 **本族守的是「算得出來的容量」,不是瀏覽器的用值。** 誠實邊界寫在 `MODEL` 那段。
describe('`#485` 片4 — 窄版 chip 容量(算式模型,校準自真瀏覽器)', () => {
  const ADMIN_SRC = join(__dirname, '../..');
  const CSS = readFileSync(join(ADMIN_SRC, 'app/globals.css'), 'utf8');
  const PAGE = readFileSync(join(ADMIN_SRC, 'app/orders/page.tsx'), 'utf8');
  const SHELL = readFileSync(join(ADMIN_SRC, 'components/layout/workspace-shell.tsx'), 'utf8');

  /**
   * 🔴🔴 **這一族成立的前提 = 「chip 組獨佔一整行」。**
   *
   * 前提由 `page.tsx` 的 `basis-full` 提供。**把前提綁在一個會被改到的字面上,不是綁在時間點上**
   * —— 下一個人拿掉 `basis-full` 時,`grep basis-full` 會撞到這裡,而不是等他自己想起來。
   * ⚠️ **前提沒了,本族要重寫**(不是調閾值):chip 組不再獨佔一行 ⇒ 它會先被右邊那組壓縮,
   *    容量預算不再是「整個內容寬」,失敗形狀也會變回「掉行」。
   */
  it('🔴 前提:`page.tsx` 仍讓 chip 組獨佔一行(`basis-full`);沒了就要重寫本族', () => {
    expect(PAGE).toContain('order-last basis-full md:order-none md:basis-auto');
  });

  /**
   * 版面預算與 chip 幾何 —— **每個常數都有出處,沒有一個是挑的**。
   *
   * · 內容容器內距 `p-6` ⇒ 左右各 24 ⇒ 扣 48(`workspace-shell.tsx` 的 `workspace-content`)
   * · 側欄在窄版**不佔寬**:`components/ui/sidebar.tsx` 那顆是 `hidden md:block`(<768 變覆蓋式抽屜)
   * · 390 = 現行最窄的實機寬(iPhone 12/13/14 直式)
   * · chip 外框 24 = `padding: 3px 11px` 的左右 11×2 + `border: 1px` 的 1×2(`border-box`)
   * · 每個全形字 12px = `font-size: 12px`(CJK 的字身寬 = 字級)
   * · chip 間距 8 = 元件根節點的 `gap-2`(下面有一格釘著)
   *
   * 🔴🔴 **誠實邊界 —— 這是【算式】,不是瀏覽器的用值:**
   *   ① **只對全形字準確**。半形(英數、`/`)實測窄得多(`/` ≈ 4px)⇒ 模型會**高估**寬度
   *      ⇒ **偏保守、會早一步紅**,不會漏報。
   *   ② 字體真的換掉、或 `.fchip` 的 padding/font-size 被改 ⇒ 模型會失準;
   *      **但後者有上面「常態 6 個宣告」那格擋著**(本檔直接從 CSS 讀,不抄第二份)。
   *   ③ **它證明不了瀏覽器算出來的用值** —— 那要真瀏覽器
   *      (同 `#486` 記過的坑:CSS 字面 36、用值 30)。
   * ✅ **校準來源(2026-08-15 真瀏覽器,幾何照真版面)**:模型算 184 / 340 / 352,
   *    瀏覽器量 184 / 340 / 352 —— **三點全中**,且模型預測的破點(17 字)與實測破點一致。
   */
  const num = (prop: string, re: RegExp) => {
    const decls = new Map<string, string>();
    postcss.parse(CSS).walkRules((rule) => {
      if (rule.selector.replace(/\s+/g, ' ').trim() !== '.fchip') return;
      if (rule.parent?.type !== 'root') return;
      // 🔴 用區塊而非簡寫:`walkDecls` 的 callback 型別是 `void | false`,
      //    `(d) => decls.set(...)` 會把 `Map` 當回傳值 ⇒ `TS2322`(vitest 不跑型別檢查、全綠也擋不住)。
      rule.walkDecls((d) => {
        decls.set(d.prop, d.value);
      });
    });
    const m = re.exec(decls.get(prop) ?? '');
    if (!m) throw new Error(`.fchip 的 ${prop} 讀不到,模型不能用推的 —— 實際值:${decls.get(prop)}`);
    return Number(m[1]);
  };
  const CHIP_PAD_X = num('padding', /^\d+px\s+(\d+)px$/); // 11
  const CHIP_BORDER = num('border', /^(\d+)px\s/); //          1
  const CHIP_FONT = num('font-size', /^(\d+)px$/); //          12
  const CHIP_GAP = 8; // Tailwind `gap-2` = 0.5rem;下一格釘住元件真的在用它
  const CONTENT_PADDING = 48; // `p-6` 左右各 24
  const NARROWEST = 390;
  const BUDGET = NARROWEST - CONTENT_PADDING; // 342

  const chipWidth = (label: string) => CHIP_PAD_X * 2 + CHIP_BORDER * 2 + label.length * CHIP_FONT;
  const groupWidth = (labels: readonly string[]) =>
    labels.reduce((sum, l) => sum + chipWidth(l), 0) + CHIP_GAP * (labels.length - 1);

  it('前提:間距常數 8 對應元件真的用的 `gap-2`,與內容容器真的是 `p-6`', () => {
    const { container } = renderChips({});
    expect(container.querySelector('div')?.className).toContain('gap-2');
    expect(SHELL).toContain('workspace-content min-w-0 flex-1 p-6');
    expect(CHIP_GAP).toBe(8);
    expect(CONTENT_PADDING).toBe(48);
  });

  it('🔴 模型校準:三個真瀏覽器量過的點必須算得出同一個數(算錯就整族失效)', () => {
    expect(groupWidth(['全部', '待處理', '未到貨'])).toBe(184);
    expect(groupWidth(['全部', '待'.repeat(16), '未到貨'])).toBe(340);
    expect(groupWidth(['全部', '待'.repeat(17), '未到貨'])).toBe(352);
  });

  it('🔴 天花板:16 個字放得下、17 個字放不下(校準自實測破點,不是挑的閾值)', () => {
    expect(groupWidth(['全部', '待'.repeat(16), '未到貨'])).toBeLessThanOrEqual(BUDGET);
    expect(groupWidth(['全部', '待'.repeat(17), '未到貨'])).toBeGreaterThan(BUDGET);
  });

  /**
   * 🔴 **這一格才是這一族存在的理由**:`#485` 已拍板「chip 要改名」(名字未定),
   * 而 Sean 舉的候選之一是 `待收款/待訂貨` —— **改名是最可能撞破容量的那個動作**。
   * ⚠️ 而它**同時**是最不會被察覺的:改名的人在桌機上看不出任何問題。
   */
  it('🔴 現行三顆 chip 的標籤放得下 390 窄版(改名/加第四顆時這格會先紅)', () => {
    const { container } = renderChips({});
    const labels = chips(container).map((a) => a.textContent ?? '');
    const w = groupWidth(labels);
    expect(w, `三顆總寬 ${w} 超過 390 窄版預算 ${BUDGET}(標籤:${labels.join('/')})`).toBeLessThanOrEqual(BUDGET);
  });
});
