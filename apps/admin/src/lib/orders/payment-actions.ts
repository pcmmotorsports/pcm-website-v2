'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';
import {
  EMPTY_PAYMENT_VALUES,
  PAY_ORDER_ID_FIELD,
  PAYMENT_DUPLICATE_RESULT_CODE,
  PAYMENT_RECORDED_RESULT_CODE,
  paymentFailure,
  paymentFailureCodeForThrown,
  type PaymentActionState,
} from './payment-action-state';
import { buildReceivedAt, carryBackPaymentValues, parsePaymentForm } from './payment-form';
import { recordManualPayment } from './payment-repository';

// payment-actions.ts — M-4b E10 #15-B2-b2:手動收款登錄的 server action。
//
// 🔴🔴 **`redirect()` 在 try 之外,這是硬條款不是風格**(B2-b 的 Fable R4 F2):
//    Next 的 `redirect()` **用 throw 實作**。把它包進 RPC 的那個 try:
//    寫入成功 → 拋 `NEXT_REDIRECT` → 被 catch 接住 → 它既沒有 `wrote` 也沒有 `sqlstate`
//    ⇒ 分派成 `'bug'` ⇒ 文案逐字說「沒有寫入」⇒ 員工再登一次 ⇒ **重複入帳**。
//    (姊妹片 `receipt-actions.ts:38-40` 立過同一條,理由逐字相同。)
//
// 🔴 **catch 一律走 `paymentFailureCodeForThrown`**,不自己判斷:
//    通用的 `catch → 'bug'` 會把「已經寫進去但讀不懂回應」講成「沒有寫入」——同上,重複入帳。
//
// 🔴🔴 **稽核的實況(我原本在這裡寫錯,關卡2 抓到)**:
//    我原本逐字寫「RPC 在同交易寫 `admin_audit_log`」—— **那是假的**。
//    實查:`grep -c admin_audit_log 20260810200000_m4b_e10_op5_record_manual_payment.sql` = **0**。
//    ⇒ 手動收款登錄**沒有 `admin_audit_log` 條目**,與備註線(A6)、取消線(A9d2)不同。
//    今天能追到「誰登的」只有 `order_payments.actor` 這一欄(RPC 的 G2 驗它存在且啟用),
//    而 `actor` 是 picker cookie 選出來的、`session/actor.ts:6-7` 逐字自陳「不是授權邊界」
//    ⇒ **它是「畫面上被選的人」,不是責任歸屬證據**。
//    ⚠️ 這是**現況的缺口、不是本片造成的**,但本片是第一個把這條路走通的入口
//    ⇒ 已回報主視窗立案;**本層不自己補寫稽核**(那要動錢的路徑與權限面,不是 action 層自己能拍的)。
//
// 🔴 **授權面的誠實話**(與讀路徑同一個現況):`authorizeAdminMutation` 驗的是
//    「有沒有有效的 admin session + Origin + 具名 actor」,**不驗這個人能不能碰這張單** ——
//    後台沒有分單權限這回事。`p_order_id` 直接來自表單 ⇒ 任何登入者都能對任一張單登錄收款。
//    這是 repo 現況、不是本片新增的洞;真身分綁定是 E8-B 那條線。
//    ⇒ 所以**不做**「這張單屬不屬於你」那種檢查(做了也只是假的安心)。
//    ⚠️ 但 `actor` 仍然要送:RPC 的 G2 會驗它存在且啟用(`20260810200000:148`),
//    而且在**沒有稽核條目**的現況下(見上),`order_payments.actor` 是全系統唯一
//    寫著「誰登的」的地方 —— 不是稽核列,是收款列本身。

export async function recordManualPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  // ① 授權閘。🔴 絕對第一 —— 未授權者送爛表單要拿到 `denied` 而不是 `invalid`,
  //    否則等於對未授權者洩漏表單規則。代價:`denied` 不保留輸入(拿不到可信的值)。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    // 🔴 留一行(零 PII:只記有沒有帶 order_id,不記值)—— 沒有這行的話,
    //    「有人在敲收款 action 但過不了授權閘」在營運面完全看不見。
    console.warn('[admin/orders/payment] payment.record.denied', {
      request_id: await getRequestId(),
      has_order_id: readSingleString(formData, PAY_ORDER_ID_FIELD) !== null,
    });
    return paymentFailure('denied', EMPTY_PAYMENT_VALUES);
  }

  const carried = carryBackPaymentValues(formData);
  const parsed = parsePaymentForm(formData);
  if (!parsed) {
    return paymentFailure('invalid', carried);
  }

  const orderId = parsed.orderId;
  const returnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), orderId);
  // 🔴 這是**稽核/log 用的 HTTP request id**,與表單帶來的冪等鍵是兩回事。
  //    拿它當 `p_request_id` 會讓每次重送都變成新請求 ⇒ 冪等失效(姊妹片同款警告)。
  const logRequestId = await getRequestId();
  const receivedAt = buildReceivedAt(parsed);

  // 🔴 log **不記備註內容**(只記有沒有填):備註是內部營運資料,進了 Vercel log
  //    就等於多一份不受 service_role 邊界保護的副本。單號同理只記有沒有。
  console.info('[admin/orders/payment] payment.record.attempt', {
    request_id: logRequestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: orderId,
    rail: parsed.rail,
    amount: parsed.amount,
    received_at: receivedAt,
    has_bank_reference: parsed.bankReference !== null,
    has_payer_note: parsed.payerNote !== null,
  });

  let outcome: Awaited<ReturnType<typeof recordManualPayment>>;
  try {
    outcome = await recordManualPayment(
      parsed.rail === 'cash'
        ? {
            rail: 'cash',
            orderId,
            requestId: parsed.requestId,
            actor: authorization.actorId,
            amount: parsed.amount,
            receivedAt,
            payerNote: parsed.payerNote,
          }
        : {
            rail: 'bank_transfer',
            orderId,
            requestId: parsed.requestId,
            actor: authorization.actorId,
            amount: parsed.amount,
            receivedAt,
            bankReference: parsed.bankReference,
            payerNote: parsed.payerNote,
          },
    );
  } catch (error) {
    // 🔴 **失敗路徑也要 revalidate**:`'error'` 那一類**可能已經寫進去了**
    //    (RPC 已 commit、回應斷在路上)⇒ 不重取的話員工停在看不到那筆收款的舊畫面,
    //    而文案正好叫他「先看收款明細有沒有這一筆」—— 畫面不更新的話那句話沒東西可看。
    revalidateOrderViews({ orderId, returnTo, scope: 'payment', requestId: logRequestId });
    const code = paymentFailureCodeForThrown(error);
    console.error('[admin/orders/payment] payment.record.failed', {
      request_id: logRequestId,
      order_id: orderId,
      failure_code: code,
      // 只記 code 與訊息前 200 字,**不記 details / hint**(PG 的 DETAIL 會把整列值帶出來)。
      sqlstate: (error as { sqlstate?: unknown })?.sqlstate ?? null,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return paymentFailure(code, carried);
  }

  console.info('[admin/orders/payment] payment.record.ok', {
    request_id: logRequestId,
    order_id: orderId,
    payment_id: outcome.paymentId,
    idempotent: outcome.idempotent,
  });
  revalidateOrderViews({ orderId, returnTo, scope: 'payment', requestId: logRequestId });

  // 🔴 **redirect 在 try 之外**(見檔頭)。冪等重放與首次成功分開帶碼:
  //    對員工兩者都是「記好了」,但 `duplicate` 要能說「先前已經登錄過」,不能講成剛剛才記的。
  // 🔴🔴 **`r=` 這兩個字元是 wire 格式的一部分,不是可省的裝飾**(R2 MF1):
  //    頁層讀的是 `r` 這個 query 參數(`cancel-action-state.ts:187` 逐字 `CANCEL_RESULT_PARAM = 'r'`),
  //    而 `appendResultQuery` **只負責接 `?` 或 `&`、不會幫你補鍵名**
  //    ⇒ 少了它會產出 `?payment_recorded`,頁層永遠讀不到 ⇒ **橫幅永遠不出現**,而四閘全綠。
  //    (退款 `refund-actions.ts:438`、採購 `procurement-actions.ts:262`、取消
  //     `cancel-action-state.ts:226` 三支都逐字寫 `r=`;到貨那支漏了,本片一起修。)
  redirect(
    appendResultQuery(
      returnTo,
      `r=${outcome.idempotent ? PAYMENT_DUPLICATE_RESULT_CODE : PAYMENT_RECORDED_RESULT_CODE}`,
    ),
  );
}
