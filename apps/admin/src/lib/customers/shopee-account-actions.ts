'use server';

// 客人頁「蝦皮帳號」的新增 / 刪除(貼板 261;Sean 2026-10-01 蝦皮帳號 Q1 甲)。在職員工都可以做(同改個人資料)。
// 順序:授權閘 → 驗表單 → 寫入 → 寫一筆操作紀錄(非交易性;寫不進去只進 server log, 不擋結果)→ 回客人頁帶結果碼。
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { SHOPEE_ACCOUNT_RE, addShopeeAccount, deleteShopeeAccount } from './shopee-accounts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Code = 'added' | 'exists' | 'taken' | 'deleted' | 'gone' | 'invalid' | 'denied' | 'not_found' | 'error';

function back(customerId: string | null, code: Code): never {
  redirect(`${customerId === null ? '/customers' : `/customers/${customerId}`}?r=customer_shopee_${code}`);
}

async function audit(action: string, customerId: string, change: { before?: object; after?: object }, actor: string): Promise<void> {
  const requestId = await getRequestId();
  try {
    await getAdminAuditLogRepository().record(
      { action, target: `customer:${customerId}`, ...change },
      { actor, requestId, sourceApp: 'admin' },
    );
  } catch {
    console.error('[admin/customers] 蝦皮帳號操作紀錄沒有寫入', { request_id: requestId, customer_id: customerId, action });
  }
}

export async function addShopeeAccountAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('customer_id') ?? '');
  const customerId = UUID_RE.test(raw) ? raw : null;
  const auth = await authorizeAdminMutation();
  if (!auth) back(customerId, 'denied');
  if (customerId === null) back(null, 'invalid');
  const account = String(formData.get('shopee_account') ?? '').trim();
  if (!SHOPEE_ACCOUNT_RE.test(account)) back(customerId, 'invalid');

  const result = await addShopeeAccount(customerId, account, auth.actorId);
  if (result === 'added') {
    await audit('customer.shopee_account.add', customerId, { after: { shopee_account: account } }, auth.actorId);
    revalidatePath(`/customers/${customerId}`);
  }
  back(customerId, result);
}

export async function deleteShopeeAccountAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('customer_id') ?? '');
  const customerId = UUID_RE.test(raw) ? raw : null;
  const auth = await authorizeAdminMutation();
  if (!auth) back(customerId, 'denied');
  const accountId = String(formData.get('account_id') ?? '');
  if (customerId === null || !UUID_RE.test(accountId)) back(customerId, 'invalid');

  let removed: string | null;
  try {
    removed = await deleteShopeeAccount(customerId, accountId);
  } catch (err) {
    console.error('[admin/customers] 刪蝦皮帳號失敗', { customer_id: customerId, message: String((err as Error).message).slice(0, 200) });
    back(customerId, 'error');
  }
  if (removed === null) back(customerId, 'gone');
  // 刪除記在 before(刪掉的是什麼), 不記 after。
  await audit('customer.shopee_account.delete', customerId, { before: { shopee_account: removed } }, auth.actorId);
  revalidatePath(`/customers/${customerId}`);
  back(customerId, 'deleted');
}
