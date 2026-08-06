'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { parseProcurementForm } from './procurement-form';
import {
  EMPTY_PROCUREMENT_VALUES,
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
  PROC_ALLOCATED_FIELD,
  PROC_CONTACT_CHANNEL_FIELD,
  PROC_EXCEPTION_REASON_FIELD,
  PROC_EXPECTED_ARRIVAL_FIELD,
  PROC_HYDRATED_FIELD,
  PROC_REPLY_STATUS_FIELD,
  PROC_STALE_FIELD,
  PROC_SUBMITTED_AT_LOCAL_FIELD,
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
  procurementFailure,
  type ProcurementActionState,
  type ProcurementFormValues,
} from './procurement-action-state';
import {
  ProcurementCallerBugError,
  findOrderIdForItem,
  upsertItemProcurement,
  type ProcurementResultCode,
} from './procurement-repository';
import { classifyResult } from './procurement-result';
import { toTaipeiIso } from './procurement-view';

// M-4b E10 A10b:採購 upsert server action。
//
// 🔴 **失敗回 state / 成功才 redirect**(沿用備註線 Q1=A 的形狀;理由見 procurement-action-state.ts 檔頭)。
//
// 🔴 **成功的 `redirect()` 必須在 try 之外**:`redirect()` 是**拋 NEXT_REDIRECT**,
//    包進 RPC 的 try 會被 catch 吞掉、把**已經成功的寫入**分類成 `error`
//    ⇒ 員工看到失敗訊息、但採購已經寫進去了(A9d2-1 關卡1 Fable R2-3 的同一條)。
//
// 🔴 **本檔沒有一行稽核 code** —— `admin_upsert_item_procurement` 在同交易寫 `admin_audit_log`。

const ORDERS_PATH = '/orders';

function detailPath(orderId: string): string {
  return `${ORDERS_PATH}/${orderId}`;
}

// A9h-1(2026-08-06):`classifyResult` 已抽到 `./procurement-result` —— A9h 批次 coordinator
// 要用同一套語意,兩份 switch 會在加碼時漂移(症狀=同一個碼在單列失敗、在批次成功)。
// 本檔的呼叫點字面未動。

/** 三個成功碼各自的 PRG 結果碼(員工要看得出「有沒有真的改到東西」)。 */
function successResultCode(code: 'CREATED' | 'UPDATED' | 'NO_CHANGE'): string {
  switch (code) {
    case 'CREATED':
      return PROCUREMENT_CREATED_RESULT_CODE;
    case 'UPDATED':
      return PROCUREMENT_UPDATED_RESULT_CODE;
    case 'NO_CHANGE':
      return PROCUREMENT_NO_CHANGE_RESULT_CODE;
  }
}

/** 失敗時要帶回的員工輸入。解析失敗時也要盡量帶回,否則他打的整份會不見。 */
function carryBack(formData: FormData): ProcurementFormValues {
  const read = (field: string): string => {
    const raw = formData.get(field);
    return typeof raw === 'string' ? raw : '';
  };
  return {
    supplierId: read(PROC_SUPPLIER_ID_FIELD),
    allocatedQuantity: read(PROC_ALLOCATED_FIELD),
    replyStatus: read(PROC_REPLY_STATUS_FIELD),
    contactChannel: read(PROC_CONTACT_CHANNEL_FIELD),
    // 🔴 帶回的是**可見欄的本地字面**(datetime-local 的原值),不是換算後的 hidden ——
    //    帶回 ISO 會讓瀏覽器把 datetime-local 顯示成空白(格式不合)= 員工的輸入還是不見了。
    submittedAtLocal: read(PROC_SUBMITTED_AT_LOCAL_FIELD),
    supplierOrderNo: read(PROC_SUPPLIER_ORDER_NO_FIELD),
    exceptionReason: read(PROC_EXCEPTION_REASON_FIELD),
    expectedArrivalDate: read(PROC_EXPECTED_ARRIVAL_FIELD),
  };
}

export async function upsertItemProcurementAction(
  _prev: ProcurementActionState,
  formData: FormData,
): Promise<ProcurementActionState> {
  // ① 授權閘。🔴 **絕對第一,連讀一個欄位都在它之後** —— 未授權者送爛表單要拿到 denied
  //    而不是 invalid(否則等於對未授權者洩漏表單規則)。
  //    🔴 代價同 A9d2-1:`denied` 因此**不保留輸入**(拿不到值就回不了);理由 = denied 意謂 session
  //    已失效,他下一步一定要重新登入,留著的內容在那之後也接不回去。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return procurementFailure('denied', null, EMPTY_PROCUREMENT_VALUES);
  }

  const carried = carryBack(formData);

  // ② hydration 閘 + 截斷閘(A9a-2 MF1 的下游義務)。
  //    🔴 讀模型若回報「這個品項的採購清單可能不完整」,表單的 hydrate 就不可信,
  //    而 A5a 是**全量 payload** ⇒ 照送 = 用不完整的內容覆蓋既有事實。
  //    🔴 這是**縱深、不是唯一防線**:表單在 truncated 時本來就不該渲染出送出鈕
  //    (`item-procurement-form.tsx`),這裡擋的是「畫面渲染後才被改掉的 DOM / 直接打 action」。
  //    ⚠️ 誠實:旗標由表單自己帶,繞過畫面者可以不帶 ⇒ 本閘擋的是誠實路徑上的意外,
  //    不是惡意繞過(真正的 fail-closed 在 RPC 那層的各項固定碼)。
  // 🔴 hydration 閘(關卡2 code-reviewer Critical)—— **排在截斷閘之前**:
  //    未 hydrate 時 `hydrateFormValues` 沒跑過,整份表單的值都不可信,
  //    連「這個品項是不是真的被截斷」都還沒被畫面算出來 ⇒ 先擋這一層。
  //    fail-closed:**沒帶旗標也擋**(舊快取的 HTML / 直接打 action 都算)。
  if (formData.get(PROC_HYDRATED_FIELD) !== '1') {
    const parsedForHydration = parseProcurementForm(formData);
    return procurementFailure('not_hydrated', parsedForHydration.orderItemId, carried);
  }

  const staleRaw = formData.get(PROC_STALE_FIELD);
  if (staleRaw === '1') {
    const parsedForStale = parseProcurementForm(formData);
    return procurementFailure('stale', parsedForStale.orderItemId, carried);
  }

  // ③ 解析。
  const parsed = parseProcurementForm(formData);
  if (!parsed.ok) {
    return procurementFailure('invalid', parsed.orderItemId, carried);
  }

  const requestId = await getRequestId();
  // 🔴 log **不記三個文字欄的內容**(只記有沒有填)—— 供應商單號與異常原因是內部營運資料,
  //    進了 Vercel log 就等於多一份不受 service_role 邊界保護的副本。
  console.info('[admin/orders/procurement] procurement.upsert.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    order_item_id: parsed.orderItemId,
    supplier_id: parsed.supplierId,
    allocated_quantity: parsed.allocatedQuantity,
    reply_status: parsed.replyStatus,
    has_contact_channel: parsed.contactChannel !== null,
    has_supplier_order_no: parsed.supplierOrderNo !== null,
    has_exception_reason: parsed.exceptionReason !== null,
  });

  // ④ 品項歸屬驗證(關卡2 codex R2 MF4):RPC 只認 `order_item_id`,而 `order_id` 是表單 hidden 欄
  //    ⇒ 不驗的話會「從 A 單的表單寫進 B 單的品項」,畫面還跳回 A 單。
  //    🔴 fail-closed:查不到 / 對不起來 / 查詢本身炸掉,一律不寫。
  let ownerOrderId: string | null;
  try {
    ownerOrderId = await findOrderIdForItem(parsed.orderItemId);
  } catch (error) {
    console.error('[admin/orders/procurement] 品項歸屬查詢失敗', {
      request_id: requestId,
      message: String((error as { message?: unknown })?.message ?? '').slice(0, 200),
    });
    return procurementFailure('error', parsed.orderItemId, carried);
  }
  if (ownerOrderId === null) {
    return procurementFailure('ORDER_ITEM_NOT_FOUND', parsed.orderItemId, carried);
  }
  if (ownerOrderId !== parsed.orderId) {
    console.error('[admin/orders/procurement] 品項不屬於這張訂單,拒絕寫入', {
      request_id: requestId,
      form_order_id: parsed.orderId,
      owner_order_id: ownerOrderId,
      order_item_id: parsed.orderItemId,
    });
    return procurementFailure('bug', parsed.orderItemId, carried);
  }

  // ⑤ 寫入。
  let result: ProcurementResultCode;
  try {
    result = await upsertItemProcurement({
      orderItemId: parsed.orderItemId,
      supplierId: parsed.supplierId,
      allocatedQuantity: parsed.allocatedQuantity,
      replyStatus: parsed.replyStatus,
      contactChannel: parsed.contactChannel,
      // 🔴 偏移在**這裡**補 Asia/Taipei(A5a 契約 `20260803160000:475-476`);
      //    解析器收的是無偏移的台北牆上時間,瀏覽器不做換算(裝置時區會寫錯時刻)。
      submittedAt: parsed.submittedAtLocal === null ? null : toTaipeiIso(parsed.submittedAtLocal),
      supplierOrderNo: parsed.supplierOrderNo,
      exceptionReason: parsed.exceptionReason,
      expectedArrivalDate: parsed.expectedArrivalDate,
      actor: authorization.actorId,
      requestId,
    });
  } catch (error) {
    // 🔴 失敗路徑也要 revalidate:`bug` / `error` 兩支都**可能已經寫進去了**
    //    (RPC 已 commit、回應斷在路上)⇒ 不重取的話員工會停在看不到那筆採購的舊畫面。
    revalidatePath(detailPath(parsed.orderId));
    if (error instanceof ProcurementCallerBugError) {
      console.error('[admin/orders/procurement] 呼叫端契約違反', {
        request_id: requestId,
        message: error.message.slice(0, 200),
      });
      return procurementFailure('bug', parsed.orderItemId, carried);
    }
    // 🔴 只記 code 與 message 前 200 字 —— **不得**記 `details` / `hint`:
    //    PG 23514 的 DETAIL 會帶整列內容 = 供應商單號與異常原因全文進 log。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error('[admin/orders/procurement] 採購寫入失敗', {
      request_id: requestId,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
    });
    return procurementFailure('error', parsed.orderItemId, carried);
  }

  revalidatePath(detailPath(parsed.orderId));

  const failure = classifyResult(result);
  if (failure) return procurementFailure(failure, parsed.orderItemId, carried);

  // ⑥ 成功才 PRG。🔴 在 try 之外(見檔頭)。
  redirect(
    `${detailPath(parsed.orderId)}?r=${successResultCode(
      result as 'CREATED' | 'UPDATED' | 'NO_CHANGE',
    )}`,
  );
}
