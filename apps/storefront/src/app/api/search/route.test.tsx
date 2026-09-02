// @vitest-environment node
//
// /api/search 守門 — 這支只有三個決定,而每一個錯了都不會紅:
//
// R1:空 q ⇒ 回 200 空陣列且**不打 DB**(搜尋框剛打開時 client 不該把 DB 叫醒)。
// R2:🔴 撈失敗 ⇒ **503**,不是 200 空陣列。回 200 空陣列會讓「這次查不到」與
//     「我們沒有這件商品」在疊層裡長成同一個畫面 —— 而那是在告訴客人我們沒貨。
// R3:回傳面比 `MockProduct` 窄 —— 只有疊層那一列畫得到的四欄。多帶 description /
//     images / fitments = 每打一個字就把那些送過網路一次,而**功能完全正常**。
// R4:超長輸入截斷而**不是** 400 —— 貼一段長文不該讓搜尋框整個壞掉。

import { describe, expect, it, vi, beforeEach } from 'vitest';

const searchProducts = vi.fn();
vi.mock('@/lib/search', () => ({ searchProducts, SEARCH_OVERLAY_LIMIT: 8 }));

const { GET } = await import('./route');

const req = (q: string) => new Request(`http://x/api/search?q=${encodeURIComponent(q)}`);

const FULL_PRODUCT = {
  id: 1, slug: 'a', brand: 'B', name: 'N', price: 100, image: null,
  // 疊層畫不到的重欄位 —— 不該出現在回傳裡
  description: 'x'.repeat(500), images: ['1', '2'], fitments: [{ motoBrand: 'Honda' }],
};

beforeEach(() => searchProducts.mockReset());

describe('/api/search', () => {
  it('R1 空 q ⇒ 200 空陣列,且完全沒呼叫 searchProducts', async () => {
    const res = await GET(req('   '));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('R2 撈失敗 ⇒ 503,**不是** 200 空陣列', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: true });
    const res = await GET(req('排氣管'));
    expect(res.status).toBe(503);
    // 🔵 兩個世界對照:成功而零筆時是 200 —— 證明這格分得出來,不是恆回 503。
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    expect((await GET(req('排氣管'))).status).toBe(200);
  });

  it('R3 回傳只有四欄,重欄位不外流', async () => {
    searchProducts.mockResolvedValue({ items: [FULL_PRODUCT], total: 1, error: false });
    const body = (await (await GET(req('排氣管'))).json()) as { items: object[] };
    expect(Object.keys(body.items[0] as object).sort()).toEqual(['brand', 'image', 'name', 'price', 'slug']);
  });

  it('R4 🔴 超長輸入【原樣傳下去、不在這一層截斷】,而且不回 400', async () => {
    // ⛔ ~~舊斷言:`searchProducts` 收到的字串長度 === 100(= route 自己截)~~
    // 🔴 **那一版是錯的**(codex 2026-09-02 must-fix 2):截斷若做在 route,
    //    疊層搜前 100 字、而 `/search` server component 不經過 route ⇒ 搜完整字串
    //    ⇒ **同一個輸入,兩個畫面給相反的答案**,而每一邊各自看起來都正常。
    // ✅ 現在截斷住在 `searchProducts`(兩條路都經過它),本層只做 trim 與空字串短路。
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    const res = await GET(req('排'.repeat(300)));
    expect(res.status).toBe(200);
    expect((searchProducts.mock.calls[0] as [string])[0]).toHaveLength(300);
  });
});
