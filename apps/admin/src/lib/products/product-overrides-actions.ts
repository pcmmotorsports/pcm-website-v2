'use server';

// 商品文字「我們的版本」的 server action(商品編輯丙方案片 2)。鏡射 product-listing-actions.ts:
// 授權 → 解析 → RPC(同交易寫稽核)→ revalidate → 導回帶 ?r= 結果碼(文字在 components/orders/result-banner.tsx)。
// 🔴 Sean 2026-09-27 C4 甲:所有員工都能改 ⇒ authorizeAdminMutation(不是主管閘);變更紀錄由 RPC 寫。

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { setProductOverride } from './product-repository';
import { parseOverrideForm } from './product-overrides-form';

type ResultCode =
  | 'override_saved'
  | 'override_restored'
  | 'override_noop'
  | 'override_not_found'
  | 'override_invalid'
  | 'override_denied'
  | 'override_error';

function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

export async function setProductOverrideAction(formData: FormData): Promise<void> {
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/products', 'override_denied');
  }

  const parsed = parseOverrideForm(formData);
  if (!parsed.ok) {
    redirectWith('/products', 'override_invalid');
  }

  const requestId = await getRequestId();
  console.info('[admin/products] product.override.change.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    product_id: parsed.productId,
    field: parsed.field,
    restore: parsed.value === null,
  });

  let code: ResultCode;
  try {
    const result = await setProductOverride({
      productId: parsed.productId,
      field: parsed.field,
      value: parsed.value,
      actor: auth.actorId,
      requestId,
    });
    code =
      result === 'UPDATED'
        ? parsed.value === null
          ? 'override_restored'
          : 'override_saved'
        : result === 'NOT_FOUND'
          ? 'override_not_found'
          : 'override_noop';
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    const message = String(e.message ?? '');
    // RPC 自己 RAISE 的(內容不合規則)開頭都是函式名;其餘(連線、權限、RPC 不存在)一律當系統錯誤。
    const rejectedByRule = message.startsWith('admin_set_product_override:');
    console.error('[admin/products] 商品文字儲存失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: message.slice(0, 200),
    });
    redirectWith(parsed.returnTo, rejectedByRule ? 'override_invalid' : 'override_error');
  }

  revalidatePath(`/products/${parsed.productId}`);
  redirectWith(parsed.returnTo, code);
}
