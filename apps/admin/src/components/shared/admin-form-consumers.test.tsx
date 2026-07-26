// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import {
  ORDER_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
} from '../../lib/orders/workflow-form';
import {
  TIER_CUSTOMER_ID_FIELD,
  TIER_VALUE_FIELD,
  TIER_NOTE_FIELD,
  TIER_RETURN_TO_FIELD,
  TIER_NOTE_MAX,
} from '../../lib/customers/tier-form';
import {
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_DIRECTION_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_NOTE_MAX,
} from '../../lib/customers/wallet-form';

// E11-2 <AdminForm> 重構的**錢面迴歸守門**(鐵則 12 ①錢:order / 會員 tier / 儲值金)。
//
// 為什麼放這裡而不是各元件旁邊:被守的不是三個元件各自的業務規則,是「E11-2 把欄位接線
// 從 JSX 結構搬進 props 物件」這**一件**改動。opus 對抗審 C1/C2 實錘:重構前刪掉一個
// <input type='hidden'> 是結構性缺失,重構後只是少一個物件屬性 —— 而三個消費端在此之前
// 零測試覆蓋,刪掉 order-edit 的 version 樂觀鎖那一行,typecheck / lint / 全套測試都會綠。
//
// 這些斷言要鎖的就是「靜默掉一個欄位」:hidden 三鍵、name、required、maxLength、
// inputMode,以及 wallet 兩顆 submit 的 name/value(決定加值還是扣款)。
// server action 本身的行為不在此檔範圍(那是 lib/*-form.test.ts 與 RPC 層的事)。

vi.mock('../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: async () => {},
}));
vi.mock('../../lib/customers/tier-actions', () => ({
  setTierAction: async () => {},
}));
vi.mock('../../lib/customers/wallet-actions', () => ({
  adjustWalletAction: async () => {},
}));

const { OrderEditForm } = await import('../orders/order-edit-form');
const { TierEditForm } = await import('../customers/tier-edit-form');
const { WalletAdjustForm } = await import('../customers/wallet-adjust-form');

afterEach(cleanup);

/** 取得 form 底下具名控制項;查無回 null(斷言端自己爆,不在此吞掉)。 */
function field(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector(`[name="${name}"]`);
}

/**
 * 回 form 內 DOM tree order 的**第一顆 submitter**(=隱式提交按 Enter 會選中的那顆)。
 *
 * 🔴 不能用屬性 selector 比對 `[type="submit"]`:HTML 規範中 `<button>` 的 type 是
 * enumerated attribute,**缺失或無效值一律當 submit**(`<button type="">`、
 * `<button type="garbage">` 都是 submit 鈕)。改讀 `.type` 屬性 —— DOM 會替我們正規化。
 * `<input>` 則是 submit 與 image 兩種會成為 submitter。
 * 另驗 `el.form === form`:元素可用 `form=` 屬性關聯到別張表單(或從外部關聯進來),
 * 光看 descendant 會誤判。今天 `<AdminForm>` 沒有 id、關聯不到,先擋住未來。
 */
function firstSubmitterOf(form: HTMLFormElement): HTMLElement | null {
  for (const el of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
    if (el.form !== form) continue;
    if (el instanceof HTMLButtonElement && el.type === 'submit') return el;
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image')) return el;
  }
  return null;
}

/** hidden inputs 依 DOM 順序回 [name, value] 陣列。 */
function hiddenPairs(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map(
    ({ name, value }) => [name, value],
  );
}

const ORDER_DETAIL = {
  id: 'ord-1',
  version: 7,
  shippingMethod: '新竹物流',
  invoiceNumber: 'AB-12345678',
  invoiceAmount: { amount: toMoneyAmount(4000), currency: 'TWD' },
  invoiceStatus: 'issued',
} as unknown as AdminOrderDetail;

describe('OrderEditForm — E11-2 重構後的錢面欄位契約', () => {
  it('should keep all three hidden fields including the version optimistic lock', () => {
    const { container } = render(<OrderEditForm detail={ORDER_DETAIL} />);
    expect(hiddenPairs(container)).toEqual([
      [ORDER_ID_FIELD, 'ord-1'],
      [VERSION_FIELD, '7'],
      [RETURN_TO_FIELD, '/orders/ord-1'],
    ]);
  });

  it('should keep all four named controls present so the parser sees every key', () => {
    const { container } = render(<OrderEditForm detail={ORDER_DETAIL} />);
    // workflow-form.ts 用 form.has() 分辨「未送出」與「清空」=> 四個 key 必須全 present。
    for (const name of [
      SHIPPING_METHOD_FIELD,
      INVOICE_STATUS_FIELD,
      INVOICE_NUMBER_FIELD,
      INVOICE_AMOUNT_FIELD,
    ]) {
      expect(field(container, name)).toBeTruthy();
    }
  });

  it('should keep the shipping method required with its length cap and prefill current values', () => {
    const { container } = render(<OrderEditForm detail={ORDER_DETAIL} />);
    const shipping = field(container, SHIPPING_METHOD_FIELD) as HTMLInputElement;
    expect(shipping.required).toBe(true);
    expect(shipping.maxLength).toBe(64);
    expect(shipping.value).toBe('新竹物流');
    expect((field(container, INVOICE_AMOUNT_FIELD) as HTMLInputElement).value).toBe('4000');
    expect((field(container, INVOICE_STATUS_FIELD) as HTMLSelectElement).value).toBe('issued');
  });
});

describe('TierEditForm — E11-2 重構後的錢面欄位契約', () => {
  it('should keep both hidden fields carrying the customer identity', () => {
    const { container } = render(<TierEditForm customerId='cus-1' currentTier='store' />);
    expect(hiddenPairs(container)).toEqual([
      [TIER_CUSTOMER_ID_FIELD, 'cus-1'],
      [TIER_RETURN_TO_FIELD, '/customers/cus-1'],
    ]);
  });

  it('should keep the tier select on its current value and the reason required', () => {
    const { container } = render(<TierEditForm customerId='cus-1' currentTier='store' />);
    expect((field(container, TIER_VALUE_FIELD) as HTMLSelectElement).value).toBe('store');
    const note = field(container, TIER_NOTE_FIELD) as HTMLInputElement;
    expect(note.required).toBe(true);
    expect(note.maxLength).toBe(TIER_NOTE_MAX);
  });
});

describe('WalletAdjustForm — E11-2 重構後的錢面欄位契約', () => {
  it('should keep both hidden fields carrying the customer identity', () => {
    const { container } = render(<WalletAdjustForm customerId='cus-1' />);
    expect(hiddenPairs(container)).toEqual([
      [WALLET_CUSTOMER_ID_FIELD, 'cus-1'],
      [WALLET_RETURN_TO_FIELD, '/customers/cus-1'],
    ]);
  });

  it('should keep the amount and note guards that the parser relies on', () => {
    const { container } = render(<WalletAdjustForm customerId='cus-1' />);
    const amount = field(container, WALLET_AMOUNT_FIELD) as HTMLInputElement;
    expect(amount.required).toBe(true);
    expect(amount.maxLength).toBe(8);
    expect(amount.inputMode).toBe('numeric');
    const note = field(container, WALLET_NOTE_FIELD) as HTMLInputElement;
    expect(note.required).toBe(true);
    expect(note.maxLength).toBe(WALLET_NOTE_MAX);
  });

  it('should keep both direction submitters inside the form so deposit and withdrawal stay distinguishable', () => {
    const { container } = render(<WalletAdjustForm customerId='cus-1' />);
    // 兩顆 submit 的 name=direction 決定加值還是扣款;slot 化後若掉出 <form> 就送不出方向。
    const submitters = [
      ...container.querySelectorAll<HTMLButtonElement>(
        `form button[type="submit"][name="${WALLET_DIRECTION_FIELD}"]`,
      ),
    ];
    expect(submitters.map((b) => b.value)).toEqual(['deposit', 'use']);
  });

  it('should make deposit the first submit in the form so pressing Enter never withdraws', () => {
    const { container } = render(<WalletAdjustForm customerId='cus-1' />);
    // 🔴 backlog #296 的守門(Sean 2026-07-26 拍 A)。HTML 隱式提交選 form 內**第一顆 submit**
    // (任何一顆,不限帶 name=direction 的)⇒ 員工在金額欄按 Enter 必須落在「加值」。
    // 這條轉紅代表有人改了按鈕順序、或在前面插了新的 submit ⇒ 按 Enter 會變成扣款。
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    const firstSubmit = firstSubmitterOf(form as HTMLFormElement);
    expect(firstSubmit?.getAttribute('name')).toBe(WALLET_DIRECTION_FIELD);
    expect(firstSubmit?.getAttribute('value')).toBe('deposit');
    // 🔴 formAction 會整個覆寫 form 的 action(React 19 照樣執行)⇒ 光看 name/value 會假綠。
    expect(firstSubmit?.hasAttribute('formaction')).toBe(false);
  });
});
