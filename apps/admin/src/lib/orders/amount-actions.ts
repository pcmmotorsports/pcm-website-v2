'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminOrderRepository } from './order-repository';
import { parseAmountForm } from './amount-form';
import { appendResultQuery } from './order-return-to';

// amount-actions.ts — 後台「改品項金額」server action(M-4b E10 #13 片1c-1)。
//
// 🔴 安全縱深五條:形狀與理由**逐條抄 `order-actions.ts:24-31`**,不是重新發明:
//   ① verifySession(cookie)自驗;② Origin fail-closed;③ actor 具名身分(只標「我是誰」、非授權);
//   ④ 寫入走 owner RPC `admin_update_order_item_amount`(orders 對 service_role 已 REVOKE 直寫),
//      RPC 內鎖列 + 樂觀鎖 + 同交易寫 admin_audit_log(稽核在 RPC、action 不另接);
//   ⑤ PRG:結果碼 → revalidate + redirect 帶固定 query;DB error 不外洩瀏覽器、server log 留 request_id。
//
// ⚠️ **本片(1c-1)不含畫面** —— 表單元件與掛載點在 1c-2(後台介面正由 OD 改版,先做不會白做的那半)。
//    ⇒ 本檔目前**零 consumer**,那是預期狀態、不是漏接。

type ResultCode = 'saved' | 'conflict' | 'noop' | 'invalid' | 'denied' | 'error';

function redirectWith(returnTo: string, code: ResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
}

/**
 * 改品項金額。
 *
 * 🔴🔴 **成功碼是 `'OK'`,不是 `'UPDATED'`** —— 這是本片的**第一個驗收條款**(plan §10-4 陷阱①)。
 * 相鄰的 `updateOrderWorkflowAction` 逐字寫的是
 * `result === 'UPDATED' ? 'saved' : result === 'CONFLICT' ? 'conflict' : 'noop'`,
 * **照抄過來會讓本 RPC 的 `'OK'` 掉進最後那個 `: 'noop'`**
 * ⇒ **金額真的改了、稽核也寫了,而員工看到「無變更」,且不會有任何東西紅。**
 * ⇒ 這裡用**顯式三分支 + `default` fail-closed**,並在 `amount-actions.test.ts` 釘一格
 * 「`'OK'` ⇒ `saved`」。**那格沒過不准 commit。**
 *
 * ⚠️ **已知限度(不是漏做,是這套結果碼的能力上限;plan §10-3)**:
 * RPC 有 16 種 `RAISE`,其中 `pcm_e13_no_edit_after_payment`(這張單已收過款)與
 * `pcm_e13_discount_not_supported`(這張單有折扣)是**正當的業務拒絕**,
 * RPC 刻意寫了給員工看的中文(含「需要調整請走退款流程」)。
 * 而這六碼**沒有「業務拒絕」這一類** ⇒ 它們一律變成 `error`,那兩句中文到不了畫面。
 * 🔴 要分辨它們,前提是「`USING ERRCODE` / CONSTRAINT 名會不會出現在 supabase-js 的 `error.code`」——
 * **那件事還沒有人實測過**(Sean 2026-08-15 已批准做一次驗證,尚未執行;repo 內零前例可抄)。
 * ⇒ **在測出來之前不寫任何 mapping** —— 猜一個 code 去分流,錯了會把「已收款不能改」講成別的意思。
 */
export async function updateOrderItemAmountAction(formData: FormData): Promise<void> {
  // ①②③ 授權閘(session / Origin / actor;共用 helper,與其他 order action 同一支)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/orders', 'denied');
  }

  // 表單 → patch(形狀層 + 員工手滑層;語意權威在 RPC)。
  const parsed = parseAmountForm(formData);
  if (!parsed.ok) {
    redirectWith('/orders', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:🔴 **只記識別欄位,不記金額本身**(同 `order-actions.ts` 不記 patch 內容的理由)。
  console.info('[admin/orders] order.item.amount.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId, order_id: parsed.orderId,
  });

  let code: ResultCode;
  try {
    const result = await getAdminOrderRepository().updateAdminOrderItemAmount(
      parsed.orderId,
      parsed.expectedVersion,
      parsed.patch,
      auth.actorId,
      requestId,
    );
    // 🔴 顯式三分支;**不用三元式串接**,也不留「其餘 ⇒ noop」那種兜底。
    switch (result) {
      case 'OK':
        code = 'saved';
        break;
      case 'CONFLICT':
        code = 'conflict';
        break;
      case 'NOOP':
        code = 'noop';
        break;
      default: {
        // 🔴 fail-closed:回了預期外的碼 ⇒ 當成錯誤,**不當成成功也不當成無變更**。
        //    (adapter 已先收斂一次;這裡是第二層,因為「猜錯方向」的代價是報告說謊。)
        const exhaustive: never = result;
        throw new Error(`admin_update_order_item_amount 回傳非預期碼:${String(exhaustive)}`);
      }
    }
  } catch (err) {
    // RPC 的 16 種 RAISE 全部走這裡(見上方「已知限度」)。
    //
    // 🔴 **不記 `message`,連截短的都不記**(2026-08-15 codex 關卡2 R1 must-fix 2)。
    //    相鄰的 `order-actions.ts` 記 `message.slice(0, 200)`,而本片**不能照抄**:
    //    RPC `:372` 逐字把**收到的原因字串內插進訊息**(`'…不得帶「零元原因」(收到:%)'`),
    //    而那個字串是員工打的字、可能含客人資訊。
    //    ⚠️ **截短不是脫敏** —— 前 200 字正好是訊息開頭,想藏的東西就在那裡。
    //    ⇒ 只留 `code` + `request_id`:出事要查細節,走 `admin_audit_log`(RPC 同交易寫,有 request_id 可對)。
    const e = err as { code?: unknown };
    console.error('[admin/orders] 改品項金額失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // 成功路徑 revalidate;🔴 redirect 在 catch **外**(它是用 throw 實作的,包進 try 會被自己的 catch 吞掉
  // ——`order-actions.ts:104` 那條註解就是在講這件事)。
  revalidatePath('/orders');
  revalidatePath(`/orders/${parsed.orderId}`);
  redirectWith(parsed.returnTo, code);
}
