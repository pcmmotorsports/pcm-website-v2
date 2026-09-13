'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeManagerMutation } from '../session/authorize';
import { setOrderItemCostsViaRpc } from './cost-repository';
import { COST_ROWS_FIELD, parseCostRowsField, type CostResultCode } from './cost-view';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from './order-return-to';

// cost-actions.ts — 「老闆:成本」的寫入 server action(plan §1-d「確認全部」與批次「改成本(勾選的列)」同一支)。
//    形狀抄 `lib/fx/fx-rate-actions.ts`:`authorizeManagerMutation` → 一發 RPC → `revalidatePath` → `redirect(?r=…)`。
//
// 🔴 身分閘在這裡(session + Origin + 具名 actor + is_manager),RPC 再驗一次 is_manager —— 兩層都在。
// 🔴 表單欄位:`COST_ROWS_FIELD` = JSON 陣列(island 收集 dirty 的列)`[{orderItemId, costPrice, costShipping, costTax, currency}]`,
//    `return_to` = 列表網址(照 `parseOrderReturnTo` 白名單,壞的退回 /orders)。金額字串**原樣**送 RPC(不過 number)。
// 🔴 結果只用 `?r=<code>` 回列表(同 `result-banner.tsx` 那一族);RPC 的人話(「EUR 還沒設過匯率…」)只認得的兩種
//    對成 code,其餘落 `cost_error`。**不把 RPC 訊息塞進網址**(網址可貼可轉發)。

// 🔴 'use server' 檔只能 export async function ⇒ 欄位名 / code 型別 / 解析器住 `cost-view.ts`。

function redirectWith(returnTo: string, code: CostResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
}

export async function setOrderItemCostsAction(formData: FormData): Promise<void> {
  // return_to 只認 /orders 那一族(`parseOrderReturnTo` 白名單);這支 action 沒有單一 orderId(批次)⇒ 壞的退回列表根。
  const parsedReturnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), '');
  const returnTo = parsedReturnTo === '/orders/' ? '/orders' : parsedReturnTo;

  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith(returnTo, 'cost_denied');

  const rows = parseCostRowsField(readSingleString(formData, COST_ROWS_FIELD));
  if (rows === null) redirectWith(returnTo, 'cost_invalid');

  const requestId = await getRequestId();
  let outcome;
  try {
    outcome = await setOrderItemCostsViaRpc(authorization.actorId, rows, requestId);
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    console.error('[admin/orders/cost] 成本寫入失敗', {
      request_id: requestId,
      rows: rows.length,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(returnTo, 'cost_error');
  }
  if (outcome.kind === 'denied') redirectWith(returnTo, 'cost_denied');
  if (outcome.kind === 'rejected') {
    console.warn('[admin/orders/cost] RPC 拒絕', { request_id: requestId, message: outcome.message.slice(0, 200) });
    redirectWith(returnTo, outcome.message.includes('還沒設過匯率') ? 'cost_no_fx' : 'cost_rejected');
  }
  revalidatePath('/orders');
  redirectWith(returnTo, 'cost_saved');
}
