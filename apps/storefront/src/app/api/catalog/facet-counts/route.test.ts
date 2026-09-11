// @vitest-environment node
//
// route.test.ts — #306 facet-counts route handler 守門。
//
// 🔴 這支 route 是**公開**端點,而它的放大係數是 **108**(一次冷請求 = 108 條 DB 查詢)⇒
//   三道車輛白名單(形狀 / 字典 / 年份)把 key 空間綁死在車輛字典上,每一道都必須有負向測試。
//   拿掉任一道 = 任何人都能用亂數車款字串驅動無上限的 DB 查詢。
//   (速率面的節流在 `vehicle-facet-counts.ts` 的 fan-out 閘,測試在該檔。)
// 🔴 另一組是 fail-safe:算不出來時必須明講失敗(503),讓 client 維持「不顯示件數」;
//   絕不能退回全站總數頂替 —— 那正是 #306 要修掉的誤導。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 的 factory 會被 hoist 到檔頂 ⇒ 它引用的 mock 必須用 vi.hoisted 一起提上去。
const { fetchFacetCounts, fetchVehicleTaxonomy, fetchCategories, fetchCatalogBrandTaxonomy } =
  vi.hoisted(() => ({
    fetchFacetCounts: vi.fn(),
    fetchVehicleTaxonomy: vi.fn(),
    fetchCategories: vi.fn(),
    fetchCatalogBrandTaxonomy: vi.fn(),
  }));

vi.mock('@/lib/products', () => ({
  fetchVehicleTaxonomy,
  fetchCategories,
  fetchCatalogBrandTaxonomy,
}));

vi.mock('@/lib/vehicle-facet-counts', () => ({ fetchFacetCounts }));

const NONE = { categories: [], brandSlugs: [] };

const TAXONOMY = [
  {
    id: 'kawasaki',
    name: 'KAWASAKI',
    models: [{ id: 'zx10r', name: 'Ninja ZX-10R', years: [2023, 2024] }],
  },
];
const CATEGORIES = [
  { id: 'c1', name: '碳纖維部品', count: 2130, children: [] },
  { id: 'c2', name: '操控部品', count: 10, children: [{ id: 's1', name: '腳踏後移', count: 4 }] },
];
const BRANDS = [
  { id: 'rpm-carbon', name: 'RPM CARBON', count: 1900 },
  { id: 'akrapovic', name: 'Akrapovic', count: 12 },
];

import { GET, categoryFacetKeys } from './route';

const OK_COUNTS = { categories: { 碳纖維部品: 198 }, brands: { 'rpm-carbon': 190 } };

function get(query: string) {
  return GET(new Request(`https://shop.pcmmotorsports.com/api/catalog/facet-counts${query}`));
}

beforeEach(() => {
  fetchFacetCounts.mockReset();
  fetchFacetCounts.mockResolvedValue(OK_COUNTS);
  fetchVehicleTaxonomy.mockReset().mockResolvedValue(TAXONOMY);
  fetchCategories.mockReset().mockResolvedValue(CATEGORIES);
  fetchCatalogBrandTaxonomy.mockReset().mockResolvedValue(BRANDS);
});

describe('GET /api/catalog/facet-counts', () => {
  it('合法車輛 → 200,把 slug 解成真名稱後帶進取數層', async () => {
    const res = await get('?vehicle=kawasaki:zx10r:2024');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(OK_COUNTS);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchFacetCounts).toHaveBeenCalledWith(
      { brand: 'KAWASAKI', model: 'Ninja ZX-10R', year: 2024 },
      // 子類要帶完整路徑(`大類 · 子類`),否則 RPC 的 LIKE 比對會算成整個大類
      ['碳纖維部品', '操控部品', '操控部品 · 腳踏後移'],
      ['rpm-carbon', 'akrapovic'],
      NONE,
    );
  });

  it('只選廠牌也能算(逐層送出是正式站既有能力)', async () => {
    const res = await get('?vehicle=kawasaki');
    expect(res.status).toBe(200);
    expect(fetchFacetCounts.mock.calls[0]?.[0]).toEqual({ brand: 'KAWASAKI' });
  });

  it.each([
    ['什麼都沒選(沒車、沒品牌、沒分類)', '', 'nothing_to_count'],
    // 🔴 帶了 vehicle 而形狀不合法 ⇒ 不得退成「沒車」拿全目錄的數字回他
    ['vehicle 形狀不合法而同時有品牌', '?vehicle=KAWASAKI%20zx10r&pbrands=rpm-carbon', 'invalid_vehicle'],
    ['已選品牌不在品牌表', '?pbrands=rpm-carbon,no-such-brand', 'unknown_selection'],
    ['已選分類不在分類樹', '?categories=%E4%B8%8D%E5%AD%98%E5%9C%A8', 'unknown_selection'],
    ['形狀不合法(大寫/空白)', '?vehicle=KAWASAKI%20zx10r', 'invalid_vehicle'],
    ['字典查無廠牌', '?vehicle=lamborghini', 'unknown_vehicle'],
    ['字典查無車型', '?vehicle=kawasaki:zx-999', 'unknown_model'],
    ['字典查無年份', '?vehicle=kawasaki:zx10r:1999', 'unknown_year'],
  ])('%s → 400 且完全不查 DB', async (_label, query, error) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // 🔴 節流的重點不是回 400,是「沒有打到 DB」——**每一個來源都要斷言**。
    //    原本只斷言 fetchFacetCounts(codex 關卡2 C5:測試名寫「完全不查 DB」但只驗了一支,
    //    而分類與品牌其實在驗證前就被並行讀掉了、品牌那支當時還沒有快取)。
    // 🔵 已選篩選的白名單要先讀分類 / 品牌字典(都有 60s 快取)才判得了 ⇒ 那兩格只斷言沒打件數 RPC。
    expect(fetchFacetCounts).not.toHaveBeenCalled();
    if (error !== 'unknown_selection') {
      expect(fetchCategories).not.toHaveBeenCalled();
      expect(fetchCatalogBrandTaxonomy).not.toHaveBeenCalled();
    }
  });

  it('🔴 沒選車、只選品牌 → 200,車送 null、已選品牌帶進取數層(Sean 09-12 抓到的那個情境)', async () => {
    const res = await get('?pbrands=rpm-carbon');
    expect(res.status).toBe(200);
    expect(fetchFacetCounts).toHaveBeenCalledWith(
      null,
      ['碳纖維部品', '操控部品', '操控部品 · 腳踏後移'],
      ['rpm-carbon', 'akrapovic'],
      { categories: [], brandSlugs: ['rpm-carbon'] },
    );
    // 沒車就不必讀車輛字典
    expect(fetchVehicleTaxonomy).not.toHaveBeenCalled();
  });

  it('車 + 已選分類(新舊兩種參數都吃,與列表同一支 parser)+ 已選品牌 → 全部帶進去', async () => {
    const res = await get(
      '?vehicle=kawasaki:zx10r:2024&categories=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81%20%C2%B7%20%E8%85%B3%E8%B8%8F%E5%BE%8C%E7%A7%BB&category=%E7%A2%B3%E7%BA%96%E7%B6%AD%E9%83%A8%E5%93%81&pbrand=akrapovic',
    );
    expect(res.status).toBe(200);
    expect(fetchFacetCounts.mock.calls[0]?.[0]).toEqual({ brand: 'KAWASAKI', model: 'Ninja ZX-10R', year: 2024 });
    expect(fetchFacetCounts.mock.calls[0]?.[3]).toEqual({
      categories: ['操控部品 · 腳踏後移', '碳纖維部品'],
      brandSlugs: ['akrapovic'],
    });
  });

  it('取數失敗 → 503,不回任何數字讓 client 頂替', async () => {
    fetchFacetCounts.mockResolvedValue(null);
    const res = await get('?vehicle=kawasaki:zx10r:2024');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'facet_counts_unavailable' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  // 🔴 三支 taxonomy 都是「自己 catch 掉回 []」⇒ 空陣列 = 這次讀取失敗,不是「沒有分類」。
  //    照著往下跑會回 200 半套(分類全空),而 #306-b 依 Q2=A 會把整個分類面板灰掉且點不下去。
  it.each([
    ['分類讀取失敗', () => fetchCategories.mockResolvedValue([])],
    ['品牌讀取失敗', () => fetchCatalogBrandTaxonomy.mockResolvedValue([])],
    ['車輛字典讀取失敗', () => fetchVehicleTaxonomy.mockResolvedValue([])],
  ])('%s(回空陣列)→ 503,不得回 200 半套、也不得誤報成 400', async (_label, breakIt) => {
    breakIt();
    const res = await get('?vehicle=kawasaki:zx10r:2024');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'taxonomy_unavailable' });
    expect(fetchFacetCounts).not.toHaveBeenCalled();
  });

  // 🔴 2026-07-31 實跑抓到:`fetchCatalogBrandTaxonomy` 的 `createSupabaseAnonClient()` 寫在 try
  //    **外面** ⇒ 環境變數缺漏時是未捕捉的 throw、直接 500、繞過上面那道 503 守門。
  it('上游 taxonomy 直接 throw(不是回空陣列)→ 一樣收斂成 503,不得變成 500', async () => {
    fetchCatalogBrandTaxonomy.mockRejectedValue(new Error('NEXT_PUBLIC_SUPABASE_URL not set'));
    const res = await get('?vehicle=kawasaki:zx10r:2024');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'taxonomy_unavailable' });
    expect(fetchFacetCounts).not.toHaveBeenCalled();
  });

  it('分類名含 LIKE 萬用字元 → 該分類不進 facet key(算得出來但點不進去,比沒數字更糟)', async () => {
    fetchCategories.mockResolvedValue([
      { id: 'c1', name: '正常分類', count: 5, children: [] },
      { id: 'c2', name: '含%萬用字元', count: 5, children: [] },
      { id: 'c3', name: '含_底線', count: 5, children: [] },
    ]);
    await get('?vehicle=kawasaki:zx10r:2024');
    expect(fetchFacetCounts.mock.calls[0]?.[1]).toEqual(['正常分類']);
  });
});

describe('categoryFacetKeys', () => {
  it('大類 + `大類 · 子類`,順序與分類樹一致', () => {
    expect(
      categoryFacetKeys([
        { id: 'a', name: 'A', count: 1, children: [{ id: 'a1', name: 'A1', count: 1 }] },
        { id: 'b', name: 'B', count: 2, children: [] },
      ]),
    ).toEqual(['A', 'A · A1', 'B']);
  });
});
