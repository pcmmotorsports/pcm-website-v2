'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import {
  ORDER_RETURN_TO_FIELD,
  appendResultQuery,
  parseOrderReturnTo,
} from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';
import { toTaipeiIso } from './procurement-view';
import {
  EMPTY_RECEIPT_VALUES,
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_INLINE_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RECEIPT_DUPLICATE_RESULT_CODE,
  RECEIPT_RECORDED_RESULT_CODE,
  receiptFailure,
  type ReceiptActionState,
} from './receipt-action-state';
import { carryBackReceiptValues, parseReceiptForm } from './receipt-form';
import {
  ReceiptCallerBugError,
  findDuplicateOutcome,
  findProcurementRemaining,
  listProcurementChoices,
  recordItemReceipt,
  type ItemProcurementChoice,
} from './receipt-repository';
import { findOrderIdForItem } from './procurement-repository';

// receipt-actions.ts — M-4b E10 #352-b:到貨登錄 server action。
//
// 🔴 **成功的 `redirect()` 必須在 try 之外**:`redirect()` 是拋 `NEXT_REDIRECT`,
//    包進 RPC 的 try 會被 catch 吞掉、把**已經成功的寫入**分類成 `error`
//    ⇒ 員工看到失敗訊息、但到貨已經記進去了。
//
// 🔴 **本檔沒有一行稽核 code** —— `admin_record_item_receipt` 在同交易寫 `admin_audit_log`。
//
// 🔴 **沒有 hydration 閘,這是判斷不是遺漏**:那道閘存在的理由是 A5a 是**全量 payload**
//    (未 hydrate 送出 = 用空白覆蓋既有欄)。本片是 append + 冪等鍵,而冪等鍵由 client 掛載時產生
//    ⇒ 未 hydrate 時 `request_id` 根本不存在、解析直接回 `invalid`,已經是 fail-closed。
//    再加一道只會多一個會壞的東西。

export async function recordItemReceiptAction(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  // ① 授權閘。🔴 絕對第一 —— 未授權者送爛表單要拿到 denied 而不是 invalid
  //    (否則等於對未授權者洩漏表單規則)。代價:denied 不保留輸入。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return receiptFailure('denied', null, EMPTY_RECEIPT_VALUES);
  }

  const carried = carryBackReceiptValues(formData);

  // 🔴 **`invalid` 也要帶 procurementId**(R2 must-fix ①):小視窗用
  //    `state.procurementId === procurementId` 決定要不要渲染橫幅,`null` 恆不等
  //    ⇒ 帶 null 回去 = 員工按下送出後**畫面完全沒有反應**,和沒送出去分不出來。
  //    可達路徑很平常:到貨時間欄清空 → 解析回 null → 就走這裡。
  //    ⚠️ 解析失敗時整份 FormData 都不可信,但這個 hidden 欄**只用來決定顯示在哪一份表單上**、
  //    不參與任何寫入決策 ⇒ 讀它是安全的(值壞掉最多是橫幅沒顯示,回到今天的行為)。
  const scopeId = readSingleString(formData, RCPT_PROCUREMENT_ID_FIELD);
  // 🔴 彈窗模式(E1):成功回 state 不 redirect。**fail-closed 判法** —— 只有明確送 `'1'` 才算,
  //    送兩份 / 缺欄一律當列表模式(走 redirect,那是既有且已審過的路)。
  const inline = readSingleString(formData, RCPT_INLINE_FIELD) === '1';

  const parsed = parseReceiptForm(formData);
  if (!parsed) {
    return receiptFailure('invalid', scopeId, carried);
  }

  const orderId = readSingleString(formData, RCPT_ORDER_ID_FIELD) ?? '';
  const orderItemId = readSingleString(formData, RCPT_ORDER_ITEM_ID_FIELD) ?? '';
  if (orderId === '' || orderItemId === '') {
    return receiptFailure('invalid', parsed.procurementId, carried);
  }

  // ② 品項歸屬驗證(同 A10b 關卡2 MF4 的理由):RPC 只認 `procurement_id`,
  //    而 `order_id` 是表單 hidden 欄 ⇒ 不驗的話會「從 A 單的表單寫進 B 單的品項」。
  //    🔴 fail-closed:查不到 / 對不起來 / 查詢本身炸掉,一律不寫。
  const requestId = await getRequestId();
  let ownerOrderId: string | null;
  try {
    ownerOrderId = await findOrderIdForItem(orderItemId);
  } catch (error) {
    console.error('[admin/orders/receipt] 品項歸屬查詢失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptFailure('error', parsed.procurementId, carried);
  }
  if (ownerOrderId === null || ownerOrderId !== orderId) {
    console.error('[admin/orders/receipt] 品項不屬於這張訂單,拒絕寫入', {
      request_id: requestId,
      form_order_id: orderId,
      owner_order_id: ownerOrderId,
      order_item_id: orderItemId,
    });
    return receiptFailure('bug', parsed.procurementId, carried);
  }

  const returnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), orderId);

  // 🔴 偏移在**這裡**補 Asia/Taipei(同 A5a `submittedAt` 的理由:瀏覽器換算會讓非台北裝置存錯時刻)。
  //    `toTaipeiIso` 對不合格式的輸入回空字串 —— 那不可以往下送(RPC 會拿到空字串)⇒ 當成沒填。
  const receivedAt = toTaipeiIso(parsed.receivedAtLocal);
  if (receivedAt === '') {
    return receiptFailure('RECEIVED_AT_REQUIRED', parsed.procurementId, carried);
  }

  // 🔴 log **不記備註內容**(只記有沒有填)—— 備註是內部營運資料,
  //    進了 Vercel log 就等於多一份不受 service_role 邊界保護的副本。
  console.info('[admin/orders/receipt] receipt.record.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: orderId,
    order_item_id: orderItemId,
    procurement_id: parsed.procurementId,
    quantity: parsed.quantity,
    surplus_quantity: parsed.surplusQuantity,
    has_note: parsed.note !== null,
  });

  let result: Awaited<ReturnType<typeof recordItemReceipt>>;
  try {
    result = await recordItemReceipt({
      procurementId: parsed.procurementId,
      quantity: parsed.quantity,
      surplusQuantity: parsed.surplusQuantity,
      receivedAt,
      note: parsed.note,
      actor: authorization.actorId,
      // 🔴 **表單帶來的一次性鍵,不是 `requestId`** —— 這支的 `p_request_id` 是冪等鍵。
      //    用每次請求的 HTTP request id 會讓重送變成新請求、員工手滑按兩次就記兩筆到貨。
      requestId: parsed.requestId,
    });
  } catch (error) {
    // 🔴 失敗路徑也要 revalidate:`bug` / `error` 都**可能已經寫進去了**
    //    (RPC 已 commit、回應斷在路上)⇒ 不重取的話員工會停在看不到那筆到貨的舊畫面。
    revalidateOrderViews({ orderId, returnTo, scope: 'procurement', requestId });
    if (error instanceof ReceiptCallerBugError) {
      console.error('[admin/orders/receipt] 呼叫端契約違反', {
        request_id: requestId,
        message: error.message.slice(0, 200),
      });
      return receiptFailure('bug', parsed.procurementId, carried);
    }
    console.error('[admin/orders/receipt] 到貨登錄失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptFailure('error', parsed.procurementId, carried);
  }

  // ③ 固定碼分派。
  if (result === 'RECORDED') {
    revalidateOrderViews({ orderId, returnTo, scope: 'procurement', requestId });
    if (inline) {
      return { status: 'recorded_inline', outcome: 'recorded', procurementId: parsed.procurementId };
    }
    redirect(appendResultQuery(returnTo, RECEIPT_RECORDED_RESULT_CODE));
  }

  if (result === 'DUPLICATE_REQUEST') {
    // 🔴 **不可以只回一個綠色的成功**(plan §5.1 / R3-nit4):RPC 對「先前登錄過、產物後來被刪」
    //    一樣回 `DUPLICATE_REQUEST` 且**不重新建立**(`20260811010000:181` 逐字)
    //    ⇒ 顯示成功會讓員工以為貨記在帳上,而帳面其實是空的。
    let outcome: Awaited<ReturnType<typeof findDuplicateOutcome>>;
    try {
      outcome = await findDuplicateOutcome(parsed.requestId);
    } catch (error) {
      console.error('[admin/orders/receipt] 冪等產物查詢失敗', {
        request_id: requestId,
        message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
      });
      outcome = 'unknown';
    }
    revalidateOrderViews({ orderId, returnTo, scope: 'procurement', requestId });
    if (inline && outcome === 'alive') {
      return { status: 'recorded_inline', outcome: 'duplicate', procurementId: parsed.procurementId };
    }
    if (outcome === 'deleted') {
      return receiptFailure('DUPLICATE_DELETED', parsed.procurementId, carried);
    }
    if (outcome === 'unknown') {
      return receiptFailure('DUPLICATE_UNKNOWN', parsed.procurementId, carried);
    }
    redirect(appendResultQuery(returnTo, RECEIPT_DUPLICATE_RESULT_CODE));
  }

  if (result === 'QUANTITY_EXCEEDS_ALLOCATED') {
    // 拆分建議(plan §5.1 / R3-nit1)。🔴 這個讀在 RPC 的鎖**之外**、只用來組訊息,
    //    不是守門 —— 守門在 RPC 裡。查不到就不給數字,不編一個。
    let detail: string | undefined;
    try {
      const remaining = await findProcurementRemaining(parsed.procurementId);
      const surplus = remaining === null ? 0 : parsed.quantity - remaining;
      // 🔴 `surplus > 0` 才給建議(R2 nit):`remaining` 是**鎖外**讀的,併發下可能比送出當下更大
      //    ⇒ 差額算出來會是 0 或負數,而訊息會白紙黑字寫「溢收填 **-1** 件」。
      //    算不出正數就不給數字 —— 基本訊息本身已經講得出該怎麼做。
      if (remaining !== null && remaining >= 0 && surplus > 0) {
        detail = `這筆採購還能登錄 ${remaining} 件 —— 建議「到貨」填 ${remaining} 件、「溢收」填 ${surplus} 件。`;
      }
    } catch {
      detail = undefined;
    }
    return receiptFailure('QUANTITY_EXCEEDS_ALLOCATED', parsed.procurementId, carried, detail);
  }

  return receiptFailure(result, parsed.procurementId, carried);
}

/**
 * 入口 2 用:抓某個品項的採購列供小視窗選擇(#352-b-2,主視窗裁 C 案)。
 *
 * 🔴 **閘的順序逐字沿用本檔的寫入路徑**,不因為「這只是讀」就放寬:
 *    ① 授權閘**絕對第一** ② 品項歸屬閘(不信任 client 送的 id)。
 *    這條路吐的是**供應商身分**(`service_role only` 的內部資料)⇒ 讀路徑同樣要證明
 *    「這個品項真的屬於這張單」,否則它就是一支「給我任意品項的供應商」的查詢。
 *
 * 回傳 `null` = 拒絕或失敗;呼叫端一律當「抓不到」處理並顯示可操作的文案,
 * **不得**把 null 當成「這個品項沒有採購列」(那兩件事員工的下一步完全不同)。
 */
export async function fetchItemProcurementChoices(
  orderId: string,
  orderItemId: string,
): Promise<ItemProcurementChoice[] | null> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) return null;

  const requestId = await getRequestId();
  try {
    const ownerOrderId = await findOrderIdForItem(orderItemId);
    if (ownerOrderId === null || ownerOrderId !== orderId) {
      console.error('[admin/orders/receipt] 品項不屬於這張訂單,拒絕回傳採購列', {
        request_id: requestId,
        form_order_id: orderId,
        owner_order_id: ownerOrderId,
        order_item_id: orderItemId,
      });
      return null;
    }
    return await listProcurementChoices(orderItemId);
  } catch (error) {
    console.error('[admin/orders/receipt] 採購列查詢失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return null;
  }
}
