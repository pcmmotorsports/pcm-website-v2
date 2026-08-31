import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  search: vi.fn(),
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorize }));
vi.mock('./manual-order-catalog', () => ({ searchManualOrderCatalog: mocks.search }));

import { searchManualOrderCatalogAction } from './manual-order-catalog-actions';

// 片1(⟦b4-SKULOOKUP⟧)的 server action。
// 🔴 誠實邊界:本檔全是 mock ⇒ 證的是【這一層做了什麼決定】——
//    授權有沒有先跑、失敗有沒有被轉成「查無」、原始訊息有沒有外洩。
//    **不證** PostgREST 真的回什麼、也不證那道授權閘本身對不對(那在 authorize.ts 的測試裡)。

const HIT = { variantId: 'v1', sku: 'SKU-1', title: '品名', unitPrice: 100 };

beforeEach(() => {
  mocks.authorize.mockReset().mockResolvedValue({ actorId: 'probe' });
  mocks.search.mockReset();
});

describe('searchManualOrderCatalogAction', () => {
  it('🔵 正常:回 ok:true 與那幾筆', async () => {
    mocks.search.mockResolvedValue([HIT]);
    await expect(searchManualOrderCatalogAction('SKU')).resolves.toEqual({ ok: true, hits: [HIT] });
  });

  it('🔴 查無 ⇒ ok:true 而 hits 是空陣列 —— 那是一個【合法答案】不是失敗', async () => {
    mocks.search.mockResolvedValue([]);
    await expect(searchManualOrderCatalogAction('ZZQ')).resolves.toEqual({ ok: true, hits: [] });
  });

  it('🔴🔴 查詢失敗 ⇒ ok:false —— 【不得】與查無印同一個東西', async () => {
    mocks.search.mockRejectedValue(new Error('boom'));
    const r = await searchManualOrderCatalogAction('SKU');
    expect(r.ok, '失敗被轉成 ok:true 的話, 員工會以為是料號打錯而一直改關鍵字').toBe(false);
    // 🔵 而它與「查無」在型別上就分得開:查無有 hits, 失敗沒有。
    expect(r).not.toHaveProperty('hits');
  });

  it('🔴 失敗訊息【不得】含原始錯誤字面(連線字串 / 表名 / PostgREST 細節都可能在裡面)', async () => {
    mocks.search.mockRejectedValue(new Error('postgres://user:pw@host/db 掛了 table=product_variants'));
    const r = await searchManualOrderCatalogAction('SKU');
    const msg = r.ok ? '' : r.message;
    expect(msg).not.toMatch(/postgres:\/\/|product_variants|pw@/);
    expect(msg, '而它要告訴員工【這不是你的問題】, 否則他會一直改關鍵字').toMatch(/不是料號打錯/);
  });

  // 🔴🔴 **本格的第一版是【假綠】, 而錯在 mock 不在碼**(codex R1 must-fix):
  //    我寫 `mockRejectedValue` ⇒ 假設那道閘【拋錯】。
  //    而 `authorize.ts:31-34` 的回傳型別是 `{…} | null` —— **它拒絕時回 `null`, 不拋。**
  //    ⇒ 真實世界裡我那句 `await authorizeAdminMutation();` 會**順順往下走**,
  //      而未授權的人照樣查得到 DB —— 而這一格是綠的。
  //    📌 **⇒ 一個 mock 編碼的是【我以為的合約】; 它與真合約不同時, 測試會替錯的碼背書。**
  //    ⇒ 兩格都留:一格演 `null`(真合約), 一格演 throw(萬一它日後改成拋)。
  it('🔴🔴 授權回 null(真合約)⇒ 回 denied, 而【不得】先查 DB', async () => {
    mocks.authorize.mockResolvedValue(null);
    const r = await searchManualOrderCatalogAction('SKU');
    expect(r).toEqual({ ok: false, reason: 'denied', message: expect.any(String) });
    expect(
      mocks.search,
      '順序反了的話, 一個沒有票的人也量得到「這個料號存不存在」',
    ).not.toHaveBeenCalled();
  });

  it('🔵 而它若日後改成【拋】, 也不得吞掉 —— 拋要往上走, 不得變成 ok:false', async () => {
    mocks.authorize.mockRejectedValue(new Error('unauthorized'));
    await expect(searchManualOrderCatalogAction('SKU')).rejects.toThrow('unauthorized');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('🔵 正對照:授權有被呼叫(不然上一格與「這支根本沒授權」印同一個綠)', async () => {
    mocks.search.mockResolvedValue([]);
    await searchManualOrderCatalogAction('SKU');
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
  });
});
