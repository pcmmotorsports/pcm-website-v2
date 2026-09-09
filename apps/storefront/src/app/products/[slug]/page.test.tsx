// 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):route 改走【帶 `failed` 的那扇門】
//   ⇒ 本檔的 mock 與斷言跟著換受詞:`fetchVehicleTaxonomy` ⇒ `tryVehicleTaxonomy`,
//   回傳形狀從 `MockMotoBrand[]` 變成 `{ motoBrands, failed }`。
//   🛑 **不是為了讓測試變綠才改** —— 是被測的那一行真的換了呼叫對象;
//      不改的話這幾格會綠在一個【已經不存在的呼叫】上。
// @vitest-environment node
//
// PDP 的 smoke —— 而**這支存在的理由是「整個目錄零測試檔」**(`⟦search-VEHTAXSLOW⟧` · 2026-09-05)。
//   要改 `tryVehicleTaxonomy`(七個入口共用)之前查回歸分母, 兩把尺都說沒有:
//   `ls products/[slug]/` ⇒ 只有 `page.tsx`;`grep` 誰 import 它 ⇒ **0**。
//   🟢 正對照:首頁 `app/page` 被 4 支測試 import ⇒ 尺是活的。
//
// 🔴 而這一頁對 taxonomy 的呼叫是【有條件的】(`page.tsx` 那一行):
//    `hasVehicleParam || hasFitments ? tryVehicleTaxonomy() : Promise.resolve([])`
//    ⇒ 📌 **那是一個已經在的優化, 而它今天沒有任何東西守著** —— 本檔把它釘住。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MemberTier } from '@pcm/domain';
import { renderToStaticMarkup } from 'react-dom/server';

const tryVehicleTaxonomy = vi.fn();
const fetchProductByHandle = vi.fn();
// 🔴 要能逐格換掉（「handle 解不出 uuid」那一格）⇒ 不能寫成裸箭頭函式。
const fetchProductIdsByHandles = vi.fn((handles: readonly string[]) =>
  Promise.resolve(new Map(handles.map((h) => [h, `uuid-${h}`]))),
);

vi.mock('@/components/ProductPage', () => ({
  // 🔴 2026-09-06 R1 must-fix:stub 原本【只畫 motoBrands 不畫 failed】
  //   ⇒ 四處把 `vehicleTaxonomyFailed` 寫死 `false` 也照樣全綠 ⇒ 那條接線零守門。
  // 🔴🔴 **stub 要把 `product` 與 `tier` 讀出來**（codex R2 must-fix ⑦⑨）——
  //   原本它只畫 taxonomy ⇒ **把 route 裡填 `dealerPrice` 那幾行刪掉、或把 tier 改回 general，測試照樣全綠**。
  //   📌 而「一般會員的經銷價有沒有外洩」**只有這一層答得出來**：
  //     `ProductInfo.test.tsx` 是我自己把價塞進 props 的，它證不了這件事。
  ProductPage: function ProductPage({
    motoBrands,
    vehicleTaxonomyFailed,
    product,
    tier,
  }: {
    motoBrands?: unknown[];
    vehicleTaxonomyFailed?: boolean;
    product?: { dealerPrice?: number; variants?: Array<{ id: string; dealerPrice?: number }> };
    tier?: string;
  }) {
    return (
      <div
        data-stub="pdp"
        data-moto-brands={String(motoBrands?.length ?? 'undefined')}
        data-failed={String(vehicleTaxonomyFailed)}
        data-tier={String(tier)}
        data-dealer-price={String(product?.dealerPrice)}
        data-variant-dealer-prices={(product?.variants ?? [])
          .map((v) => `${v.id}=${String(v.dealerPrice)}`)
          .join(',')}
      />
    );
  },
}));
vi.mock('@/lib/products', () => ({
  fetchProductByHandle,
  tryVehicleTaxonomy,
  // ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08:route 現在也要 uuid(UI 型別的 `id` 是 number 不是 uuid)。
  fetchProductIdsByHandles,
}));
// 🔴 `@/lib/tier` 與 `@/lib/tier-prices` 都帶 `import 'server-only'` ⇒ 在這支 jsdom 測試裡
//    會炸「This module cannot be imported from a Client Component module」——
//    📌 **那不是斷言紅, 是整支檔載不起來**(實測:`Tests 111 passed` 而 `Test Files 1 failed`)
//    ⇒ 這一格值得記:**少了一整支檔的綠, 比多一個紅難發現。**
// 🔵 本組測的是 route 的接線與畫面契約, 不是 RPC ⇒ mock 掉是對的層。
// 🔴🔴 **mock 要用 `vi.fn()`, 不是裸箭頭函式**(code-reviewer R1 must-fix 3)——
//    裸箭頭數不了呼叫次數 ⇒ 「general / 未登入【一次 RPC 都沒發】」那條驗收**沒有任何一格在驗**;
//    實測:把 `page.tsx` 的 `if (tier === 'store')` 拿掉, 舊測試**全綠**(mock 回空 Map)。
//    ⇒ 📌 **一道安全邊界如果沒有東西數它, 它與不存在在測試上長得一樣。**
const resolveAuthenticatedTier = vi.fn(() => Promise.resolve<MemberTier>('general'));
// 🔴 型別要帶【參數】—— 不帶的話 `mockImplementation((args) => …)` 在 tsc 是紅的，
//   而那正是「切批送了幾個 id」那一格唯一能問的地方。
const fetchEffectivePrices = vi.fn(
  (_args: { tier: string; productIds: readonly string[]; variantIds: readonly string[] }) =>
    Promise.resolve(new Map<string, number>()),
);
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTier }));
vi.mock('@/lib/tier-prices', () => ({
  fetchEffectivePrices,
  priceKey: (kind: string, id: string) => `${kind}:${id}`,
}));
vi.mock('@/lib/recommendations/fetch-recommendations', () => ({
  fetchRecommendedProducts: () => Promise.resolve({ items: [], error: false }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
}));
vi.mock('@/lib/auth/composition', () => ({
  getVehicleRepo: () => Promise.resolve({ listByCustomer: () => Promise.resolve([]) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: ProductSlugRoute, generateMetadata } = await import('./page');

const BRANDS = [
  { id: 'yamaha', name: 'YAMAHA', models: [] },
  { id: 'honda', name: 'HONDA', models: [] },
];
const product = (fitments: unknown[], variants: Array<{ id: string; price: number }> = []) => ({
  id: 'p1', slug: 'a', handle: 'a', name: 'N', brand: 'B', price: 100,
  images: [], description: '', fitments, availability: true, category: null, variants,
});
const call = (fitments: unknown[], sp: Record<string, string> = {}) =>
  ProductSlugRoute({ params: Promise.resolve({ slug: 'a' }), searchParams: Promise.resolve(sp) } as never);

describe('PDP 的車款清單', () => {
  it('🔴 商品有 fitments ⇒ 【會】撈 taxonomy, 而且真的傳進去', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="2"');
    expect(tryVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 商品【沒有】fitments 且網址沒帶車 ⇒ 【不撈】taxonomy', async () => {
    // 🛑 這一格釘的是一個【已經在的優化】—— 而它今天沒有任何東西守著。
    //    把那個三元運算子改成無條件呼叫 ⇒ 這一格紅, 而畫面看不出差別(只是每次多付那 12 秒)。
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-stub="pdp"');
    expect(tryVehicleTaxonomy).not.toHaveBeenCalled();
  });

  it('🔴 沒有 fitments 而【網址帶了車】⇒ 還是要撈(另一半條件)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    // 🔵 參數名是 `vehicle`(短版), 不是 `v` —— 我第一版寫 `v` 而這一格【當場紅】。
    //    `page.tsx:97-98` 逐字:`spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null)`
    await call([], { vehicle: 'yamaha-r1-2020' });
    expect(tryVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴 taxonomy 回空 ⇒ 頁面【仍然要渲染】(車款清單掛了不該讓商品頁打不開)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="0"');
  });
  // 🔴🔴 **2026-09-06 R1 must-fix:`failed` 那條接線原本零守門**(stub 只畫 motoBrands)。
  //   PDP 這一支多一個【它獨有】的形狀要守:**略過分支必須回 `false`** ——
  //   「這一頁不需要車款樹」與「撈失敗」是兩件事, 混在一起會讓沒有 fitments 的商品頁
  //   對每一個客人都說「車款清單暫時無法載入」。
  it('🔴 撈失敗(failed=true)⇒ 那個旗標【真的傳進 ProductPage】', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: true });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-failed="true"');
  });

  it('🔵 負對照:沒失敗 ⇒ 傳下去的是 false, 不是恆真', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-failed="false"');
  });

  it('🔴🔴 沒有 fitments 也沒有車款參數 ⇒ 根本不撈 ⇒ 旗標必須是 false(不是 undefined、不是 true)', async () => {
    // 🛑 **這一格是 PDP 獨有的**:略過分支若回 `true` 或漏傳,
    //    每一個沒有適用車款的商品頁都會對客人說「車款清單暫時無法載入」。
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: true });
    const html = renderToStaticMarkup(await call([]));
    expect(tryVehicleTaxonomy).not.toHaveBeenCalled();
    expect(html).toContain('data-failed="false"');
  });

});

// ── ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08:route 層那道安全邊界(R1 must-fix 3)──────────
describe('/products/[slug] · 經銷價那條路只對 store 開', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: false });
    // 🔴 `vi.clearAllMocks()` **只清呼叫紀錄, 不清 implementation** ⇒ 上一格用
    //   `mockImplementation` 裝的東西會漏到下一格。這一行是那道隔離。
    fetchEffectivePrices.mockReset().mockResolvedValue(new Map<string, number>());
  });

  it('🔴 general ⇒ 一次 RPC 都不發(數呼叫次數, 不是看畫面)', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('general');
    await call([]);
    // 🔴 這一格就是「拿掉 route 的 `if (tier === 'store')` 必須紅」的守門。
    expect(fetchEffectivePrices).toHaveBeenCalledTimes(0);
  });

  it('🟢 store ⇒ 發一次, 且帶的是【解出來的 uuid】不是 UI 的 number id', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    await call([]);
    expect(fetchEffectivePrices).toHaveBeenCalledTimes(1);
    const arg = (fetchEffectivePrices.mock.calls as unknown as Array<[{ productIds: string[]; tier: string }]>)[0]?.[0];
    expect(arg?.tier).toBe('store');
    // 🔴 **釘【那個值】, 不是「是不是字串」**（codex R3 must-fix ⑤）——
    //   ⛔ ~~原本只驗 `typeof x === 'string'` 且長度 > 0~~：改成送 `[slug]`（`'a'`）仍然全綠，
    //   而真 RPC 的參數型別是 `uuid[]`，送 handle 進去會在線上炸。
    //   🔵 mock 的 `fetchProductIdsByHandles` 回的是 `uuid-<handle>` ⇒ 這裡釘死那個值。
    expect(arg?.productIds).toEqual(['uuid-a']);
  });

  it('🔴 premiumStore ⇒ 也不發(本片不做那一級, 而顯示端不得出現假的經銷標記)', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('premiumStore');
    await call([]);
    expect(fetchEffectivePrices).toHaveBeenCalledTimes(0);
  });

  // ── 以下四格看的是【傳下去的 props】，不是呼叫次數 ─────────────────────────
  it('🟢 store + RPC 有回 ⇒ 價真的**填進 props**（刪掉 route 那幾行賦值 ⇒ 這一格紅）', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    fetchProductByHandle.mockResolvedValue(product([], [{ id: 'v-1', price: 8400 }]));
    fetchEffectivePrices.mockResolvedValueOnce(
      new Map([['product:uuid-a', 6720], ['variant:v-1', 6300]]),
    );
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-tier="store"');
    expect(html).toContain('data-dealer-price="6720"');
    expect(html).toContain('data-variant-dealer-prices="v-1=6300"');
  });

  it('🔴🔴 general ⇒ props 裡**一個經銷價都沒有**（一般會員外洩的守門在這一層）', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('general');
    fetchProductByHandle.mockResolvedValue(product([], [{ id: 'v-1', price: 8400 }]));
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-tier="general"');
    expect(html).toContain('data-dealer-price="undefined"');
    expect(html).toContain('data-variant-dealer-prices="v-1=undefined"');
  });

  it('🔴 ③ RPC 少回那一列（amount NULL ⇒ 不在 Map）⇒ props 保持 undefined，不得寫 0', async () => {
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    fetchProductByHandle.mockResolvedValue(product([], [{ id: 'v-1', price: 8400 }]));
    // `fetchEffectivePrices` 對 `amount === null` **不放進 Map** ⇒ 這裡就是空 Map。
    fetchEffectivePrices.mockResolvedValueOnce(new Map());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-dealer-price="undefined"');
    expect(html).toContain('data-variant-dealer-prices="v-1=undefined"');
    // 🔴 **退回一般價這件事要出聲**（codex R3 must-fix ⑥）——
    //   只驗 props 的話，把整段 `console.error` 刪掉仍然全綠，而**那是錢默默算錯的形狀**。
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.flat().join(' ')).toContain('沒取到價');
    spy.mockRestore();
  });

  it('\u{1f534}\u{1f534} RPC **整個拋錯** ⇒ 頁面仍要畫出來（降級成一般價）而且要留痕', async () => {
    // 🛑 `fetchEffectivePrices` 是刻意 fail-closed（會 throw）。沒有 route 那個 try
    //   ⇒ **經銷會員的整張商品頁 500，而一般會員完全正常** ⇒ 沒有人會回報。
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    fetchProductByHandle.mockResolvedValue(product([], [{ id: 'v-1', price: 8400 }]));
    fetchEffectivePrices.mockRejectedValueOnce(new Error('get_effective_prices failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-stub="pdp"');            // 頁面**有**畫出來
    expect(html).toContain('data-dealer-price="undefined"');
    expect(spy.mock.calls.flat().join(' ')).toContain('整段失敗');
    spy.mockRestore();
  });

  it('\u{1f534} handle 解不出 uuid 且零變體 ⇒ **仍要出聲**（不變量與 missing 都是 0 的那個盲區）', async () => {
    // codex R3 must-fix ③：`sent === expected === 0`、`missing === 0` ⇒ 兩道守門都不會印。
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    fetchProductByHandle.mockResolvedValue(product([], []));
    fetchProductIdsByHandles.mockResolvedValueOnce(new Map());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderToStaticMarkup(await call([]));
    expect(spy.mock.calls.flat().join(' ')).toContain('解不出商品 uuid');
    spy.mockRestore();
  });

  it('🔴 變體 250 個 ⇒ **切批**送、每發 ≤ 200 個 id、而 250 個變體的價全都拿得到', async () => {
    // 🛑 這一格釘的是 codex R2 must-fix ⑥ 那個 off-by-one：商品 uuid 自己佔掉一個位子。
    //   改回「一次送 1 + 全部變體」⇒ 第一發 251 個 id ⇒ 這一格紅。
    const variants = Array.from({ length: 250 }, (_, i) => ({ id: `v-${i}`, price: 8400 }));
    resolveAuthenticatedTier.mockResolvedValueOnce('store');
    fetchProductByHandle.mockResolvedValue(product([], variants));
    fetchEffectivePrices.mockImplementation((args) =>
      Promise.resolve(
        new Map<string, number>([
          ...args.productIds.map((id) => [`product:${id}`, 6720] as const),
          ...args.variantIds.map((id) => [`variant:${id}`, 6300] as const),
        ]),
      ),
    );
    const html = renderToStaticMarkup(await call([]));
    const calls = fetchEffectivePrices.mock.calls;
    expect(calls.length).toBe(2);
    for (const [arg] of calls) {
      expect(arg.productIds.length + arg.variantIds.length).toBeLessThanOrEqual(200);
    }
    // 🔴 鐵則 11 的第四個數：我餵幾個 vs 它送幾個 —— 只比「發數」答不出漏掉一個變體。
    const sentVariants = calls.flatMap(([a]) => a.variantIds);
    expect(new Set(sentVariants).size).toBe(250);
    expect(html).toContain('v-249=6300');
  });
});

// ── 🔴 分享圖的守門(2026-09-09 第5片實測後補)──────────────────────────────
//
// 🛑 **這一組守的是一個【我自己造成過】的回歸。** 第5片在 `layout.tsx` 加了站台級
//   `twitter: { images: [站台預設圖] }`,而 Next 對 `twitter` / `openGraph` 是
//   **整組取代、不是逐欄合併** ⇒ 站台那組把本頁原本自動推導出來的 `twitter:image`
//   **蓋成站台 hero 圖** ⇒ 分享商品頁出來的是店招,不是那顆商品。
// 📌 而那個回歸**測試不會叫、Google 不會叫、畫面完全正常** —— 只有真的去讀 `<meta>` 才看得到。
//   ⇒ 所以它必須有一條會紅的守門。
describe('/products/[slug] · 分享圖(og / twitter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryVehicleTaxonomy.mockResolvedValue({ motoBrands: [], failed: false });
  });

  const metaFor = async (images: string[]) => {
    fetchProductByHandle.mockResolvedValue({
      id: 1,
      slug: 'x-1',
      name: '測試商品',
      brand: 'TEST',
      subtitle: '副標',
      price: 100,
      images,
      variants: [],
    });
    return generateMetadata({
      params: Promise.resolve({ slug: 'x-1' }),
      searchParams: Promise.resolve({}),
    });
  };

  it('🔴 有商品圖 ⇒ og:image 與 twitter:image 都是【商品圖】,不是站台預設', async () => {
    const m = await metaFor(['https://cdn.example.com/a.jpg']);
    expect(m.openGraph?.images).toEqual(['https://cdn.example.com/a.jpg']);
    // 🔴 這一格就是那個回歸:少了 route 端的 twitter,這裡會拿到 layout 的站台圖。
    expect(m.twitter?.images).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('🔵 沒有合格商品圖 ⇒ 本頁不自己指定,退回 layout 的站台預設(不是留一條沒有圖的裸連結)', async () => {
    // 相對路徑不合格(Google 拒收),與絕對網址白名單一致 ⇒ 這一顆等於「沒有圖」。
    const m = await metaFor(['/placeholder-product.png']);
    expect(m.openGraph?.images).toBeUndefined();
    expect(m.twitter).toBeUndefined();
  });
});
