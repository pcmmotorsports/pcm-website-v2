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
// ⟦b4-DEALERSIGNUPUNSEEN⟧ 第二半:這兩支帶 `server-only` ⇒ 不 mock 的話整支測試檔【載不起來】
//   🔴 而那印的是 `Tests no tests` —— **少了一整批綠, 而它比多一個紅難發現**(memory 記過)。
const resolveAuthenticatedTier = vi.fn(() => Promise.resolve('general' as const));
// 🔴 route 2026-09-08 起改用 **Strict** 版(它多回一格 `reason`, 用來分辨
//    「訪客」與「登入了而 tier 讀不到」)⇒ 兩支都要 mock。
//    🛑 而本 mock **由 `resolveAuthenticatedTier` 推導**, 不各寫一份 ——
//    📌 各寫一份的話, 測試裡設了 `store` 而 Strict 那支還回 `general`,
//      **那種不一致不會有任何東西叫。**
const resolveAuthenticatedTierStrict = vi.fn(async () => {
  const tier = await resolveAuthenticatedTier();
  return { ok: true, tier } as const;
});
const fetchEffectivePrices = vi.fn(
  (_args: { tier: string; productIds: readonly string[]; variantIds: readonly string[] }) =>
    Promise.resolve(new Map<string, number>()),
);
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTier, resolveAuthenticatedTierStrict }));
vi.mock('@/lib/tier-prices', () => ({
  fetchEffectivePrices,
  priceKey: (kind: string, id: string) => `${kind}:${id}`,
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

// ── ⟦front-CATALOGPRICEGENERALONLY⟧ M-2-08 · 目錄頁的價格篩選吃誰的價 ────────────
//
// 🔴🔴 **這一組【釘的是今天的錯誤行為】, 不是期望行為。**
//    Sean 2026-09-07 `Q74 = 要` ⇒ 經銷會員的價格篩選要用**他看到的那個價**。
//    而今天:目錄查詢**完全不帶客人的身分** ⇒ 📌 **系統在這一層分不出經銷會員與一般會員。**
//    ⇒ 經銷客人打「5,000–10,000」時, 篩的是他**看不到的那個一般價**
//      (RPC `20260906910000…sql:198-199` 逐字 `p.price_general >= p_price_min`)。
//
// 🎯 **為什麼寫成綠的而不是紅的**(mainB 2026-09-07 裁):
//    一支永遠紅的測試不是回歸測試, 是缺陷展示;而 skip 是繞過。
//    ⇒ **斷言 = 今天實際發生的事(綠、可 commit), 而【方向寫在名字與註解裡】**
//      ⇒ db 那半一落地, 這一格會自己紅, **逼下一個人有意識地翻它**。
//    📌 依據 `feedback_a-tradeoff-needs-its-direction-written-down`:
//       已知行為寫成期望值, **有方向才叫取捨**;沒方向的話,
//       它在 diff 上跟「這就是對的」長得一模一樣。
//
// ⚠️ **這一組答不出什麼**:它證的是**顧客站送出去的東西**, 不是 RPC 內部怎麼比。
//    「餵 price_general 5,200 / price_store 4,800 ⇒ 經銷篩 5,000–10,000 不得命中」
//    那一格**只有 SQL 層答得出來** ⇒ 那是 db 那半的驗收, 不在本檔。
describe('⟦front-CATALOGPRICEGENERALONLY⟧ 目錄頁的價格篩選(今天的行為)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSidebars();
    vi.mocked(fetchCatalogPage).mockResolvedValue({ products: [], total: 0, error: false });
  });

  const runCatalog = (qs: Record<string, string>) =>
    ProductsRoute({ searchParams: Promise.resolve(qs) });

  /**
   * 🔴🔴 **[2026-09-08 · 這一格【沒有照它自己預告的翻紅】, 而修法已經上了]**
   *
   * 它逐字寫著「修完之後這一格要翻成【帶得到 tier】」, 而 front 2026-09-08 接完線之後
   * **它照樣綠**。⚠️ **不是修法沒生效** —— 是這一格**觀察的不是那個東西**:
   * ```
   * 斷言:const [query] = mock.calls[0]  ⇒ 它只看【第一個引數】
   * 而修法把身分放在【第三個引數】 fetchCatalogPage(query, vehicle, tier)
   * ⇒ query 物件裡確實仍然沒有 tier 鍵 ⇒ 斷言仍然成立、仍然是【對的觀察】
   * ```
   * 🎯 📌 **成因**:寫這一格的人預設了修法會【把 tier 塞進 query 物件】——
   *    那是一個合理的設計, 而**不是唯一合理的設計**。
   *    ⇒ **絆線綁在一個【實作形狀】上, 而不是綁在【行為】上** ⇒ 換一個形狀它就不絆了。
   * 🛑 **而它的危害是特定的**:它自稱是絆線 ⇒ **下一個人會信任它的綠**。
   * ✅ 真正在看接線的那一格在下面(「經銷會員 ⇒ 第三個引數收到 store」)。
   * 🔵 **本格【不刪】, 而它的理由要改寫**(codex 2026-09-08 nit, 而它是對的):
   *    ⛔ ~~「有人把 tier 塞進 query, 它會進快取鍵 ⇒ **那正是外洩那條路**」~~
   *    🛑 **那句講反了。** 快取鍵**有** tier ⇒ 兩種會員各自一份 ⇒ 那是**隔離**;
   *      外洩來自快取鍵**缺少**可分辨的欄位。⇒ 📌 把 tier 加進鍵是選項【甲】, 它是安全的。
   *    ✅ 本格真正在釘的是**本片選的那條路**(乙:經銷整條繞過快取)的一個不變量:
   *      **在乙之下, query 物件不該帶身分** —— 帶了就代表有人在快取那條路上分身分,
   *      而那是**另一個設計**(甲), 不是這一片。⇒ 那時要回來一起改, 不是讓兩套並存。
   */
  it('⚪【不變量】query 物件裡【不】帶身分 —— 塞進去它就會進快取鍵(⚠️ 原本自稱「修完要翻紅」, 沒翻, 理由見上)', async () => {
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    const [query] = vi.mocked(fetchCatalogPage).mock.calls[0] ?? [];
    // 🔴 今天:查詢物件裡沒有任何一個欄位在講「這個客人是誰」。
    expect(Object.keys(query ?? {})).not.toContain('tier');
    // 🔵 而價格那兩個值【有】傳下去 ⇒ 證明這一格不是因為整個查詢是空的才綠。
    //    ⚠️ 用的是**真的級距字面**(`catalog-query.ts:82-88` 的 `PRICE_LABEL_BOUNDS`)——
    //    我第一版寫 `price_min`/`price_max` 兩個【不存在的參數名】, 結果查詢是空的而斷言紅了
    //    ⇒ 📌 **那一行就是它存在的理由:沒有它, 這一格會在「查詢根本是空的」時照樣綠。**
    expect(query?.priceMin).toBe(3000);
    expect(query?.priceMax).toBe(10000);
  });

  it('⚪【不變量】兩發【同一種】會員送出的查詢一模一樣(⚠️ 原本自稱「修完必須紅」, 沒紅, 理由見上一格)', async () => {
    // ⛔ ~~「本檔沒有 mock `@/lib/tier`」~~ 🔴 **那句是錯的** —— 本檔 `:35` 就有
    //    `vi.mock('@/lib/tier', …)`, 而 `:30` 那個 mock 預設回 `general`。
    //    ⇒ 📌 **一句關於「這個檔有沒有 mock 某個東西」的陳述, 沒有人會去驗它。**
    // 🔵 而這一格改成【不變量】:同一種會員連打兩次, 送出的東西必須一樣(沒有隱藏的狀態)。
    // ⛔ ~~「這一格的價值在於:**修完之後它必須紅**」~~
    // 🔴 **那句留在這裡是錯的**(codex R2 nit):我已經把它從【絆線】改成【不變量】,
    //    而不變量**修前修後都該綠**。兩句並存 ⇒ 📌 **下一輪看到綠的人分不出
    //    它代表「不變量成立」還是代表「tier 根本沒接線」。**
    // ✅ 今天的判準:**這一格永遠綠**;而「tier 有沒有真的接上」在下面
    //    「經銷會員 ⇒ 身分真的傳到第三個引數」那一格。
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    const [a] = vi.mocked(fetchCatalogPage).mock.calls[0] ?? [];
    const [b] = vi.mocked(fetchCatalogPage).mock.calls[1] ?? [];
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // ══ 🔴 真正在看【接線】的三格(front 2026-09-08 補)══════════════════════════
  //
  // 🛑 上面那兩格自稱是絆線而沒有絆到 ⇒ **這三格是換上來的**。
  //    判別句:**這一格在【好世界】與【壞世界】會不會印不同的東西?**

  it('🔴 經銷會員 ⇒ 身分【真的傳到】fetchCatalogPage 的第三個引數', async () => {
    // 🛑 少了這一格,「解析出來了」與「傳下去了」是兩個宣稱, 而只有前者會被看見。
    //    (memory `feedback_behaviour-tests-prove-a-path-not-the-wiring`)
    resolveAuthenticatedTier.mockResolvedValueOnce('store' as never);
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    const call = vi.mocked(fetchCatalogPage).mock.calls[0];
    expect(call?.[2], '身分沒有傳到取數那一層 ⇒ 篩選與排序仍然用一般價算').toBe('store');
  });

  it('🟢 負對照:一般會員 ⇒ 第三個引數是 general, 不是 store', async () => {
    // 🛑 少了這一格,「永遠傳 store」的實作在上一格也會綠 —— 而那會讓一般客人走經銷 RPC。
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    const call = vi.mocked(fetchCatalogPage).mock.calls[0];
    expect(call?.[2], '一般會員被當成經銷 ⇒ 他會撞上經銷 RPC 的身分閘, 目錄整個壞掉').toBe('general');
  });

  // 🔴🔴 **[這裡原本有一格「身分要在取商品【之前】解析」的順序測試 —— 我拆掉了]**
  //
  // ⛔ ~~`expect(tierOrder < fetchOrder).toBe(true)`~~
  // 🔬 **拆掉的理由是量到的, 不是覺得多餘**:我做了那一發突變(把解析搬回取商品之後)
  //    ⇒ 🛑 **整支測試檔炸開 8 格**, 而炸的原因是 `catalogTier` 在宣告【之前】被引用
  //      (TDZ)⇒ 📌 **那個順序是【語言本身】在擋, 不是我那一格在擋。**
  // 🎯 ⇒ 它在「好世界」與「壞世界」印的不是【不同的東西】—— 壞世界根本到不了它。
  //    ⇒ 那是一格**沒有咬合力的自檢**, 而 memory `feedback_a-toothless-selftest-is-worse-than-none`
  //      逐字:**它讓 PASS 計數看起來更飽。**
  // 🔵 **留這段訃聞而不是靜靜刪掉**:下一個人會想到同一個顧慮(順序), 而這裡直接告訴他
  //    【那個顧慮成立, 而已經有東西在擋了】—— 省掉他再寫一次同一格。

  it('⚪【不變量 · 不准翻】一般會員的價格篩選值原封傳下去(修的時候不得誤傷一般客人)', async () => {
    // 🎯 這一格與上面兩格不同:**修前修後都必須綠**。
    //    db 那半上線後它若跟著紅 ⇒ **那是誤傷一般會員**, 不是進度。
    await runCatalog({ price: 'NT$ 3,000 – 10,000' });
    const [query] = vi.mocked(fetchCatalogPage).mock.calls[0] ?? [];
    expect(query?.priceMin).toBe(3000);
    expect(query?.priceMax).toBe(10000);
  });
});

// 🔴🔴 **Server 端鐵則逐字:「經銷價絕不傳到一般會員瀏覽器」** —— 而 `ProductsPage` 是 client
//   ⇒ 它的 props 會被序列化送到瀏覽器。**這一組就是那條鐵則的守門。**
//   🛑 **兩個世界都要動得了**:general 沒有 · store 有【而且值真的不同】。
//      📌 只驗第一格會全綠 —— **把整個功能關掉也通過。**
describe('/products 經銷價接線(⟦b4-DEALERSIGNUPUNSEEN⟧ 第二半)', () => {
  /** 在 route 回的元素樹裡找第一個帶 `products` 的 props。找不到 ⇒ undefined。 */
  const findProducts = (node: unknown): Array<Record<string, unknown>> | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findProducts(n);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props && 'products' in props) return props.products as Array<Record<string, unknown>>;
    return props ? findProducts(props.children) : undefined;
  };

  const oneRow = () => [
    {
      id: 1,
      slug: 'p-1',
      productId: '11111111-1111-1111-1111-111111111111',
      brand: 'LIGHTECH',
      name: 'P1',
      price: 12000,
    },
  ];

  /**
   * 🔴 `price` 可以指定 —— **接上經銷目錄 RPC 之後, 取數層會【依身分回不同的價】**
   *    (經銷走 `products_list_dealer`, 該 view 把 `price_store` 映進同一個欄位)。
   *    ⇒ 📌 所以這一層要驗的不再是「頁面有沒有蓋一個欄位」, 是
   *      **「取數層回什麼, 頁面就原封往下傳什麼」**。
   */
  const runRoute = async (price = 12000) => {
    stubSidebars();
    vi.mocked(fetchCatalogPage).mockResolvedValue({
      products: oneRow().map((r) => ({ ...r, price })),
      total: 1,
      error: false,
    } as unknown as Awaited<ReturnType<typeof fetchCatalogPage>>);
    return ProductsRoute({ searchParams: Promise.resolve({}) });
  };

  /** 走【關鍵字】那條路(`searchProducts`)—— 它回的是牌價, 沒有經銷版本。 */
  const runSearchRoute = async (price = 12000) => {
    stubSidebars();
    vi.mocked(searchProducts).mockResolvedValue({
      items: oneRow().map((r) => ({ ...r, price })),
      total: 1,
      error: false,
    } as never);
    return ProductsRoute({ searchParams: Promise.resolve({ search: '排氣管' }) });
  };

  /**
   * 🔴🔴 **[codex R2 must-fix:這一格的【抬頭】已經證不到它宣稱的事]**
   *
   * ⛔ ~~「general tier ⇒ props 裡沒有 `dealerPrice`(**經銷價不得進一般會員的瀏覽器**)」~~
   * 🛑 **括號裡那半今天是假的**:接上經銷目錄 RPC 之後,經銷價是走 **`price`** 這個欄位進來的
   *    ⇒ 一般會員若拿到一份 `{price: 4800}` 的經銷結果、而它**沒有** `dealerPrice`,
   *      **本格照樣全綠, 而經銷價已經在他的瀏覽器裡了。**
   * 🎯 ⇒ 📌 **一個曾經是「外洩」代名詞的欄位, 在架構換掉之後只剩下【它自己】的意思。**
   * ✅ **真正在守外洩的那一格在 `lib/catalog-dealer-not-cached.test.ts`**
   *    (「經銷先打過, 一般會員打同一個網址不得拿到他的結果」——
   *     那一格的世界是一個**真的會記住**的 `unstable_cache`)。
   * 🔵 **本格保留, 而抬頭收窄到它真的證得到的範圍**:目錄頁**不再自己蓋**那個欄位。
   */
  it('🔵 general tier ⇒ 頁面不蓋 dealerPrice, 也不打第二支價格 RPC(⚠️ 這【不】等於證明沒外洩, 見上)', async () => {
    resolveAuthenticatedTier.mockResolvedValue('general' as never);
    const out = findProducts(await runRoute());
    expect(out).toHaveLength(1);
    expect(out?.[0]).not.toHaveProperty('dealerPrice');
    // 🛑 而它連 RPC 都不該打 —— 少了這一格,「有打而回空」與「沒打」印同一個結果。
    expect(fetchEffectivePrices).not.toHaveBeenCalled();
  });

  /**
   * 🔴🔴 **[這三格【換掉了它們守的前提】, 而不是被刪掉 —— 2026-09-08]**
   *
   * ⛔ ~~舊前提:`price` 是【一般價】, 所以 `tier === 'store'` 的 props 要**另外**有 `dealerPrice`~~
   *    (判準逐字是「有沒有 `dealerPrice` 這個欄位」—— **主視窗 B 2026-09-07 裁甲**)
   * 🔴 **2026-09-08 Sean 裁甲**, 逐字「**甲 不掛了 —— 一個來源、一個快照**」:
   *    接上經銷目錄 RPC 之後 `price` **本身就是經銷價** ⇒ 再蓋一次 = 兩支 RPC 兩個快照
   *    ⇒ 同一份 props 兩個經銷價(codex must-fix)。⇒ **store 的 props 從此沒有那個欄位。**
   * 📌 **舊拍板不是錯的 —— 是【它問的那個世界不存在了】。**
   *    🛑 舊字面留刪除線:搜「有沒有這個欄位」的人要同一發撞到這裡。
   * 🎯 ⇒ **新的證人是**:`tier === 'store'` 時 props 的 `price` **與一般價不同**
   *    —— 而它**不依賴那個欄位存不存在**。
   * ⚠️ **本層能證到哪裡**:`fetchCatalogPage` 在本檔是 mock 的 ⇒ 這三格證的是
   *    **「取數層回什麼, 頁面就原封往下傳什麼」**;**「取數層真的依身分換了 RPC」**
   *    那一格在 `lib/catalog-dealer-not-cached.test.ts`, 不在這裡。
   */
  it('🔴 store tier ⇒ 取數層回的經銷價【原封】到 props, 而頁面【不再】自己蓋 dealerPrice', async () => {
    resolveAuthenticatedTier.mockResolvedValue('store' as never);
    const out = findProducts(await runRoute(4800));
    expect(out?.[0]?.price, '經銷價沒有原封傳下去').toBe(4800);
    expect(
      out?.[0]?.dealerPrice,
      '頁面又蓋了一次 dealerPrice ⇒ 同一個數字兩個來源兩個快照(2026-09-08 Sean 裁甲禁止)',
    ).toBeUndefined();
  });

  it('🟢 負對照:general tier ⇒ price 是我餵的一般價, 且不掛 dealerPrice(⚠️ 價差是 fixture 給的, 不是 tier 造成的)', async () => {
    /**
     * 🛑🛑 **[codex R2 nit:這一格【證不到】「是身分造成價差」]**
     *   兩個數字(4800 / 12000)是**我自己用 `runRoute(...)` 餵進去的**,
     *   而 `fetchCatalogPage` 在本檔是 mock ⇒ 🔴 **一個「永遠回一般價」的壞實作,
     *   照樣可以被這兩個 fixture 人工餵出不同數字而通過。**
     * 🎯 ⇒ 📌 **這是 mock 這一層的天花板, 不是這一格寫壞了** ——
     *   「取數層真的依身分換 RPC」那一格在 `lib/catalog-dealer-not-cached.test.ts`
     *   (它 mock 的是 supabase client 而不是取數函式 ⇒ 問得到 RPC 名字)。
     * ✅ **本格今天證得到的只有一件事**:**頁面把取數層回的東西原封往下傳, 不加不減。**
     */
    resolveAuthenticatedTier.mockResolvedValue('general' as never);
    const out = findProducts(await runRoute(12000));
    expect(out?.[0]?.price).toBe(12000);
    expect(out?.[0]?.dealerPrice, 'general 的 props 裡不得有經銷價欄位').toBeUndefined();
  });

  // ══ 🔴🔴 **兩條路各自【一個來源】—— 而它們的做法【相反】, 所以兩格分開** ══════════
  //
  // 🛑 合成一格的話, 「漏的是哪一條路」答不出來。而我**真的漏過關鍵字那一條**
  //    (codex R2 must-fix:我拿掉疊價時把兩條路一起拿掉了 ⇒ 經銷客人搜尋看到牌價)。

  it('🔴 經銷 + 【關鍵字搜尋】⇒ 要疊 dealerPrice(那條路回的是牌價, 它沒有經銷版本)', async () => {
    resolveAuthenticatedTier.mockResolvedValue('store' as never);
    fetchEffectivePrices.mockResolvedValue(
      new Map([['product:11111111-1111-1111-1111-111111111111', 4800]]),
    );
    const out = findProducts(await runSearchRoute(12000));
    expect(out?.[0]?.price, '⚪ 正對照:這一發真的走到關鍵字那條路(它回牌價)').toBe(12000);
    expect(
      out?.[0]?.dealerPrice,
      '🔴 經銷客人搜尋時看到牌價 ⇒ 點進商品頁又變經銷價, 同一個商品前後兩個價',
    ).toBe(4800);
  });

  it('🟢 負對照:經銷 + 【目錄】那條 ⇒ 不得疊(疊了就是兩支 RPC 兩個快照)', async () => {
    // 🛑 少了這一格,「一律疊」的實作在上一格也會綠 —— 而那正是 Sean 2026-09-08 裁甲禁止的。
    //
    // 🔴🔴 **這一行 `mockClear` 是承重的, 而我是被一個紅逼出來的**:
    //    本 describe(`:550`)**沒有** `beforeEach(vi.clearAllMocks)` ——
    //    ⇒ 📌 `fetchEffectivePrices` 的呼叫次數是**跨格累積**的
    //      ⇒ 我第一版的 `not.toHaveBeenCalled()` 讀到的是**上一格**打的那一次, 當場紅。
    //    🎯 **那個紅是對的, 而它紅的理由不是我以為的那個** ——
    //      我差一點去改實作, 而實作是對的。
    //    🛑 **⇒ 「呼叫次數」類的斷言, 先問這個檔有沒有在每格之間清乾淨。**
    vi.mocked(fetchEffectivePrices).mockClear();
    resolveAuthenticatedTier.mockResolvedValue('store' as never);
    fetchEffectivePrices.mockResolvedValue(
      new Map([['product:11111111-1111-1111-1111-111111111111', 4800]]),
    );
    const out = findProducts(await runRoute(4800));
    expect(out?.[0]?.price).toBe(4800);
    expect(out?.[0]?.dealerPrice, '目錄那條路又疊了一次 ⇒ 同一個數字兩個來源').toBeUndefined();
    expect(fetchEffectivePrices, '目錄那條路根本不該打第二支價格 RPC').not.toHaveBeenCalled();
  });

  it('🔴 真 0 元是合法價 ⇒ 不得被當成「沒有價」丟掉', async () => {
    /**
     * 🔵 **這一條【仍然成立】, 而它的受詞換了**(主視窗 A 2026-09-08 指名不要順手拿掉):
     *    ⛔ 舊受詞:`dealerPrices` 那個 Map —— 判準是「在不在 Map」不是「> 0」。
     *    ✅ 新受詞:`price` 本身 —— 取數層回 `0` 時, 頁面不得把它變成 `undefined` 或跳過。
     *    🎯 **不變的那句是**:**`0` 是一個合法的價, 不是「查無」。**
     */
    resolveAuthenticatedTier.mockResolvedValue('store' as never);
    const out = findProducts(await runRoute(0));
    expect(out?.[0]?.price, '0 被當成「沒有價」處理掉了').toBe(0);
  });
});
