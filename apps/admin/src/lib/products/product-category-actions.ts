'use server';

// 商品頁乙 C3:改分類的 server action(編輯頁單件、列表批次共用)。
// 寫法照 product-overrides-actions.ts:先檢查登入與 Origin(authorizeAdminMutation),操作人取自 session,
// request id 由 server 產生,驗證輸入後才用 service_role 呼叫 RPC。
// 批次要逐件列出結果,所以回傳結果物件,不走 redirect。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { MAX_CATEGORY_BATCH } from './product-list-view';
import { setProductCategory, type ProductCategoryOutcome } from './product-repository';

// 🔴 'use server' 檔只能匯出 async 函式(Next 限制),上限常數住在 product-list-view.ts(C3 Codex 必修 1)。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetProductCategoryResult =
  | { ok: true; results: { productId: string; outcome: ProductCategoryOutcome }[] }
  | { ok: false; message: string };

const MESSAGE = {
  denied: '沒有權限改分類，請重新登入後再試。',
  invalid: '選的商品或分類有問題，請重新整理後再試。',
  tooMany: `一次最多改 ${MAX_CATEGORY_BATCH} 件，請縮小範圍後再試。`,
  busy: '商品正在更新，請稍後再試。',
  // 🔴 丟錯的原因可能是連線中斷:資料庫也許已經寫好了 ⇒ 不能說「失敗」,請員工重新整理確認。
  unknown: '無法確認分類是否已儲存，請重新整理頁面確認目前的分類。',
} as const;

export async function setProductCategoryAction(input: {
  productIds: readonly string[];
  categoryId: string | null;
  unlock: boolean;
}): Promise<SetProductCategoryResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: MESSAGE.denied };

  // 🔴 server action 的參數是從瀏覽器來的:型別宣告不算數,執行期逐欄檢查形狀(C3 Codex 必修 2)。
  if (typeof input !== 'object' || input === null || !Array.isArray(input.productIds) || typeof input.unlock !== 'boolean') {
    return { ok: false, message: MESSAGE.invalid };
  }
  const ids = [...new Set(input.productIds)];
  if (ids.length === 0 || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    return { ok: false, message: MESSAGE.invalid };
  }
  if (ids.length > MAX_CATEGORY_BATCH) return { ok: false, message: MESSAGE.tooMany };
  const unlock = input.unlock;
  const categoryId = input.categoryId;
  if (unlock ? categoryId !== null : typeof categoryId !== 'string' || !UUID.test(categoryId)) {
    return { ok: false, message: MESSAGE.invalid };
  }

  const requestId = await getRequestId();
  console.info('[admin/products] product.category.change.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    count: ids.length,
    unlock,
  });

  let results: { productId: string; outcome: ProductCategoryOutcome }[];
  try {
    results = await setProductCategory({ productIds: ids, categoryId, unlock, actor: auth.actorId, requestId });
  } catch (err) {
    const message = String((err as { message?: unknown }).message ?? '');
    console.error('[admin/products] 改分類失敗', { request_id: requestId, message: message.slice(0, 200) });
    if (message === '無權執行此操作') return { ok: false, message: MESSAGE.denied };
    if (message === '商品正在更新,請稍後再試') return { ok: false, message: MESSAGE.busy };
    if (message.startsWith('admin_set_product_category:')) return { ok: false, message: MESSAGE.invalid };
    return { ok: false, message: MESSAGE.unknown };
  }

  revalidatePath('/products');
  for (const id of ids) revalidatePath(`/products/${id}`);
  return { ok: true, results };
}
