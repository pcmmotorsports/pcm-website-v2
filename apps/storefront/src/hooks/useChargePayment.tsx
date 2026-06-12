'use client';

// useChargePayment.tsx — 結帳刷卡 client hook(M-3 ②-④b;.tsx 取 react-hooks 規則守門)
//
// 取代 usePlaceOrder 接 chargePaymentAction(②-③e):getPrime(呼叫端先取)→ 送 charge 整鏈
// (server:cardholder 組裝 → 建單 → findTotal → 鎖 → charge → confirm)→ 六態映 client state。
//
// 鏡像 usePlaceOrder 紀律:
// - 🔴 inFlightRef 同步原子鎖防重複送出(client 第一道;真防線 = server per-order 鎖 + per-user 閘)。
// - client fail-closed:缺 variantId 整單拒;零價(lines 只 {variantId, quantity})。
// - 終態鎖:paid / processing / unknown 保持上鎖(畫面取代表單);error / wait / in_flight 釋放
//   (wait / in_flight 文案已告知稍候、re-render 後可重試)。
//
// 清車政策(plan ②-④ §2、commit body 揭示):
// - paid → clear(既有慣例)。
// - processing(orphan/charge_unknown/order_locked/not_unpaid)→ **clear**:錢可能已扣、訂單已建,
//   殘留 cart 誘導重買重刷;②-⑥ webhook 對帳收斂。
// - 🔴 unknown(action 呼叫 throw = 回應遺失層)→ **clear + 終態鎖**(審查側 BLOCKER 修):
//   client 無法分辨「請求沒送到(零扣款)」vs「送到了、server 已完成 charge+confirm、回應在
//   回程遺失(已扣款)」;後者 order 已 paid → per-user 閘不再攔同人新請求(migration 閘
//   predicate 排除 payment_status='paid')→ 若釋鎖重試 = 新單第二次扣款(真雙扣)。
//   寧卡單勿雙扣:狀態未知一律當已扣款處理(勿重複付款文案、②-⑥ 對帳收斂;
//   極少數真零扣款者走客服 LINE 確認)。
// - in_flight / error / wait → 保留 cart(server 明確回覆零扣款/未扣款、可修正後重試)。

import { useRef, useState } from 'react';
import type { ShippingMethod } from '@pcm/domain';
import { useCart } from '@/contexts/CartContext';
import { chargePaymentAction, type ChargePaymentActionResult } from '@/app/checkout/charge-actions';
import type { InvoiceDraft } from '@/components/CheckoutStep2';

export type ChargeArgs = {
  addressId: string | undefined;
  shippingMethod: ShippingMethod;
  invoice: InvoiceDraft;
  prime: string;
};

export type ChargeState =
  | { status: 'idle' }
  | { status: 'submitting' }
  /** 可修正後重試(驗證錯 / 卡拒未扣款 / 零扣款通用錯)。 */
  | { status: 'error'; message: string }
  /** 卡拒未扣款但釋鎖紀錄未落(charge_failed_wait):誠實未扣款、請稍候再試(不誘導立即重刷)。 */
  | { status: 'wait'; message: string }
  /** 同會員另筆付款進行中(user_in_flight):零扣款、無單號、稍候再試。 */
  | { status: 'in_flight'; message: string }
  /** 付款已收或處理中(orphan/unknown/locked):勿重複付款、帶單號供客服查。 */
  | { status: 'processing'; displayId: string; message: string }
  /** 🔴 action 呼叫 throw(回應遺失層):付款狀態未知、可能已扣款 → 終態、勿重複付款、無單號。 */
  | { status: 'unknown'; message: string }
  | { status: 'paid'; displayId: string };

export type UseChargePayment = {
  state: ChargeState;
  /** 回傳是否落入終態(paid/processing/unknown = true;呼叫端據此維持自身終態鎖、如 View 的 primeBusyRef)。 */
  submit: (args: ChargeArgs) => Promise<boolean>;
};

const GENERIC_FAIL = '付款失敗,請稍後再試或聯繫客服 LINE';
// 🔴 回應遺失層終態文案(禁誘導重刷;與 action MSG_PROCESSING 同精神、但 client 無單號)。
const MSG_UNKNOWN = '付款狀態未知,請勿重複付款,客服 LINE 將協助確認';

export function useChargePayment(): UseChargePayment {
  const { items, clear } = useCart();
  const [state, setState] = useState<ChargeState>({ status: 'idle' });
  // 🔴 同步原子鎖(鏡像 usePlaceOrder;快速雙擊在 re-render disabled 生效前被同步擋)。
  const inFlightRef = useRef(false);

  async function submit(args: ChargeArgs): Promise<boolean> {
    if (inFlightRef.current) return true; // 已上鎖(進行中或終態):呼叫端不得釋放自身鎖
    inFlightRef.current = true;

    if (items.length === 0) {
      inFlightRef.current = false;
      setState({ status: 'error', message: '購物車是空的,無法結帳' });
      return false;
    }
    const lines: { variantId: string; quantity: number }[] = [];
    for (const it of items) {
      if (!it.variantId) {
        inFlightRef.current = false;
        setState({ status: 'error', message: '購物車有商品缺少規格資訊,請返回購物車重新確認' });
        return false;
      }
      lines.push({ variantId: it.variantId, quantity: it.qty });
    }

    setState({ status: 'submitting' });
    let res: ChargePaymentActionResult;
    try {
      res = await chargePaymentAction({
        addressId: args.addressId,
        shippingMethod: args.shippingMethod,
        invoice: args.invoice,
        lines,
        prime: args.prime,
      });
    } catch {
      // 🔴 fail-closed(審查側 BLOCKER 修):action 內部 catch 全吞回 formError,走到這裡 =
      // 回應遺失層(網路斷在去程或回程/序列化異常)——「送到了但回應丟」時 server 可能已完成
      // charge+confirm(已扣款),不可當零扣款釋鎖重試(見檔頭清車政策)。
      // 比照 processing 終態:清車 + 終態鎖(inFlightRef 不釋放)+ 勿重複付款文案。
      clear();
      setState({ status: 'unknown', message: MSG_UNKNOWN });
      return true; // 終態:呼叫端(View primeBusyRef)同樣不得釋放
    }

    // 六態映射(②-③e ChargePaymentActionResult → client state;文案由 action 常數單一真相)。
    if ('ok' in res && res.ok) {
      clear(); // paid:清車(僅成功後)
      setState({ status: 'paid', displayId: res.displayId }); // 終態保持上鎖
      return true;
    }
    if ('payment' in res) {
      switch (res.payment) {
        case 'processing':
          clear(); // 錢可能已扣、訂單已建 → 清車防重買重刷(②-⑥ 對帳收斂)
          setState({ status: 'processing', displayId: res.displayId, message: res.message });
          return true; // 終態保持上鎖
        case 'in_flight':
          inFlightRef.current = false;
          setState({ status: 'in_flight', message: res.message });
          return false;
        case 'charge_failed_wait':
          inFlightRef.current = false;
          setState({ status: 'wait', message: res.message });
          return false;
        case 'charge_failed':
          inFlightRef.current = false;
          setState({ status: 'error', message: res.message });
          return false;
      }
    }
    // 驗證層(fieldErrors / formError;零扣款)。
    inFlightRef.current = false;
    let message = GENERIC_FAIL;
    if ('formError' in res && res.formError) message = res.formError;
    else if ('fieldErrors' in res && res.fieldErrors) {
      message = res.fieldErrors.addressId ?? '結帳資料有誤,請返回上一步確認';
    }
    setState({ status: 'error', message });
    return false;
  }

  return { state, submit };
}
