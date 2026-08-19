// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

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
  const trigger = (i: number) => cards()[i]!.querySelector('button')!;
  return { openState, trigger };
}

describe('片6a-2 缺料自動展開 · 行為', () => {
  afterEach(cleanup);

  it('🔴 初始:缺料那張是開的、另一張是關的(正向對照:兩張都在)', () => {
    const { openState } = setup();
    expect(openState()).toEqual([true, false]);
  });

  it('🔴🔴 **收起缺料那張之後,它必須【維持關著】** —— 上一版會立刻又開(W6-030 M1 失敗一)', () => {
    const { openState, trigger } = setup();
    fireEvent.click(trigger(0));
    expect(openState()).toEqual([false, false]);
  });

  it('🔴🔴 **打開 B、再關掉 B ⇒ A 不得自己彈開** —— 上一版會(W6-030 M1 失敗二,更常發生)', () => {
    const { openState, trigger } = setup();
    fireEvent.click(trigger(1)); // 開 B ⇒ A 收起
    expect(openState()).toEqual([false, true]);
    fireEvent.click(trigger(1)); // 關 B
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

  it('🔴 同時只有一張是開的(既有約束:只展開正在編輯的那一項)', () => {
    const { openState, trigger } = setup();
    fireEvent.click(trigger(1));
    expect(openState().filter(Boolean)).toHaveLength(1);
  });
});
