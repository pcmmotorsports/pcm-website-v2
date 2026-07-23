'use client';

// useChargePayment.tsx — 結帳刷卡 client hook(M-3 ②-④b;.tsx 取 react-hooks 規則守門)
//
// 接 chargePaymentAction(②-③e):getPrime(呼叫端先取)→ 送 charge 整鏈
// (server:cardholder 組裝 → 建單 → findTotal → 鎖 → charge → confirm)→ 六態映 client state。
//
// 送出紀律:
// - 🔴 inFlightRef 同步原子鎖防重複送出(client 第一道;真防線 = server per-order 鎖 + per-user 閘)。
// - client fail-closed:缺 variantId 整單拒;零價(lines 只 {variantId, quantity})。
// - 終態鎖:paid / processing / unknown 保持上鎖(畫面取代表單);error / wait / in_flight 釋放
//   (wait / in_flight 文案已告知稍候、re-render 後可重試)。
//
// 清車政策(plan ②-④ §2、commit body 揭示):
// - paid → clear(既有慣例)。
// - processing(orphan/charge_unknown/order_locked/not_unpaid、**帶單號**)→ **clear**:錢可能已扣、訂單已建,
//   殘留 cart 誘導重買重刷;②-⑥ webhook 對帳收斂。
// - 🔴 R3 preflight hold(processing **無單號**)→ **不 clear**:§2.3 新單未建、保留 cart 供 sibling 確定
//   failed 後再結帳;按鈕仍鎖死(終態鎖、Q2=B 防焦慮連按再打 Record)。
// - 🔴 unknown(action 呼叫 throw = 回應遺失層,或 S1a 送出逾時無回應=F5 出口)→ **clear + 終態鎖**(審查側 BLOCKER 修):
//   client 無法分辨「請求沒送到(零扣款)」vs「送到了、server 已完成 charge+confirm、回應在
//   回程遺失(已扣款)」;後者 order 已 paid → per-user 閘不再攔同人新請求(migration 閘
//   predicate 排除 payment_status='paid')→ 若釋鎖重試 = 新單第二次扣款(真雙扣)。
//   寧卡單勿雙扣:狀態未知一律當已扣款處理(勿重複付款文案、②-⑥ 對帳收斂;
//   極少數真零扣款者走客服 LINE 確認)。
// - 🔴 redirect(3DS-6b、flag on 3DS 啟動成功)→ **不 clear**:即將整頁跳轉 TapPay payment_url、
//   清車交 3DS-3 callback 成功頁(ClearCartOnSuccess);abandon 回頭時車仍在、可立即重結帳。
//   UI 鎖定維持(導向中、防重送);付款狀態非終態(待 OTP→callback 裁決)。
// - in_flight / error / wait → 保留 cart(server 明確回覆零扣款/未扣款、可修正後重試)。

import { useRef, useState } from 'react';
import type { ShippingMethod } from '@pcm/domain';
import { useCart, type CartItemVehicle } from '@/contexts/CartContext';
import { chargePaymentAction, type ChargePaymentActionResult } from '@/app/checkout/charge-actions';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import { setPaymentInflight } from '@/lib/payment/inflight-marker';
import { useReconcilePayment } from '@/hooks/useReconcilePayment';

export type ChargeArgs = {
  addressId: string | undefined;
  shippingMethod: ShippingMethod;
  invoice: InvoiceDraft;
  prime: string;
  /** 🔴 #241 同意服務條款 checkbox 狀態;送 server action 重驗(不信任 client)。
   *  ⚠️ 2026-07-22 U3b:前端已改為「未勾也可按、按下顯示錯誤」→ server guard 是唯一權威。 */
  agreed: boolean;
  /** B-3 flag-on 才存在；server 仍會以同一份 schema 重新驗證。 */
  notificationEmail?: string;
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
  /** 付款已收或處理中(orphan/unknown/locked):勿重複付款、帶單號供客服查。
   *  🔴 R3 preflight hold(§2.3 新單未建、保留 cart):displayId 缺 = hold、不清車、按鈕仍鎖死。 */
  | { status: 'processing'; displayId?: string; message: string }
  /** 🔴 action 呼叫 throw(回應遺失層):付款狀態未知、可能已扣款 → 終態、勿重複付款、無單號。 */
  | { status: 'unknown'; message: string }
  /** 🔴 S1b-2:reconcile 反查到明確未成功(server settleCharge 已 markFailed、款項未成立)→ 全頁終態、
   *  CTA「重新選購」(unknown 態車已被 S1a 清、無法還原);displayId 若 active 分支有帶則透傳供客訴查。 */
  | { status: 'reconciled_failed'; message: string; displayId?: string }
  /** 🔴 3DS-6b:3DS 啟動成功 → 即將整頁跳轉 TapPay payment_url(付款狀態非終態、UI 鎖定導向中、不清車)。 */
  | { status: 'redirect'; redirectUrl: string }
  | { status: 'paid'; displayId: string };

export type UseChargePayment = {
  state: ChargeState;
  /** 回傳是否落入終態(paid/processing/unknown = true;呼叫端據此維持自身終態鎖、如 View 的 primeBusyRef)。 */
  submit: (args: ChargeArgs) => Promise<boolean>;
  /** 🔴 S1b-2 黑洞「查詢付款結果」:即時反查 → paid/reconciled_failed/維持 unknown(邏輯在 useReconcilePayment、
   *  組合於本 hook 內部以共用同一 ChargeState;plan §5 MF7 凍結)。 */
  reconcile: () => void;
  /** 反查請求進行中(bounded timeout + finally 保證重置)。 */
  reconciling: boolean;
  /** 按鈕 disabled = reconciling || 冷卻中(兩者皆保證重置 → 永不永久鎖死)。 */
  reconcileDisabled: boolean;
};

const GENERIC_FAIL = '付款失敗,請稍後再試或聯繫客服 LINE';
// 🔴 回應遺失層終態文案(禁誘導重刷;與 action MSG_PROCESSING 同精神、但 client 無單號)。
const MSG_UNKNOWN = '付款狀態未知,請勿重複付款,客服 LINE 將協助確認';

// 🔴 S1a F5:charge server action 無 client 逾時 → 網路黑洞時 submit 永不落地、submitting 恆真、
//   U5 遮罩(open=submitting)永久鎖死(客人卡「付款處理中」、唯一出路重新整理而畫面又叫別關)。
//   加上限=末路 hang-breaker(非正常路徑機制):逾時 = 回應未定、可能已扣款 → reject 落下方 catch 的
//   unknown 終態(掀遮罩給出口、清車、保留 cart_session_id 不 regenerate、不釋鎖防雙扣)。
//   🔴 值取捨(codex 關卡2 must-fix + Fable F1):client 逾時專治「client 完全收不到回應」的黑洞(連線斷死;
//   server 端即使被平台 maxDuration 殺,那個 error 也回不到 client)。正常 initiate→redirect / 同步 charge 應
//   於「數秒」內回 → 取保守 90s(遠高於正常延遲、不誤傷 90s 內的慢成功)。真 >90s 收不到回應會降級 unknown
//   =安全方向、非雙扣;該 pending attempt 由 S1b 反查 / sweeper 收斂,客人可聯繫客服或重試。
//   ⚠️ Vercel effective maxDuration 未實查(repo 無 maxDuration 設定、Hobby 上限視 Fluid 而定)→ S3 併驗。
//   **provisional:S3 sandbox 3DS E2E 實測 charge/redirect 真延遲 + 平台 cap 後定案,才進 S4 prod。**
const SUBMIT_TIMEOUT_MS = 90_000;

// 逾時 → reject(不 cancel 底層請求:server 端可能仍完成)。防雙扣多層:client 終態鎖(inFlightRef 不釋放)
//   + 清車不 regenerate 保留 cart_session_id(server cart-dedup 把手)+ 跨分頁 in-flight 軟提醒(catch 內設)
//   + server per-order 鎖。⚠️ 殘餘:另一分頁若持不同 cartSessionId 且原請求 late-paid,server per-user 閘排除
//   paid 單 → 軟提醒被強行略過時仍有雙扣面(同型風險回應遺失 catch 既有;S1a 擴大觸發面〔+ >90s 慢成功〕;硬封閉待 server 端 S1b/backlog)。
function withSubmitTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('charge-submit-timeout')), SUBMIT_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useChargePayment(): UseChargePayment {
  const { items, clear, cartSessionId, regenerateCartSession } = useCart();
  const [state, setState] = useState<ChargeState>({ status: 'idle' });
  // 🔴 同步原子鎖(快速雙擊在 re-render disabled 生效前被同步擋)。
  const inFlightRef = useRef(false);

  async function submit(args: ChargeArgs): Promise<boolean> {
    if (inFlightRef.current) return true; // 已上鎖(進行中或終態):呼叫端不得釋放自身鎖
    inFlightRef.current = true;

    if (items.length === 0) {
      inFlightRef.current = false;
      setState({ status: 'error', message: '購物車是空的,無法結帳' });
      return false;
    }
    // V-3a:line 帶上該列「給哪台車用」(CartItemVehicle、選填;server schema 判別式驗+RPC 白名單
    //   重組 → order_items.vehicle_snapshot;🔴 純 metadata 不含價/tier、缺=不帶)。
    const lines: { variantId: string; quantity: number; vehicle?: CartItemVehicle }[] = [];
    for (const it of items) {
      if (!it.variantId) {
        inFlightRef.current = false;
        setState({ status: 'error', message: '購物車有商品缺少規格資訊,請返回購物車重新確認' });
        return false;
      }
      lines.push({
        variantId: it.variantId,
        quantity: it.qty,
        ...(it.vehicle !== undefined ? { vehicle: it.vehicle } : {}),
      });
    }

    setState({ status: 'submitting' });
    let res: ChargePaymentActionResult;
    try {
      // 🔴 S1a:包 withSubmitTimeout —— 逾時 reject → 下方 catch 的 unknown 終態(修 F5、掀遮罩)。
      res = await withSubmitTimeout(
        chargePaymentAction({
          addressId: args.addressId,
          shippingMethod: args.shippingMethod,
          invoice: args.invoice,
          lines,
          prime: args.prime,
          cartSessionId, // 🔴 3DS-7:client CartContext 穩定 key(server 驗 uuid/非空;空車不可達此=items>0 已保證生成)
          agreed: args.agreed, // 🔴 #241:同意條款 → server action 重驗(不信任 client)
          ...(args.notificationEmail !== undefined
            ? { notificationEmail: args.notificationEmail }
            : {}),
        }),
      );
    } catch {
      // 🔴 fail-closed(審查側 BLOCKER 修):action 內部 catch 全吞回 formError,走到這裡 =
      // 回應遺失層(網路斷在去程或回程/序列化異常),**或 S1a 送出逾時 SUBMIT_TIMEOUT_MS 無回應**——
      // 兩者皆「送到了但回應未定」、server 可能已完成 charge+confirm(已扣款),不可當零扣款釋鎖重試。
      // 比照 processing 終態:清車 + 終態鎖(inFlightRef 不釋放)+ 勿重複付款文案(掀遮罩、F5 出口)。
      clear();
      // 🔴 3DS-7:回應遺失/逾時=可能已扣未定 → **保留 cart_session_id、不 regenerate**(同 processing;
      //   保留 key = server cart-dedup 命中既有單的把手、防雙扣;勿加 regenerate)。
      // 🔴 S1a(codex 關卡2 must-fix):可能已扣未定 → 寫跨分頁 in-flight 記號(同 redirect 路徑),另開
      //   分頁再結帳時 handleSubmit 軟提醒,縮小「另一分頁不同 key late-paid 後重送」殘餘雙扣面(軟提醒
      //   非硬防線;硬封閉待 server 端 S1b/backlog)。
      setPaymentInflight(cartSessionId);
      setState({ status: 'unknown', message: MSG_UNKNOWN });
      return true; // 終態:呼叫端(View primeBusyRef)同樣不得釋放
    }

    // 六態映射(②-③e ChargePaymentActionResult → client state;文案由 action 常數單一真相)。
    // 🔴 3DS-6b:redirect(flag on 3DS 啟動成功)→ 即將整頁跳轉 TapPay。不清車(callback 成功頁才清、
    //   abandon 可回頭重結帳);UI 鎖定維持(導向中、防重送)、付款狀態非終態。redirectUrl 不 log。
    if ('redirect' in res && res.redirect) {
      // 🔴 P3:即將整頁跳轉 TapPay → 寫 in-flight 記號(6 分 TTL)。另開分頁再結帳時 handleSubmit 軟提醒;
      //   付款有結論(callback paid/failed/no_attempt 掛 ClearPaymentInflight)或逾時 → 清/失效。
      //   fail-safe:localStorage 不可用不影響導向(後端 preflight 才是雙扣真防線)。
      setPaymentInflight(cartSessionId);
      setState({ status: 'redirect', redirectUrl: res.redirectUrl });
      return true; // 維持 UI 鎖:呼叫端(View primeBusyRef)不釋放(即將導向)
    }
    if ('ok' in res && res.ok) {
      clear(); // paid:清車(僅成功後)
      // 🔴 3DS-7 Q4=A:**DB 確定 paid → 換新 key**(防下次合法重購撞已 paid sibling 被 begin D2 誤擋)。
      //   模糊態(processing/unknown)刻意「不」regenerate=保留 key 讓 dedup 守住既有單、防雙扣(見下)。
      regenerateCartSession();
      setState({ status: 'paid', displayId: res.displayId }); // 終態保持上鎖
      return true;
    }
    if ('payment' in res) {
      switch (res.payment) {
        case 'processing':
          // 🔴 既有 processing(**帶單號**:orphan/charge_unknown/locked)→ 清車:錢可能已扣、訂單已建,
          //   殘留 cart 誘導重買重刷(②-⑥ 對帳收斂)。
          // 🔴 R3 preflight hold(**無單號**:§2.3 新單未建)→ 不清車:保留 cart 供 sibling 確定 failed
          //   後再結帳(displayId 缺即 hold)。兩者皆終態鎖(按鈕鎖死、Q2=B 防焦慮連按再打 Record)。
          if (res.displayId) clear();
          // 🔴 3DS-7:模糊態(可能已扣未定)**保留 cart_session_id、不 regenerate** —— 換 key 會讓 dedup 失去
          //   既有單把手、既有單若已扣則重購雙扣;保留 key=防雙扣把手(plan §3 7b 表;切勿在此加 regenerate)。
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
      message =
        res.fieldErrors.notificationEmail ??
        res.fieldErrors.addressId ??
        '結帳資料有誤,請返回上一步確認';
    }
    setState({ status: 'error', message });
    return false;
  }

  // 🔴 S1b-2:reconcile 邏輯外移至 useReconcilePayment(避免本 hook 再膨脹過 200 警戒;鐵則 6),但**組合於此
  //   內部**、注入私有 setState/clear/regenerateCartSession/cartSessionId → 反查結果驅動**同一份** ChargeState
  //   (plan §5 MF7 凍結:唯一 owner 是本 hook,View 不得自行實例化 useReconcilePayment)。
  const reconciler = useReconcilePayment({ cartSessionId, setState, clear, regenerateCartSession });

  return {
    state,
    submit,
    reconcile: reconciler.reconcile,
    reconciling: reconciler.reconciling,
    reconcileDisabled: reconciler.reconcileDisabled,
  };
}
