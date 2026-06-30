'use server';

// app/checkout/charge-actions.ts — 結帳刷卡 server action(M-3 ②-③e、plan v6 §7)
//
// 🔴 鐵則 12 成交 path:組「建單(既有 placeOrder)→ charge → confirm」整鏈。
// 前端契約 = { addressId, shippingMethod, invoice, lines, prime } —— **零價、零 cardholder、零 orderId**
// (client 多塞的鍵一律不讀;金額 = server read-back orders.total 單一來源;cardholder = server 組裝)。
//
// 信任邊界(五層 + 付款層;沿用 addAddressAction 既有五層信任邊界 pattern):
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
// - 🔴 settlement_required(cart dedup duplicate/needs_settle、本次零扣款)→ 3DS-7 7c-2 即時裁決
//   adjudicateSettlement(取代 7b「一律處理中」):
//     duplicate / settleCharge=paid(既有單 DB 確定 paid)→ paid-equivalent({ ok:true, displayId:既有單 }、
//       hook clear+regenerate;codex K1 must-fix:換 key 防下次重購撞已 paid sibling D2 誤擋)。
//     settleCharge=failed/no_attempt → 放行重刷(charge_failed、釋鎖、保留 key)。
//     settleCharge=pending / throw → 短 hold(processing、保留 key、不背景輪詢〔Q3=A〕)。
// - in_flight → locked(user_in_flight):🔴 不帶 displayId(此請求的新單零扣款、不得以
//   「付款單號/已收」呈現;codex 關卡1 round3 C)。
//
// 🔴 3DS-6a(flag on=`isThreeDSEnabled()`、僅 sandbox/staging):⑥ 改走 initiatePayment(回 payment_url
//   跳轉、不請款)→ mapInitiateOutcome 映 `{ redirect:true, redirectUrl }`(client 整頁跳 TapPay);非成功
//   態(charge_unknown/settlement_required/locked/init_failed)沿用上方同名 UI 態(無 paid、結算交 settleCharge)。
//   ①-⑤ 兩路徑共用;result_url base+secret 在 placeOrder「前」preflight(缺/壞 → 零扣款 + 零垃圾單)。
//   flag off = 同步 confirmPayment(逐字不動、現況)。🔴 payment_url 含 token、零入 log。

import {
  placeOrder,
  confirmPayment,
  initiatePayment,
  settleCharge,
  preflightReleaseSibling,
} from '@pcm/use-cases';
import { CheckoutInput, PlaceOrderLinesInput, TapPayPrimeInput } from '@pcm/schemas';
import type {
  ConfirmPaymentOutcome,
  InitiatePaymentOutcome,
  PlaceOrderInput,
  PlaceOrderLine,
  SettlementRequiredContext,
  SettleChargeOutcome,
} from '@pcm/domain';
import { getOrderRepo, getCustomerRepo, getAddressRepo } from '@/lib/auth/composition';
import {
  getTapPayAdapter,
  getPaymentConfirmer,
  getChargeAttemptStore,
  getSettleChargeDeps,
  getPreflightReleaseSiblingDeps,
} from '@/lib/payment/composition';
import { buildCardholder, type BuildCardholderFailReason } from '@/lib/payment/cardholder';
import { isThreeDSEnabled } from '@/lib/payment/three-ds-flag';
import { resolveThreeDSConfig, buildResultUrls, isHttpsUrl } from '@/lib/payment/three-ds-urls';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { CURRENT_TERMS_VERSION } from '@/lib/legal/terms-version';
import type { CheckoutFieldErrors } from './checkout-form-types';

// 🔴 3DS-7:cart_session_id 局部 uuid 驗(不改共用 CheckoutInput;沿用
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
  // 🔴 displayId-presence 是契約:**有單號**=既有 processing(orphan/charge_unknown/locked,已建單、hook 清車);
  //   **無單號**=R3 preflight hold(新單未建、§2.3 保留 cart、hook 不清車)。非 hold 的 processing producer 一律必帶 displayId。
  | { ok: false; payment: 'processing'; displayId?: string; message: string }
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

  // ②a CheckoutInput(只驗 addressId/shippingMethod/invoice、strip 未知欄)。
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

  // ②e 🔴 #241 同意條款 server 驗(不信任 client;前端鈕已 payDisabled=!agreed,此為繞 UI 直打 action 的縱深)。
  //   🔴 守門放 try{ 之前(buildCardholder/preflightReleaseSibling/placeOrder/charge/settle **全部之前**;codex 關卡1 B3;
  //   登入 gate + schema parse 之後=純讀/驗證、非付款副作用):agreed !== true → 任何**付款/建單/settle 副作用**前 return,
  //   零扣款零建單、不動 sibling/settle;涵蓋 flag-on(3DS)+ flag-off(同步)兩路徑。
  //   非單純 defense-in-depth:繞 UI 者須主動建構 {agreed:true} = 明確同意訊號,舉證責任推回發起端(non-repudiation;plan §3)。
  if (raw.agreed !== true) {
    return { formError: '請先閱讀並同意服務條款與隱私政策' };
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

    // 🔴 R3:立即重刷 preflight(canonical §2.3、**placeOrder「前」**=否則新單先建成孤兒)。
    //   Q1=A gating:**只在 3DS 路徑跑**(threeDSConfig 非 null)。flag off → 同步路徑逐字不動、零回歸;
    //   prod flag=false → preflight 不啟用、prod 零影響。released 重刷機制本就只在 3DS async redirect 才需要。
    //   接線注意:① 在 placeOrder 前(此處);② release 三參數順序由 use-case 內固定(R2b S1、R3 不直接呼);
    //   ④ userId 餵 server 驗過登入態 user.id(L92-96 getUser、**不信 client**)。
    if (threeDSConfig) {
      const preflight = await preflightReleaseSibling(await getPreflightReleaseSiblingDeps(), {
        userId: user.id,
        cartSessionId,
      });
      if (preflight.kind === 'existing_paid') {
        // 兄弟單已付款 → 顯既有單(paid-equivalent;hook 當 paid 處理:clear + regenerateCartSession,
        //   防下次合法重購撞已 paid sibling 被 begin D2 誤擋;同 adjudicateSettlement duplicate 分支)。
        return { ok: true, displayId: preflight.displayId };
      }
      if (preflight.kind === 'hold') {
        // 確認中、稍候(§2.3:不建新單、保留 cart)。🔴 Q2=B:回 processing **無 displayId** →
        //   hook 鎖死按鈕(終態鎖、防焦慮連按再打 Record)+ 不清車(displayId 缺=hold、保留 cart)。
        return { ok: false, payment: 'processing', message: MSG.settlementRequired };
      }
      // proceed → 續往下建單 + charge(none / 已 release / failed / no_attempt;§2.3 確定未成交)。
    }

    // 🔴 #241 best-effort 同意來源 IP/UA(於 try 內抓 → 萬一 headers 異常落 generic catch、零扣款;
    //   Vercel header 順序 x-vercel-forwarded-for > x-forwarded-for > x-real-ip、取首段、截斷 128/1024;
    //   best-effort 爭議舉證、**非強身分證據**;codex 關卡1 M7/M8)。
    const reqHeaders = await headers();
    const clientIp =
      (reqHeaders.get('x-vercel-forwarded-for') ??
        reqHeaders.get('x-forwarded-for') ??
        reqHeaders.get('x-real-ip'))
        ?.split(',')[0]
        ?.trim()
        ?.slice(0, 128) ?? null;
    const clientUserAgent = reqHeaders.get('user-agent')?.slice(0, 1024) ?? null;

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
      // 🔴 #241 同意紀錄(server 注入、非 client):version 常數 + best-effort IP/UA → create_order 同 transaction 原子寫 order_legal_consents。
      termsVersion: CURRENT_TERMS_VERSION,
      clientIp,
      clientUserAgent,
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
      return await mapInitiateOutcome(initiated, placed.displayId);
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
    return await mapOutcome(outcome, placed.displayId);
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

/** ConfirmPaymentOutcome → UI 態(plan v6 §7 映射表;settlement_required 走 7c-2 即時裁決、其餘純映)。 */
async function mapOutcome(
  outcome: ConfirmPaymentOutcome,
  displayId: string,
): Promise<ChargePaymentActionResult> {
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
      // 🔴 3DS-7 7c-2:cart dedup(duplicate/needs_settle)即時裁決(取代 7b「一律處理中」);
      //    duplicate→既有單 paid-equivalent / needs_settle→鎖外跑 settleCharge(見 adjudicateSettlement)。
      return adjudicateSettlement(outcome.dedup);
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
async function mapInitiateOutcome(
  outcome: InitiatePaymentOutcome,
  displayId: string,
): Promise<ChargePaymentActionResult> {
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
      // 🔴 3DS-7 7c-2:cart dedup 即時裁決(同步路徑同款 adjudicateSettlement;取代 7b「一律處理中」)。
      return adjudicateSettlement(outcome.dedup);
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(此請求零扣款、無單號)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
    case 'init_failed':
      // bank_txn 未 durable → 零 TapPay 呼叫、零扣款(誠實未扣款 + 系統忙碌請稍候;鎖殘留 expirer/sweeper 清)。
      return { ok: false, payment: 'charge_failed_wait', displayId, message: MSG.chargeFailedWait };
  }
}

/**
 * settlement_required(cart-instance dedup)即時裁決(🔴 3DS-7 7c-2、鐵則 12 核心;同步 + 3DS 兩路徑共用)。
 *
 * - `duplicate`(existingPaid:true)→ 既有單 DB 確定 paid → **paid-equivalent 終態**:回 { ok:true, displayId:既有單 }
 *   → hook 當 paid 處理(clear + regenerateCartSession;🔴 codex K1 must-fix:換 key 防下次合法重購撞已 paid
 *   sibling 被 begin D2 誤擋)。
 * - `needs_settle` → 鎖外跑 settleCharge(既有單;begin needs_settle 未取鎖、settleCharge 自管冪等:Record API
 *   權威 + markCharged/confirm `FOR UPDATE` + paid 短路 → 零雙扣/零雙 settle),依結果映:
 *     `paid`             → paid-equivalent(同 duplicate;顯既有單號、hook clear+regenerate)。
 *     `failed`/`no_attempt` → 放行重刷(charge_failed → hook error 態:釋鎖、保留 cart、保留 key);既有單已
 *                            markFailed/無 active attempt → 退出 begin dedup + user_in_flight 雙閘 → 重結帳建新單。
 *     `pending`          → 短 hold「狀態確認中」(processing、保留 key、不放行〔防雙扣〕、不背景輪詢〔Q3=A〕)。
 *
 * 🔴 settleCharge / getSettleChargeDeps **全包局部 try/catch**(codex K1 should):任何 throw → fail-closed hold
 *   (processing / MSG.settlementRequired、保留 key)、**絕不落 chargePaymentAction 外層 generic catch**(否則回
 *   formError → client 釋鎖允許重試 → 潛在雙扣)。duplicate 分支為純 return(零 throw)→ 本函式整體不 reject。
 *
 * displayId 一律取既有單(ctx.existingDisplayId / settleCharge paid 回的 displayId),不用本次新建的孤兒單號
 * (孤兒未付、對客人無意義)。existingOrderId / existing_* 全鏈 server 權威(begin→adapter→outcome、client 零入口)→ 無 IDOR。
 *
 * 🔴 攻擊時序自審(鐵則 10):
 *  ① failed 放行重刷 vs 客人稍後在舊 3D 頁完成 OTP —— `failed` 僅由 Record record_status ∈ {-1 ERROR, 5 CANCEL}
 *     終態驅動(settle-charge classifyRecordStatus);TapPay 模型下同交易終態 -1/5 與「後續 OTP 成功」互斥 →
 *     放行重刷後既有單不會再成交 → 無雙扣。(綁定 Record 終態語意、未來改 settleCharge 裁決須重核。)
 *  ② callback settleCharge(callback/page.tsx)× 本 action settleCharge 對同 existingOrderId 並發 —— 兩條走同一
 *     use-case、讀 Record 同一權威 rec、經 markCharged/confirm `FOR UPDATE` 序列化 → 一條 paid、一條 idempotent
 *     no-op → 零雙扣 / 零雙 settle。
 */
async function adjudicateSettlement(
  ctx: SettlementRequiredContext,
): Promise<ChargePaymentActionResult> {
  // duplicate:既有單 DB 確定 paid → paid-equivalent(純 return、零 throw;顯既有單號、hook clear+regenerate)。
  if (ctx.reason === 'duplicate') {
    return { ok: true, displayId: ctx.existingDisplayId };
  }

  // needs_settle:鎖外跑 settleCharge。🔴 全包局部 try/catch(含 getSettleChargeDeps):throw → fail-closed
  //   hold(processing、保留 key)、不落外層 generic catch(防誤釋鎖重試=雙扣)。
  let settled: SettleChargeOutcome;
  try {
    settled = await settleCharge(getSettleChargeDeps(), {
      orderId: ctx.existingOrderId,
      recTradeIdHint: ctx.existingRecTradeId ?? undefined,
    });
  } catch {
    return {
      ok: false,
      payment: 'processing',
      displayId: ctx.existingDisplayId,
      message: MSG.settlementRequired,
    };
  }

  switch (settled.kind) {
    case 'paid':
      // 既有單確定 paid → paid-equivalent 終態(顯既有單號、hook clear+regenerate;codex K1 must-fix)。
      return { ok: true, displayId: settled.displayId };
    case 'failed':
    case 'no_attempt':
      // 既有單已釋鎖(markFailed 退雙閘)或無 active attempt(必未扣款)→ 放行重刷(hook error 態、保留 key)。
      return {
        ok: false,
        payment: 'charge_failed',
        displayId: ctx.existingDisplayId,
        message: MSG.chargeFailed,
      };
    case 'pending':
      // 既有 3D 可能仍進行中 → 短 hold「狀態確認中」(保留 key、不放行、不背景輪詢;Q3=A)。
      return {
        ok: false,
        payment: 'processing',
        displayId: ctx.existingDisplayId,
        message: MSG.settlementRequired,
      };
  }
}
