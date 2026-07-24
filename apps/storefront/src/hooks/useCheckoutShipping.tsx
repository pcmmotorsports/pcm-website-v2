'use client';

// useCheckoutShipping.tsx — 依購物車內容決定配送方式 + 顯示標籤(補差額免運、Sean 2026-07-24)。
// 🔴 鐵則 6:自 CheckoutView 外移(該檔卡 400 硬上限);補差額整車 → 自取(store)免運、其餘 → 宅配(home)。
//   混入一般商品即回 home 照常收運費 = 天然防混車偷吃步。方式驅動運費鏡像 + create_order 傳參一致。

import { useCart } from '@/contexts/CartContext';
import { isBalancePaymentOnlyCart } from '@/lib/balance-payment';
import type { ShippingMethod } from '@pcm/domain';

export type CheckoutShipping = {
  /** create_order 與運費鏡像共用的配送方式(store→0 免運 / home→滿5000免運否則100)。 */
  method: ShippingMethod;
  /** 收件摘要配送標籤(補款專用 vs 貨運宅配)。 */
  label: string;
  /** true=整車補差額商品 → 配送區顯「補款專用・免運」兩態文案。 */
  balancePaymentCheckout: boolean;
};

export function useCheckoutShipping(): CheckoutShipping {
  const { items } = useCart();
  const balancePaymentCheckout = isBalancePaymentOnlyCart(items.map((i) => i.productId));
  return {
    method: balancePaymentCheckout ? 'store' : 'home',
    label: balancePaymentCheckout ? '免運(補款專用)' : '貨運宅配',
    balancePaymentCheckout,
  };
}
