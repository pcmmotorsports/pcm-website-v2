// @vitest-environment node
//
// products-search-terms.test.ts — ⟦db-SEARCHFACETMUTEX⟧ 關鍵字與 facet 不再互斥的守門。
//
// 🔴 **為什麼要在【這一層】釘,而不是只在 `products/page.test.tsx`**:那一支把
//   `fetchCatalogPage` 整支 mock 掉 ⇒ 它看得到「有沒有走這條路」,**看不到送進 RPC 的是什麼**。
//   而本片真正的行為住在參數裡:`p_terms` 有沒有帶、帶的是不是切好的詞。
//   ⇒ 📌 只斷言「走了哪條路」的測試對這一片**零判別力** —— 一個把 `p_terms` 寫死 `null`
//     的實作會讓上面那支全綠,而客人打的字被靜靜丟掉、拿到整張目錄。
//
// 🛑 **兩層方向【相反】而各自正確,兩邊都要釘**:
//   · RPC 那一側對「全是空白的詞」是 fail-**open**(`20260909010000:472` 逐字
//     `OR NOT EXISTS (… btrim(pt, c_ws) <> '')` ⇒ 整個關鍵字條件被跳過)
//     ⇒ 所以這一側**絕不可以送 `[]`**,要送 `null`。
//   · 而「客人打了字卻切不出任何一個詞」要 fail-**closed**(回 0 筆)——
//     `splitSearchTerms` 檔頭逐字寫著「回空陣列是一個【要呼叫端 fail-closed 的訊號】,
//     不是『沒有條件』」,實例是零寬空格(`'​'.trim()` 清不掉它)。
//   ⇒ 🎯 **少了任一邊,客人都會拿到【整張目錄】而以為那是搜尋結果 —— HTTP 200、畫面完全正常。**

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();

// 🔵 `splitSearchTerms` 餵**真的那支** —— 本片的整個賣點就是「兩條路同一把分詞尺」,
//    在這裡塞一個假的分詞器,等於把要驗的東西換掉。
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  return {
    createSupabaseAnonClient: () => ({ rpc }),
    SupabaseProductAdapter: class {},
    availabilityToBool: () => true,
    splitSearchTerms: real.splitSearchTerms,
  };
});

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import { fetchCatalogPage } from '@/lib/products';
import { parseCatalogQuery } from '@/lib/catalog-query';

function row(total: number, id = 'p1') {
  return {
    item: {
      id,
      title: 't',
      subtitle: null,
      handle: 'h',
      availability: 'in_stock',
      price_general: 100,
      card_image: null,
      fits: '通用款',
      brand_name: 'b',
      brand_slug: 'b',
      category_raw: 'c',
      fitments: [],
      card_image_trim: null,
    },
    total,
  };
}

const argsOf = (call = 0) => rpc.mock.calls[call]?.[1] as Record<string, unknown>;

const go = (qs: string) =>
  fetchCatalogPage(parseCatalogQuery(new URLSearchParams(qs)), null, 'general');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [row(1)], error: null });
});

describe('⟦db-SEARCHFACETMUTEX⟧ 關鍵字進 RPC 的 p_terms', () => {
  it('🔵 負對照:沒有 search ⇒ p_terms 是 null(不是 [],也不是漏送這個 key)', async () => {
    await go('page=1');
    expect(argsOf()).toHaveProperty('p_terms');
    expect(argsOf().p_terms, '沒搜尋卻帶了關鍵字條件 = 整個目錄頁被一個看不見的條件縮過').toBeNull();
  });

  it('🔴 有 search ⇒ p_terms 帶【切好的詞】進同一發 RPC', async () => {
    await go('search=akrapovic');
    expect(argsOf().p_terms).toEqual(['akrapovic']);
  });

  it('🔴 多個詞 ⇒ 逐詞送(AND 條件在 RPC 那側)', async () => {
    await go('search=' + encodeURIComponent('akrapovic 排氣管'));
    expect(argsOf().p_terms).toEqual(['akrapovic', '排氣管']);
  });

  // 🎯 **這一格就是本列的受詞** —— 關鍵字與 facet 同時出現在【同一發】RPC 的參數裡。
  it('🔴🔴 關鍵字 + 分類 + 品牌 + 價格 + 排序 + 分頁 ⇒ 全部在同一發 RPC,一起生效', async () => {
    await go('search=mt07&category=' + encodeURIComponent('煞車系統')
      + '&pbrands=ohlins&pmin=1000&pmax=5000&sort=price-asc&page=3&per=200');
    const a = argsOf();
    expect(a.p_terms, '關鍵字被丟掉 ⇒ 客人打的字沒作用').toEqual(['mt07']);
    expect(a.p_category, '分類被丟掉 ⇒ 回到互斥那個世界').toBe('煞車系統');
    expect(a.p_brand_slugs).toEqual(['ohlins']);
    expect(a.p_price_min).toBe(1000);
    expect(a.p_price_max).toBe(5000);
    expect(a.p_sort).toBe('price-asc');
    // 🎯 寫算式不寫結果 —— 抄一個 50 進來的話, 改 per 就再也不會紅。
    expect(a.p_offset).toBe((3 - 1) * 200);
    expect(a.p_limit).toBe(200);
    expect(rpc, '打了兩發 = 兩個快照, 而它們之間可以不一致').toHaveBeenCalledTimes(1);
  });

  it.each([
    ['空字串', ''],
    ['純空白', '   '],
  ])('🔵 search 是 %s ⇒ p_terms 是 null,而查詢【照常送出】(那是「沒有搜尋」不是「搜不到」)', async (_l, v) => {
    await go('search=' + encodeURIComponent(v));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(argsOf().p_terms).toBeNull();
  });

  // 🛑🛑 fail-closed 那一半。零寬空格是**真的會發生**的輸入(貼上來的字常帶著它)。
  it('🔴🔴 打了字卻一個詞都切不出來(零寬空格)⇒ 回 0 筆,而且【完全不打 RPC】', async () => {
    // 🔵 先證前提, 不是假設:`trim()` 清不掉它 ⇒ 上面那格「空白就短路」擋不住這個。
    expect('​'.trim()).toBe('​');
    const r = await go('search=' + encodeURIComponent('​'));
    expect(rpc, '送出去 = 一個【完全沒有條件】的查詢 ⇒ 整張目錄回來當搜尋結果').not.toHaveBeenCalled();
    expect(r.products).toEqual([]);
    expect(r.total).toBe(0);
    // ⚪ 這不是「壞掉」⇒ 不得畫成錯誤狀態, 要畫成「查無結果」。
    expect(r.error, '切不出詞是客人打的字的問題, 不是我們壞了').toBe(false);
  });
});

describe('/products?search= 的目錄 RPC:資料庫逾時(57014)重試一次(2026-09-11)', () => {
  const timeout = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

  it('第一發 57014、第二發成功 ⇒ 有結果, 兩發帶同一組 p_terms', async () => {
    rpc.mockResolvedValueOnce(timeout).mockResolvedValueOnce({ data: [row(1)], error: null });
    const r = await go('search=DBK%20SPECIAL');
    expect(r.error).toBe(false);
    expect(r.products).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(argsOf(1).p_terms).toEqual(argsOf(0).p_terms);
  });

  it('兩發都 57014 ⇒ 照舊 error:true, 只叫兩次', async () => {
    rpc.mockResolvedValue(timeout);
    const r = await go('search=DBK%20SPECIAL');
    expect(r.error).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('非 57014 的錯 ⇒ 不重試, 照舊 error:true', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    const r = await go('search=DBK%20SPECIAL');
    expect(r.error).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
