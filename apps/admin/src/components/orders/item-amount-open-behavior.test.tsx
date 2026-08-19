// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { ItemAmountRow, ItemAmountRowGroup } from './item-amount-row';

// item-amount-open-behavior.test.tsx — 片6a-2「缺料自動展開」的**行為**守門。
//
// 🔴🔴 **這一支存在的理由,是我上一版那格守門【把 bug 釘住當成規格】。**
//    我原本釘的是**原始碼字面**:`/ctx\?\.openId == null \? defaultOpen/`
//    —— 而那一行**正是 `W6-030` M1 的 bug 本體**
//    ⇒ **那格測試確認了 bug 在場,不是抓到它。它綠,而功能是壞的。**
//    📌 **字面守門只能證明「code 裡有這段字」,證不了「這段字做對了事」。**
//       這一支改成模擬真的點擊,問的是**畫面最後是開還是關**。
//
// ⚠️ 射程:jsdom,不量版面;`<details>` 的 open 屬性用 DOM 讀,不是用截圖判。

vi.mock('server-only', () => ({}));
vi.mock('./item-amount-form', () => ({
  // 表單本體不是本檔要驗的東西;只要它可辨認即可。
  ItemAmountForm: () => <div data-testid='amount-form' />,
}));

const props = (id: string, defaultOpen: boolean) => ({
  variant: 'card-line' as const,
  colSpan: 6,
  defaultOpen,
  before: <span>before-{id}</span>,
  priceText: <>NT$ 100</>,
  after: <span>after-{id}</span>,
  orderId: 'ord-1',
  expectedVersion: 1,
  orderItemId: id,
  currentUnitPrice: 100,
  returnTo: '/orders/ord-1',
  blockedReason: null,
});

/** A = 缺料(自動展開)、B = 沒缺料。 */
function setup() {
  const r = render(
    <ItemAmountRowGroup>
      <ItemAmountRow {...props('A', true)} />
      <ItemAmountRow {...props('B', false)} />
    </ItemAmountRowGroup>,
  );
  const cards = () => [...r.container.querySelectorAll('details')];
  const openState = () => cards().map((d) => d.open);
  /**
   * 🔴🔴 **片7:開合卡片的是 `<summary>`,不再是那顆鈕。**
   * 片6a 時兩者是同一件事(展開區裡只有改金額表單)⇒ 這幾格原本點的是 `button`。
   * 片7 把採購那層放進展開區之後,那顆鈕**只管改金額表單** ⇒ 再拿它當卡片開關,
   * 這幾格量的就不是它們宣稱在量的東西了。
   * ⚠️ **這不是為了讓測試變綠而改的**:改完之後它們守的是**同一件事**
   *    (收起來的卡片不得自己彈開),只是走使用者現在真的會走的那條路。
   */
  /**
   * 🔴🔴 **`<details>` 的 `toggle` 事件是【非同步】的(HTML 規格:它被排進 task queue)。**
   * ⇒ `fireEvent.click(summary)` 之後,jsdom 已經把 DOM 的 `open` 改掉了,
   *   而 React 的 `onToggle` **還沒跑** ⇒ 這一刻讀 `details.open` 讀到的是
   *   **瀏覽器的預設行為**,不是我們的狀態機。
   * 🔴 **這一格我差點就交出去了**:改用 summary 之後,「收起 A ⇒ 兩張都關」那一格**是綠的** ——
   *    而它綠的原因是 jsdom 自己把 A 關掉了,`onToggle` 一次都沒跑。
   *    **測試綠、而它量的東西完全不是我以為的那個。**
   * ⇒ 所以要 `await` 一次,讓事件真的送到 React。
   */
  const clickCard = async (i: number) => {
    fireEvent.click(cards()[i]!.querySelector('summary')!);
    await act(async () => {
      // 🔴 `toggle` 被排進的是 **task queue** 不是 microtask ⇒ 要真的過一個 tick,
      //    只 await 一個空 promise 沖不掉它(實測:A 不會收起來,而那一格會說謊)。
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  const clickAmount = async (i: number) => {
    fireEvent.click(cards()[i]!.querySelector('button')!);
    await act(async () => {
      // 🔴 `toggle` 被排進的是 **task queue** 不是 microtask ⇒ 要真的過一個 tick,
      //    只 await 一個空 promise 沖不掉它(實測:A 不會收起來,而那一格會說謊)。
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  const amountForms = () => r.container.querySelectorAll('[data-testid="amount-form"]').length;
  return { openState, clickCard, clickAmount, amountForms };
}

describe('片6a-2 缺料自動展開 · 行為', () => {
  afterEach(cleanup);

  it('🔴 初始:缺料那張是開的、另一張是關的(正向對照:兩張都在)', () => {
    const { openState } = setup();
    expect(openState()).toEqual([true, false]);
  });

  it('🔴🔴 **收起缺料那張之後,它必須【維持關著】** —— 上一版會立刻又開(W6-030 M1 失敗一)', async () => {
    const { openState, clickCard } = setup();
    await clickCard(0);
    expect(openState()).toEqual([false, false]);
  });

  it('🔴🔴 **打開 B、再關掉 B ⇒ A 不得自己彈開** —— 上一版會(W6-030 M1 失敗二,更常發生)', async () => {
    const { openState, clickCard } = setup();
    await clickCard(1); // 開 B ⇒ A 收起
    expect(openState()).toEqual([false, true]);
    await clickCard(1); // 關 B
    expect(openState()).toEqual([false, false]);
  });

  // 🔴🔴 **N3(`W6-031`):這一格是我這輪學到那條的【下一步】。**
  //    「`unknown` 不得自動展開」原本**只有字面守門**(`defaultOpen={stuck.kind === 'stuck'}`)——
  //    **而那正是把 bug 釘住當成規格的那個形狀**(M1 就是那樣發生的)。
  //    ⚠️ 公平講:那格字面守門**不是恆綠**(我的突變 `!== 'not-stuck'` 有被它抓到)——
  //       **但它抓到的是【字改了】,不是【行為變了】。那兩者今天已經分開過一次。**
  //    ⇒ 這裡用**行為**再釘一次:`unknown` 的那一項,卡片必須是關的。
  //    📌 而它是本片**語意上最重要的一格**:`item-stuck.ts` 檔頭逐字
  //       「`unknown` **不是「不卡」的一種**」——靜靜當成不卡 ⇒ 卡住的那項不會自己打開,而畫面看起來完全正常。
  it('🔴🔴 `unknown`(判不出來)的那一項,卡片必須是**關的** —— 它不是「不卡」的一種', () => {
    const r = render(
      <ItemAmountRowGroup>
        {/* A:stuck ⇒ 呼叫端傳 true;U:unknown ⇒ 呼叫端傳 false(因為 kind !== 'stuck') */}
        <ItemAmountRow {...props('A', true)} />
        <ItemAmountRow {...props('U', false)} />
      </ItemAmountRowGroup>,
    );
    const open = [...r.container.querySelectorAll('details')].map((d) => d.open);
    // 正向對照:A 真的開著(否則「U 是關的」在什麼都沒渲染時也會過)
    expect(open).toEqual([true, false]);
  });

  it('🔴 同時只有一張是開的(既有約束:只展開正在編輯的那一項)', async () => {
    const { openState, clickCard } = setup();
    await clickCard(1);
    expect(openState().filter(Boolean)).toHaveLength(1);
  });

  // ── 片7:卡片開合 與 改金額表單 是兩個狀態 ──────────────────────────────
  it('🔴🔴 打開卡片【不會】把改金額表單一起掀開來', async () => {
    const { openState, clickCard, amountForms } = setup();
    // 正向對照:A 一開始就是開的(缺料自動展開),而表單不得在場。
    expect(openState()).toEqual([true, false]);
    expect(amountForms()).toBe(0);

    await clickCard(1); // 開 B
    expect(openState()).toEqual([false, true]);
    // 🔴 這一格是本片的重點:員工打開卡片是為了看採購,
    //    而改金額是一道「已收款 ⇒ 不得改」的閘守著的表單,不該在他沒要求時出現。
    expect(amountForms()).toBe(0);
  });

  it('🔴 點「改金額」才出現表單,而它會順手把卡片撐開(否則按了看起來沒反應)', async () => {
    const { openState, clickAmount, amountForms } = setup();
    await clickAmount(1); // B 的改金額
    expect(openState()).toEqual([false, true]);
    expect(amountForms()).toBe(1);
  });

  it('🔴🔴 收表單【只收表單】,卡片留著 —— 他是為了看採購才打開那張卡的', async () => {
    const { openState, clickAmount, amountForms } = setup();
    await clickAmount(1);
    expect(amountForms()).toBe(1);
    await clickAmount(1); // 再點一次 = 收起表單
    expect(amountForms()).toBe(0);
    // 🔴 負對照:若這裡寫成「連卡片一起關」,員工會被趕回起點。
    expect(openState()).toEqual([false, true]);
  });

  it('🔴🔴 收起卡片會把「正在改金額」一起清掉 —— 再打開時表單不得【自己還在那裡】', async () => {
    const { clickCard, clickAmount, amountForms } = setup();
    await clickAmount(1);
    expect(amountForms()).toBe(1);
    await clickCard(1); // 收起卡片
    expect(amountForms()).toBe(0);
    await clickCard(1); // 再打開同一張
    // 🔴 不清的話,這裡會是 1 —— 一個【看不見而仍然為真】的狀態,
    //    而員工沒有再點過那顆入口。
    expect(amountForms()).toBe(0);
  });
});
