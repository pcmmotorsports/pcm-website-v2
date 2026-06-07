'use client';

// usePlaceOrder.tsx — 結帳送出建單 client hook(M-3-S2-b2-e3b;.tsx 取 react-hooks 規則守門)
//
// 封裝送出建單的 client 端編排,讓 CheckoutView 維持精簡(鐵則 6、審查側 e3a WARN 建議抽 hook):
// - 從 useCart().items 組建單線 {variantId, quantity}(**零價**;價由 create_order RPC server 權威算)。
// - 🔴 client 先擋(友善 UX):任一品項缺 variantId(無變體 / stale / 竄改)→ 不呼叫 action、整單拒回友善訊息
//   (server PlaceOrderLinesInput 為真邊界、再擋一層;Phase 1 RPM 全有變體、缺 variantId 屬異常)。
// - 呼 placeOrderAction;成功 → clear() 清車(**僅成功後**;失敗 / RPC RAISE 保留 cart)+ 記 displayId。
// - 雙鈕(桌機 co-btn-pay + mobile buybar)共用 inFlightRef 同步原子鎖防重複送出
//   (submitting state 僅驅動視覺 disable / 按鈕文字;真防雙建單靠 inFlightRef、見 submit())。

import { useRef, useState } from 'react';
import type { ShippingMethod } from '@pcm/domain';
import { useCart } from '@/contexts/CartContext';
import { placeOrderAction, type PlaceOrderActionResult } from '@/app/checkout/actions';
import type { InvoiceDraft } from '@/components/CheckoutStep2';

export type PlaceOrderArgs = {
  addressId: string | undefined;
  shippingMethod: ShippingMethod;
  invoice: InvoiceDraft;
};

export type PlaceOrderState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; displayId: string };

export type UsePlaceOrder = {
  state: PlaceOrderState;
  submit: (args: PlaceOrderArgs) => Promise<void>;
};

const GENERIC_FAIL = '下單失敗,請稍後再試或聯繫客服 LINE';

export function usePlaceOrder(): UsePlaceOrder {
  const { items, clear } = useCart();
  const [state, setState] = useState<PlaceOrderState>({ status: 'idle' });
  // 🔴 同步原子鎖防雙建單(codex 關卡2 round1 MUST-FIX):送出前立即上鎖、check→set 之間無 await
  //    不可交錯,故快速雙擊(雙鈕 disabled 僅 re-render 後生效)第二次同步即被擋。
  //    state.status 防線是 React state(closure、非同步、re-render 後才更新)→ 不足以擋 re-render 前雙擊。
  const inFlightRef = useRef(false);

  async function submit(args: PlaceOrderArgs): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true; // 立即上鎖(同步、原子)

    if (items.length === 0) {
      inFlightRef.current = false; // 不該送出、釋放鎖待修正後重試
      setState({ status: 'error', message: '購物車是空的,無法建單' });
      return;
    }

    // 🔴 client fail-closed:組線前先擋缺 variantId(整單拒、不略過壞行)。
    const lines: { variantId: string; quantity: number }[] = [];
    for (const it of items) {
      if (!it.variantId) {
        inFlightRef.current = false; // 整單拒、釋放鎖
        setState({
          status: 'error',
          message: '購物車有商品缺少規格資訊,請返回購物車重新確認',
        });
        return;
      }
      lines.push({ variantId: it.variantId, quantity: it.qty });
    }

    setState({ status: 'submitting' });
    let res: PlaceOrderActionResult;
    try {
      res = await placeOrderAction({
        addressId: args.addressId,
        shippingMethod: args.shippingMethod,
        invoice: args.invoice,
        lines,
      });
    } catch {
      // action 內部自吞 RPC error 回 formError;此 catch 兜底網路 / 序列化異常。
      inFlightRef.current = false; // 釋放鎖、允許重試
      setState({ status: 'error', message: GENERIC_FAIL });
      return;
    }

    if (res.ok && res.displayId) {
      // 🔴 成功保持上鎖(不釋放):成功畫面取代表單、避免殘留 onClick 再次送出建第二張單。
      clear(); // 僅成功後清車(setItems([]) → 同步清空 localStorage)
      setState({ status: 'success', displayId: res.displayId });
      return;
    }

    inFlightRef.current = false; // 建單失敗(formError/fieldErrors)、釋放鎖允許修正後重試
    let message = GENERIC_FAIL;
    if (res.formError) message = res.formError;
    else if (res.fieldErrors) message = '結帳資料有誤,請返回上一步確認';
    setState({ status: 'error', message });
  }

  return { state, submit };
}
