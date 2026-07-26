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
    expect(submitters.map((b) => b.value)).toEqual(['use', 'deposit']);
  });
});
