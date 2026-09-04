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

// 🔴 **這三支非 mock 不可, 而理由不是「省一點」**:`@/lib/products` 頂層有 `import 'server-only'`
//    ⇒ 這支測試 import `./route` 時整檔就炸(`This module cannot be imported from a
//    Client Component module`)⇒ **`Tests: no tests` —— 連一格都沒跑, 而不是紅一格。**
//    ⚠️ 而 `route.ts` 是 2026-09-02 `⟦搜尋-第2刀⟧` 2a(`5e268d49`)才多引它們的
//    ⇒ 📌 **加一個 import 會讓一支【它沒改過】的測試整檔消失 —— 而報告上是「0 test」不是「1 failed」。**
const tryCatalogBrandTaxonomy = vi.fn();
const tryCategories = vi.fn();
const tryVehicleTaxonomy = vi.fn();
vi.mock('@/lib/products', () => ({
  tryCatalogBrandTaxonomy,
  tryCategories,
  tryVehicleTaxonomy,
}));

const { GET } = await import('./route');

const req = (q: string) => new Request(`http://x/api/search?q=${encodeURIComponent(q)}`);

const FULL_PRODUCT = {
  id: 1, slug: 'a', brand: 'B', name: 'N', price: 100, image: null,
  // 疊層畫不到的重欄位 —— 不該出現在回傳裡
  description: 'x'.repeat(500), images: ['1', '2'], fitments: [{ motoBrand: 'Honda' }],
};

beforeEach(() => {
  searchProducts.mockReset();
  // 預設:三支 taxonomy 都好、都空 ⇒ 既有那四格的斷言不受本次改動影響。
  tryCatalogBrandTaxonomy.mockReset().mockResolvedValue({ brands: [], failed: false });
  tryCategories.mockReset().mockResolvedValue({ categories: [], failed: false });
  tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: false });
});

describe('/api/search', () => {
  it('R1 空 q ⇒ 200 空陣列,且完全沒呼叫 searchProducts', async () => {
    const res = await GET(req('   '));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
    expect(searchProducts).not.toHaveBeenCalled();
    // 🔴 **R1 的分母 2026-09-02 變寬了**:2a 之後這條路上多了三支 taxonomy,
    //    而「不打 DB」要對它們也成立 —— 否則有人把 `Promise.all` 搬到早退之前,
    //    R1 照樣綠而「搜尋框一打開就叫醒 DB」就回來了。
    expect(tryCatalogBrandTaxonomy).not.toHaveBeenCalled();
    expect(tryCategories).not.toHaveBeenCalled();
    expect(tryVehicleTaxonomy).not.toHaveBeenCalled();
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

// ⟦搜尋-第2刀⟧ 2a 的兩個決定 —— 而它們原本【只活在一句註解裡】(`-f3` 自己標、`-c7` 審前補)。
describe('/api/search 的成本', () => {
  it('R7 疊層那條路【不】叫 DB 數總數 —— 而那是一個 560 倍的差', async () => {
    // 🔴 **為什麼這一格非有不可**(`-fc` 2026-09-02 R1 must-fix):
    //    `route.ts` 那段註解把理由寫得很完整 —— 而**那個知道沒有變成一格會紅的東西**。
    //    🧬 `-fc` 把第四個參數改回 `true` ⇒ **6 passed, 全綠** ⇒ 零守門。
    //
    //    而它比一般的「沒守門」重一格, 理由兩格:
    //    ① 這是**公開、無 auth** 的端點 ⇒ 回退的後果是【每個按鍵一次全表掃描】
    //    ② 而它**看不出來** —— 畫面完全正常, 只是慢;疊層那 220ms debounce 還蓋著它
    //       ⇒ 🔴 **回退之後沒有任何訊號會叫。**
    //    📌 ⇒ 而 `/search` 那條路**要**數(`app/search/page.tsx:85` 共 N 件)
    //       ⇒ 這一格釘的是【分路】, 不是「不要數」。
    searchProducts.mockResolvedValue({ items: [], total: null, error: false });

    await GET(req('碳纖維'));

    expect(searchProducts).toHaveBeenCalledWith('碳纖維', 8, 0, false);
  });
});

describe('/api/search 的另三區', () => {
  it('R5 三個 failed 各自回, 不合成一個', async () => {
    // 🔴 合成一個在型別上完全合法 ⇒ 而它壞掉的方式是【品牌查不到 ⇒ 三區都說查不到】。
    //    這一格用**三區狀態互不相同**的世界去問:`a||b||c` 三格全 true、
    //    `a&&b&&c` 三格全 false ⇒ 兩種合成法都紅。
    searchProducts.mockResolvedValue({ items: [], total: null, error: false });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: [], failed: true });
    tryCategories.mockResolvedValue({ categories: [], failed: false });
    tryVehicleTaxonomy.mockResolvedValue({ motoBrands: [], failed: true });

    const res = await GET(req('brembo'));
    const body = await res.json();

    // 🔵 `-c7` 2026-09-02 nit:這一行不是因為現在沒守住, 是因為**現在那個保護讀不出來**
    //    —— 下一個人會像 `-c7` 一樣以為沒守。(它原本被 `body.failed` 那格【間接】守著:
    //    變 503 的話 body 會是 `{error:'search_failed'}` ⇒ toEqual 必紅。)
    expect(res.status).toBe(200);
    expect(body.failed).toEqual({ brands: true, categories: false, vehicles: true });
  });

  it('R6 三區任一 failed 不讓整發變 503 —— 商品那一區是主體', async () => {
    // 🔴 這個決定原本只寫在 route.ts 的一句註解裡 ⇒ **沒有任何東西守著它**,
    //    而它是一個下一個人可以【無聲改掉】的決定:改成 503 之後,
    //    「品牌那支壞了」會讓客人連商品都搜不到。
    searchProducts.mockResolvedValue({
      items: [{ slug: 'a', brand: 'B', name: 'N', price: 1, image: null }],
      total: null,
      error: false,
    });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: [], failed: true });

    const res = await GET(req('brembo'));

    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1); // 🟢 商品照樣給
  });
});

// ══════════════════════════════════════════════════════════════════════
// 🔴🔴 「你是不是要找 X?」的候選(`⟦search-BRANDTYPOTRGM⟧` · Sean 2026-09-04 拍甲)
// ══════════════════════════════════════════════════════════════════════
describe('/api/search 的品牌候選', () => {
  const BRANDS = [
    { id: 'akrapovic', name: 'AKRAPOVIČ', count: 1 },
    { id: 'rizoma', name: 'RIZOMA', count: 1 },
  ];

  it('🔴 打錯字 ⇒ 回一個候選, 而且帶著連結用的 slug', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: BRANDS, failed: false });
    const body = await (await GET(req('akrpovic'))).json();
    expect(body.suggestion).toEqual({ name: 'AKRAPOVIČ', slug: 'akrapovic' });
  });

  it('🔴 亂編的字 ⇒ suggestion 是 null(不是 undefined —— 兩者在畫的人那邊不一樣)', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: BRANDS, failed: false });
    const body = await (await GET(req('zzzzzqqqqq'))).json();
    expect(body.suggestion).toBeNull();
  });

  it('🔴 品牌清單讀不到(failed)⇒ null —— 「沒有建議」比「猜一個」誠實', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: [], failed: true });
    const body = await (await GET(req('akrpovic'))).json();
    expect(body.suggestion).toBeNull();
  });

  it('🔵 **有結果的時候也照樣算** —— 判準只有一份, 在 UI 那邊', async () => {
    // 🛑 少了這一格, 有人「順手」在 route 加一個 `if (有結果) suggestion = null`,
    //    那就變成同一個判準有兩個實作 ⇒ 它們會漂, 而漂掉不會紅。
    searchProducts.mockResolvedValue({ items: [FULL_PRODUCT], total: 1, error: false });
    tryCatalogBrandTaxonomy.mockResolvedValue({ brands: BRANDS, failed: false });
    const body = await (await GET(req('akrpovic'))).json();
    expect(body.suggestion).toEqual({ name: 'AKRAPOVIČ', slug: 'akrapovic' });
  });
});
