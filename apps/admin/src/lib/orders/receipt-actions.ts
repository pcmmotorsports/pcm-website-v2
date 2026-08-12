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
  RCPT_REQUEST_ID_FIELD,
  RECEIPT_DUPLICATE_RESULT_CODE,
  RECEIPT_RECORDED_RESULT_CODE,
  receiptFailure,
  receiptUndoFailure,
  type ReceiptActionState,
  type ReceiptUndoState,
} from './receipt-action-state';
import { carryBackReceiptValues, parseReceiptForm } from './receipt-form';
import {
  ReceiptCallerBugError,
  deleteItemReceipt,
  findDuplicateOutcome,
  findProcurementRemaining,
  findOrderItemIdForReceipt,
  findReceiptIdByRequestId,
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
    // 🔴 **補上 `r=`**(#15-B2-b2 R2 MF1 root-cause 式跨檔修):頁層讀的是 `r` 參數,
    //    這裡原本直接接裸碼 ⇒ 產出 `?receipt_recorded` ⇒ `result-banner.tsx` 那則
    //    **今天在正式站永遠讀不到**。同族另三支(退款/採購/取消)都逐字寫 `r=`。
    redirect(appendResultQuery(returnTo, `r=${RECEIPT_RECORDED_RESULT_CODE}`));
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
    redirect(appendResultQuery(returnTo, `r=${RECEIPT_DUPLICATE_RESULT_CODE}`));
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
 * 撤銷**剛剛登錄的那一筆**到貨(「改軟」線片 1;Sean 逐字「登入到貨也要可以取消」)。
 *
 * 🔴 **只撤得掉「這個表單這次登錄的那筆」,不是任意一筆** —— 逐筆到貨沒有被投影到讀模型
 *    (`mappers/order-procurement.ts:16-20`)⇒ 畫面上沒有 receipt id 可拿,唯一的來源是
 *    表單手上那把已消費的冪等鍵。**事後才發現記錯**(Sean 另一句「其實要先給另外一個訂單」)
 *    **本片不覆蓋**,那要等逐筆列表(主視窗記帳中,我不自行編號)。
 *
 * 🔴 閘的順序沿用本檔寫入路徑:①授權**絕對第一** ②品項歸屬(不信任 client 送的 id)。
 *    撤銷會動 `instock` ⇒ 它是寫入路徑,不因為「只是刪一筆」而放寬。
 * 🔴 **歸屬是兩道、不是一道**(主視窗裁,鐵則 12② 權限面不降級):
 *    ①`order_item ↔ order`:表單送來的品項真的屬於這張單(擋 client 亂送 order/item)
 *    ②`receipt ↔ order_item`:**被刪的那筆**真的掛在這個品項底下 —— receipt id 是由
 *      client 送來的冪等鍵反查出來的,少了這道就沒有任何 code 在管中間那一段。
 *    ⚠️ 上一版只有 ①,並在註解裡宣稱「同登錄路徑的歸屬閘」—— 那是**量錯東西**:
 *    當時真正撐住的是「冪等鍵猜不到 + 有 SSO」這兩個**本檔管不到的外部條件**,
 *    它們哪天變了不會有任何一格轉紅。現在兩道都由本檔自己證,不再依賴那兩個條件。
 */
export async function undoItemReceiptAction(
  _prev: ReceiptUndoState,
  formData: FormData,
): Promise<ReceiptUndoState> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) return receiptUndoFailure('denied');

  const orderId = readSingleString(formData, RCPT_ORDER_ID_FIELD) ?? '';
  const orderItemId = readSingleString(formData, RCPT_ORDER_ITEM_ID_FIELD) ?? '';
  const consumedKey = readSingleString(formData, RCPT_REQUEST_ID_FIELD) ?? '';
  if (orderId === '' || orderItemId === '' || consumedKey === '') return receiptUndoFailure('bug');

  const requestId = await getRequestId();

  let ownerOrderId: string | null;
  try {
    ownerOrderId = await findOrderIdForItem(orderItemId);
  } catch (error) {
    console.error('[admin/orders/receipt] 撤銷前品項歸屬查詢失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptUndoFailure('error');
  }
  if (ownerOrderId === null || ownerOrderId !== orderId) {
    console.error('[admin/orders/receipt] 品項不屬於這張訂單,拒絕撤銷', {
      request_id: requestId,
      form_order_id: orderId,
      owner_order_id: ownerOrderId,
      order_item_id: orderItemId,
    });
    return receiptUndoFailure('bug');
  }

  const returnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), orderId);

  // 🔴 由冪等鍵反查 receipt id。查無 = 那把鍵從來沒登錄成功過 ⇒ 沒有東西可撤,
  //    當 `bug`(呼叫端拿了不存在的鍵)而不是 `already_gone`(那會謊稱「本來有、現在沒了」)。
  let receiptId: string | null;
  try {
    receiptId = await findReceiptIdByRequestId(consumedKey);
  } catch (error) {
    console.error('[admin/orders/receipt] 冪等帳反查失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptUndoFailure('error');
  }
  if (receiptId === null) {
    console.error('[admin/orders/receipt] 撤銷用的冪等鍵查無產物', { request_id: requestId });
    return receiptUndoFailure('bug');
  }

  // 🔴🔴 **交叉檢查:那筆 receipt 真的掛在這個品項底下嗎**(主視窗裁,鐵則 12② 不降級)。
  //    上面那道歸屬閘只證「表單送來的 item 屬於這張單」,證不到「被刪的那筆屬於這個 item」——
  //    receipt id 是**冪等鍵反查**來的,鍵是 client 送的。少了這一道,防護就只剩
  //    「鍵猜不到 + 有 SSO」這兩個**這段 code 管不到的外部條件**,而且它們哪天破了不會有任何一格轉紅。
  //    🔴 fail-closed:查不到 / 對不起來 / 查詢本身炸掉,一律不刪(與登錄路徑同一個立場)。
  let receiptOwnerItemId: string | null;
  try {
    receiptOwnerItemId = await findOrderItemIdForReceipt(receiptId);
  } catch (error) {
    console.error('[admin/orders/receipt] 撤銷目標歸屬查詢失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptUndoFailure('error');
  }
  if (receiptOwnerItemId === null || receiptOwnerItemId !== orderItemId) {
    console.error('[admin/orders/receipt] 撤銷目標不屬於這個品項,拒絕刪除', {
      request_id: requestId,
      form_order_item_id: orderItemId,
      receipt_owner_item_id: receiptOwnerItemId,
    });
    return receiptUndoFailure('bug');
  }

  console.info('[admin/orders/receipt] receipt.undo.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: orderId,
    order_item_id: orderItemId,
  });

  let outcome: Awaited<ReturnType<typeof deleteItemReceipt>>;
  try {
    // 🔴 這支的 `p_request_id` **不是冪等鍵**(`20260810233000:283` 逐字)⇒ 給 HTTP request id
    //    做稽核關聯即可;沿用表單那把一次性鍵反而會讓稽核指向錯的請求。
    outcome = await deleteItemReceipt({
      receiptId,
      actor: authorization.actorId,
      requestId,
    });
  } catch (error) {
    // 🔴 失敗也要 revalidate:`error` 涵蓋「RPC 已 commit、回應斷在路上」⇒ 不重取的話
    //    員工會停在一個「撤銷失敗」但數字其實已經變了的畫面。
    revalidateOrderViews({ orderId, returnTo, scope: 'procurement', requestId });
    if (error instanceof ReceiptCallerBugError) {
      console.error('[admin/orders/receipt] 撤銷:呼叫端契約違反', {
        request_id: requestId,
        message: error.message.slice(0, 200),
      });
      return receiptUndoFailure('bug');
    }
    console.error('[admin/orders/receipt] 撤銷失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return receiptUndoFailure('error');
  }

  revalidateOrderViews({ orderId, returnTo, scope: 'procurement', requestId });

  // 🔴 **業務拒絕原文往上帶,不改寫**(`receipt-repository.ts` 檔頭交辦):DB 訊息已寫成白話,
  //    還逐箱列出未出貨的包裹編號與件數 + 出路。壓成「刪不掉」等於把員工唯一能照做的資訊丟掉。
  if (outcome.kind === 'blocked') return { status: 'blocked', message: outcome.message };
  if (outcome.code === 'DELETED') return { status: 'undone' };
  return { status: 'already_gone' };
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
