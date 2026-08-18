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
// 🔴 **稽核的實況(#423 之後已改;這段留著是因為它的歷史很重要)**:
//    · 一度寫「RPC 在同交易寫 `admin_audit_log`」= **假的**(關卡2 抓到)。
//    · 改成「手動收款登錄**沒有**稽核條目」= 當時**是真的**,並據此立案 #423。
//    · **#423 落地後這句又成假了** —— `20260812150000` 讓 OP5 與沖銷(OP-A12)兩支
//      都在**同交易**寫 `admin_audit_log`:成功走 `payment.record`、
//      冪等重放走 `payment.record.replay`(Sean 線 Q-D16=B:重送那條路要留痕)、
//      沖銷走 `payment.reverse`。三者都有「筆數恰 1」的守門,寫不進去就整筆回滾。
//    ⚠️ 同一句話在**兩天內**是真、是假、又是真(本檔建於 `6e0062c1` 2026-08-11、#423 是 08-12)
//      —— 所以**引用它之前先看 migration 現況**,
//      別把註解當事實來源(這正是它兩次寫錯的原因)。
//    ⓘ `order_payments.actor` 的誠實邊界**沒有改變**:它仍是 picker cookie 選出來的、
//      `session/actor.ts:6-7` 逐字自陳「不是授權邊界」⇒ 稽核列補的是「有沒有紀錄」,
//      **不是**「這個名字可信」。真身分綁定仍在 E8-B 那條線。
//    🔴 **本層仍然不自己寫稽核**:錢的路徑一律由 RPC 同交易寫。
//      ⚠️ 別把它讀成「全 repo 一致」—— 那句話是假的:`staff-actions.ts:61` 就是從 app 層
//      直接 `getAdminAuditLogRepository().record(...)` 寫進 `admin_audit_log`(非交易性)。
//      分界是**有沒有錢/有沒有交易邊界**,不是「app 層從不寫稽核」。
//
// 🔴 **授權面的誠實話**(與讀路徑同一個現況):`authorizeAdminMutation` 驗的是
//    「有沒有有效的 admin session + Origin + 具名 actor」,**不驗這個人能不能碰這張單** ——
//    後台沒有分單權限這回事。`p_order_id` 直接來自表單 ⇒ 任何登入者都能對任一張單登錄收款。
//    ✅ **這是 Sean 拍板的刻意設計,不是「還沒做」** —— 別撿去做授權矩陣:
//      2026-08-16 決策單 `:51` 逐字「所有員工都可以看到客戶資料沒有分權限,
//      我唯一擔心就是資料被駭客攻擊而已」;2026-08-18 `Q3=甲` 確認**「看得到」也包括「動得了」**
//      (`#635` 據此結案)。
//    🔴 **原本這裡寫「真身分綁定是 E8-B 那條線」,那是【誤 defer】,已刪** ——
//      `E8-B` 解身分,解不了授權,其 plan 明文排除角色/權限矩陣(`plan v4:122`)。
//      ⚠️ **不要連上面 `:44` 那句一起改** —— 那句講的是 `order_payments.actor` 這個
//      【身分】不可信,而 `E8-B` 正好解那個,**那是正確的 defer**。
//    ⇒ 所以**不做**「這張單屬不屬於你」那種檢查(做了也只是假的安心)。
//    ⚠️ 但 `actor` 仍然要送:RPC 的 G2 會驗它存在且啟用(`20260810200000:148`),
//    而且 **#423 之後它一送兩用** —— 同一個值同時寫進 `order_payments.actor` 與
//    `admin_audit_log.actor`(`payment.record` / `payment.record.replay` 那兩列)。
//    ⇒ 送錯人的話,帳本列與稽核列會**一起**記錯,對帳時兩邊互相佐證不出任何東西。
//    (這段原本寫「在沒有稽核條目的現況下,actor 是全系統唯一寫著誰登的地方」——
//     #423 落地後那句已成假,與上面那段同一次更新漏改,2026-08-12 關卡2 R2 抓到。)

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
