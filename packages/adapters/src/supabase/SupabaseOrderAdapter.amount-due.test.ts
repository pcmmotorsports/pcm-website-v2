// ⟦Q1 甲⟧ Sean 2026-09-16「應收改成取消後剩下的金額」:adapter 算應收與未結待退款的兩支私有方法。
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseOrderAdapter } from './SupabaseOrderAdapter';

// 🔴 `status` 是 **C4 的判準本人**(見 `SupabaseOrderAdapter.ts` 那段註解)⇒ fixture 不帶它
//    等於在測一個「永遠不成立」的分支。R2 M-A 就是這樣紅的。
type Result = { data: unknown; error: unknown; status?: number };

function adapterWith(opts: { rpc?: () => Promise<Result>; pending?: () => Promise<Result> }) {
  const rpc = vi.fn(opts.rpc ?? (() => Promise.reject(new Error('rpc 不該被叫'))));
  const is2 = vi.fn(opts.pending ?? (() => Promise.reject(new Error('pending 不該被查'))));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ is: () => ({ is: is2 }) }) }) }));
  const adapter = new SupabaseOrderAdapter({ rpc, from } as unknown as SupabaseClient);
  return { adapter, rpc, from };
}

describe('amountDueAfterCancel', () => {
  it('沒取消 ⇒ 原總額,不打 RPC;整單取消 ⇒ 0,不打 RPC', async () => {
    const { adapter, rpc } = adapterWith({});
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, false)).toBe(14300);
    expect(await adapter['amountDueAfterCancel']('o1', 14300, '2026-09-15T00:00:00Z', true)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('部分取消 ⇒ pcm_order_remaining_receivable(bigint 字串也吃)', async () => {
    const { adapter, rpc } = adapterWith({ rpc: () => Promise.resolve({ data: '9220', error: null }) });
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(9220);
    expect(rpc).toHaveBeenCalledWith('pcm_order_remaining_receivable', { p_order_id: 'o1' });
  });

  // 🔴🔴 **[2026-09-16 Sean 拍【乙】—— 期望值改了,而改的理由是【規則變了】不是為了過關]**
  //   舊的把「DB 明說算不出來」與「我們讀不到」合成同一個答案(都落回原總額)⇒ 畫面印出一個
  //   看起來正確、其實不該信的滿額數字。他看過之後選乙:**算不出來就說算不出來。**
  //   ⇒ 這兩種現在**必須分開**,因為它們要員工做的事不一樣:
  //     · 算不出來 ⇒ 去退款異常頁人工處理    · 讀不到 ⇒ 重整頁面
  it('🔴 RPC 明說 NULL(且無錯誤)⇒ null =「這張單的稅算不出來」, 不是原總額', async () => {
    const { adapter } = adapterWith({ rpc: () => Promise.resolve({ data: null, error: null, status: 200 }) });
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBeNull();
  });

  // 🔴🔴 **[R2 M-A —— 這一格是【補上來的】,而它補的是我自己挖的洞]**
  //   我加了 C4(判準多要 `status === 200`)之後**沒有重跑上面那一格** ⇒ 它當場變紅而我沒發現,
  //   是對抗審查跑出來的。📌 **改了守門的判準之後,要重跑被它收窄的那些格,不是只跑新加的格。**
  //   ⇒ 本格把 C4 釘住:**沒有它,把 `status === 200` 整段拿掉照樣全綠** —— 那道判準等於沒人守。
  //   `204` 不是我編的:postgrest-js 對【body 是空字串的 404】就地改寫成 204
  //   (`@supabase/postgrest-js@2.105.3` 的 `src/PostgrestBuilder.ts:524-525` 逐字 `status = 204`,
  //    我開檔讀過)⇒ 那一種是 gateway / proxy 層的讀失敗,**不是** DB 說算不出來。
  it('🔴 裸 404(postgrest-js 就地改寫成 204)⇒ 落回原總額,不是「算不出來」', async () => {
    const { adapter } = adapterWith({ rpc: () => Promise.resolve({ data: null, error: null, status: 204 }) });
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(14300);
  });

  it('🔵 讀失敗 / throw / 負數 ⇒ 仍落回原總額(改前口徑)—— 那是「我們讀不到」不是「算不出來」', async () => {
    for (const rpc of [
      () => Promise.resolve({ data: 9220, error: { code: '42501' } }),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve({ data: -1, error: null }),
    ]) {
      expect(await adapterWith({ rpc }).adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(14300);
    }
  });

  it('🔴 負對照:帶著錯誤的 NULL【不算】算不出來(否則 DB 一打嗝就印「算不出來」)', async () => {
    const { adapter } = adapterWith({ rpc: () => Promise.resolve({ data: null, error: { code: '42501' } }) });
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(14300);
  });
});

describe('openPendingRefundTotal', () => {
  it('未結列合計;查 order_pending_refunds', async () => {
    const { adapter, from } = adapterWith({
      pending: () => Promise.resolve({ data: [{ amount_at_cancel: 5080 }, { amount_at_cancel: '100' }], error: null }),
    });
    expect(await adapter['openPendingRefundTotal']('o1')).toBe(5180);
    expect(from).toHaveBeenCalledWith('order_pending_refunds');
  });

  it('沒有列 ⇒ 0;讀失敗 / 壞列 ⇒ null(不補 0)', async () => {
    expect(await adapterWith({ pending: () => Promise.resolve({ data: [], error: null }) }).adapter['openPendingRefundTotal']('o1')).toBe(0);
    for (const pending of [
      () => Promise.resolve({ data: null, error: { code: 'x' } }),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve({ data: [{ amount_at_cancel: null }], error: null }),
    ]) {
      expect(await adapterWith({ pending }).adapter['openPendingRefundTotal']('o1')).toBeNull();
    }
  });
});
