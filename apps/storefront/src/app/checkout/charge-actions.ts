'use server';

// app/checkout/charge-actions.ts — 結帳刷卡 server action(M-3 ②-③e、plan v6 §7)
//
// 🔴 鐵則 12 成交 path:組「建單(既有 placeOrder)→ charge → confirm」整鏈。
// 前端契約 = { addressId, shippingMethod, invoice, lines, prime } —— **零價、零 cardholder、零 orderId**
// (client 多塞的鍵一律不讀;金額 = server read-back orders.total 單一來源;cardholder = server 組裝)。
//
// 信任邊界(鏡像 placeOrderAction 五層、新增付款層):
// - ① server session getUser:純登入 gate(不把 user.id 傳進建單 use-case;身分由 create_order RPC
//      auth.uid() 重查)。user.id/email 只餵 cardholder 組裝(本就 server session 權威值)。
// - ② CheckoutInput + PlaceOrderLinesInput + TapPayPrimeInput 三段 safeParse(strip 未知欄)。
// - ③ buildCardholder **先於建單**(PII 缺失不產垃圾 unpaid 單;fail → 對應引導文案、placeOrder 零呼叫)。
// - ④ placeOrder(RPC server 權威算價)→ ⑤ findTotal read-back(🔴 單一金額來源;null → 拒、零扣款)
//   → ⑥ confirmPayment(鎖 → charge → 雙軌簿記 → PF-X3 → confirm → 收斂補記;②-③c-2)。
// - 🔴 error 不洩:catch 全吞回通用字面(Q2=A);**走到 throw 的路徑全屬零扣款**(begin throw 含內;
//   charge/confirm 失敗已由 use-case 收斂為 outcome、不會 throw)→ 通用「請稍後再試」誠實且安全。
//
// outcome → UI 六態(plan v6 §7;文案常數 = 單一真相、②-④ 直接顯示):
// - paid → { ok:true, displayId }(②-⑤ 完成頁)。
// - charge_failed(recordPersisted:true)→ 卡拒未扣款、可立即重試。
// - charge_failed_wait(recordPersisted:false、round5 MF1)→ 誠實「未扣款」+ 請稍候(鎖殘留、
//   per-user 閘 10 分鐘自動過期;不誘導立即重試、不謊稱「已收」)。
// - processing → charge_unknown / orphan(全 reason)/ locked(order_locked|not_unpaid):
//   勿重複付款(成功真相 = confirm 成功;重試走 ②-⑥ 冪等 confirm 非重 charge)。
// - in_flight → locked(user_in_flight):🔴 不帶 displayId(此請求的新單零扣款、不得以
//   「付款單號/已收」呈現;codex 關卡1 round3 C)。

import { placeOrder, confirmPayment } from '@pcm/use-cases';
import { CheckoutInput, PlaceOrderLinesInput, TapPayPrimeInput } from '@pcm/schemas';
import type { ConfirmPaymentOutcome, PlaceOrderInput, PlaceOrderLine } from '@pcm/domain';
import { getOrderRepo, getCustomerRepo, getAddressRepo } from '@/lib/auth/composition';
import {
  getTapPayAdapter,
  getPaymentConfirmer,
  getChargeAttemptStore,
} from '@/lib/payment/composition';
import { buildCardholder, type BuildCardholderFailReason } from '@/lib/payment/cardholder';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CheckoutFieldErrors } from './actions';

// 文案常數(單一真相;②-④ client 直接顯示、不另維護字面)。
const MSG = {
  generic: '付款失敗,請稍後再試或聯繫客服 LINE',
  chargeFailed: '付款未成功,請確認卡片資訊後重試',
  chargeFailedWait: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
  processing: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
  inFlight: '您有一筆付款正在處理中,請稍候再試',
} as const;

export type ChargePaymentActionResult =
  | { fieldErrors?: CheckoutFieldErrors; formError?: string } // 驗證/登入/建單失敗(零扣款)
  | { ok: true; displayId: string } // paid(含冪等)→ ②-⑤ 完成頁
  | { ok: false; payment: 'charge_failed'; displayId: string; message: string }
  | { ok: false; payment: 'charge_failed_wait'; displayId: string; message: string }
  | { ok: false; payment: 'processing'; displayId: string; message: string }
  | { ok: false; payment: 'in_flight'; message: string }; // 🔴 無 displayId

/**
 * 刷卡成交。成功 → { ok:true, displayId };付款層結果 → { ok:false, payment, message };
 * 驗證/登入/建單失敗 → { fieldErrors | formError }(零扣款)。
 */
export async function chargePaymentAction(input: unknown): Promise<ChargePaymentActionResult> {
  // ① 登入 gate(user.id/email 之後只餵 cardholder server 組裝)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  // ②a CheckoutInput(鏡像 placeOrderAction;只驗 addressId/shippingMethod/invoice、strip 未知欄)。
  const parsedCheckout = CheckoutInput.safeParse({
    addressId: raw.addressId,
    shippingMethod: raw.shippingMethod,
    invoice: raw.invoice,
  });
  if (!parsedCheckout.success) {
    const fieldErrors: CheckoutFieldErrors = {};
    for (const issue of parsedCheckout.error.issues) {
      const p0 = issue.path[0];
      const p1 = issue.path[1];
      if (
        p0 === 'invoice' &&
        (p1 === 'carrier' || p1 === 'title' || p1 === 'taxId' || p1 === 'donateCode')
      ) {
        (fieldErrors.invoice ??= {})[p1] = issue.message;
      } else if (p0 === 'addressId' || p0 === 'shippingMethod') {
        fieldErrors[p0] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    return { formError: '結帳資料有誤,請返回確認' };
  }

  // ②b 購物車線(缺/非法 variantId → REJECT 整單、zod strip 竄改的 unitPrice/tier 等鍵)。
  const parsedLines = PlaceOrderLinesInput.safeParse(raw.lines);
  if (!parsedLines.success) {
    return { formError: '購物車有商品缺少規格資訊,請返回購物車重新確認' };
  }

  // ②c prime(一次性 token、形狀驗;真偽 TapPay server 驗)。
  const parsedPrime = TapPayPrimeInput.safeParse(raw.prime);
  if (!parsedPrime.success) {
    return { formError: '付款資訊缺失,請重新進行刷卡' };
  }

  try {
    // ③ 🔴 cardholder server 組裝(MUST-FIX 3、Q3=B 級聯)**先於建單**:fail → 引導文案、零垃圾單。
    const built = await buildCardholder(
      { customers: await getCustomerRepo(), addresses: await getAddressRepo() },
      { user: { id: user.id, email: user.email }, addressId: parsedCheckout.data.addressId },
    );
    if (!built.ok) {
      return mapCardholderFail(built.reason);
    }

    // ④ 建單(零 userId/tier/price;身分/算價全 create_order RPC server 權威)。
    const placeOrderInput: PlaceOrderInput = {
      lines: parsedLines.data.map(
        (l): PlaceOrderLine => ({ variantId: l.variantId, quantity: l.quantity }),
      ),
      addressId: parsedCheckout.data.addressId,
      shippingMethod: parsedCheckout.data.shippingMethod,
      invoice: parsedCheckout.data.invoice,
    };
    const orderRepo = await getOrderRepo();
    const placed = await placeOrder(orderRepo, placeOrderInput);

    // ⑤ 🔴 server read-back orders.total = 單一金額來源(client 永不送價;null → 拒、此時零扣款)。
    const total = await orderRepo.findTotal(placed.orderId);
    if (!total) {
      return { formError: MSG.generic };
    }

    // ⑥ 編排:鎖 → charge → 雙軌簿記 → PF-X3 → confirm → 收斂補記(②-③c-2)。
    const outcome = await confirmPayment(
      {
        tappay: getTapPayAdapter(),
        confirmer: getPaymentConfirmer(),
        attempts: await getChargeAttemptStore(),
      },
      {
        prime: parsedPrime.data,
        orderId: placed.orderId,
        amount: total,
        cardholder: built.cardholder,
      },
    );
    return mapOutcome(outcome, placed.displayId);
  } catch {
    // 🔴 Q2=A 通用字面、零原始 error 透傳。走到此處的 throw 全屬零扣款路徑
    // (cardholder repo / placeOrder RPC / findTotal / attempts.begin;charge 之後的失敗
    //  已由 confirmPayment 收斂為 outcome、不 throw)→「請稍後再試」誠實且安全。
    return { formError: MSG.generic };
  }
}

/** cardholder 組裝失敗 → 引導文案(fieldErrors.addressId 引導補地址/手機;其餘 formError)。 */
function mapCardholderFail(reason: BuildCardholderFailReason): ChargePaymentActionResult {
  switch (reason) {
    case 'address_not_found':
      return { fieldErrors: { addressId: '請重新選擇收件地址' } };
    case 'phone_missing':
      return { fieldErrors: { addressId: '收件地址缺少手機號碼,請補齊後再試' } };
    case 'name_missing':
      return { formError: '會員資料缺少姓名,請至會員中心補齊後再試' };
    case 'email_missing':
    case 'profile_not_found':
      return { formError: '會員資料異常,請重新登入後再試' };
  }
}

/** ConfirmPaymentOutcome → UI 六態(plan v6 §7 映射表)。 */
function mapOutcome(outcome: ConfirmPaymentOutcome, displayId: string): ChargePaymentActionResult {
  switch (outcome.kind) {
    case 'paid':
      return { ok: true, displayId };
    case 'charge_failed':
      return outcome.recordPersisted
        ? { ok: false, payment: 'charge_failed', displayId, message: MSG.chargeFailed }
        : { ok: false, payment: 'charge_failed_wait', displayId, message: MSG.chargeFailedWait };
    case 'charge_unknown':
    case 'orphan':
      return { ok: false, payment: 'processing', displayId, message: MSG.processing };
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(round3 C)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
  }
}
