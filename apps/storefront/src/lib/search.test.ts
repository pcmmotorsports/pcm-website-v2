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
// 🔵 ⟦商品頁印的料號搜不到⟧ 2026-09-09:一筆都沒有時的第二發(變體料號回查)。
//    預設回空 ⇒ **既有那幾格的行為逐字不變**(它們餵的都是空結果, 而空 + 空還是空)。
const searchByVariantSku = vi.fn();
vi.mock('@pcm/adapters', () => ({
  SupabaseProductAdapter: class {
    searchByKeyword = searchByKeyword;
    searchByVariantSku = searchByVariantSku;
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
  searchByVariantSku.mockReset();
  searchByVariantSku.mockResolvedValue({ items: [] });
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


// ══ ⟦商品頁印的料號搜不到⟧ 商品頁印的是【變體】料號, 而搜尋只認母料號 ══════════════
//
// 🔬 病(鑽機實測):`/products/probe-dbk-3` 主標上方逐字印
//   「DBK SPECIAL PARTS · 原廠料號 **DBK-3-BLK**」, 而 `?search=DBK-3-BLK` ⇒ **0 件商品**;
//   同一頁的母料號 `PB-dbk-3` ⇒ 1 件。⇒ 📌 **畫面印 A、搜尋只認 B。**
// 🛑 本組釘的是【什麼時候問第二發】, 不是【第二發怎麼查】——
//   後者住在 `SupabaseProductAdapter.searchByVariantSku`, 由那一層自己負責。
describe('searchProducts · 變體料號回查', () => {
  // 🔵 形狀照 adapter 現在真的回的那個:它只在【答得完整】時回東西, 所以 `total` 是精確的。
  const hit = { items: [{ id: 'p1', slug: 'probe-dbk-3' }], total: 1 };

  it('🔴 主查詢零筆 ⇒ 問變體料號, 而它找到的東西要回給客人', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockResolvedValue(hit);
    const r = await searchProducts('DBK-3-BLK', 8);
    expect(searchByVariantSku).toHaveBeenCalledTimes(1);
    expect(r.items).toHaveLength(1);
    // 🔴🔴 **件數要接 adapter 給的那個, 不是留 `null`**(codex 2026-09-09 must-fix ①):
    //    `components/ProductsPage.tsx:298` 逐字 `const resultCount = total ?? products.length;`
    //    ⇒ 📌 `null` **不是「不印件數」**, 是「拿當頁筆數當總數印出來」。
    //    adapter 那邊只在【答得完整】時才回東西, 所以這個數是精確的。
    expect(r.total).toBe(1);
    expect(r.error).toBe(false);
  });

  // 🟢 正對照 —— 少了這格, 「永遠都問第二發」也會讓上面那格綠。
  it('🔵 主查詢有結果 ⇒ 【不】問第二發(行為逐字不變、不插隊)', async () => {
    searchByKeyword.mockResolvedValue({ items: [{ id: 'x' }], total: 1 });
    const r = await searchProducts('煞車拉桿', 8);
    expect(searchByVariantSku).not.toHaveBeenCalled();
    expect(r.total).toBe(1);
  });

  // 🔴 翻頁不問 —— 翻過尾頁本來就該是空的, 在那裡回一批新東西 = 同一次瀏覽兩種清單。
  it('🔴 offset > 0(翻頁)⇒ 不問第二發', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockResolvedValue(hit);
    const r = await searchProducts('DBK-3-BLK', 8, 8);
    expect(searchByVariantSku).not.toHaveBeenCalled();
    expect(r.items).toHaveLength(0);
  });

  // 🔴 第二發也一筆都沒有 ⇒ 照舊回主查詢那個空結果(含它的 total), 不得因此變成錯誤狀態。
  it('🔵 第二發也沒有 ⇒ 維持空結果、error 仍是 false', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockResolvedValue({ items: [] });
    const r = await searchProducts('不存在的料號', 8);
    expect(r).toEqual({ items: [], total: 0, error: false });
  });

  // 🔴🔴 **第二發炸掉【吞掉】, 而那與本檔別處的紀律方向相反 —— 理由在 `search.ts` 那段註解**:
  //   它是一發純加法。失敗 ⇒ 客人看到今天那個正確但不完整的答案;
  //   讓它大聲 ⇒ 📌 **站上每一個零結果查詢都會變成「搜尋暫時無法使用」**, 嚴格更差。
  //   ⚠️ 正式站 anon 能不能直讀 `product_variants_public` 我們證不到 ⇒ 這一格不是假設性的。
  it('🔴 第二發 throw ⇒ 吞掉、維持今天的零筆結果(不得整頁變成錯誤狀態)', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockRejectedValue(new Error('boom'));
    const r = await searchProducts('DBK-3-BLK', 8);
    expect(r).toEqual({ items: [], total: 0, error: false });
  });

  // 🟢 對照:**主查詢**炸掉照舊要大聲 —— 上面那格吞的只有第二發, 不是把整條路變安靜。
  it('🔵 主查詢 throw ⇒ 仍然 error:true', async () => {
    searchByKeyword.mockRejectedValue(new Error('boom'));
    expect((await searchProducts('DBK-3-BLK', 8)).error).toBe(true);
  });

  // 🔴🔴 **回查壞掉 ⇒ 不得把這一次記成「客人搜這個字我們一件都沒有」**
  //   (codex 2026-09-09 must-fix ②)。語料表是缺貨商機的分母, 一次權限錯會被寫成一筆假商機,
  //   而 console 留痕不會阻止那筆資料寫進去。**這一次的零筆是「不知道」不是「沒有」。**
  it('🔴 回查 throw ⇒ 不記語料(那個 0 不是答案)', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockRejectedValue(new Error('boom'));
    await searchProducts('DBK-3-BLK', 8);
    expect(logSearchQuery).not.toHaveBeenCalled();
  });

  // 🟢 正對照 —— 少了這格,「永遠不記」也會讓上面那格綠。
  it('🔵 回查正常回空 ⇒ 照記(那個 0 是真的答案)', async () => {
    searchByKeyword.mockResolvedValue({ items: [], total: 0 });
    searchByVariantSku.mockResolvedValue({ items: [] });
    await searchProducts('DBK-3-BLK', 8);
    expect(logSearchQuery).toHaveBeenCalledTimes(1);
    expect(logSearchQuery.mock.calls[0]![0]).toMatchObject({ resultCount: 0 });
  });
});

describe('searchProducts:資料庫逾時(57014)重試一次(2026-09-11)', () => {
  const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

  it('第一發 57014、第二發成功 ⇒ 有結果, 不是「搜尋暫時無法使用」', async () => {
    searchByKeyword.mockRejectedValueOnce(timeout()).mockResolvedValueOnce({ items: [{ id: 'p1' }], total: 1 });
    const r = await searchProducts('DBK SPECIAL', 8);
    expect(r.error).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(searchByKeyword).toHaveBeenCalledTimes(2);
  });

  it('兩發都 57014 ⇒ 照舊 error:true(畫面印那句), 只叫兩次', async () => {
    searchByKeyword.mockRejectedValue(timeout());
    const r = await searchProducts('DBK SPECIAL', 8);
    expect(r.error).toBe(true);
    expect(searchByKeyword).toHaveBeenCalledTimes(2);
  });

  it('非 57014 的錯 ⇒ 不重試, 照舊 error:true', async () => {
    searchByKeyword.mockRejectedValue(Object.assign(new Error('boom'), { code: '42501' }));
    const r = await searchProducts('DBK SPECIAL', 8);
    expect(r.error).toBe(true);
    expect(searchByKeyword).toHaveBeenCalledTimes(1);
  });
});
