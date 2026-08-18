// SupabaseFavoritesAdapter.test.ts
//
// 🔴 **這支測的是「呼叫形狀」,不是「資料庫行為」** —— 兩者的界線寫在這裡,免得被讀成全面覆蓋。
// ```
// mock 測得到:add 有沒有帶 ignoreDuplicates / onConflict、list 有沒有用 !inner、remove 有沒有兩個 eq
// mock 測不到:ON CONFLICT DO NOTHING 到底會不會需要 UPDATE 權限、!inner 會不會真的濾掉下架商品
// ```
// ⇒ 後者 **2026-08-18 用真的 supabase-js 打真的 PostgREST 驗過**(拋棄式鑽機),結果:
// ```
// 連按兩次 add                       ⇒ 兩次都無錯（冪等）
// 🔴 負向對照:改用【預設 upsert】     ⇒ 42501 permission denied for table customer_favorites
//    ⇒ 證明 ignoreDuplicates 是承重的，不是最佳化（預設走 DO UPDATE，而我們沒有 UPDATE 權限）
// remove 連按兩次                     ⇒ 兩次都無錯
// 商品軟下架 ⇒ 收藏清單 2 筆變 1 筆；DB 仍是 2 列；重新上架 ⇒ 清單又變回 2 筆
//    ⇒ Sean 拍的甲（不顯示）成立，而「收藏會自己回來」也是量到的，不是我推的
// ```
// ⚠️ **那一輪不可重跑**(鑽機拆了)⇒ 本檔守的是「呼叫形狀別被改壞」,
//    行為那半的證據在 commit `<本片>` 的 body 裡。

import { describe, expect, it, vi } from 'vitest';
import { SupabaseFavoritesAdapter } from './SupabaseFavoritesAdapter';

/** 只記下呼叫參數的假 client。回傳值固定,因為本檔不測資料轉換以外的東西。 */
function makeFakeClient() {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const chain = {
    select: (...args: unknown[]) => { calls.push({ table: 'x', op: 'select', args }); return chain; },
    eq: (...args: unknown[]) => { calls.push({ table: 'x', op: 'eq', args }); return chain; },
    order: (...args: unknown[]) => { calls.push({ table: 'x', op: 'order', args }); return Promise.resolve({ data: [], error: null }); },
    upsert: (...args: unknown[]) => { calls.push({ table: 'x', op: 'upsert', args }); return Promise.resolve({ error: null }); },
    delete: (...args: unknown[]) => { calls.push({ table: 'x', op: 'delete', args }); return chain; },
    then: undefined as unknown,
  };
  // delete().eq().eq() 最後要能 await ⇒ 讓 chain 本身 thenable
  (chain as unknown as { then: unknown }).then = (res: (v: unknown) => void) => res({ error: null });
  const from = vi.fn(() => chain);
  return { client: { from } as never, calls, from };
}

describe('SupabaseFavoritesAdapter', () => {
  it('🔴 add 必須帶 ignoreDuplicates（否則走 DO UPDATE，而我們沒有 UPDATE 權限）', async () => {
    const { client, calls } = makeFakeClient();
    await new SupabaseFavoritesAdapter(client).add('u-1', 'p-1');
    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert, '沒有呼叫 upsert').toBeTruthy();
    const opts = upsert!.args[1] as { onConflict?: string; ignoreDuplicates?: boolean };
    expect(opts?.ignoreDuplicates, 'ignoreDuplicates 不是 true ⇒ 會走 DO UPDATE ⇒ 42501').toBe(true);
    expect(opts?.onConflict, 'onConflict 要指到複合主鍵').toBe('customer_user_id,product_id');
  });

  it('🔴 list 的投射必須是 !inner（左外接會讓下架商品以 null 出現 = 被推翻的乙案）', async () => {
    const { client, calls } = makeFakeClient();
    await new SupabaseFavoritesAdapter(client).listByCustomer('u-1');
    const select = calls.find((c) => c.op === 'select');
    const projection = String(select!.args[0]);
    expect(projection).toContain('products!inner(');
    expect(projection).toContain('brands!inner(');
  });

  it('🔴 list 的投射【不得】含 price_store 或任何 tier 價（經銷價不進客人瀏覽器）', async () => {
    const { client, calls } = makeFakeClient();
    await new SupabaseFavoritesAdapter(client).listByCustomer('u-1');
    const projection = String(calls.find((c) => c.op === 'select')!.args[0]);
    expect(projection).not.toContain('price_store');
    expect(projection).not.toContain('price_by_tier');
  });

  it('remove 用兩個 eq 鎖到單一列（複合主鍵兩欄都要）', async () => {
    const { client, calls } = makeFakeClient();
    await new SupabaseFavoritesAdapter(client).remove('u-1', 'p-1');
    const eqs = calls.filter((c) => c.op === 'eq');
    expect(eqs).toHaveLength(2);
    expect(eqs.map((e) => e.args[0])).toEqual(['customer_user_id', 'product_id']);
  });
});
