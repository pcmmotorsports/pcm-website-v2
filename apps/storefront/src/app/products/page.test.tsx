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
