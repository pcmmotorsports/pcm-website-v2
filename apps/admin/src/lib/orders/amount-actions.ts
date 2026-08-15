'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminOrderRepository } from './order-repository';
import { parseAmountForm } from './amount-form';
import { appendResultQuery } from './order-return-to';
import {
  ORDER_AMOUNT_ERROR_RESULT_CODE,
  ORDER_AMOUNT_REJECTED_RESULT_CODE,
} from './amount-action-state';
import { orderAmountRejectCodeForLog } from './amount-reject-set';

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

/** 導頁結果碼。🔴 **為什麼只有失敗那顆 namespace,理由全文在 `amount-action-state.ts` 檔頭。** */
type ResultCode =
  | 'saved'
  | 'conflict'
  | 'noop'
  | 'invalid'
  | 'denied'
  | typeof ORDER_AMOUNT_ERROR_RESULT_CODE
  | typeof ORDER_AMOUNT_REJECTED_RESULT_CODE;

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
 * 而這六碼**沒有「業務拒絕」這一類** ⇒ 它們一律變成 `error`。
 *
 * 🔴🔴 **成因是「到了被丟掉」,不是「傳不到」**(2026-08-15 主視窗對正式庫實測,一次呼叫):
 * 用不存在的 order_id 打 PostgREST ⇒ `HTTP 400`,body 逐字
 * `{"code":"P0001","details":null,"hint":null,"message":"admin_update_order_item_amount: 訂單不存在"}`
 * ⇒ **`code` 會到客戶端,而且 RPC 的完整中文訊息也會到。**
 * ⇒ 那兩句業務拒絕的中文**不是到不了,是到了之後被這一層丟掉**。
 * **這個差別決定解法**:前者要改 RPC 或傳輸層,後者**只要這一層別丟就好**。
 * ⚠️ 但**不得直接把 `message` 顯示給員工** —— 它帶函式名前綴,而且 `:372` 那條會把
 * **收到的原因字串內插進去**(就是本檔 catch 不記 `message` 的原因)。**「可用但要處理」,不是「可以直接顯示」。**
 *
 * ⚠️ **仍未實測的那一半**:上面那一發回的是 `P0001`(plpgsql 預設 sqlstate),
 * 因為訂單查無那條**沒有** `USING ERRCODE`。
 * **「`USING ERRCODE = 'P2C13'` 會不會逐字出現在 `code`」到現在還是沒人測過** ——
 * 要觸發那 7 條之一得用**一張真訂單**,風險等級不同。
 * ⇒ **在那一半測出來之前不寫任何以 `P2C13` 為條件的 mapping。**
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
    // 🔴 **導回明細頁,不是列表**(R3/fable F3)。
    //    1c-1 導 `/orders` 當時合理(那片沒有畫面,`invalid` 幾乎只可能是 hidden 欄被竄改);
    //    **1c-2 讓 `invalid` 變成「員工打字就到得了」** ⇒ 把正在看單的人丟回列表 = 他得自己找回來。
    //    ⚠️ `orderId` 是 best-effort(只在字面是 UUID 時才有值),拿不到才退回列表。
    redirectWith(parsed.orderId ? `/orders/${parsed.orderId}` : '/orders', 'invalid');
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
    //    ⇒ 只留 `code` + `request_id` + **`reject`**(`#518` 加的第三顆,值來自白名單、不是原始
    //       `details`):出事要查細節,走 `admin_audit_log`(RPC 同交易寫,有 request_id 可對)。
    //    ⚠️ 本行原本寫「只留 code + request_id」—— `#518` 之後那句就過期了,一併改掉。
    const e = err as { code?: unknown };
    // 🔴 **只呼叫一次**,分派與 log 用同一個值(code-reviewer R1 nit 3):
    //    兩支各呼叫一次 ⇒ `err.details` 實際被讀兩次,而本檔的前提是「不信任這個物件」。
    //    安全上原本就沒洞(兩次都經同一次讀的白名單驗證),但**敘述與呼叫端要一致**。
    const reject = orderAmountRejectCodeForLog(err);
    console.error('[admin/orders] 改品項金額失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      // 🔴 `#518`:多記一顆**拒絕代號**。它是 RPC 送的 `DETAIL`,而 `DETAIL` 只放常數
      //    ⇒ 與 `message` 不同,它不會夾帶員工打的字。
      //    ⚠️ 走 `orderAmountRejectCodeForLog` 而不是直接記 `e.details`:
      //       那支只回**白名單內**的值,認不出來就 `undefined`(見該檔的理由)。
      reject,
    });
    // 🔴 **業務拒絕 vs 系統故障要分開**(codex 關卡2 R1 must-fix):
    //    第一版把兩者塞同一顆碼,而那句文案說「請確認是否已收款或已有折扣」
    //    ⇒ **DB 斷線 / timeout 也會顯示那句,員工往錯方向查。**
    //    ✅ 分得開靠的是量測:E 窗實測 `P2C13` **逐字出現在 `error.code`**(`#518` Q1)。
    //
    // 🔴 **`#518` 改掉的就是下面這一行的條件**:原本是 `e.code === 'P2C13'`,
    //    而 `P2C13` **不等於**業務拒絕 —— 同一個碼底下有兩條是**資料損壞 / 設定錯誤**
    //    (`pcm_e13_subtotal_matches_lines` / `pcm_e13_guard_unknown_table`,住在別的函式)。
    //    ⇒ 只看 `code` 會把**資料損壞講成「請確認你的輸入」**。
    //    改成看白名單(見 `amount-reject-set.ts`,含 PostgREST 實測與 apply 順序的說明)。
    //    ⚠️ **fail-closed**:認不出來一律走通用錯誤 + 「找系統維護」。
    redirectWith(
      parsed.returnTo,
      reject === undefined ? ORDER_AMOUNT_ERROR_RESULT_CODE : ORDER_AMOUNT_REJECTED_RESULT_CODE,
    );
  }

  // 成功路徑 revalidate;🔴 redirect 在 catch **外**(它是用 throw 實作的,包進 try 會被自己的 catch 吞掉
  // ——`order-actions.ts:104` 那條註解就是在講這件事)。
  revalidatePath('/orders');
  revalidatePath(`/orders/${parsed.orderId}`);
  redirectWith(parsed.returnTo, code);
}
