'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminOrderRepository } from './order-repository';
import { parseWorkflowPatchForm, parseItemWorkflowForm } from './workflow-form';

// M-4a Slice C 後台改單 server action(D-2 起只映射 shipping_method / 發票紀錄三欄=4 欄;
// workflow_status 寫入面移 item 層 updateOrderItemWorkflowAction,order 層 RPC 白名單已同步收窄
// =送該 key 即 RAISE、20260716130000 §4)。
//
// 🔴 安全縱深(不只靠 proxy 登入閘;verdict must-fix 2/3):
//   ① verifySession(cookie) 自驗——admin session 票證無效 → 拒(裸 Route Handler 不吃 Next 內建、
//      Server Action 雖有 Origin 內建但仍顯式驗,雙保險);
//   ② Origin fail-closed——缺 Origin 即拒 + 精確等值(dev 走 ADMIN_DEV_BYPASS localhost allowlist);
//   ③ actor 具名身分——picker cookie 解析(缺=拒;actor 只標「我是誰」、非授權,授權在 ①);
//   ④ 寫入走 owner RPC(admin_update_order_workflow;orders 對 service_role 已 REVOKE 直寫),
//      RPC 內樂觀鎖 + 同交易寫 admin_audit_log(稽核在 RPC、action 不另接;actor 傳入)。
//   ⑤ PRG:結果碼 → revalidate + redirect 帶固定 query(?r=saved/conflict/noop/invalid/denied/error);
//      DB error 不外洩瀏覽器、server log 留 request_id;redirect 不包在吞它的 catch。

type ResultCode = 'saved' | 'conflict' | 'noop' | 'invalid' | 'denied' | 'error';

/** 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /orders 路徑)。 */
function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

// 共用授權閘 authorizeAdminMutation:M-4a 儲值金編輯片起搬至 ../session/authorize.ts
// (orders / customers 兩域共用;行為零變更、原封搬移)。

export async function updateOrderWorkflowAction(formData: FormData): Promise<void> {
  // ①②③ 授權閘(session/Origin/actor;共用 helper、語意同 Slice C 原三段)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/orders', 'denied');
  }

  // 表單 → patch(形狀層;語意權威在 RPC)。
  const parsed = parseWorkflowPatchForm(formData);
  if (!parsed.ok) {
    redirectWith('/orders', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log(Fable nit-2):僅識別欄位、不記 patch 內容/發票號碼。
  console.info('[admin/orders] order.workflow.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId, order_id: parsed.orderId,
  });

  let code: ResultCode;
  try {
    const result = await getAdminOrderRepository().updateAdminOrderWorkflow(
      parsed.orderId,
      parsed.expectedVersion,
      parsed.patch,
      auth.actorId,
      requestId,
    );
    code = result === 'UPDATED' ? 'saved' : result === 'CONFLICT' ? 'conflict' : 'noop';
  } catch (err) {
    // DB error / RPC 輸入 RAISE(未知 code / 非法金額等)→ 固定碼、不外洩;server log 只留摘要
    // (不印整個 err 物件:轉型錯誤可能回顯輸入值 / 發票號碼;Fable nit-7)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/orders] 改單失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // 成功路徑 revalidate(列表 + 明細);redirect 在 catch 外(不被吞)。
  revalidatePath('/orders');
  revalidatePath(`/orders/${parsed.orderId}`);
  redirectWith(parsed.returnTo, code);
}

/**
 * per-item 改狀態 server action(M-4a Slice D-2;鏡像上方 order 層 action、單欄 workflow_status)。
 * 寫入走 admin_update_order_item_workflow owner RPC(order_items 對 service_role 已 REVOKE 直寫;
 * RPC 內樂觀鎖+同交易 audit target='order_item:<id>');安全縱深①②③同 order 層(共用授權閘)。
 */
export async function updateOrderItemWorkflowAction(formData: FormData): Promise<void> {
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/orders', 'denied');
  }

  const parsed = parseItemWorkflowForm(formData);
  if (!parsed.ok) {
    redirectWith('/orders', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:僅識別欄位(item id;狀態 code 非敏感但循 order 層慣例不記內容)。
  console.info('[admin/orders] order_item.workflow.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId, item_id: parsed.itemId,
  });

  let code: ResultCode;
  try {
    const result = await getAdminOrderRepository().updateAdminOrderItemWorkflow(
      parsed.itemId,
      parsed.expectedVersion,
      parsed.workflowStatus,
      auth.actorId,
      requestId,
    );
    code = result === 'UPDATED' ? 'saved' : result === 'CONFLICT' ? 'conflict' : 'noop';
  } catch (err) {
    // DB error / RPC 輸入 RAISE(未知 code 等)→ 固定碼、不外洩;server log 只留摘要(同 order 層)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/orders] per-item 改狀態失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // revalidate:列表必刷;明細頁靠 returnTo 判斷(item 表單可能來自 /orders 或 /orders/<orderId>)。
  revalidatePath('/orders');
  const returnPath = parsed.returnTo.split('?')[0] ?? parsed.returnTo;
  if (returnPath.startsWith('/orders/')) {
    revalidatePath(returnPath);
  }
  redirectWith(parsed.returnTo, code);
}
