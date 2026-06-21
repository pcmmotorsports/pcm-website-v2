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
// - processing → charge_unknown / orphan(全 reason)/ locked(order_locked|not_unpaid)/
//   settlement_required(3DS-0b dedup duplicate/needs_settle、本次零扣款、獨立「狀態確認中」文案):
//   勿重複付款(成功真相 = confirm 成功;重試走 ②-⑥ 冪等 confirm 非重 charge)。
// - in_flight → locked(user_in_flight):🔴 不帶 displayId(此請求的新單零扣款、不得以
//   「付款單號/已收」呈現;codex 關卡1 round3 C)。
//
// 🔴 3DS-6a(flag on=`isThreeDSEnabled()`、僅 sandbox/staging):⑥ 改走 initiatePayment(回 payment_url
//   跳轉、不請款)→ mapInitiateOutcome 映 `{ redirect:true, redirectUrl }`(client 整頁跳 TapPay);非成功
//   態(charge_unknown/settlement_required/locked/init_failed)沿用上方同名 UI 態(無 paid、結算交 settleCharge)。
//   ①-⑤ 兩路徑共用;result_url base+secret 在 placeOrder「前」preflight(缺/壞 → 零扣款 + 零垃圾單)。
//   flag off = 同步 confirmPayment(逐字不動、現況)。🔴 payment_url 含 token、零入 log。

import { placeOrder, confirmPayment, initiatePayment } from '@pcm/use-cases';
import { CheckoutInput, PlaceOrderLinesInput, TapPayPrimeInput } from '@pcm/schemas';
import type {
  ConfirmPaymentOutcome,
  InitiatePaymentOutcome,
  PlaceOrderInput,
  PlaceOrderLine,
} from '@pcm/domain';
import { getOrderRepo, getCustomerRepo, getAddressRepo } from '@/lib/auth/composition';
import {
  getTapPayAdapter,
  getPaymentConfirmer,
  getChargeAttemptStore,
} from '@/lib/payment/composition';
import { buildCardholder, type BuildCardholderFailReason } from '@/lib/payment/cardholder';
import { isThreeDSEnabled } from '@/lib/payment/three-ds-flag';
import { resolveThreeDSConfig, buildResultUrls, isHttpsUrl } from '@/lib/payment/three-ds-urls';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CheckoutFieldErrors } from './actions';

// 🔴 3DS-7:cart_session_id 局部 uuid 驗(不改共用 CheckoutInput〔placeOrderAction 退役不動〕;沿用
//   callback/page.tsx 同層 UUID_RE 慣例 —— storefront 無 zod 直接依賴,不引 z.uuid 避脆弱 transitive import)。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 文案常數(單一真相;②-④ client 直接顯示、不另維護字面)。
const MSG = {
  generic: '付款失敗,請稍後再試或聯繫客服 LINE',
  chargeFailed: '付款未成功,請確認卡片資訊後重試',
  chargeFailedWait: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
  processing: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
  settlementRequired: '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認',
  inFlight: '您有一筆付款正在處理中,請稍候再試',
} as const;

export type ChargePaymentActionResult =
  | { fieldErrors?: CheckoutFieldErrors; formError?: string } // 驗證/登入/建單失敗(零扣款)
  | { ok: true; displayId: string } // paid(含冪等)→ ②-⑤ 完成頁(僅同步 flag-off 路徑)
  | { redirect: true; redirectUrl: string } // 🔴 3DS-6a:3DS 啟動成功 → client 整頁跳轉 TapPay(非 paid、付款狀態非終態)
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

  // ②d cart_session_id(3DS-7:信任 client CartContext 穩定 key + server 驗 uuid 格式/非空 fail-closed)。
  //   非價/tier/身分純去重子(plan §4);偽造僅自我 DoS、無跨用戶面;begin/settleCharge 仍讀 DB row key、不信
  //   client 重送(plan §4 不變量)。缺/非法 → 零垃圾單(對齊既有 placeOrder + create_order null fail-closed)。
  const cartSessionId = raw.cartSessionId;
  if (typeof cartSessionId !== 'string' || !UUID_RE.test(cartSessionId)) {
    return { formError: '購物車工作階段資訊有誤,請重新整理頁面後再試' };
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

    // 🔴 3DS-6a:flag 讀一次 + preflight(placeOrder「前」驗 result_url base+secret;不合 → 既有 catch
    //   → MSG.generic、零扣款 + 零垃圾單;codex 關卡1 #3)。flag off → threeDSConfig=null → 走同步 ⑥。
    const threeDSConfig = isThreeDSEnabled() ? resolveThreeDSConfig() : null;

    // ④ 建單(零 userId/tier/price;身分/算價全 create_order RPC server 權威)。
    const placeOrderInput: PlaceOrderInput = {
      lines: parsedLines.data.map(
        (l): PlaceOrderLine => ({ variantId: l.variantId, quantity: l.quantity }),
      ),
      addressId: parsedCheckout.data.addressId,
      shippingMethod: parsedCheckout.data.shippingMethod,
      invoice: parsedCheckout.data.invoice,
      // 🔴 3DS-7:cart_session_id = client CartContext 穩定 key(②d 已驗 uuid/非空)。信任此非價/tier/身分
      //   去重子(plan §4)、取代 option A 的 server randomUUID → begin cart-instance dedup 由此叫醒生效(治本)。
      cartSessionId,
    };
    const orderRepo = await getOrderRepo();
    const placed = await placeOrder(orderRepo, placeOrderInput);

    // ⑤ 🔴 server read-back orders.total = 單一金額來源(client 永不送價;null → 拒、此時零扣款)。
    const total = await orderRepo.findTotal(placed.orderId);
    if (!total) {
      return { formError: MSG.generic };
    }

    // 🔴 3DS-6a flag on:3DS 啟動半段(initiatePayment → redirect / 對帳態);結算交 settleCharge 脊椎。
    //   ①-⑤(getUser/parse/cardholder/placeOrder/findTotal)與同步路徑共用、只 ⑥ 分岔;deps 復用既有
    //   getTapPayAdapter/getChargeAttemptStore(不呼 confirmer — initiate 不 markCharged/confirm)。
    if (threeDSConfig) {
      const { frontendRedirectUrl, backendNotifyUrl } = buildResultUrls(threeDSConfig, placed.orderId);
      const initiated = await initiatePayment(
        {
          tappay: getTapPayAdapter(),
          attempts: await getChargeAttemptStore(),
        },
        {
          prime: parsedPrime.data,
          orderId: placed.orderId,
          amount: total,
          cardholder: built.cardholder,
          frontendRedirectUrl,
          backendNotifyUrl,
        },
      );
      return mapInitiateOutcome(initiated, placed.displayId);
    }

    // ⑥ 編排(flag off 同步路徑、逐字不動):鎖 → charge → 雙軌簿記 → PF-X3 → confirm → 收斂補記(②-③c-2)。
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
    case 'settlement_required':
      // 🔴 3DS-0b dedup(duplicate/needs_settle):同 cart 異單已扣款/扣款中、**本次零扣款** →
      //    沿用 processing UI 終態(清車 + 勿重複付款 + 客服 LINE),但獨立「狀態確認中」文案(非「付款失敗」、
      //    不走 generic catch);domain 層保持獨立 settlement_required kind(不 alias locked),此處僅 presentation
      //    映射故無需新增 client UI 態。option A 下 dormant;#3DS-7 client cart key + 3DS-1b settleCharge 後完整消費 D2/D4。
      return { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(round3 C)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
  }
}

/**
 * InitiatePaymentOutcome → UI 態(3DS-6a flag on;plan §2.3 映射表)。
 *
 * 🔴 與同步 `mapOutcome` 本質差異:3DS 啟動半段不回 paid(無 `ok:true`);成功 = `redirect`(client 整頁跳轉
 * TapPay payment_url、付款狀態非終態)。結算/失敗-釋鎖全交 settleCharge 脊椎(Record API 唯一權威)。
 */
function mapInitiateOutcome(
  outcome: InitiatePaymentOutcome,
  displayId: string,
): ChargePaymentActionResult {
  switch (outcome.kind) {
    case 'redirect':
      // 🔴 N1 / codex 關卡1 #2:client 整頁 window.location 跳轉「前」,delivery 層驗 payment_url 是合法 https URL
      //   (isHttpsUrl 較鬆、允許 ?token= query)。合法 → redirect;壞值(TapPay 已 status=0、可能 OTP 後成交)→
      //   processing 終態(**非** generic 可重試 → 防誤導重刷雙扣);bank_txn 已 durable、settleCharge 經 bank_txn 收斂。
      return isHttpsUrl(outcome.redirectUrl)
        ? { redirect: true, redirectUrl: outcome.redirectUrl }
        : { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'charge_unknown':
      // initiate 非成功、bank_txn 已 durable、可能已登記交易 → 狀態確認中、勿重複付款(settleCharge 經 bank_txn 收斂)。
      return { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'settlement_required':
      // 同步路徑同名態同映射(option A per-call cart_session_id 下 dormant)。
      return { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(此請求零扣款、無單號)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
    case 'init_failed':
      // bank_txn 未 durable → 零 TapPay 呼叫、零扣款(誠實未扣款 + 系統忙碌請稍候;鎖殘留 expirer/sweeper 清)。
      return { ok: false, payment: 'charge_failed_wait', displayId, message: MSG.chargeFailedWait };
  }
}
