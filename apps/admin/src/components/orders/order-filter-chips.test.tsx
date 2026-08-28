// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminOrderFilter } from '@pcm/domain';
import { OrderFilterChips } from './order-filter-chips';
import { OrderToolbar } from './order-toolbar';
import { ORDER_DENSITY_DEFAULT, PANEL_CLOSED } from '../../lib/orders/order-list-view';

// order-filter-chips.test.tsx — `#484` 片 B-1。
// 🔴 本檔守三件:①chip 的 href 帶對軸值且不洗掉其他篩選 ②選中態(含**兩個方向**)
//    ③`.fchip` 的樣式與 OD 逐字相同(postcss 走 AST,不做字串比對)。

afterEach(cleanup);

const DEN = { density: ORDER_DENSITY_DEFAULT } as const;
/**
 * 🔴 第二顆 chip 的顯示字面(`#485` 片6,**Sean 拍板乙案**逐字「待收款/待訂貨」)。
 * **選擇器統一走這個常數,下次改名只動一處**;而「恰三顆且順序照 OD」那格**刻意保留完整字面陣列**
 * —— 那格的職責就是「有人改了字面要紅一次」,走常數會讓它變成恆真。
 * ⚠️ `key` 仍是 `'pending'`、URL 仍是 `pending=1`:**改的只有給人看的那一層。**
 */
const PENDING_LABEL = '待收款/待訂貨';
const chips = (c: HTMLElement) => [...c.querySelectorAll('a.fchip')] as HTMLAnchorElement[];
const byLabel = (c: HTMLElement, label: string) =>
  chips(c).find((a) => a.textContent === label) ?? null;

const renderChips = (filter: AdminOrderFilter) =>
  render(<OrderFilterChips filter={filter} display={DEN} panelTarget={PANEL_CLOSED} />);

describe('#484 B-1 — 快速篩選 chip', () => {
  it('恰三顆,且**順序照 OD**(第二顆字面片6 改名、位置不變;退貨中另有去處 `#500`)', () => {
    // 🔴 `#485` 片2:「待處理」**插回 OD 原位**,不是接在後面 —— 順序是 OD 字面的一部分。
    const { container } = renderChips({});
    expect(chips(container).map((a) => a.textContent)).toEqual(['全部', PENDING_LABEL, '未到貨']);
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
    // 🔴 **分母守門(2026-08-28 量到這一格是恆綠的)**:`for...of` 走空集合時整個迴圈不執行
    //    ⇒ 「兩顆都不亮」與「一顆都沒渲染」印同一個綠。實測:元件空渲染 ⇒ 本格照樣過。
    //    用**數量**不用文案:chip 改名不該讓這格紅(那是另一個方向的過頭)。
    expect(chips(container).length, '一顆 chip 都沒渲染 ⇒ 下面那個迴圈不會執行 ⇒ 本格恆真').toBeGreaterThan(0);
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
    // 🔴 **分母守門**:`not.toContain` 對空字串恆真 ⇒ 讀到空內容(檔被改名/清空)也會綠。
    //    釘的是**結構**(元件的 export 還在),不是任何一句文案。
    expect(src, '讀到的內容裡連元件本身都不在 ⇒ 下面那條什麼都沒證明').toContain(
      'export function OrderFilterChips',
    );
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
      // 🔴🔴 **2026-08-24 線3:比的是【逗號清單裡有沒有它】,不是整串相等。**
      //    舊版 `norm(rule.selector) !== selector` 看不到分組選擇器 ⇒ globals.css 裡
      //    字面錨 `.fchip,.cap-n,` 那條(`{font-size:14px}`)被整條跳過,
      //    而它在字面錨 `.fchip {` 那塊(`font-size: 12px`)**後面**、同特異性
      //    ⇒ **畫面上生效的是 14px,本檔卻在對 12px。**(不寫行號:本 repo 座標會漂)
      //    📏 兩個方向各餵一發(改完前,`globals.css` 改完即還原、porcelain 0):
      //      改【死的】那條 `.fchip{font-size:12px}` → 99px ⇒ 🔴 本格紅  ← 它在對一個不生效的宣告
      //      改【活的】那條 `.fchip,…{font-size:14px}` → 99px ⇒ 🟢 本格全綠 ← 對真正生效的值失明
      //    ⇒ 同一支檔裡下方 `num('font-size')` 讀到的是 **14**,本格斷言 **12** ——
      //      **兩個讀取器對同一個屬性給出不同的值,而兩個都是綠的。**
      const parts = norm(rule.selector)
        .split(',')
        .map((x) => x.trim());
      if (!parts.includes(selector)) return;
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
    // 🏁 **2026-08-23 Sean 拍板「乙 —— 不算了,照 OD 新稿全部圓角」⇒ `var(--radius)` → `9999px`。**
    //
    // ⚠️ **下面這段舊依據刻意留著** —— 它是「形狀語意」這條規則的完整推理,
    //    而被推翻的是那條規則本身,不是推理過程。誰想把它找回來,從這裡讀起:
    //    ~~2026-08-16:從 `999px` 改成 `var(--radius)`,而這一格是【紅了才被改】的。
    //      依據:設計參照 §6.5.4 裁決「形狀傳達的是【可不可以互動】,不是【重不重要】」
    //      ⇒ chip 渲染成 `<Link>`(可以點)= 控制項 ⇒ 跟所有控制項一起直角化;
    //        只能看的狀態膠囊維持 pill。~~
    //
    // 🔴 **繞了一圈回到 `999px` 家族,但【不是回到原點】**:
    //    2026-08-16 之前是寫死 `999px`(沒有理由);現在是 `9999px`(有拍板 + 有稿)。
    //    **值長得像,授權完全不同。** 下一個人不要把它讀成「當初那個改動白做了」。
    expect(d.get('border-radius')).toBe('9999px');
    // 🏁 2026-08-23 照 OD 新稿:`3px 11px` → `4px 12px`(FIX-37「內距放寬」)。
    // ⚠️ 這一改**牽動下方那組算式模型**(chip 外框由 24 變 26)—— 見 `:377` 那段的重新校準。
    expect(d.get('padding')).toBe('4px 12px');
    // 🔴 **2026-08-24 線3:`12px` → `14px`,而改的不是規矩,是這一格本來就讀錯了。**
    //    字面錨 `.fchip {` 那塊的 `font-size: 12px` 被後面字面錨 `.fchip,.cap-n,`
    //    那條的 `font-size:14px` 覆蓋(同特異性、後者在後)⇒ **畫面上一直是 14px**。
    //    ⚠️ **同一條規則上的 `.cap-n/.cap-y/.cap-bl/.cap-g/.cap-risk` 不是 14** ——
    //       它們被更後面的 `font-size:12px!important` 再蓋一次 ⇒ 那條給 cap-* 的 14px 是死宣告。
    //       (審查 2026-08-24 點出;不要把這一行讀成「這六個都 14」。)
    //    讀取器修好之後本格當場紅,逐字:`expected '14px' to be '12px'` ⇒ 舊期望值是假的。
    //    ⚠️ 所以這一行**不是**把守門調鬆去配合現況 —— 是把它從「對死值」搬到「對生效值」。
    expect(d.get('font-size')).toBe('14px');
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
    // 🔴 **分母守門**:`walkRules` 走 0 條規則時 `bad` 必為 `[]` ⇒ CSS 沒讀到也會綠。
    //    實測(2026-08-28):把 `CSS` 換成空字串 ⇒ 本格照樣過。
    let seen = 0;
    const bad: string[] = [];
    ROOT.walkRules((rule) => {
      seen += 1;
      if (rule.selector.includes('aria-pressed')) bad.push(norm(rule.selector));
    });
    expect(seen, 'globals.css 一條規則都沒走到 ⇒ 下面那條恆真').toBeGreaterThan(0);
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
    // 🔴 **分母守門**:兩條 `not.toMatch` 的主詞都是 `goodsAxes` ——
    //    那個字整個從檔裡消失(改名/檔讀空)時,兩條都會過而**映射早就壞了**。
    expect(SRC, '讀到的內容裡沒有 goodsAxes ⇒ 下面兩條恆真').toContain('goodsAxes');
    expect(SRC).not.toMatch(/goodsAxes\?*\.\[0\]/);
    expect(SRC).not.toMatch(/goodsAxes\?*\.slice\(/);
  });
});

// ── `#485` 片2:「待收款/待訂貨」chip + 「兩份清單合成一份」────────────────────────────
//
// 🔴 **本族守的是片1 交出來的那顆定時彈,而它的病根不是「忘了清」**:
//   【高亮的判準】與【實際生效的篩選集合】從一開始就不是同一個東西。
//   ⇒ 所以下面**不只**測「按全部會清掉待處理」(那只證明現在這一格對),
//   還有一格直接釘住「**chip 設的欄 ⊆ isActive 比對的欄**」——
//   **下一顆 chip 加進來時,漏登記會在那一格紅,不是等人按出來。**
describe('#485 片2 — 「待收款/待訂貨」chip', () => {
  it('🔴 這顆 chip 的 href 帶 pending=1(參數名不隨顯示字面走)', () => {
    const { container } = renderChips({});
    expect(byLabel(container, PENDING_LABEL)?.getAttribute('href')).toContain('pending=1');
  });

  it('🔴🔴 按「全部」會清掉待收款/待訂貨(片1 交出來的定時彈,本片的 must)', () => {
    // 少了 `...CLEARED_CHIP_FILTER`,`pendingOnly` 會被 `...filter` 原封帶過去
    // ⇒ 高亮跳回全部、清單還是待處理那批,而且**沒有錯誤、沒有空白**。
    const { container } = renderChips({ pendingOnly: true });
    expect(byLabel(container, '全部')?.getAttribute('href')).not.toContain('pending');
  });

  it('🔴 按「未到貨」也會清掉待收款/待訂貨(不是只有「全部」那顆要清)', () => {
    const { container } = renderChips({ pendingOnly: true });
    const href = byLabel(container, '未到貨')?.getAttribute('href') ?? '';
    expect(href).toContain('goods_axis=');
    expect(href).not.toContain('pending');
  });

  it('🔴 按「待收款/待訂貨」會清掉貨品軸(反方向,證明清除不是只做單邊)', () => {
    const { container } = renderChips({ goodsAxes: ['none', 'ordered'] });
    expect(byLabel(container, PENDING_LABEL)?.getAttribute('href')).not.toContain('goods_axis');
  });

  it('選中態:pendingOnly ⇒ 只有「待收款/待訂貨」亮(兩個方向都驗)', () => {
    const { container } = renderChips({ pendingOnly: true });
    expect(byLabel(container, PENDING_LABEL)?.getAttribute('aria-current')).toBe('true');
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
    expect(byLabel(container, PENDING_LABEL)?.getAttribute('href')).toContain('order_source=web');
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
      [PENDING_LABEL, { pendingOnly: true }],
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
  const SHELL = readFileSync(join(ADMIN_SRC, 'components/layout/workspace-shell.tsx'), 'utf8');

  /**
   * 🔴🔴 **這一族成立的前提 = 「chip 組獨佔一整行」。**
   *
   * ⚠️ **前提沒了,本族要重寫**(不是調閾值):chip 組不再獨佔一行 ⇒ 它會先被右邊那組壓縮,
   *    容量預算不再是「整個內容寬」,失敗形狀也會變回「掉行」。
   *
   * 🔴 **本格改過一次,改法值得留(`#485` 片5a)**:
   *   原版讀 `page.tsx` 的**檔案文字**斷言含 `order-last basis-full …`。
   *   片5a 把工具列抽成 `order-toolbar.tsx` ⇒ **那個字面搬走了,本格紅**。
   *   ✅ **它紅得完全正確** —— 前提的載體變了,而守門本來就該在這時候叫。
   *   ⚠️ **而修法不是把路徑改指到新檔**(那只是把同一個脆弱性搬家),
   *      是改成**斷言 render 出來的結果** ⇒ **再搬幾次家都不會假紅,而且**
   *      **寫在註解裡的同一串字也騙不過它**(讀檔版會被註解餵飽)。
   *   🔴 **判別:這格紅的時候,是因為「事實變了」還是「有人搬動了我釘的那份字」?**
   *      改成釘 render 之後,只剩前者。
   */
  it('🔴 前提:chip 組仍獨佔一整行(`basis-full`,釘 render 不釘檔案文字);沒了就要重寫本族', () => {
    const html = renderToStaticMarkup(
      <OrderToolbar
        filter={{}}
        display={DEN}
        page={1}
        total={13}
        loadFailed={false}
        panelTarget={PANEL_CLOSED}
      />,
    );
    expect(html).toContain('class="order-last basis-full md:order-none md:basis-auto"');
  });

  /**
   * 版面預算與 chip 幾何 —— **每個常數都有出處,沒有一個是挑的**。
   *
   * · 內容容器內距 `p-6` ⇒ 左右各 24 ⇒ 扣 48(`workspace-shell.tsx` 的 `workspace-content`)
   * · 側欄在窄版**不佔寬**:`components/ui/sidebar.tsx` 那顆是 `hidden md:block`(<768 變覆蓋式抽屜)
   * · 390 = 現行最窄的實機寬(iPhone 12/13/14 直式)
   * · chip 外框 26 = `padding: 4px 12px` 的左右 12×2 + `border: 1px` 的 1×2(`border-box`)
   * · 每個全形字 14px = `font-size: 14px`(CJK 的字身寬 = 字級)
   *   ⚠️ ~~原本寫 12px~~ —— 那是讀取器漏看 `globals.css:1846` 那條多選擇器規則造成的,見下方註解。
   * · chip 間距 8 = 元件根節點的 `gap-2`(下面有一格釘著)
   *
   * 🔴🔴 **誠實邊界 —— 這是【算式】,不是瀏覽器的用值:**
   *   ① **只對全形字準確**。半形(英數、`/`)實測窄得多(`/` ≈ 4px)⇒ 模型會**高估**寬度
   *      ⇒ **偏保守、會早一步紅**,不會漏報。
   *   ② 字體真的換掉、或 `.fchip` 的 padding/font-size 被改 ⇒ 模型會失準。
   *      🔴 ~~「但後者有上面『常態 6 個宣告』那格擋著」~~ **這半句 2026-08-23 起為假,審查點名。**
   *      擋不住的原因:**改它的是【另一個選擇器】** —— `globals.css:1846` 的
   *      `.fchip,.cap-n,…{font-size:14px}` 不在那一格的視野裡,而它才是贏的那條。
   *      ⇒ 現在靠的是本檔讀取器**認得多選擇器規則**(見下方 `num()`),不是那一格。
   *   ③ **它證明不了瀏覽器算出來的用值** —— 那要真瀏覽器
   *      (同 `#486` 記過的坑:CSS 字面 36、用值 30)。
   * ✅ **校準來源(2026-08-15 真瀏覽器,幾何照真版面)**:模型算 184 / 340 / 352,
   *    瀏覽器量 184 / 340 / 352 —— **三點全中**,且模型預測的破點(17 字)與實測破點一致。
   */
  // 🔴🔴 **2026-08-23 審查 Critical:上一版用 `selector === '.fchip'` ⇒ 【只認獨門選擇器】。**
  //    而 `globals.css:1846` 是 `.fchip,.cap-n,.cap-y,… {font-size:14px}` ——
  //    **多選擇器、頂層、在後、同特異性 ⇒ 它才是贏的那一條**,而讀取器看不到它
  //    ⇒ `CHIP_FONT` 讀到 12,真值是 14。
  //    ✅ **真瀏覽器覆核**(`localhost:3871`,`getComputedStyle`):`font-size: 14px`。
  //    ✅ **交叉證據來自本 repo 自己**:`order-toolbar-browser.test.tsx` 量到 chip 高 26→31,
  //       **12px 算不出 31** —— 同一筆 diff 裡「量到的」與「模型假設的」互斥。
  //    ⇒ 改成**看選擇器清單裡有沒有 `.fchip` 這一項**(逗號切開、逐項比對,不是子字串比對:
  //       子字串會誤中 `.fchip-x` 之類的名字)。
  const num = (prop: string, re: RegExp) => {
    const decls = new Map<string, string>();
    postcss.parse(CSS).walkRules((rule) => {
      const parts = rule.selector.split(',').map((x) => x.replace(/\s+/g, ' ').trim());
      if (!parts.includes('.fchip')) return;
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
  const CHIP_PAD_X = num('padding', /^\d+px\s+(\d+)px$/); // 12(生效 padding 是 `4px 12px`)
  const CHIP_BORDER = num('border', /^(\d+)px\s/); //          1
  const CHIP_FONT = num('font-size', /^(\d+)px$/); //          14(2026-08-23 起;見上方讀取器的更正)
  const CHIP_GAP = 8; // Tailwind `gap-2` = 0.5rem;下一格釘住元件真的在用它
  const CONTENT_PADDING = 48; // `p-6` 左右各 24
  const NARROWEST = 390;
  const BUDGET = NARROWEST - CONTENT_PADDING; // 342

  const chipWidth = (label: string) => CHIP_PAD_X * 2 + CHIP_BORDER * 2 + label.length * CHIP_FONT;
  const groupWidth = (labels: readonly string[]) =>
    labels.reduce((sum, l) => sum + chipWidth(l), 0) + CHIP_GAP * (labels.length - 1);

  it('🔴 前提:at-rule 裡的 `.fchip` 沒有動到模型讀的那三個屬性', () => {
    // 🔴🔴 **R3-F12**:`num()` 只看 `rule.parent?.type === 'root'` ⇒ **看不到 at-rule 裡的 `.fchip`**。
    //    今天不失準(那兩條只設 `position` / `::after` / `white-space`),而**那是一個沒有載體的前提** ——
    //    有人在 `@media` 裡加一行 `.fchip{font-size:12px}`,模型會靜靜地繼續用 14。
    // ⇒ 這一格把那個前提變成機械的:at-rule 內的 `.fchip` **不得**碰 padding / border / font-size。
    const watched = ['padding', 'border', 'font-size'];
    const offenders: string[] = [];
    postcss.parse(CSS).walkRules((rule) => {
      if (rule.parent?.type === 'root') return;
      const parts = rule.selector.split(',').map((x) => x.replace(/\s+/g, ' ').trim());
      if (!parts.includes('.fchip')) return;
      rule.walkDecls((d) => {
        if (watched.includes(d.prop)) offenders.push(`${rule.selector} { ${d.prop}: ${d.value} }`);
      });
    });
    expect(
      offenders,
      'at-rule 裡的 .fchip 動到了模型讀的屬性 ⇒ 上面那個幾何模型的輸入已經不完整',
    ).toEqual([]);

    // 對照組:分母不是零 —— at-rule 裡確實有 `.fchip` 規則,只是它們不碰那三個屬性。
    let inAtRule = 0;
    postcss.parse(CSS).walkRules((rule) => {
      if (rule.parent?.type === 'root') return;
      if (rule.selector.split(',').map((x) => x.trim()).includes('.fchip')) inAtRule++;
    });
    expect(inAtRule, 'at-rule 裡一條 .fchip 都沒掃到 ⇒ 這把尺可能壞了').toBeGreaterThan(0);

    // 🔴🔴 **2026-08-24 線3(審查 nit 4)——上面那半只守 at-rule 內,而同一個病會換形狀復發。**
    //    `declsOf()` 比的是「逗號清單裡有沒有 `.fchip` 這一項」⇒ 它看不到**後代/複合**選擇器。
    //    有人在頂層加一條 `.toolbar .fchip{font-size:12px}`(特異性更高、真的會生效)
    //    ⇒ 畫面變了、`declsOf` 讀到的值不變 ⇒ **上面那格與幾何模型雙雙全綠**,
    //      正是本檔 2026-08-24 剛修掉的那個病,只是換了一種寫法。
    //    ⇒ 判準:selector 的某一項**含 `.fchip` 卻不是以 `.fchip` 開頭**(排掉
    //      `.fchip::after` / `.fchip[aria-current='true']` 這種同元素修飾)且碰到模型讀的三個屬性。
    //    📏 表演過會紅:注入 `.toolbar .fchip{font-size:12px}` ⇒ 🔴;拿掉 ⇒ 🟢(見交件包)。
    const descendants: string[] = [];
    postcss.parse(CSS).walkRules((rule) => {
      const parts = rule.selector.split(',').map((x) => x.replace(/\s+/g, ' ').trim());
      if (!parts.some((p) => p.includes('.fchip') && !p.startsWith('.fchip'))) return;
      rule.walkDecls((d) => {
        if (watched.includes(d.prop)) descendants.push(`${rule.selector} { ${d.prop}: ${d.value} }`);
      });
    });
    expect(
      descendants,
      '有後代/複合選擇器在改 .fchip 的 padding/border/font-size ⇒ `declsOf()` 讀不到它,' +
        '而畫面吃得到 ⇒ 本檔的「逐字對 OD」與幾何模型會同時失明',
    ).toEqual([]);
  });

  it('前提:間距常數 8 對應元件真的用的 `gap-2`,與內容容器真的是 `p-6`', () => {
    const { container } = renderChips({});
    expect(container.querySelector('div')?.className).toContain('gap-2');
    expect(SHELL).toContain('workspace-content min-w-0 flex-1 p-6');
    expect(CHIP_GAP).toBe(8);
    expect(CONTENT_PADDING).toBe(48);
  });

  it('🔴 模型自洽:三個點必須算得出同一個數(算錯就整族失效)', () => {
    // 🔴 **校準點刻意不用產品字面**:與這顆 chip 現在叫什麼無關。
    //    用 `'待'.repeat(n)` 讓改名不會動到校準
    //    (片6 實錘:改名時這一格若綁產品字面,會跟著紅而讓人誤以為模型壞了)。
    //
    // 🏁 **2026-08-23 三個數全部改過:184/340/352 → 190/346/358。**
    //    成因不是模型改了,是它讀的 CSS 改了:Sean 拍板「依照 OD」⇒ `.fchip` 內距
    //    `3px 11px` → `4px 12px` ⇒ **chip 外框 24 → 26**,三顆就多 6px。
    //
    // 🔴🔴 **而本格的【標題也改了】,不是只改數字 —— 那才是這次最重要的一筆:**
    //    ~~「三個【真瀏覽器量過】的點」~~ → 「三個點」。
    //    ⚠️ **舊的三個數是 2026-08-15 真瀏覽器量出來的(模型算 184/340/352,瀏覽器量同值,三點全中)。
    //       新的三個數【沒有人用瀏覽器量過】** —— 它們是同一條算式吃了新的 padding 算出來的。
    //    ⇒ **本格現在證明的是「模型自洽」,不再是「模型與真瀏覽器一致」。**
    //       留著仍有價值(有人改壞算式會紅),但**不要再拿它當「這個寬度是真的」的靠山**。
    //    📎 要恢復那半:在 390/393/430 三個寬度用真瀏覽器重量一次(`order-toolbar-browser.test.tsx`
    //       那條 harness 就在做這件事)——那支已經量到 chip 高 26 → 31,寬的部分還沒對回本模型。
    // 🏁 **2026-08-23 第二次改:190/346/358 → 206/388/402。**
    //    上一次改的是 padding(11→12),**這一次改的是字級 —— 而字級一直都是 14,是讀取器在說謊。**
    //    ✅ **而這一次「模型 vs 真瀏覽器」那一半【回來了】**:同日 `localhost:3871` 實量
    //       `全部` = **54.0** / `未到貨` = **68.0**,模型算 26+2×14=54 與 26+3×14=68 ⇒ **兩點全中**。
    //       (第三顆 `待收款/待訂貨` 瀏覽器量 114.1、模型算 124 ⇒ **模型高估** ——
    //        那是半形 `/` 造成的,方向與上面誠實邊界①寫的一致:**保守、會早一步紅,不會漏報。**)
    expect(groupWidth(['全部', '待'.repeat(3), '未到貨'])).toBe(206);
    expect(groupWidth(['全部', '待'.repeat(16), '未到貨'])).toBe(388);
    expect(groupWidth(['全部', '待'.repeat(17), '未到貨'])).toBe(402);
  });

  it('🔴 天花板:12 個字放得下、13 個字放不下', () => {
    // 🏁 **2026-08-23 天花板兩次下修:16/17 → ~~15/16~~ → 12/13。**
    //    第一次是 padding 11→12(Sean 拍「依照 OD」);
    //    🔴 **第二次不是任何人改了什麼 —— 是上一版的 15/16 從頭到尾就是錯的。**
    //       它建立在 `CHIP_FONT = 12` 上,而真值一直是 **14**(讀取器漏看多選擇器規則)。
    //       ⇒ **上一版宣稱「15 字放得下」,而 15 字實際要 374px、預算只有 342 ⇒ 溢出 32px。**
    //    ⚠️ **這是使用者看得到的變化,而且比上次大**:手機上 chip 名字的上限
    //       從「以為的 15 字」掉到「真的 12 字」。**現行三顆最長的是 6 字,離天花板還遠**
    //       (`待收款/待訂貨`;而它含半形 `/`,模型還高估了它)⇒ **今天不會踩到,但命名時要知道。**
    // ⚠️ 破點仍然是**算出來的**,不是撞出來的 —— 而算式的兩個輸入
    //    (chip 外框 26、全形字 14)這次都有真瀏覽器背書(見上一格)。
    expect(groupWidth(['全部', '待'.repeat(12), '未到貨'])).toBeLessThanOrEqual(BUDGET);
    expect(groupWidth(['全部', '待'.repeat(13), '未到貨'])).toBeGreaterThan(BUDGET);
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

describe('`#742` — chip 與密度鈕都要把開著的面板帶著走', () => {
  /**
   * 🔴 病灶不是「忘了寫」,是**寫不寫得出來在型別上沒有差別**:
   *    `buildOrderListHref` 的第 4 參數原本是選填 ⇒ 少給一個參數,`tsc` 不會叫。
   *    實測後果 = 五個 production 呼叫點裡有三個少給 ⇒ 翻頁 / 按 chip / 換密度
   *    都會把員工正在看的那張單關掉。修法把它改成必填 + `PANEL_CLOSED`(見 `#742`)。
   * ⚠️ 本族驗的是**連結上帶著 `panel`**,不是「面板在瀏覽器裡真的還開著」——
   *    後者要 production build E2E(`#288`)。
   */
  it('每一顆 chip 的連結都帶著 panel', () => {
    const c = render(
      <OrderFilterChips filter={{}} display={DEN} panelTarget='ord-1' />,
    ).container;
    const hrefs = chips(c).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0); // 空陣列會讓下面那條 every 恆真
    for (const h of hrefs) expect(h).toContain('panel=ord-1');
  });

  it('刻意關閉時,chip 的連結上【沒有】panel(對照組)', () => {
    const c = render(
      <OrderFilterChips filter={{}} display={DEN} panelTarget={PANEL_CLOSED} />,
    ).container;
    const hrefs = chips(c).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).not.toContain('panel=');
  });

  it('密度鈕的連結也帶著 panel', () => {
    const html = renderToStaticMarkup(
      <OrderToolbar
        filter={{}}
        display={DEN}
        page={3}
        total={13}
        loadFailed={false}
        panelTarget='ord-1'
      />,
    );
    // 🏁 **2026-08-22 Sean 拍板「寬鬆、標準、緊湊功能就保持寬鬆吧」⇒ 三顆密度鈕已移除。**
    //    (2026-08-23 落地;OD 改版稿 `FIX-25 密度切換固定為「寬鬆」` 同一條。)
    //
    // 🔴🔴 **本格【翻面】:原本斷言「密度連結存在且都帶 panel」,現在斷言「一條都不存在」。**
    //    ⚠️ 舊的意圖留著:那條要防的是「切密度會把員工正在看的那張單關掉」。
    //       **鈕沒了 ⇒ 那個風險消失 ⇒ 這一格改成守【鈕真的沒了】。**
    //    🔴 為什麼不是整格刪掉:刪掉的話「有人把密度鈕加回來、而且忘了帶 panel」
    //       **不會有任何東西紅** —— 那正是這一格原本存在的理由。
    // 🔴 **分母守門(2026-08-28 量到這一格是恆綠的)**:整支 `OrderToolbar` 空渲染時
    //    `densityHrefs` 也是 `[]` ⇒ 「密度鈕沒了」與「整條工具列沒了」印同一個綠。
    //    釘**任一連結存在**(分頁鈕),不釘任何文案。
    expect(
      [...html.matchAll(/href="/g)].length,
      '整條工具列一個連結都沒有 ⇒ 工具列根本沒渲染 ⇒ 下面那條恆真',
    ).toBeGreaterThan(0);
    const densityHrefs = [...html.matchAll(/href="([^"]*den=[^"]*)"/g)].map((m) => m[1] ?? '');
    expect(
      densityHrefs,
      '密度連結又出現了 ⇒ 三顆鈕被加回來。若那是拍板要的, 記得每一顆都要帶 panel=,否則切密度會關掉員工開著的那張單',
    ).toEqual([]);
  });
});
