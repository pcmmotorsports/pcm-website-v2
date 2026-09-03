// @vitest-environment node
//
// app/products/page.tsx metadata 守門 — W9e-005(2026-08-20)
//
// 🔴 這支測試守不住這次的缺口:2026-08-19 那次「PCM Motorsports → PCM重機零件販售」改名
// commit(2111bff8)在 dev 上是對的(這支測試會綠),而 origin/main(顧客站生產環境綁的分支)
// 當時已經停在改名前 10 小時的 commit、之後再沒合併過 —— 顧客看到舊名字的原因是分支從沒
// 合併,不是字面改錯或漏測。**這支測試通過只證明「dev 上的字面對」,不證明「顧客看到的對」。**
// 詳見 ~/pcm-mailbox/W9e-005-站名落地-plan-20260820.md §0/§5/§6。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 🔴 必須 mock:本檔只要 `metadata`(靜態 const,不需真的 render),但 import './page' 會連帶
//    載入 `@/lib/products` / `@/lib/supabase/server` / `@/lib/auth/composition` ——
//    三支都 `import 'server-only'`,在 vitest(非 RSC 邊界)載入即 throw(同 brands/page.test.tsx
//    檔頭註解那個坑)。這裡只要它們不炸,不需要真的可用 —— 本測試不呼叫任何一個。
vi.mock('@/lib/products', () => ({
  fetchCatalogPage: vi.fn(),
  fetchCatalogBrandTaxonomy: vi.fn(),
  fetchCategories: vi.fn(),
  fetchVehicleTaxonomy: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/auth/composition', () => ({ getVehicleRepo: vi.fn() }));
// ⟦搜尋-落點換 /products⟧ 2026-09-03:第二條資料路。
vi.mock('@/lib/search', () => ({ searchProducts: vi.fn() }));
// ⟦search-CAPSULEPARSE⟧:`redirect()` 在 server component 是用 throw 實作的
// ⇒ mock 成 throw 一個認得出來的錯, 才驗得到「有沒有跳、跳去哪」。
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const e = new Error('NEXT_REDIRECT') as Error & { url?: string };
    e.url = url;
    throw e;
  }),
}));

const { metadata, default: ProductsRoute } = await import('./page');
const { fetchCatalogPage, fetchCategories, fetchVehicleTaxonomy, fetchCatalogBrandTaxonomy } =
  await import('@/lib/products');
const { searchProducts } = await import('@/lib/search');
const { getVehicleRepo } = await import('@/lib/auth/composition');

/** 三個側欄來源與 garage 都不是本組要驗的東西 —— 給到「不炸」為止就好。 */
function stubSidebars() {
  vi.mocked(fetchVehicleTaxonomy).mockResolvedValue([]);
  vi.mocked(fetchCategories).mockResolvedValue([]);
  vi.mocked(fetchCatalogBrandTaxonomy).mockResolvedValue([]);
  vi.mocked(getVehicleRepo).mockResolvedValue({
    listByCustomer: async () => [],
  } as unknown as Awaited<ReturnType<typeof getVehicleRepo>>);
}

describe('/products · metadata', () => {
  it('🔴 分頁標題 = 商品目錄 — PCM重機零件販售,不是舊名 PCM Motorsports', () => {
    expect(metadata.title).toBe('商品目錄 — PCM重機零件販售');
    expect(String(metadata.title)).not.toContain('PCM Motorsports');
  });
});

// ── ⟦搜尋-落點換 /products⟧ 2026-09-03 · **同一頁, 兩條資料路** ─────────────────
//
// 🔴🔴 **這一組是本片唯一驗得到「走了哪條路」的地方。**
//    元件測試看得到膠囊有沒有畫, 但**看不到商品是誰撈的** —— 而走錯路的失敗形狀是:
//    `?search=` 被丟給沒有關鍵字參數的 RPC ⇒ **靜靜地回全部商品**, 畫面完全正常。
//    (`-auth` 2026-09-03 對 dev 實打三個參數名 `search`/`q`/`keyword` ⇒ 三個都回全部,
//     三個都試是刻意的:只試一個的話「不吃這個名字」與「不吃任何關鍵字」分不出來。)
describe('/products · 兩條資料路(⟦搜尋-落點換 /products⟧)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSidebars();
  });

  const run = (qs: Record<string, string>) =>
    ProductsRoute({ searchParams: Promise.resolve(qs) });

  // 🔵🔵 **負對照排第一格 —— 它守的是「我沒有弄壞既有的目錄頁」。**
  it('🔵 沒有 search ⇒ 走 fetchCatalogPage, 而**完全不碰** searchProducts', async () => {
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    await run({ page: '2' });
    expect(fetchCatalogPage).toHaveBeenCalledTimes(1);
    expect(searchProducts, '沒搜尋卻走了關鍵字路 = 整個目錄頁換了資料來源').not.toHaveBeenCalled();
  });

  it('🔴 有 search ⇒ 走 searchProducts, 而**完全不碰** fetchCatalogPage', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], total: 0, error: false });
    await run({ search: 'akrapovic' });
    expect(searchProducts).toHaveBeenCalledTimes(1);
    // 🛑 這一行擋的正是今天 dev 的行為:關鍵字被交給沒有關鍵字參數的 RPC ⇒ 回全站。
    expect(fetchCatalogPage, '關鍵字交給 RPC ⇒ 被忽略 ⇒ 靜靜給客人全部商品').not.toHaveBeenCalled();
  });

  it('🔴 關鍵字與分頁一起送過去(分頁不生效 = 客人看不到第 25 筆以後 = 漏資料)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], total: 0, error: false });
    await run({ search: 'mt07', page: '3', per: '25' });
    const [q, limit, offset] = vi.mocked(searchProducts).mock.calls[0]!;
    expect(q).toBe('mt07');
    expect(limit).toBe(25);
    // 🎯 第 3 頁 = 跳過前兩頁。寫算式不寫結果 —— 抄一個 50 進來的話, 改 per 就再也不會紅。
    expect(offset).toBe((3 - 1) * 25);
  });

  // 🔴🔴 主視窗點名「絕對不准」的那個失敗態。
  it.each([
    ['空字串', ''],
    ['純空白', '   '],
  ])('🔴 search 是 %s ⇒ 走目錄路, **不得**用空關鍵字去查(ILIKE %% ⇒ 撈回全站)', async (_l, v) => {
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    await run({ search: v });
    expect(searchProducts).not.toHaveBeenCalled();
    expect(fetchCatalogPage).toHaveBeenCalledTimes(1);
  });

  it('🔴 關鍵字路的 total 是 null ⇒ 往下傳 undefined(不知道總數 ≠ 0 件)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], total: null, error: false });
    const el = (await run({ search: 'mt07' })) as { props: { children: unknown[] } };
    // 🎯 `?? 0` 會讓畫面印「共 0 件」而卡片就在那個 0 底下 —— 不知道就不要編一個。
    const page = el.props.children.find(
      (c): c is { props: Record<string, unknown> } =>
        typeof c === 'object' && c !== null && 'props' in c && 'searchKeyword' in (c as { props: object }).props,
    );
    expect(page?.props.total).toBeUndefined();
    expect(page?.props.searchKeyword).toBe('mt07');
  });
});

// ── ⟦search-CAPSULEPARSE⟧ 2026-09-03:自由文字 ⇒ 膠囊 ────────────────────────
describe('/products · 解析成膠囊之後 redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSidebars();
  });

  /** 跑 route,把 `redirect()` 丟出來的網址接住。沒跳就回 null。 */
  async function redirectedTo(qs: Record<string, string>): Promise<string | null> {
    try {
      await ProductsRoute({ searchParams: Promise.resolve(qs) });
      return null;
    } catch (e) {
      const err = e as Error & { url?: string };
      if (err.message === 'NEXT_REDIRECT') return err.url ?? '';
      throw e;
    }
  }

  it('🔴 「mt07 akrapovic」⇒ 跳到帶膠囊的網址(Sean 原話那個例子)', async () => {
    vi.mocked(fetchVehicleTaxonomy).mockResolvedValue([
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
    ] as unknown as Awaited<ReturnType<typeof fetchVehicleTaxonomy>>);
    vi.mocked(fetchCatalogBrandTaxonomy).mockResolvedValue([
      { id: 'akrapovic', name: 'AKRAPOVIČ', count: 9 },
    ] as unknown as Awaited<ReturnType<typeof fetchCatalogBrandTaxonomy>>);
    const url = await redirectedTo({ search: 'mt07 akrapovic' });
    expect(url).toContain('vehicle=yamaha%3Amt-07');
    expect(url).toContain('pbrands=akrapovic');
    // 🔴 零剩字 ⇒ 不得帶 unmatched
    expect(url).not.toContain('unmatched');
    // 🛑 而**不得**把原句留在 search —— 留著的話 route 會走關鍵字路而忽略膠囊
    expect(url, 'search 還在 ⇒ 剛解析出來的膠囊會被自己忽略掉').not.toContain('search=');
  });

  it('🔴🔴 解析一半 ⇒ 沒用到的字走 `unmatched=`, **不是** `search=`', async () => {
    vi.mocked(fetchVehicleTaxonomy).mockResolvedValue([
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
    ] as unknown as Awaited<ReturnType<typeof fetchVehicleTaxonomy>>);
    const url = await redirectedTo({ search: 'mt07 好看的' });
    expect(url).toContain('vehicle=yamaha%3Amt-07');
    expect(url).toContain('unmatched=');
    // 🎯 這一行是本片最貴的那一格:leftover 若進了 search,
    //    route 會走關鍵字路 ⇒ 膠囊不生效**而且**被藏起來 ⇒ 比不解析更糟。
    expect(url, 'leftover 進了 search ⇒ 膠囊不生效也不顯示').not.toContain('search=');
  });

  // 🔵🔵 **本片最重要的負對照** —— 這一片動的是【每一次搜尋都會經過的那條路】。
  it.each([
    ['完全解析不出來', 'zzz不存在zzz'],
    ['純標點', '--- ...'],
  ])('🔵 %s ⇒ **不跳**, 走今天那條關鍵字路(行為逐字不變)', async (_l, q) => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], total: 0, error: false });
    expect(await redirectedTo({ search: q })).toBeNull();
    expect(searchProducts, '沒解析出東西就該照舊走關鍵字路').toHaveBeenCalledTimes(1);
  });

  it('🔵 負對照:網址已經有 vehicle ⇒ **不再解析**(否則會二次跳 = 迴圈)', async () => {
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    expect(await redirectedTo({ search: 'mt07', vehicle: 'yamaha:mt-07' })).toBeNull();
  });

  // 🔴 code-reviewer 2026-09-04 minor:`pbrands` 那道 guard 零測試覆蓋。
  it('🔵 網址已經有 pbrands ⇒ **不再解析**(不得用猜的覆蓋他明確選的)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], total: 0, error: false });
    expect(await redirectedTo({ search: 'mt07', pbrands: 'akrapovic' })).toBeNull();
  });

  it('🔴 redirect 要**保留**原本的其他參數(sort/per 不得被丟掉)', async () => {
    vi.mocked(fetchVehicleTaxonomy).mockResolvedValue([
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
    ] as unknown as Awaited<ReturnType<typeof fetchVehicleTaxonomy>>);
    const url = await redirectedTo({ search: 'mt07', sort: 'price-asc', per: '25' });
    expect(url).toContain('sort=price-asc');
    expect(url).toContain('per=25');
    // 🛑 而原本那個 search 要被拿掉 —— 留著 route 會走關鍵字路而忽略膠囊。
    expect(url).not.toContain('search=');
  });

  it('🔵 負對照:沒有 search ⇒ 一次都不解析(既有目錄頁零影響)', async () => {
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    expect(await redirectedTo({ page: '2' })).toBeNull();
    expect(fetchCatalogPage).toHaveBeenCalledTimes(1);
  });
});
