import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// shopee-accounts.ts — 客人的蝦皮帳號(`customer_shopee_accounts`, 貼板 261;Sean 2026-10-01 蝦皮帳號 Q1 甲:一位客人可記多個)。
// 建蝦皮單時由建單函式自動補記;本檔是客人頁的「查看 / 新增 / 刪除」。
// 🔴 帳號不分大小寫全站唯一(唯一索引 lower(account))⇒ 新增撞到 23505 時再查一次是誰的:自己的 = 已經有, 別人的 = 擋下。

export type ShopeeAccount = { id: string; account: string; createdAt: string; createdBy: string };

/** 與 DB 約束 customer_shopee_accounts_account_shape 同一條:不能有空白、最多 64 字。 */
export const SHOPEE_ACCOUNT_RE = /^\S{1,64}$/u;

export async function listShopeeAccounts(customerId: string): Promise<ShopeeAccount[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('customer_shopee_accounts')
    .select('id, account, created_at, created_by')
    .eq('customer_user_id', customerId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`讀蝦皮帳號失敗:${error.code ?? ''}`);
  return (data ?? []).map((r) => ({ id: r.id, account: r.account, createdAt: r.created_at, createdBy: r.created_by }));
}

export type AddShopeeAccountResult = 'added' | 'exists' | 'taken' | 'not_found' | 'error';

export async function addShopeeAccount(customerId: string, account: string, actor: string): Promise<AddShopeeAccountResult> {
  const client = createSupabaseServiceClient();
  const { error } = await client
    .from('customer_shopee_accounts')
    .insert({ customer_user_id: customerId, account, created_by: actor });
  if (!error) return 'added';
  if (error.code === '23503') return 'not_found';
  if (error.code !== '23505') return 'error';
  // 撞到唯一索引:看這個帳號(不分大小寫)現在記在誰身上。
  // 🔴 PostgREST 的 ilike 會把 `*` 當萬用字元(帳號格式允許 `*`)⇒ 查回來的可能不只一筆, 在這裡逐筆比完整帳號再判斷。
  const { data, error: readError } = await client
    .from('customer_shopee_accounts')
    .select('customer_user_id, account')
    .ilike('account', account.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(50);
  const owner = data?.find((r) => r.account.toLowerCase() === account.toLowerCase());
  if (readError || owner === undefined) return 'error';
  return owner.customer_user_id.toLowerCase() === customerId.toLowerCase() ? 'exists' : 'taken';
}

/** 刪掉這位客人身上的一個帳號;回刪掉的帳號字串(寫操作紀錄用), 查無 ⇒ null。 */
export async function deleteShopeeAccount(customerId: string, accountId: string): Promise<string | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('customer_shopee_accounts')
    .delete()
    .eq('id', accountId)
    .eq('customer_user_id', customerId)
    .select('account');
  if (error) throw new Error(`刪蝦皮帳號失敗:${error.code ?? ''}`);
  return data && data.length > 0 ? data[0]!.account : null;
}
