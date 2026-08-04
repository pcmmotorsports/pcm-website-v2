// brand-products / #315 兩軸 — 設計側契約的守門(D3b;2026-08-04)
//
// backlog #315 要求「兩條測試都跑在**真目錄資料**上,不是 mock —— 用 mock 的話兩邊永遠對得上、
// 守門恆綠」。**本檔做不到那件事,而且我不假裝做到了**:單元測試沒有 DB 連線,
// 把真 taxonomy 抄成 fixture 只會變成一份會過期的假真相(而過期是靜默的)。
//
// ⇒ 分工寫清楚:
//   · **本檔守的是設計側**:20 個 slug 與 12 個分類名這兩份「品牌頁會產出什麼網址」的清單,
//     一旦有人加第 21 家或第 13 個分類名,這裡會紅 —— 那正是需要重新比對真目錄的時機。
//   · **真目錄那一半是實測、不是守門**:2026-08-04 以 production build + 真 DB 量過一次,
//     結果記在 backlog #315(含當天的 miss 名單)。要重量就照那條記的方法再跑一次。
//   · 🔴 **所以「這兩份清單與真目錄對得上」目前沒有機制**。這是已知的能力邊界,
//     不是漏做;要變成機制得先有一條能連 DB 的 CI job(#315 的後續)。
//
// 2026-08-04 實測結論(方法與數字見 backlog #315):
//   · 分類軸:12 個名稱有 11 個命中正式 taxonomy 的**大類**;`輪框與傳動` 兩層都查無。
//     🔴 而且「查無」在**與有效 pbrand 併用時是靜默的** —— 實測
//     `/products?pbrand=akrapovic&category=輪框與傳動` 的網址會被 client 端改寫成
//     `/products?pbrand=akrapovic`、顯示該品牌全部 648 件,零錯誤訊息。
//     (單獨 `?category=輪框與傳動` 則是 0 件 + 空狀態,看得見。)
//   · 品牌軸:20 個 slug 有 5 個在目錄中零商品(dbk / gilles / kineo / rizoma / wrs)。
//     🔴 **這一半也是靜默的**(關卡2 R1 must-fix 1 更正 —— 我第一版寫「不是靜默的」,
//     那是只看冷載入第一畫面就下的結論,錯的):`/products?pbrand=dbk` 冷載入是 0 張卡,
//     但**再動任何一個篩選**,網址就被改寫成沒有 `pbrand` 的版本、列表跳成全站目錄
//     (實測改排序 → `?sort=new` + 50 張;對照 akrapovic 則保住 `?pbrand=akrapovic&sort=new`)。
//     與分類軸是同一條機制(`products-url-state.tsx:98` → `:249` restorable →
//     `useCatalogFilterUrlSync` 寫回),只差首輪 `initialized` 守衛讓冷載入那次逃過。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_CONTENT } from '@/data/brand-content';
import { brandCatalogueUrl, brandIntroUrl } from '@/lib/brand-url';
import { isSafeCategoryValue, parseCatalogQuery } from '@/lib/catalog-query';

const ALL_CATEGORY_REFS = BRAND_CONTENT.flatMap((b) => b.categories);
const DISTINCT_CATEGORY_NAMES = [...new Set(ALL_CATEGORY_REFS.map(([name]) => name))].sort();
const SLUGS = BRAND_CONTENT.map((b) => b.slug).sort();

describe('#315 設計側契約 · 品牌 slug(pbrand 軸)', () => {
  it('🔴 20 個 slug 的清單被釘住 —— 改動時必須重新比對真目錄', () => {
    expect(SLUGS).toEqual([
      'akrapovic', 'bonamici', 'cnc-racing', 'dbk', 'eazi-grip', 'ebc', 'evotech',
      'extreme', 'front3d', 'gb-racing', 'gilles', 'k-speed', 'kineo', 'lightech',
      'materya', 'motogadget', 'rizoma', 'rpm-carbon', 'samco', 'wrs',
    ]);
  });

  it('🔴 每個 slug 都真的通得過 server 端那道白名單(`catalog-query.ts:50` SAFE_SLUG,用在 `:84`)', () => {
    // 形狀不合的話 server 端會**整個丟掉**那個參數 ⇒ 篩選靜默失效(而不是回 0 件)。
    // 🔴 **呼叫真的 `parseCatalogQuery`,不在測試裡手抄一份正規式**(關卡2 R1 nit 6:
    //    本檔下面才剛寫「不照抄看起來差不多的正規式」,上面卻自己抄了一份 ——
    //    生產側哪天收緊〔例如禁數字開頭〕,抄來的那份不會紅)。
    for (const slug of SLUGS) {
      const parsed = parseCatalogQuery(new URLSearchParams(`pbrand=${slug}`));
      expect(parsed.brandSlugs, `${slug} 被 server 端的白名單丟掉了`).toEqual([slug]);
    }
    // 前提:那道閘真的會丟東西(否則上面恆真)。
    expect(parseCatalogQuery(new URLSearchParams('pbrand=Not_A_Slug')).brandSlugs).toEqual([]);
  });

  it('品牌頁產出的兩種網址都不需要逸出(slug 全是 ASCII)', () => {
    for (const slug of SLUGS) {
      expect(brandIntroUrl(slug)).toBe(`/brands/${slug}`);
      expect(brandCatalogueUrl(slug)).toBe(`/products?pbrand=${slug}`);
    }
  });
});

describe('#315 設計側契約 · 分類名(category 軸)', () => {
  it('🔴 12 個分類名的清單被釘住 —— 加第 13 個就必須回頭比對真 taxonomy', () => {
    // 🔴 `輪框與傳動` **已知在正式 taxonomy 查無**(2026-08-04 實測,見檔頭與 backlog #315),
    //    留在清單裡是因為它是 KINEO 唯一的分類、而怎麼處理要 Sean 拍板。
    //    ⚠️ 它今天**碰不到**那個靜默失效:KINEO 目錄零商品 ⇒ 那條 chip 進去是空目錄。
    //    KINEO 一旦上架商品,同一條 chip 就會變成「顯示全品牌商品、零訊號」。
    expect(DISTINCT_CATEGORY_NAMES).toEqual([
      '止滑貼與保護膜', '外觀與後視鏡', '拉桿與把手', '排氣系統', '引擎與冷卻',
      '碳纖維部品', '精品螺絲與螺帽', '腳踏後移與傳動', '燈具與電子', '煞車系統',
      '車身防護與防摔', '輪框與傳動',
    ].sort());
    expect(DISTINCT_CATEGORY_NAMES).toHaveLength(12);
    expect(ALL_CATEGORY_REFS).toHaveLength(52);
  });

  it('🔴 分類名必須過得了 `isSafeCategoryValue`(過不了 = server 端靜默丟掉整個 category)', () => {
    // `catalog-query.ts:46`:長度 ≤120 且不含控制字元 / `%` / `_`。
    // `%` 與 `_` 是 LIKE 萬用字元,混進去會讓 rollup 件數**多算**(該檔逐字)。
    // 🔴 直接呼叫**同一支函式**,不在測試裡照抄一份看起來差不多的正規式 ——
    //    字元類抄錯(例如把控制字元範圍寫成 `[ -%_]`)會變成完全不同的集合,而中文一個都不在
    //    裡面 ⇒ 整條斷言恆真、永遠綠。
    for (const name of DISTINCT_CATEGORY_NAMES) {
      expect(isSafeCategoryValue(name), `${name} 過不了 isSafeCategoryValue`).toBe(true);
    }
    // 前提:上面那條要有判別力,先證明那支函式抓得到真的壞值(否則它可能恆回 true)。
    expect(isSafeCategoryValue('排氣_系統')).toBe(false);
    expect(isSafeCategoryValue('排氣%系統')).toBe(false);
  });

  it('🔴 `輪框與傳動` 只有 KINEO 在用(拍板時的影響面 = 一家、一條 chip)', () => {
    const owners = BRAND_CONTENT.filter((b) => b.categories.some(([n]) => n === '輪框與傳動'));
    expect(owners.map((b) => b.slug)).toEqual(['kineo']);
    // 而且那是它唯一的分類 ⇒ 改掉它等於改掉 KINEO 品牌頁上唯一的分類入口。
    expect(owners[0]!.categories).toHaveLength(1);
  });
});

// ── fetchBrandTopProducts / fetchBrandsWithProducts 本體(D3c-1;R3 Fable consider F1)────
// 🔴 為什麼補這段:`app/brands/[slug]/page.test.tsx` 把**整個 `@/lib/brand-products` 模組**
//    mock 掉(它會拖 `server-only` 進 vitest),於是這兩支函式本身**一行都沒被測到** ——
//    傳給 RPC 的參數形狀寫錯、error 分支回錯東西,兩邊都不會紅。這裡只 mock 它的下游
//    `@/lib/products`,讓函式本體真的跑一次。
describe('fetchBrandTopProducts / fetchBrandsWithProducts 本體', () => {
  // 🔴 `doUnmock` 放 afterEach、不放各條 it 的結尾(關卡2 R1 nit 8):
  //    斷言先炸的話 it 內的清理不會執行 ⇒ mock 漏到後續測試 = harness 自己假綠的預備形狀。
  //    ⚠️ 關卡2 R2 must-fix 3:本函式**原本是空的** —— 註解宣稱做了、實際零行。已補實。
  //    `resetModules` 一定要跟著 `doUnmock`:不重置的話下一次 `import` 拿到的是快取裡
  //    那份「已經綁著 mock」的模組實例,unmock 等於沒發生。
  afterEach(() => {
    vi.doUnmock('@/lib/products');
    vi.resetModules();
  });

  it('🔴 傳給 fetchCatalogPage 的 query 形狀(perPage 必須等於格數、只帶該品牌)', async () => {
    const calls: unknown[] = [];
    vi.doMock('@/lib/products', () => ({
      fetchCatalogPage: (q: unknown) => {
        calls.push(q);
        return Promise.resolve({ products: [{ id: 1 }], total: 1, error: false });
      },
      fetchCatalogBrandTaxonomy: () => Promise.resolve([]),
    }));
    vi.resetModules();
    const { fetchBrandTopProducts } = await import('@/lib/brand-products');
    const { BRAND_PRODUCT_SLOTS } = await import('@/lib/brand-url');

    const out = await fetchBrandTopProducts('akrapovic');
    expect(out).toHaveLength(1);
    expect(calls[0]).toEqual({
      page: 1,
      perPage: BRAND_PRODUCT_SLOTS,
      sort: 'recommend',
      brandSlugs: ['akrapovic'],
    });
  });

  it('🔴 撈取失敗 → 回空陣列(呼叫端據此整區不渲染,不能讓錯誤變成一排空骨架)', async () => {
    vi.doMock('@/lib/products', () => ({
      fetchCatalogPage: () => Promise.resolve({ products: [{ id: 9 }], total: 1, error: true }),
      fetchCatalogBrandTaxonomy: () => Promise.resolve([]),
    }));
    vi.resetModules();
    const { fetchBrandTopProducts } = await import('@/lib/brand-products');
    // 🔴 刻意讓 mock 同時回「有一筆商品」與 `error: true` —— 只看 products 長度的實作會漏掉
    //    這個組合(RPC 失敗時上游是回空陣列 + error,但守門不該依賴那個巧合)。
    expect(await fetchBrandTopProducts('akrapovic')).toEqual([]);
  });

  it('🔴 fetchBrandsWithProducts 只收 count > 0 的品牌(0 件的不算「有商品」)', async () => {
    vi.doMock('@/lib/products', () => ({
      fetchCatalogPage: () => Promise.resolve({ products: [], total: 0, error: false }),
      fetchCatalogBrandTaxonomy: () =>
        Promise.resolve([
          { id: 'akrapovic', name: 'A', count: 648 },
          { id: 'ghost', name: 'G', count: 0 },
        ]),
    }));
    vi.resetModules();
    const { fetchBrandsWithProducts } = await import('@/lib/brand-products');
    const set = await fetchBrandsWithProducts();
    expect([...set]).toEqual(['akrapovic']);
    expect(set.has('ghost'), 'count 0 的品牌被當成有商品 ⇒ 磚會變成可點的空入口').toBe(false);
  });

  // 🔴 **afterEach 自己的負測**(關卡2 R2 must-fix 3 的第二半):上面那個清理函式原本是**空的**,
  //    而註解宣稱它在做事 —— 空與不空,前面每一條都照樣綠。這一條讓它有判別力。
  //    原理 = `@/lib/products` 檔頭有 `import 'server-only'`,在 vitest 的 node 環境下
  //    **真的 import 會炸**(實測訊息:`This module cannot be imported from a Client Component
  //    module.`)。所以:清理成功 ⇒ 這裡拿到真模組 ⇒ 炸;清理失敗 ⇒ 拿到上一條留下的替身
  //    ⇒ 不炸 ⇒ 本條紅。**這也是為什麼上面每一條都得自己 doMock**。
  //    ⚠️ 位置就是行為:本條必須排在**最後**(它驗的是「前一條的殘留」)。
  it('🔴 afterEach 真的把 `@/lib/products` 的 mock 拆乾淨了(空的清理函式會讓本條紅)', async () => {
    await expect(import('@/lib/products')).rejects.toThrow(/cannot be imported from a Client Component/);
  });
});
