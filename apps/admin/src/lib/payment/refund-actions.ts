'use server';

import { redirect } from 'next/navigation';
import { TapPayRefundNotSentError, toMoneyAmount } from '@pcm/domain';
import type { TapPayRefundPayload, TapPayRefundResult } from '@pcm/domain';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { TapPayConfigError, getTapPayAdapter } from './composition';
import { REFUND_RECORD_QUERY_TIMEOUT_MS, checkRecordBaseline } from './refund-baseline';
import { parseRefundForm } from './refund-form';
// #350d-4:動作做完回發起的那個視圖(order 域五支共用的解析器 + 契約 §5 的單一 revalidate 實作)。
import {
  ORDER_RETURN_TO_FIELD,
  appendResultQuery,
  parseOrderReturnTo,
} from '../orders/order-return-to';
import { revalidateOrderViews } from '../orders/order-revalidate';
import { isRefundUiEnabled } from './refund-ui-flag';
import {
  EMPTY_REFUND_INPUT,
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  REFUND_SUBMITTED_RESULT_CODE,
  generateRefundRequestToken,
  refundFailure,
  type RefundActionState,
  type RefundFormInput,
} from './refund-action-state';
import {
  RefundCallerBugError,
  finalizeOrderRefund,
  findOrderForRefund,
  initiateOrderRefund,
  type FinalizeOrderRefundArgs,
  type FinalizeOrderRefundOutcome,
} from './refund-repository';

// refund-actions.ts — M-3 A7c RW2c:退款 server action(高風險片、鐵則 12 ①②)。
//
// 流程(plan v3.2 §2 丙 + §3 表,順序即合約):
//   授權(絕對第一)→ 啟用旗標 → 解析 → server 重讀訂單(確認碼/refunded 硬擋/卡交易)
//   → G0 recordQuery baseline → RPC initiate(帳先記)→ adapter.refund() → RPC finalize
//   → 成功才 redirect(PRG;**在一切 try 之外**,A9d2-1 R2-3)。
//
// 🔴 錯誤分派鐵律(§2 丙;`packages/domain/src/payment/types.ts:177-179` JSDoc 同語):
//    refund() 只認 `TapPayRefundNotSentError` 與三態結果;**其他一切 throw = unknown-state
//    ⇒ 不 finalize、列留 processing(S5 擋同單再發)、不自動重發、UI 顯「勿重試」**。
//    「不 finalize」不是漏做 —— unknown-state 在 RPC 端**沒有對應 outcome**(刻意不可表達)。
//
// 🔴 本檔沒有一行稽核 code —— 兩支 RPC 同交易寫 admin_audit_log(G9)。
// 🔴 本片收工時本 action 零呼叫端(入口 = RW2d);對 27 項驗收貢獻 0。

// 🔴 `ORDERS_PATH` / `detailPath()` 已於 #350d-4 **具名刪除**(零呼叫端):導頁與 revalidate 的
//    路徑一律由 `return_to`(過 `parseOrderReturnTo`)與 `revalidateOrderViews` 決定。
//    留著一支沒人用的路徑拼接器 = 下一個人繞過 `return_to` 的現成入口
//    (同 `order-detail-route.tsx` 刪掉零呼叫端 prop 的理由)。

/**
 * 碼位安全截斷(給 failed_detail 用):`.slice()` 按 UTF-16 units 切,切在 surrogate pair
 * 中間會產生 lone surrogate → JSON 序列化成不成對的 \uD800 → PG 端直接炸;
 * 按碼位切則永遠是合法字串,且碼位數 ≤ RPC 的 char_length 上限語意一致。
 */
function clipCodepoints(value: string, max: number): string {
  return [...value].slice(0, max).join('');
}

/** 失敗時帶回的員工輸入(Q1=A)。唯一空殼例外=denied(授權閘在讀表單之前);
 *  disabled 在 carryBack 之後才判 ⇒ 帶的是真輸入(RW2d 關卡2 nit 更正舊字面)。 */
function carryBack(formData: FormData): RefundFormInput & { requestToken: string } {
  const read = (field: string): string => {
    const value = formData.get(field);
    return typeof value === 'string' ? value : '';
  };
  const token = read(REFUND_REQUEST_TOKEN_FIELD);
  return {
    kind: read(REFUND_KIND_FIELD),
    amount: read(REFUND_AMOUNT_FIELD),
    reason: read(REFUND_REASON_FIELD),
    confirmCode: read(REFUND_CONFIRM_FIELD),
    // 🔴 原樣帶回;真的拿不到才新產(帶回舊的才能讓重按被 G4 認出,A9d2-1 R2-2 同理)。
    requestToken: token !== '' ? token : generateRefundRequestToken(),
  };
}

export async function initiateRefundAction(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  // ① 授權閘。🔴 絕對第一,連讀一個欄位都在它之後(未授權者送爛表單拿到的是 denied
  //    而非 invalid;測試用 get() 會爆的地雷 FormData 釘住短路)。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return refundFailure('denied', EMPTY_REFUND_INPUT, generateRefundRequestToken());
  }

  const carried = carryBack(formData);
  const input: RefundFormInput = {
    kind: carried.kind,
    amount: carried.amount,
    reason: carried.reason,
    confirmCode: carried.confirmCode,
  };

  // ② 啟用旗標(server 閘;RW2d 的按鈕只是同一旗標的顯示面,兩端讀同一函式 —— 見 refund-ui-flag.ts)。
  //    🔴 **action 自己也要驗**,不只藏按鈕 —— 「UI 不顯示」擋不住直接 POST action
  //    (A1 片同型教訓:可見性看伺服端閘,不看畫面)。
  if (!isRefundUiEnabled()) return refundFailure('disabled', input, carried.requestToken);

  // ③ 解析(純形狀;業務判定單一真相在 RPC)。
  const parsed = parseRefundForm(formData);
  if (!parsed.ok) return refundFailure('invalid', input, carried.requestToken);

  // 🔴 #350d-4 C1:動作做完回發起的那個視圖(面板裡退款 ⇒ 回面板)。
  //    綁在 `parsed.orderId`(已過 uuid 閘)上 —— 契約 §6-1:`return_to` 只決定視圖、不決定哪一張單。
  //    🔴 **這一條碰錢,但它決定不了「退哪一張單的錢」**:退款目標自始至終是 `parsed.orderId`
  //    (`:141` 的 `findOrderForRefund`、`:207`/`:217` 的 initiate 都吃它),`return_to` 只影響
  //    「PRG 之後畫面停在哪」。非法值 fail-closed 退回本單明細頁,**不影響已經送出去的退款**。
  const returnTo = parseOrderReturnTo(formData.get(ORDER_RETURN_TO_FIELD), parsed.orderId);

  const httpRequestId = await getRequestId();
  // 🔴 log 紀律(A9d2-1 H11 同型):reason 是營運文字 → 只記長度;
  //    冪等鍵=表單 token ≠ HTTP x-request-id ⇒ 兩者都記才對得回稽核鏈。
  console.info('[admin/payment/refund] order_refund.initiate.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    kind: parsed.kind,
    amount: parsed.amount,
    reason_length: [...parsed.reason].length,
  });

  const logError = (stage: string, error: unknown, extra: Record<string, unknown> = {}) => {
    // 🔴 只記 code 與 message 前 200 字,**不得**記 details / hint(PG DETAIL 會帶整列內容)。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error(`[admin/payment/refund] ${stage}`, {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
      ...extra,
    });
  };

  // ④ server 重讀訂單(app 層縱深;RPC G12/白名單仍是權威)。
  let order;
  try {
    order = await findOrderForRefund(parsed.orderId);
  } catch (error) {
    logError('訂單重讀失敗', error);
    return refundFailure('error', input, parsed.requestToken);
  }
  if (!order) return refundFailure('order_not_found', input, parsed.requestToken);
  // 確認碼 = 訂單號末 4 碼、server 端驗(Sean Q2=A;actor 是自報身分,這道是「你真的在退
  // 這一張」的人因閘,不是授權)。
  if (order.displayId.slice(-4) !== parsed.confirmCode) {
    return refundFailure('confirm_mismatch', input, parsed.requestToken);
  }
  // Q1=A refunded 硬擋(app 鏡像;RPC G12 = REFUND_LEDGER_FULL 是權威)。
  if (order.paymentStatus === 'refunded') {
    return refundFailure('already_refunded', input, parsed.requestToken);
  }
  const recTradeId = order.tappayRecTradeId;
  if (recTradeId === null || recTradeId.trim() === '') {
    return refundFailure('no_card_transaction', input, parsed.requestToken);
  }

  // ⑤ adapter(composition 是唯一取得管道;設定錯 = 具名 TapPayConfigError,
  //    「找管理者」與「稍後再試」是兩種完全不同的值班動作 —— N4 前置債)。
  let adapter;
  try {
    adapter = getTapPayAdapter();
  } catch (error) {
    logError('adapter 建構失敗', error);
    return refundFailure(
      error instanceof TapPayConfigError ? 'config' : 'error',
      input,
      parsed.requestToken,
    );
  }

  // ⑥ G0 baseline:Record 反查 + 斷言全套;任一不成立 → RPC 零呼叫(fail-closed)。
  //    🔴 自帶 ≤10s 逾時(RW2b 契約債:recordQuery 預設無逾時;慢回應會把 maxDuration 60s
  //    的餘額吃到不足 refund 的 30s,退款送出後才被平台砍在半路 = 自製 unknown-state)。
  let recordResult;
  try {
    recordResult = await adapter.recordQuery(
      { recTradeId },
      { signal: AbortSignal.timeout(REFUND_RECORD_QUERY_TIMEOUT_MS) },
    );
  } catch (error) {
    logError('Record 反查失敗', error);
    return refundFailure('record_unavailable', input, parsed.requestToken);
  }
  const baseline = checkRecordBaseline(recordResult, recTradeId, parsed.kind);
  if (!baseline.ok) {
    console.error('[admin/payment/refund] G0 baseline 不成立', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: baseline.code,
      detail: baseline.detail,
    });
    return refundFailure(baseline.code, input, parsed.requestToken);
  }

  // ⑦ RPC initiate(帳先記、後打 API;G3 凍結額:full=Record 剩餘額 / partial=員工輸入)。
  let initiated;
  try {
    // kind 判別分支逐欄具名(不 spread;互斥由 InitiateOrderRefundArgs 判別聯合在編譯期釘死)。
    initiated = await initiateOrderRefund(
      parsed.kind === 'partial'
        ? {
            orderId: parsed.orderId,
            kind: 'partial',
            amount: parsed.amount,
            recordAmount: null,
            recordRefundedBefore: baseline.refundedBefore,
            reason: parsed.reason,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          }
        : {
            orderId: parsed.orderId,
            kind: 'full',
            amount: null,
            recordAmount: baseline.recordAmount,
            recordRefundedBefore: baseline.refundedBefore,
            reason: parsed.reason,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          },
    );
  } catch (error) {
    revalidateOrderViews({
      orderId: parsed.orderId,
      returnTo,
      scope: 'refund',
      // 🔴 用 **HTTP x-request-id**、不是表單 token(code-reviewer must-fix 1):本檔 `:125-126`
      //    的紀律逐字寫「冪等鍵=表單 token ≠ HTTP x-request-id ⇒ 兩者都記才對得回稽核鏈」,
      //    而我原本讓同一個 `request_id` 欄在同一支 action 裡放兩種值 —— 事故當天拿
      //    x-request-id 撈整條鏈,revalidate 那行會撈不到。
      //    ⚠️ 本檔其餘 `requestId: parsed.requestToken` 是**送進 RPC 的冪等鍵**,那些是對的、不要一起改。
      requestId: httpRequestId,
    });
    if (error instanceof RefundCallerBugError) {
      logError('initiate 契約違反', error);
      return refundFailure('bug', input, parsed.requestToken);
    }
    // 🔴 transient(回應斷在路上):INSERT 可能已 commit。token 原樣帶回 ⇒ 員工用同一張
    //    表單重試會被 G4 認出(DUPLICATE 或全新 initiate),不會第二退。
    logError('initiate 失敗', error);
    return refundFailure('error', input, parsed.requestToken);
  }
  // 帳本自此可能有新列/新狀態 —— 之後所有 return 都要讓**兩個視圖**重取(契約 §5)。
  revalidateOrderViews({
    orderId: parsed.orderId,
    returnTo,
    scope: 'refund',
    requestId: httpRequestId,
  });

  let succeeded = false;

  if (initiated.result !== 'INITIATED') {
    switch (initiated.result) {
      case 'DUPLICATE_REQUEST':
        // 同 token 重播(G4 查驗過指紋)。confirmed=前次已完成 → 視同成功;
        // processing=前次還在路上(或已 crash)→ **不重打 refund()** —— 無從得知 wire
        // 發過沒有,fail-closed 交給 S5 卡住 + RW4 收拾,這正是查驗式冪等買到的安全。
        if (initiated.rowStatus === 'confirmed') {
          succeeded = true;
        } else {
          return refundFailure('in_flight', input, parsed.requestToken);
        }
        break;
      case 'REFUND_IN_FLIGHT':
        return refundFailure('in_flight', input, parsed.requestToken);
      case 'REFUND_LEDGER_FULL':
        return refundFailure('ledger_full', input, parsed.requestToken);
      case 'ORDER_NOT_FOUND':
        return refundFailure('order_not_found', input, parsed.requestToken);
      case 'ORDER_NOT_REFUNDABLE':
        return refundFailure('not_refundable', input, parsed.requestToken);
      case 'ORDER_NO_CARD_TRANSACTION':
        return refundFailure('no_card_transaction', input, parsed.requestToken);
      case 'REFUND_NOTHING_LEFT':
        return refundFailure('nothing_left', input, parsed.requestToken);
    }
  } else {
    // ⑧ 打 TapPay。payload 由 kind 分流(discriminated union;full 不帶 amount 欄=型別層保證)。
    //    🔴 不傳 request-scoped signal(員工關頁不該中止動錢中的呼叫;adapter 30s 上限恆在)。
    const payload: TapPayRefundPayload =
      parsed.kind === 'partial'
        ? {
            kind: 'partial',
            transactionId: recTradeId,
            amount: { amount: toMoneyAmount(initiated.refundAmount), currency: 'TWD' },
            bankRefundId: initiated.bankRefundId,
          }
        : { kind: 'full', transactionId: recTradeId, bankRefundId: initiated.bankRefundId };

    let refundResult: TapPayRefundResult;
    try {
      refundResult = await adapter.refund(payload);
    } catch (error) {
      if (error instanceof TapPayRefundNotSentError) {
        // 確定未送出(fetch 零呼叫)→ 結案 not_sent(→failed;錢沒動、token 已被終態消耗)。
        const outcome = await finalizeSafely(
          {
            refundId: initiated.refundId,
            outcome: 'not_sent',
            tappayRefundId: null,
            refundAmountWire: null,
            failedDetail: `TapPay pre-flight 拒絕:${clipCodepoints(error.message, 400)}`,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          },
          logError,
        );
        if (outcome === 'FINALIZED') {
          return refundFailure('not_sent', input, parsed.requestToken);
        }
        return refundFailure(
          outcome === 'THREW' ? 'finalize_failed' : 'bug',
          input,
          parsed.requestToken,
        );
      }
      // 🔴 unknown-state:**不 finalize**、列留 processing、不自動重發(§2 丙鐵律)。
      logError('refund unknown-state', error, { bank_refund_id: initiated.bankRefundId });
      return refundFailure('unknown_state', input, parsed.requestToken);
    }

    if (refundResult.status === 'accepted') {
      // ⑨ 立即 finalize(縮窗;refundId 證據與金額比對 G7 都在 RPC)。
      let outcome: FinalizeOrderRefundOutcome;
      try {
        outcome = await finalizeOrderRefund({
          refundId: initiated.refundId,
          outcome: 'accepted',
          tappayRefundId: refundResult.refundId,
          refundAmountWire: refundResult.refundAmount,
          failedDetail: null,
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        });
      } catch (error) {
        // 🔴 錢已受理、帳本卡 processing:唯一正確指示=勿重試、走 RW4(不分 bug/transient
        //    —— 兩者的值班動作相同,而「可重試」在這裡是災難)。
        logError('accepted 後 finalize 失敗', error, {
          bank_refund_id: initiated.bankRefundId,
          tappay_refund_id: refundResult.refundId,
        });
        return refundFailure('unknown_state', input, parsed.requestToken);
      }
      if (outcome.result === 'FINALIZED') {
        succeeded = true;
      } else if (outcome.result === 'HELD_AMOUNT_MISMATCH') {
        return refundFailure('held', input, parsed.requestToken);
      } else {
        logError('accepted 後 finalize 回 REFUND_NOT_FOUND', outcome);
        return refundFailure('bug', input, parsed.requestToken);
      }
    } else if (refundResult.status === 'deferred') {
      // 10024(僅 partial 可達):還不能做、零動錢、鍵已作廢 → deferred 終態、額度釋出。
      const outcome = await finalizeSafely(
        {
          refundId: initiated.refundId,
          outcome: 'deferred_not_captured',
          tappayRefundId: null,
          refundAmountWire: null,
          failedDetail: null,
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        },
        logError,
      );
      if (outcome === 'FINALIZED') return refundFailure('deferred', input, parsed.requestToken);
      return refundFailure(
        outcome === 'THREW' ? 'finalize_failed' : 'bug',
        input,
        parsed.requestToken,
      );
    } else if (refundResult.status === 'rejected') {
      // rejected(10051,僅 partial 可達):超額、零動錢 → failed;diagnostic 進 failed_detail。
      const outcome = await finalizeSafely(
        {
          refundId: initiated.refundId,
          outcome: 'rejected_out_of_range',
          tappayRefundId: null,
          refundAmountWire: null,
          failedDetail: clipCodepoints(`TapPay ${refundResult.wireStatus}:${refundResult.msg}`, 450),
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        },
        logError,
      );
      if (outcome === 'FINALIZED') return refundFailure('rejected', input, parsed.requestToken);
      return refundFailure(
        outcome === 'THREW' ? 'finalize_failed' : 'bug',
        input,
        parsed.requestToken,
      );
    } else {
      // 🔴 fail-closed 收口(關卡2 兩線同抓):resolved 卻不是三態之一 = adapter 合約漂移或
      //    畸形值(domain JSDoc 明寫未實證碼日後可能補結果態)。誤標成 rejected 會 finalize
      //    →failed、釋放 S5 額度、換新 token —— 若錢其實已動 = 打開雙退窗。
      //    「不明就是不動」:不 finalize、列留 processing 走 RW4。
      logError('refund 回傳非三態(合約漂移)', null, {
        resolved_status: String((refundResult as { status?: unknown }).status),
        bank_refund_id: initiated.bankRefundId,
      });
      return refundFailure('unknown_state', input, parsed.requestToken);
    }
  }

  if (!succeeded) {
    // 走到這裡=上面分支漏了 return(結構上不該發生);fail-closed 給 bug 而非誤導成功。
    return refundFailure('bug', input, parsed.requestToken);
  }

  // ⑩ 成功才 PRG。🔴 在一切 try 之外(redirect 拋 NEXT_REDIRECT,包進 try 會被 catch
  //    吞成失敗 state ⇒ 「錢退了、畫面卻說失敗」= 員工再退一次;A9d2-1 R2-3)。
  redirect(appendResultQuery(returnTo, `r=${REFUND_SUBMITTED_RESULT_CODE}`));
}

/**
 * 零動錢分支(not_sent / deferred / rejected)的 finalize 包裝:throw → 'THREW'
 * (呼叫端映 `finalize_failed`:列卡 processing 待 RW4,錢沒動);
 * 回非 FINALIZED 碼 → 原樣回傳(呼叫端映 bug)。
 * 🔴 accepted 分支**刻意不用本包裝** —— 它的 throw 語意是 unknown_state(錢已受理),
 *    兩者的員工指示不同,不得共用一條錯誤路。
 */
async function finalizeSafely(
  args: FinalizeOrderRefundArgs,
  logError: (stage: string, error: unknown, extra?: Record<string, unknown>) => void,
): Promise<'FINALIZED' | 'THREW' | 'UNEXPECTED'> {
  try {
    const outcome = await finalizeOrderRefund(args);
    if (outcome.result === 'FINALIZED') return 'FINALIZED';
    logError(`finalize(${args.outcome}) 回非預期碼`, outcome);
    return 'UNEXPECTED';
  } catch (error) {
    logError(`finalize(${args.outcome}) 失敗`, error);
    return 'THREW';
  }
}
