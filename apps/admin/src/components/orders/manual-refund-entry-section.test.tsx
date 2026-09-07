// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  EMPTY_MANUAL_REFUND_INPUT,
  MANUAL_REFUND_CARD_CONFIRM_FIELD,
  type ManualRefundActionState,
} from '../../lib/payment/manual-refund-action-state';

// ═══════════════════════════════════════════════════════════════════════════
// ⟦b4-MIXEDRAILMANUALREFUND⟧ · codex `gpt-6-astra` 2026-09-08 R1 nit(逐條收下)
//
// 🛑 **codex 逐字**:「只驗初始未勾,未驗失敗後 DOM;將 effect 改成 `setConfirmCard(true)`,
//    初始檢查與 action 回填測試都抓不到【第二次送出繞過確認】。」
// 🔴 **那個盲區是真的,而它有形狀** —— 本片的回填有兩段路,而它們互相看不見:
//    ① `actions.ts` 的 `carryBack()` 把值放進 `state.input`  ← `manual-refund-actions.test.ts` 在守
//    ② 這支元件的 effect 把 `state.input` 套回 **DOM 上那個框** ← **本檔在守**
//    ⇒ ① 全綠而 ② 壞掉 ⇒ 員工勾了、送失敗、回來框是空的(或反過來:他沒勾而框是勾的)
//      而**那兩種都在畫面上看起來完全正常**。
//
// 🔵 **為什麼要 mock `useActionState`**(不是為了方便,是 jsdom 進不去):
//    元件 import 的 `manual-refund-actions` 是 server action(鏈上有 `server-only`)
//    ⇒ 在 jsdom 會直接 throw。形狀與同目錄 `manual-refund-ledger-section.test.tsx:12` 相同。
// ⚠️ **誠實邊界**:本檔證的是【給定一個失敗態,那個框會長成什麼樣】,
//    **不是**「送出去真的會拿到那個失敗態」—— 那一半住在 `manual-refund-actions.test.ts`。
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../lib/payment/manual-refund-actions', () => ({
  recordManualRefundAction: '/submit',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let fedState: ManualRefundActionState = { status: 'idle', requestToken: 'tok-idle' };
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [fedState, () => {}, false] as const,
  };
});

const { ManualRefundEntrySection } = await import('./manual-refund-entry-section');

function failedWith(confirmCardNotRefunded: boolean): ManualRefundActionState {
  return {
    status: 'failed',
    code: 'error',
    message: '登記失敗',
    requestToken: 'tok-failed',
    input: {
      ...EMPTY_MANUAL_REFUND_INPUT,
      rail: 'cash',
      amount: '500',
      reason: '商品缺貨',
      confirmCardNotRefunded,
    },
  };
}

function box(): HTMLInputElement {
  const { container } = render(
    <ManualRefundEntrySection orderId='o-1' returnTo='/orders/o-1' serverToken='tok-idle' />,
  );
  const el = container.querySelector(
    `input[type="checkbox"][name="${MANUAL_REFUND_CARD_CONFIRM_FIELD}"]`,
  ) as HTMLInputElement | null;
  expect(el, '那個勾選框根本不在 ⇒ 下面每一條都不算數').toBeTruthy();
  return el!;
}

afterEach(() => {
  cleanup();
  fedState = { status: 'idle', requestToken: 'tok-idle' };
});

describe('⟦b4-MIXEDRAILMANUALREFUND⟧ 失敗回填要套到【DOM 上那個框】', () => {
  it('🟢 idle ⇒ 沒勾(正對照:證下面兩格不是恆真)', () => {
    expect(box().checked, '還沒送出就已經勾了 ⇒ 那道確認等於不存在').toBe(false);
  });

  it('🔴 勾了而送失敗 ⇒ 框仍是【勾的】', () => {
    fedState = failedWith(true);
    expect(box().checked, '他勾了、失敗回來框空了 ⇒ 他會再勾一次(還好);而下一格才是真的痛').toBe(
      true,
    );
  });

  it('🔴 沒勾而送失敗 ⇒ 框仍是【沒勾的】', () => {
    // 🛑 少了這一格:一個 `setConfirmCard(true)` 的實作會讓上面那格綠,
    //    而那等於「員工沒勾而畫面說他勾了」⇒ 他按第二次就送出去了 ⇒ **繞過那道確認**。
    fedState = failedWith(false);
    expect(box().checked, '沒勾而失敗回來框是勾的 ⇒ 第二次送出就繞過了那道確認').toBe(false);
  });
});
