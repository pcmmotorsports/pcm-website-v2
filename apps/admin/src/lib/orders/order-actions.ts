'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminOrderRepository } from './order-repository';
import { parseWorkflowPatchForm } from './workflow-form';
import { appendResultQuery } from './order-return-to';

// M-4a Slice C 後台改單 server action(D-2 起只映射 shipping_method / 發票紀錄三欄=4 欄;
// order 層 workflow_status 寫入面已收窄=送該 key 即 RAISE、20260716130000 §4)。
//
// 🔴 **M-4b E10 A9w4a(2026-08-06;母 plan `2026-07-28-e10-order-closure-master-plan-v2.md` row 53)**:
//    `updateOrderItemWorkflowAction`(per-item 九碼寫入 server action)**已具名移除** ——
//    前置 A11a-1 拆掉列表最後一個消費端後,本檔已無任何九碼寫入面。
//    ⚠️ **正確讀法 = 「admin 應用層沒有這支 action」,不是「九碼寫不進去」**:
//    port/adapter 的 `updateAdminOrderItemWorkflow` **已於 A9w4c 後半(2026-08-06)一併移除**;
//    **仍在的只剩 DB 端** `admin_update_order_item_workflow` RPC 本身(**REVOKE 非 DROP**);
//    其 EXECUTE 權由 **A9v `20260807120000`** 撤除,**apply 後 service_role 叫不動**。
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
//
// 🔴🔴 **本 action 刻意不檢查「這張單還活著嗎」—— Sean 2026-08-15 拍板,不是漏做。**
//    (`Q-13-2 = 丙`、`Q-13-3 = 乙`;完整矩陣與理由見
//     `docs/specs/2026-08-15-e10-13-order-edit-matrix-order-level.md` §3-4。)
//    **已取消 / 已退款 / 已出貨的單,四欄一律可改**:取消的單**可能正需要作廢發票**;
//    已出貨的單**可能要補登真實走的物流**。⇒ **鎖掉會讓員工無路可走、或被迫留假紀錄。**
//
// ⚠️ **要加閘的人會加在這裡,所以這段寫在這裡** —— 而**不是**寫在 RPC 那一側:
//    `20260714130000_m4a_admin_update_order_workflow_rpc.sql` **已 apply**
//    (`supabase/APPLIED.tsv` 有列、釘 sha256)⇒ **連註解都不能動**
//    (規則出處 `docs/runbooks/night-run-command-playbook.md:85`)。
//    🔴 **更正要寫進下一個人會讀的載體,而那個載體不一定是原檔。**
//
// 🔴 **這段註解存在的理由**:拍板之前,「沒有人決定過要不要擋」與「決定了不擋」
//    **在程式碼裡長得一模一樣**(兩者都是「這裡沒有那個 if」)—— 而現在它是後者。

type ResultCode = 'saved' | 'conflict' | 'noop' | 'invalid' | 'denied' | 'error';

/**
 * 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 `parseOrderReturnTo` 限定站內 /orders 路徑)。
 * 🔴 #350d:接法(`?` vs `&`)改走共用的 `appendResultQuery` —— 五支 action 各拼一份的話,
 *    面板網址(本來就帶 query)那一半只要有一支寫成 `?` 就會把整串篩選蓋掉。
 */
function redirectWith(returnTo: string, code: ResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
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
