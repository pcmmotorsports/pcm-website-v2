import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// order-panel-scroll.test.ts — 守「面板的高度有沒有扣掉表頭」。
//
// ── 🔴 這一格擋的病,是【沉默】的那一種 ────────────────────────────────────
//   Sean 2026-08-22 逐字:「訂單明細捲動到最下方會卡一次,會看不到申請取消訂單」。
//   真瀏覽器實量(948px 視窗、整頁未捲):
//     面板容器 `top=56` / `height=948`(= `svh` 全高)⇒ `bottom=1004`,而視窗只到 **948**
//     ⇒ **底部 56px 永遠在畫面外**,而「申請取消整張單」住在那 56px 裡。
//     面板內部捲到極限(747)之後,取消區 `bottom` 仍在 **988** ⇒ 還差 40px。
//   ⇒ **員工看到的不是「有東西被切掉」,是「捲不下去」** —— 他不會知道自己少看了一段。
//
// ⚠️ **本檔量的是原始碼字面,不是版面。**
//   jsdom 沒有排版引擎 ⇒ `getBoundingClientRect()` 全回 0,**「底部有沒有出界」單元測試量不到**。
//   ⇒ 本檔擋得住的是「有人把 `calc` 改回 `svh`」;**擋不住「表頭高度變了而這裡沒跟」** ——
//     那一格由下面「兩邊的數字要對得起來」那條頂,而它比對的是**字面**,不是渲染結果。

const PANEL = resolve(__dirname, 'orders/page.tsx');
const HEADER = resolve(__dirname, '../../components/layout/header.tsx');

const panelSrc = () => readFileSync(PANEL, 'utf8');

/** 只看 className 字串,不看註解 —— 註解裡就寫著 `max-h-svh` 這幾個字。 */
const panelClasses = () =>
  panelSrc()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

describe('訂單面板的高度必須扣掉表頭', () => {
  it('🔴 三處面板都用 calc 扣掉表頭高,不得是裸的 max-h-svh', () => {
    const c = panelClasses();
    const calc = [...c.matchAll(/max-h-\[calc\(100svh-3\.5rem\)\]/g)];
    // 🔴 **數量要對**:這支檔的 return 分支數 = 面板的種類數,
    //    只修其中一個的話,另一條路上的員工照樣看不到底部,而**測試會綠**。
    // 🔴 **2026-08-28 線A:2 ⇒ 3** —— 多了手動建單面板(`?panel=new`)。
    //    ⚠️ **這個數字是【要跟著改的】,不是壞掉了**:加一種面板就要加一格扣高。
    //    加面板而沒改這裡 ⇒ 這一格紅,**那正是它要做的事**。
    expect(calc.length, '每一個 return 分支都要扣;漏一個 = 那條路的員工看不到底部').toBe(3);
    expect(c, '裸的 max-h-svh 會讓面板底部 56px 落在畫面外').not.toMatch(/max-h-svh\b/);
  });

  it('🔴 扣掉的數字要等於表頭實際高度(兩邊各寫一份,會漂)', () => {
    // 🔴 這一格擋的是**兩份字面各自為真**:表頭改成 `h-16` 而這裡還扣 `3.5rem`
    //    ⇒ 面板底部又會出界 8px,而**沒有任何東西會紅**。
    const header = readFileSync(HEADER, 'utf8');
    const hMatch = /className='flex h-(\d+) shrink-0/.exec(header);
    expect(hMatch, '找不到表頭的高度 class ⇒ 這把尺失效,不能靜默放行').not.toBeNull();

    // Tailwind 的 h-14 = 14 × 0.25rem = 3.5rem
    const rem = Number(hMatch![1]) * 0.25;
    expect(panelClasses(), `表頭是 h-${hMatch![1]}(= ${rem}rem),面板要扣同一個數`).toContain(
      `max-h-[calc(100svh-${rem}rem)]`,
    );
  });

  it('🔴 前提:表頭確實不是 sticky(是的話這個修法的理由就不成立)', () => {
    // 如果表頭改成 sticky,它就不會捲走 ⇒ 面板永遠從 56px 開始 ⇒ 扣 3.5rem 就變成永遠正確,
    // 而現在的理由寫的是「捲過去之後底下會空 56px」。**理由變了要重寫,不是默默留著。**
    const header = readFileSync(HEADER, 'utf8');
    const headerTag = /<header className='([^']*)'/.exec(header);
    expect(headerTag, '找不到 <header> ⇒ 尺失效').not.toBeNull();
    expect(headerTag![1], '表頭變成 sticky 了 ⇒ 回去重讀面板那段註解的理由').not.toContain('sticky');
  });

  it('🔴 對照組:這把尺分得出有寫與沒寫(不是恆真)', () => {
    expect(panelClasses()).not.toContain('max-h-[calc(100svh-99rem)]');
  });
});
