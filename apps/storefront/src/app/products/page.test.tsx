// 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):route 改走【帶 `failed` 的那扇門】
//   ⇒ 本檔的 mock 與斷言跟著換受詞:`fetchVehicleTaxonomy` ⇒ `tryVehicleTaxonomy`,
//   回傳形狀從 `MockMotoBrand[]` 變成 `{ motoBrands, failed }`。
//   🛑 **不是為了讓測試變綠才改** —— 是被測的那一行真的換了呼叫對象;
//      不改的話這幾格會綠在一個【已經不存在的呼叫】上。
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
  tryCatalogBrandTaxonomy: vi.fn(),
  tryCategories: vi.fn(),
  tryVehicleTaxonomy: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/auth/composition', () => ({ getVehicleRepo: vi.fn() }));
// ⟦搜尋-落點換 /products⟧ 2026-09-03:第二條資料路。
vi.mock('@/lib/search', () => ({ searchProducts: vi.fn() }));
// 🔴🔴 **`@/lib/search-log` 也要 mock —— 而它是【漏掉這一行】把整支檔弄紅的**(2026-09-04 `-auth`):
//    `page.tsx` 為了記膠囊那條的語料而 import 它, 而那支檔頭是 `import 'server-only'`
//    ⇒ 在 jsdom(client)環境載入即 throw `This module cannot be imported from a Client Component`。
//    🛑 而**我當時沒發現**:`vitest related` 對 `search-facets.ts` 只撈到 2 檔、
//       而我手挑的那份清單是為【另一片】建的 ⇒ **本檔兩個分母都沒涵蓋到。**
//    ⇒ 📌 判別句:**我這份測試清單, 是為【這一片動到的檔】建的, 還是我手邊剛好有的那一份?**
vi.mock('@/lib/search-log', () => ({ logSearchQuery: vi.fn() }));
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
const { fetchCatalogPage, tryCategories, tryVehicleTaxonomy, tryCatalogBrandTaxonomy } =
  await import('@/lib/products');
const { searchProducts } = await import('@/lib/search');
const { getVehicleRepo } = await import('@/lib/auth/composition');

/** 三個側欄來源與 garage 都不是本組要驗的東西 —— 給到「不炸」為止就好。 */
function stubSidebars() {
  vi.mocked(tryVehicleTaxonomy).mockResolvedValue({ motoBrands: [], failed: false });
  vi.mocked(tryCategories).mockResolvedValue({ categories: [], failed: false });
  vi.mocked(tryCatalogBrandTaxonomy).mockResolvedValue({ brands: [], failed: false });
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

  // ── ⟦search-SHORTNAMEZEROFLASH⟧ 首發要認得裸【子】分類名 ──
  // 🔴🔴 **這兩格存在的理由**:本檔的 `stubSidebars()` 把 `tryCategories` 餵成 `[]`
  //    ⇒ `parseCategoryFromUrl` 在**其餘每一格裡恆回 null** ⇒ 🛑 **那 15 格對這條新分支
  //      【零判別力】** —— 有人把 `effectiveQuery` 改回 `catalogQuery`, 三綠全綠、沒有東西會紅。
  //    ⇒ 📌 **所以要餵一棵【真的有子分類的樹】, 那條分支才進得去。**(R1 對抗審查抓到)
  const DUP_TREE = [
    { id: 'atv', name: '四輪 ATV/UTV', count: 22, children: [{ id: 'atv-hose', name: '水管束環', count: 22 }] },
    { id: 'eng', name: '引擎與冷卻', count: 690, children: [{ id: 'eng-hose', name: '水管束環', count: 690 }] },
  ];

  it('🔴 裸【子】分類名 ⇒ 首發就送【全路徑】進 RPC(而且取件數最大那個父)', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ categories: DUP_TREE, failed: false } as never);
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    await run({ category: '水管束環' });
    expect(vi.mocked(fetchCatalogPage).mock.calls[0]?.[0].category).toBe('引擎與冷卻 · 水管束環');
  });

  // 🔴🔴 **R1 對抗審查抓到的 Critical 的守門**:解析出全路徑之後, **裸短名不可以留在 `categories` 裡**。
  //    留著的話 RPC 那側會把兩顆併成一份 `v_cats` ⇒ 而那顆裸短名若剛好也是某個【頂層分類】的名字,
  //    `category_raw = vc OR LIKE vc || ' · %'` 會把**整棵頂層樹**撈進來 ⇒ 比修之前【多撈】。
  it('🔴 裸子分類名解析後, categories 裡只剩全路徑 —— 裸短名不可以跟著送進去', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ categories: DUP_TREE, failed: false } as never);
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    await run({ category: '水管束環' });
    expect(vi.mocked(fetchCatalogPage).mock.calls[0]?.[0].categories).toEqual(['引擎與冷卻 · 水管束環']);
  });

  it('🔵 負對照:誰都不是的名字 ⇒ 原封送出, 不可以退化成「挑一個最像的」', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ categories: DUP_TREE, failed: false } as never);
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
    await run({ category: 'QQ9Z7XKW' });
    expect(vi.mocked(fetchCatalogPage).mock.calls[0]?.[0].category).toBe('QQ9Z7XKW');
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

  // 🔴🔴 **R1 對抗審查抓到的 must-fix 的守門**:redirect 之後**兩個鍵都要在**。
  //    只寫 `categories=` 的話, 畫膠囊那條路(`products-url-parsers` 只讀 `category`)
  //    ⇒ **一顆膠囊都畫不出來, 而篩選照樣生效** ⇒ Sean 要「兩顆都列」而結果是零顆。
  //    🛑 **而我第一版就是只寫新鍵, 全套測試【一格都沒紅】** —— 所以要有這一格。
  it('🔴 解析出分類 ⇒ 網址上 categories 與 category 兩個鍵【都要在】', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ failed: false, categories: [
      { id: 'grip', name: '止滑貼與保護膜', count: 3,
        children: [{ id: 'tank', name: '油箱止滑貼', count: 2 }] },
    ] } as never);
    const url = await redirectedTo({ search: '油箱貼' });
    expect(url, 'categories 沒寫 ⇒ server 撈不到那個聯集').toContain('categories=');
    expect(url, 'category 沒寫 ⇒ 膠囊畫不出來, 而篩選還生效').toMatch(/[?&]category=/);
  });

  // ── ⟦Q47 甲⟧ 2026-09-07:轉址要把【原搜尋詞】帶過去, 而它同時是「別再轉址」的開關 ──
  it('🔴 轉址網址要帶 q0=原詞 —— 少了它, 分類頁那一行「查看全部搜尋結果」就消失', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ failed: false, categories: [
      { id: 'grip', name: '止滑貼與保護膜', count: 3,
        children: [{ id: 'tank', name: '油箱止滑貼', count: 2 }] },
    ] } as never);
    const url = await redirectedTo({ search: '油箱貼' });
    // 🔴 這一格就是本片的突變靶:拿掉 `next.set('q0', …)` ⇒ 這裡必須紅。
    expect(url, "q0 沒帶 ⇒ 分類頁不知道客人本來打什麼 ⇒ 那一行整條不渲染").toContain('q0=');
    expect(url, 'q0 要是【原詞】, 不是解析後的東西').toContain(encodeURIComponent('油箱貼'));
  });

  it('🔴 帶著 q0 再進來 ⇒ 【不再轉址】(否則點「查看全部」會被彈回分類頁, 無窮來回)', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ failed: false, categories: [
      { id: 'grip', name: '止滑貼與保護膜', count: 3,
        children: [{ id: 'tank', name: '油箱止滑貼', count: 2 }] },
    ] } as never);
    // 🔵 這就是「查看全部搜尋結果 →」那條連結的形狀:`?search=<詞>&q0=<詞>`
    expect(await redirectedTo({ search: '油箱貼', q0: '油箱貼' })).toBeNull();
  });

  it('🔴 「mt07 akrapovic」⇒ 跳到帶膠囊的網址(Sean 原話那個例子)', async () => {
    vi.mocked(tryVehicleTaxonomy).mockResolvedValue({
      motoBrands: [
        { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
      ],
      failed: false,
    } as unknown as Awaited<ReturnType<typeof tryVehicleTaxonomy>>);
    vi.mocked(tryCatalogBrandTaxonomy).mockResolvedValue({ failed: false, brands: [
      { id: 'akrapovic', name: 'AKRAPOVIČ', count: 9 },
    ] } as unknown as Awaited<ReturnType<typeof tryCatalogBrandTaxonomy>>);
    const url = await redirectedTo({ search: 'mt07 akrapovic' });
    expect(url).toContain('vehicle=yamaha%3Amt-07');
    expect(url).toContain('pbrands=akrapovic');
    // 🔴 零剩字 ⇒ 不得帶 unmatched
    expect(url).not.toContain('unmatched');
    // 🛑 而**不得**把原句留在 search —— 留著的話 route 會走關鍵字路而忽略膠囊
    expect(url, 'search 還在 ⇒ 剛解析出來的膠囊會被自己忽略掉').not.toContain('search=');
  });

  it('🔴🔴 解析一半 ⇒ 沒用到的字走 `unmatched=`, **不是** `search=`', async () => {
    vi.mocked(tryVehicleTaxonomy).mockResolvedValue({
      motoBrands: [
        { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
      ],
      failed: false,
    } as unknown as Awaited<ReturnType<typeof tryVehicleTaxonomy>>);
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
    vi.mocked(tryVehicleTaxonomy).mockResolvedValue({
      motoBrands: [
        { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07', years: [2021] }] },
      ],
      failed: false,
    } as unknown as Awaited<ReturnType<typeof tryVehicleTaxonomy>>);
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

// 🔴🔴 **2026-09-06 R1 must-fix:`failed` 那條接線原本零守門。**
//   ⛔ ~~第一版想 render 出 HTML 再比字串~~ ⇒ `ProductsPage` 是 client component、
//     要 `useRouter` 一整套 ⇒ **那是把 harness 撐大, 不是把守門做對。**
//   ✅ **改成【不渲染, 走元素樹】** —— route 回的是一棵 React element,
//     那個 prop 有沒有被傳下去, 在樹上就問得到, 而它不需要瀏覽器也不需要 mock 半個 Next。
//   🛑 **兩格成對** —— 少了負對照, 一個無條件為 true 的實作照樣過。
describe('/products 的 vehicleTaxonomyFailed 接線(⟦search-TAXONOMYTIMEOUT⟧)', () => {
  /** 在 route 回的元素樹裡找第一個帶 `vehicleTaxonomyFailed` 的 props。找不到 ⇒ undefined。 */
  const findFailedProp = (node: unknown): boolean | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findFailedProp(n);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props && 'vehicleTaxonomyFailed' in props) return props.vehicleTaxonomyFailed as boolean;
    return props ? findFailedProp(props.children) : undefined;
  };

  it('🔴 撈失敗 ⇒ 旗標真的被傳下去(true)', async () => {
    vi.mocked(tryVehicleTaxonomy).mockResolvedValue({
      motoBrands: [],
      failed: true,
    } as unknown as Awaited<ReturnType<typeof tryVehicleTaxonomy>>);
    const tree = await ProductsRoute({ searchParams: Promise.resolve({}) } as never);
    expect(findFailedProp(tree)).toBe(true);
  });

  it('🔵 負對照:沒失敗(清單空的也一樣)⇒ 傳下去的是 false, 不是恆真', async () => {
    vi.mocked(tryVehicleTaxonomy).mockResolvedValue({
      motoBrands: [],
      failed: false,
    } as unknown as Awaited<ReturnType<typeof tryVehicleTaxonomy>>);
    const tree = await ProductsRoute({ searchParams: Promise.resolve({}) } as never);
    expect(findFailedProp(tree)).toBe(false);
  });

  it('🟢 正對照:那把尺【找得到東西】—— 找一個不存在的 prop 名必須回 undefined', async () => {
    // 🛑 少了這一格,「回 false」與「這棵樹上根本沒有那個 prop」分不開(後者也不是 true)。
    const tree = await ProductsRoute({ searchParams: Promise.resolve({}) } as never);
    const findAny = (node: unknown, key: string): unknown => {
      if (!node || typeof node !== 'object') return undefined;
      if (Array.isArray(node)) {
        for (const n of node) {
          const hit = findAny(n, key);
          if (hit !== undefined) return hit;
        }
        return undefined;
      }
      const props = (node as { props?: Record<string, unknown> }).props;
      if (props && key in props) return props[key];
      return props ? findAny(props.children, key) : undefined;
    };
    expect(findAny(tree, 'zqNoSuchPropXY9')).toBeUndefined();
    expect(findAny(tree, 'vehicleTaxonomyFailed')).not.toBeUndefined();
  });
});

// 🔴 ⟦search-SILENTDOORS2⟧:型錄那兩扇的接線守門 —— 走元素樹, 理由同上面車款那組。
describe('/products 的 category/brand TaxonomyFailed 接線(⟦search-SILENTDOORS2⟧)', () => {
  const findProp = (node: unknown, key: string): unknown => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findProp(n, key);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props && key in props) return props[key];
    return props ? findProp(props.children, key) : undefined;
  };
  const tree = () => ProductsRoute({ searchParams: Promise.resolve({}) } as never);

  it('🔴 分類撈失敗 ⇒ 旗標傳下去是 true', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ categories: [], failed: true } as never);
    expect(findProp(await tree(), 'categoryTaxonomyFailed')).toBe(true);
  });

  it('🔵 負對照:分類沒失敗 ⇒ false, 不是恆真', async () => {
    vi.mocked(tryCategories).mockResolvedValue({ categories: [], failed: false } as never);
    expect(findProp(await tree(), 'categoryTaxonomyFailed')).toBe(false);
  });

  it('🔴 品牌撈失敗 ⇒ 旗標傳下去是 true', async () => {
    vi.mocked(tryCatalogBrandTaxonomy).mockResolvedValue({ brands: [], failed: true } as never);
    expect(findProp(await tree(), 'brandTaxonomyFailed')).toBe(true);
  });

  it('🔵 負對照:品牌沒失敗 ⇒ false, 不是恆真', async () => {
    vi.mocked(tryCatalogBrandTaxonomy).mockResolvedValue({ brands: [], failed: false } as never);
    expect(findProp(await tree(), 'brandTaxonomyFailed')).toBe(false);
  });

  it('🟢 正對照:那把尺找得到東西 —— 現造的 prop 名必回 undefined', async () => {
    const t = await tree();
    expect(findProp(t, 'zqNoSuchPropXY9')).toBeUndefined();
    expect(findProp(t, 'categoryTaxonomyFailed')).not.toBeUndefined();
    expect(findProp(t, 'brandTaxonomyFailed')).not.toBeUndefined();
  });
});
