// @vitest-environment node
//
// searchProducts 守門 — **截斷必須住在這一層**。
//
// 🔴 這支存在的唯一理由是 codex 2026-09-02 must-fix 2:
//    疊層走 `/api/search`、結果頁走 `/search` server component,**只有這一支是兩條路的交集**。
//    截斷若做在 route ⇒ 疊層搜前 100 字、結果頁搜完整字串
//    ⇒ **同一個輸入,兩個畫面給相反的答案**,而每一邊各自看起來都完全正常、三綠全綠。
// 📌 判別句:一條規矩要放在【所有路徑都會經過】的那一層,不是放在你剛好在改的那一層。

import { describe, expect, it, vi, beforeEach } from 'vitest';

// 🔴 `lib/search.ts` 檔頭是 `import 'server-only'` —— 那顆套件在非 RSC 環境**載入即 throw**。
//    這裡把它換成空模組:被繞過的是【測試環境的載入守門】,**不是** production 的那一道
//    (真正擋 client bundle 的是 Next 的 RSC 邊界 + 該檔自己那個 `typeof window` runtime guard)。
// ⚠️ 而這個 mock 有代價:本檔**驗不到**「search.ts 真的還掛著 server-only」——
//    那一格由 `grep -c "import 'server-only'" apps/storefront/src/lib/search.ts` 顧,見最後一格。
vi.mock('server-only', () => ({}));

const searchByKeyword = vi.fn();
vi.mock('@pcm/adapters', () => ({
  SupabaseProductAdapter: class {
    searchByKeyword = searchByKeyword;
  },
  createSupabaseAnonClient: () => ({}),
}));
vi.mock('@/lib/products', () => ({ toUIProduct: (p: unknown) => p }));

// 🔴 記語料那一發在這裡換成 spy —— 本檔要驗的是【什麼時候記】, 不是【怎麼記】。
//    (怎麼記由 `search-log.test.ts` 顧;那支驗「失敗不得弄壞搜尋」。)
const logSearchQuery = vi.fn();
vi.mock('@/lib/search-log', () => ({ logSearchQuery: (...a: unknown[]) => logSearchQuery(...a) }));

const { searchProducts, SEARCH_MAX_QUERY_LENGTH } = await import('./search');

beforeEach(() => {
  searchByKeyword.mockReset();
  logSearchQuery.mockReset();
});

describe('searchProducts', () => {
  it('🔴 超過上限的關鍵字在【這一層】被截斷(兩條路因此拿到同一個查詢)', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    await searchProducts('排'.repeat(300), 8);
    const sent = searchByKeyword.mock.calls[0]![0] as string;
    expect(sent).toHaveLength(SEARCH_MAX_QUERY_LENGTH);
    // 🔵 負對照:沒超過上限的不准被動到 —— 否則上面那格用「永遠截成 100」也會過。
    searchByKeyword.mockClear();
    await searchProducts('排氣管', 8);
    expect(searchByKeyword.mock.calls[0]![0]).toBe('排氣管');
  });

  it('🔴 空字串 / 純空白 ⇒ 不打 DB,回 error:false 的空結果', async () => {
    const r = await searchProducts('   ', 8);
    expect(r).toEqual({ items: [], total: 0, error: false });
    expect(searchByKeyword).not.toHaveBeenCalled();
  });

  it('🔴 adapter 丟錯 ⇒ error:true(不是靜靜回零筆)', async () => {
    searchByKeyword.mockRejectedValue(new Error('boom'));
    const r = await searchProducts('排氣管', 8);
    expect(r.error).toBe(true);
    // 🔵 對照:成功世界的 error 是 false ⇒ 這格分得出兩個世界,不是恆真。
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    expect((await searchProducts('排氣管', 8)).error).toBe(false);
  });

  it('🔴 total 缺席(Paginated.total 是 optional)⇒ null,不是 0', async () => {
    searchByKeyword.mockResolvedValue({ items: [] });
    expect((await searchProducts('排氣管', 8)).total).toBeNull();
    // 🔵 對照:有數字時原樣帶出來。
    searchByKeyword.mockResolvedValue({ items: [], total: 42 });
    expect((await searchProducts('排氣管', 8)).total).toBe(42);
  });

  it("🔴 前提 — search.ts 自己還掛著 `import 'server-only'`(上面的 mock 把它繞過了)", async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
    expect(src, "server-only 被拿掉了 ⇒ 這支可能被打包進 client bundle").toContain("import 'server-only'");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 搜尋語料:**什麼時候記** —— 三個閘都是量出來的, 不是想到的(plan v5 §5)
  // ══════════════════════════════════════════════════════════════════════
  it('🔴 一般搜尋(countTotal=true · offset=0)⇒ 記一筆 keyword', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 7 });
    await searchProducts('排氣管', 8);
    expect(logSearchQuery).toHaveBeenCalledTimes(1);
    expect(logSearchQuery.mock.calls[0]![0]).toEqual({
      query: '排氣管',
      path: 'keyword',
      resultCount: 7,
    });
  });

  it('🔴 疊層(countTotal=false)⇒ 不記 —— 它是【邊打字邊呼叫】, 記它等於把前綴當成三次搜尋', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 7 });
    await searchProducts('排氣管', 8, 0, false);
    expect(logSearchQuery).not.toHaveBeenCalled();
  });

  it('🔴 翻頁(offset > 0)⇒ 不記 —— 每翻一頁重呼一次, 記它會讓次數灌水', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 7 });
    await searchProducts('排氣管', 8, 8);
    expect(logSearchQuery).not.toHaveBeenCalled();
  });

  it('🔴 撈失敗 ⇒ 不記 —— 記下去會存成「客人搜的我們都沒有」= 一筆假的缺貨商機', async () => {
    searchByKeyword.mockRejectedValue(new Error('boom'));
    await searchProducts('排氣管', 8);
    expect(logSearchQuery).not.toHaveBeenCalled();
  });

  it('🔵 而記語料【不得】改變回傳值 —— 它是 fire-and-forget', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 7 });
    logSearchQuery.mockImplementation(() => {
      throw new Error('就算它整支炸了');
    });
    // 🛑 這一格若紅, 代表記 log 的失敗會冒到客人那邊 ⇒ 那正是 Sean 明令不准的。
    await expect(searchProducts('排氣管', 8)).resolves.toMatchObject({ error: false, total: 7 });
  });
});
