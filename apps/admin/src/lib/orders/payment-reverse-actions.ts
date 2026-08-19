'use server';

import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { revalidateOrderViews } from './order-revalidate';
import { reverseFailure, reverseFailureCodeForThrown, type ReverseResult } from './payment-reverse-state';
import { reverseManualPayment } from './payment-repository';

// payment-reverse-actions.ts — M-4b E10 #372-A12 入口片:沖銷的 server action。
//
// 🔴 **沒有 `redirect()`,這是刻意的**:結果就地顯示在島元件裡。
//    姊妹片登錄那支要 PRG 是因為它是整張表單;沖銷是列上的一個小動作,
//    導頁會把員工從他正在看的那一列彈開,而那一列正是他下一步要確認的東西。
//    ⇒ 附帶好處:沒有 `redirect()` 就沒有「`NEXT_REDIRECT` 被 catch 接住、
//      分派成 bug、文案說沒寫入」那條災難序(`payment-actions.ts:23-27` 記著它)。
//
// 🔴 **catch 一律走 `reverseFailureCodeForThrown`**,不自己判斷:
//    通用的 `catch → 'bug'` 會把「已經沖掉但讀不懂回應」講成「這次沒有沖成」
//    ⇒ 員工回頭去沖列表上新出現的那列負數 ⇒ **原本那筆收款被加回帳上**。
//
// 🔴 **稽核由 RPC 同交易寫**(`20260812150000:450-471`,action=`payment.reverse`),
//    本層不自己寫。⚠️ 別把它讀成「app 層從不寫稽核」——`staff-actions.ts:61` 就有一支
//    非交易性的 app 層寫入。分界是**有沒有錢/有沒有交易邊界**。
//
// 🔴 **授權面**(與登錄那支同一個現況):`authorizeAdminMutation` 驗的是
//    「有沒有有效 admin session + Origin + 具名 actor」,**不驗這個人能不能碰這張單**。
//    ⇒ 任何登入者都能沖任一單的收款。
//
//    ✅ **這是 Sean 拍板的刻意設計,不是「還沒做」** —— 別撿去做授權矩陣:
//      2026-08-16 決策單 `:51` 逐字「所有員工都可以看到客戶資料沒有分權限,
//      我唯一擔心就是資料被駭客攻擊而已」;`:53`「這類題以後不要再問」。
//      2026-08-18 Sean 逐字答「**03 看得到包不包括動得了 = 甲**」
//      ⇒ **「看得到」也包括「動得了」**(`#635` 據此結案)。
//      🔴 **這裡刻意抄【題目文字】而不抄題號**(2026-08-19 G2 改;原本寫 `Q3=甲`):
//        那個 `03` 是 W6 窗給 Sean 的清單的**本地編號**,而同一天艦隊另有一個
//        `Q3=甲`(付款狀態文案「已收訂金」)⇒ **只抄編號的人會查到不相干的拍板,
//        然後合理地懷疑本段在說謊,再去改掉一個對的東西。**
//      📎 出處錨(不寫行號,那份檔會長):
//        `grep -n '看得到包不包括動得了' docs/security/2026-08-17-pre-launch-must-close-checklist.md`
//    🔴 **原本這裡寫「真身分綁定在 E8-B 線」,那是【誤 defer】,已刪** ——
//      `E8-B` 解「你是誰」(身分),**解不了「你能不能動這一張」(授權)**;
//      它的 plan 明文排除角色/權限矩陣(`plan v4:122`)。
//      ⇒ 留著那句的話,`E8-B` 完成那天這件事會被當成順便解決了。
//    ⚠️ **本段只講【授權】。`payment-actions.ts:44` 那句 `E8-B` 是【身分】面,
//      那是正確的 defer,不要一起改。**(🔴 原本這裡寫「同檔 `:44`」——**指錯檔了**,
//      本檔 `:44` 是函式簽章;codex 關卡2 抓到。)

export async function reversePaymentAction(args: {
  paymentId: string;
  orderId: string;
  returnTo: string;
  reason: string;
}): Promise<ReverseResult> {
  // ① 授權閘絕對第一 —— 未授權者送爛輸入要拿到 `denied` 而不是 `invalid`,
  //    否則等於對未授權者洩漏輸入規則。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    // 零 PII:只記有沒有帶 payment_id,不記值。
    console.warn('[admin/orders/payment] payment.reverse.denied', {
      request_id: await getRequestId(),
      has_payment_id: args.paymentId !== '',
    });
    return reverseFailure('denied');
  }

  // ② 原因必填。🔴 **這裡也要 trim**:RPC 的 G3 是 `btrim(coalesce(p_reason,''))` 後判空
  //    (`20260812150000:382-385`)⇒ 只擋 `''` 的話,全是空白的原因會一路送到 DB 才被拒,
  //    員工拿到的是一句通用的 `P0001`,而不是「原因沒填」。
  const reason = args.reason.trim();
  if (reason === '' || args.paymentId === '') {
    return reverseFailure('invalid');
  }

  const logRequestId = await getRequestId();
  // 🔴 log **不記沖銷原因內容**(只記有沒有填):原因是內部營運資料,進了 Vercel log
  //    就等於多一份不受 service_role 邊界保護的副本。
  console.info('[admin/orders/payment] payment.reverse.attempt', {
    request_id: logRequestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: args.orderId,
    payment_id: args.paymentId,
  });

  let outcome: Awaited<ReturnType<typeof reverseManualPayment>>;
  try {
    outcome = await reverseManualPayment({
      paymentId: args.paymentId,
      actor: authorization.actorId,
      reason,
    });
  } catch (error) {
    // 🔴 **失敗路徑也要 revalidate**:`unknown` 與 `wrote` 兩類**可能/確定已經寫進去了**
    //    ⇒ 不重取的話員工停在看不到沖銷列的舊畫面,而文案正好叫他「重新整理看那一筆」——
    //    畫面不更新的話那句話沒東西可看。
    revalidateOrderViews({
      orderId: args.orderId,
      returnTo: args.returnTo,
      scope: 'payment-reverse',
      requestId: logRequestId,
    });
    const code = reverseFailureCodeForThrown(error);
    console.error('[admin/orders/payment] payment.reverse.failed', {
      request_id: logRequestId,
      order_id: args.orderId,
      payment_id: args.paymentId,
      failure_code: code,
      // 只記 code 與訊息前 200 字,**不記 details / hint**(PG 的 DETAIL 會把整列值帶出來)。
      sqlstate: (error as { sqlstate?: unknown })?.sqlstate ?? null,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return reverseFailure(code);
  }

  console.info('[admin/orders/payment] payment.reverse.ok', {
    request_id: logRequestId,
    order_id: args.orderId,
    payment_id: args.paymentId,
    reversal_id: outcome.reversalId,
  });
  revalidateOrderViews({
    orderId: args.orderId,
    returnTo: args.returnTo,
    scope: 'payment-reverse',
    requestId: logRequestId,
  });
  return { ok: true };
}
