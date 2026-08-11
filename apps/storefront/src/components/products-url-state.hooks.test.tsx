// @vitest-environment jsdom
//
// useCatalogFilterUrlSync 回歸守門 — Sean 2026-07-19 回報「取消其中一個品牌後,該品牌商品不消失」。
//
// 根因(實測 + 讀 node_modules 內 Next 16.2.6 原始碼坐實):`getCacheKeyForDynamicParam` 產生
// page segment cache key 走 `Object.fromEntries(new URLSearchParams(...))`、**重複 key 只留最後值**。
// 品牌原本是重複 key(`pbrand`)+ 字母序 → `?pbrand=a&pbrand=b` 與 `?pbrand=b` 的 key 相同 →
// router.replace 判定同一 segment、重用舊 CacheNode、零 RSC 請求 → 畫面停在舊清單。
//
// 🔴 **2026-08-11 #287 落地:寫出端改單值鍵 `?pbrands=a,b`** ⇒ 品牌軸的碰撞在結構上不再可能,
//   案例①③⑤(原本釘「碰撞必 refresh」的那幾格)改成釘**反向**:同一個 Sean 回報的操作,
//   現在只送一次 replace、零 refresh = 恆一次查詢。碰撞守門本身沒拆(它擋的是別的重複鍵形狀),
//   判別力改由案例⑰(`?category=A&category=B`)提供 —— 拿掉 refresh 那行只有⑰會紅。
//   讀取端**新舊格式都吃**;客人手上的舊連結與站內品牌頁連結(`lib/brand-url.ts`)仍是舊格式。
//
// 原修法 = 只在 segment key 真碰撞時補一次 refresh,兩個方向都要釘:
//   ① 碰撞時**必須** refresh(缺 → 本 bug 復發;現由⑰守)
//   ② 不碰撞時**不得** refresh(多餘 → 每次切分類/拉價格都對 12793 筆型錄多查一次)
//
// 案例⑥-⑨ = **分頁失效**修復的守門(同日第二片;既有 bug,已對照 61f45b6 確認非品牌片引入):
// `useCatalogFilterUrlSync` 的 deps 含 restoreSources,server 每回新 props 就換 identity → effect
// 重跑 → 舊版**無條件** `delete('page')` 洗掉使用者剛翻到的 `?page=2`。改為只在篩選指紋變動時刪。
//
// 案例⑩ = **深連結還原波**(同日第三片、backlog #289 ✅ 已修):`?page=N` 進站時 restore dispatch
// 讓篩選指紋由空變非空 → 被誤判為使用者操作而刪掉 page(實測**不會自癒**:useBrowseUrlSync 的
// deps 此時全未變、effect 不重跑)。修法 = 刪 page 前先比對「不動 page 的版本」,若已等於當前
// URL 代表 state 只是剛追上 URL → 直接收手。
//
// 突變驗證 —— **七靶全部在 #287 最終版上重跑**(數字 = 該次 vitest 輸出字面,不是從舊版加減):
//   拿掉 `if (collides) refresh()`      → 1 failed | 17 passed → 紅 ⑰
//   改無條件 refresh                    → 5 failed | 13 passed → 紅 ①②③④⑤
//   `delete('page')` 改回無條件         → 1 failed | 17 passed → 紅 ⑱
//   filterKey 拿掉 category 軸          → 1 failed | 17 passed → 紅 ⑧
//   filterKey 拿掉 price 軸             → 1 failed | 17 passed → 紅 ⑨
//   拿掉還原波 early return             → 2 failed | 16 passed → 紅 ⑩⑯
//   `normalizedQuery` 不收斂品牌軸      → 3 failed | 15 passed → 紅 ⑥⑩⑪、**⑯仍綠**
// 🔴 最後那一靶的「⑯仍綠」不是缺口,是那條防線的形狀本身:⑯ 是新格式進站,而新格式站內到處都是
//    ⇒ 少了收斂,我們自己怎麼點都全綠,只有客人手上的舊格式連結(⑩)會踩。
// 🔴 「`delete('page')` 改回無條件 → ⑥紅」是**這次重跑推翻的舊字面**:實跑零紅 —— ⑥ 走等值早退
//    那條路,根本到不了刪 page 那一行 ⇒ 該守門在最終版上沒有任何負測。⑱ 是為此補的。
// ⚠️ 已知未擋住(R2 評估為不值得補):`[...brands].sort()` 拿掉(reducer 不會產生不同順序、
//    UI 不可達)、`prevFilterKey !== null` 守衛拿掉(該守衛是不可達死碼,拿掉零行為差異)。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CascadeFilterState } from '@pcm/ui';

const hoisted = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: hoisted.replace, refresh: hoisted.refresh, push: vi.fn() }),
}));

import { useCatalogFilterUrlSync } from './products-url-state';
import type { ProductExtraFilters } from './filter-state';

const EXTRAS: ProductExtraFilters = {
  price: null,
  colors: [],
  inStock: false,
  isNew: false,
  isSale: false,
};

const RESTORE_SOURCES = {
  categories: [{ id: 'ride', name: '操控部品', children: [] }],
  productBrands: [{ id: 'akrapovic' }, { id: 'bonamici' }],
  // Q28①:hook 新增的第三份對照表(判斷 vehicle 這輪會不會被寫進 URL);本檔案例 cascade.vehicle 恆 null
  // ⇒ 讓路守衛不觸發、行為與本片前逐字相同。
  motoBrands: [],
};

const cascade = (
  brands: string[],
  category: CascadeFilterState['category'] = null,
): CascadeFilterState => ({ vehicle: null, category, brands });

const setUrl = (search: string) => window.history.replaceState(null, '', `/products${search}`);

/** 掛載 hook、跑一次狀態變更,回傳 replace/refresh 的呼叫情形。 */
const transition = (
  initialSearch: string,
  from: CascadeFilterState,
  to: CascadeFilterState,
) => {
  setUrl(initialSearch);
  const { rerender } = renderHook(
    ({ state }: { state: CascadeFilterState }) =>
      useCatalogFilterUrlSync(state, EXTRAS, RESTORE_SOURCES),
    { initialProps: { state: from } },
  );
  rerender({ state: to });
};

beforeEach(() => {
  hoisted.replace.mockClear();
  hoisted.refresh.mockClear();
});

// 🔴 `?pbrands=a,b` 序列化後逗號會被 `URLSearchParams` 依規格編成 `%2C`(它是 form-urlencoded
//    序列化器,逗號不在安全集合裡)⇒ 網址列上看到的是 `pbrands=akrapovic%2Cbonamici`。
//    功能完全等價(讀回來自動解碼、server 端同一支 parser),但**斷言要用解碼後的值比**,
//    不要拿 backlog #287 條目裡那個未編碼的字面去比對 —— 那條字面講的是格式、不是序列化結果。
const PBRANDS = (...slugs: string[]) => `pbrands=${encodeURIComponent(slugs.join(','))}`;

describe('useCatalogFilterUrlSync — segment key 碰撞才 refresh', () => {
  it('① Sean 回報的那一步:取消非最後值的品牌 → 只送一次 replace,**不再需要 refresh**(#287 收益)', () => {
    // 舊格式進站(客人已分享的連結)→ 寫出新格式:?pbrand=akrapovic&pbrand=bonamici → ?pbrands=bonamici
    // 舊行為:兩者 segment key 同為 {pbrand:bonamici} → 必須補 refresh(2 次型錄查詢)。
    // #287 後:新網址的 key 是 {pbrands:bonamici},鍵名就不同 → 不碰撞 → 一次查詢即正確。
    transition(
      '?pbrand=akrapovic&pbrand=bonamici',
      cascade(['akrapovic', 'bonamici']),
      cascade(['bonamici']),
    );

    expect(hoisted.replace).toHaveBeenCalledWith(`/products?${PBRANDS('bonamici')}`, {
      scroll: false,
    });
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('② 取消最後值的品牌 → replace 足矣,不得多餘 refresh', () => {
    transition(
      '?pbrand=akrapovic&pbrand=bonamici',
      cascade(['akrapovic', 'bonamici']),
      cascade(['akrapovic']),
    );

    expect(hoisted.replace).toHaveBeenCalledWith(`/products?${PBRANDS('akrapovic')}`, {
      scroll: false,
    });
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('③ 新增「字母序在後」的品牌 → replace 足矣,不得多餘 refresh', () => {
    transition('?pbrand=akrapovic', cascade(['akrapovic']), cascade(['akrapovic', 'bonamici']));

    expect(hoisted.replace).toHaveBeenCalledWith(
      `/products?${PBRANDS('akrapovic', 'bonamici')}`,
      { scroll: false },
    );
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑤ 新增「字母序在前」的品牌(舊格式下會碰撞的那格)→ #287 後也不再碰撞', () => {
    // 🔴 這格的歷史要留著:舊格式下碰撞不是「移除」專屬 —— 先選 bonamici 再加 akrapovic,
    //   排序後最後值仍是 bonamici → 新舊 segment key 同為 {pbrand:bonamici} → 一樣不重抓
    //   (code-reviewer R2 nit-B 抓到的漏洞)。#287 改單值鍵之後這條路整個消失,
    //   本格改成釘住「消失了」:同一個操作零 refresh。
    transition('?pbrand=bonamici', cascade(['bonamici']), cascade(['akrapovic', 'bonamici']));

    expect(hoisted.replace).toHaveBeenCalledWith(
      `/products?${PBRANDS('akrapovic', 'bonamici')}`,
      { scroll: false },
    );
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑰ 碰撞守門仍有判別力:`?category=A&category=B` 這種重複鍵改成 B → 必須補 refresh', () => {
    // 🔴 #287 拿掉了品牌軸的碰撞,但**沒有拿掉守門** —— 因為重複鍵還有別的來源:
    //   手打/外站來的 `?category=A&category=B`。server 讀的是**第一個**值(`searchParams.get`),
    //   segment key 取的是**最後一個** ⇒ 客人把分類切成 B 時:
    //     舊網址 key = {category:操控部品}(最後值)、新網址 key = {category:操控部品} → 相同,
    //     但 server 之前看到的是「已下架的分類」(0 筆)、現在該看到「操控部品」⇒ 內容必須變。
    //   缺 refresh = 畫面停在 0 筆。**拿掉 `if (collides) router.refresh()` 只有本格會紅。**
    window.history.replaceState(
      null,
      '',
      '/products?category=%E5%B7%B2%E4%B8%8B%E6%9E%B6%E7%9A%84%E5%88%86%E9%A1%9E&category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81',
    );

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).getAll('category')).toEqual(['操控部品']); // 重複鍵被收斂成使用者選的那個
    expect(hoisted.refresh).toHaveBeenCalledTimes(1);
  });

  it('⑥ server 回新 props(restoreSources 換 identity)但篩選未變 → 不得動 URL、不得洗掉 page', () => {
    // 🔴 分頁失效回歸守門(2026-07-19):本 effect 的 deps 含 restoreSources,而它在 ProductsPage
    // 是 useMemo(..., [categories, brands]) —— server 每回一次新 props 就換 identity。
    // 舊版無條件 `params.delete('page')` 於是把使用者剛翻到的 ?page=2 洗掉 → 內容退回第 1 頁。
    // 另::219-220 重建 pbrand 會把它排到尾端(?pbrand=x&page=2 → ?page=2&pbrand=x),
    // 故比較必須正規化;否則純順序差異也會多送一次導覽 + 多查一次全型錄。
    window.history.replaceState(null, '', '/products?pbrand=akrapovic&page=2');
    const sourcesA = { categories: [], productBrands: [{ id: 'akrapovic' }], motoBrands: [] };
    const sourcesB = { categories: [], productBrands: [{ id: 'akrapovic' }], motoBrands: [] }; // 值同、identity 不同

    const { rerender } = renderHook(
      ({ sources }: { sources: typeof sourcesA }) =>
        useCatalogFilterUrlSync(cascade(['akrapovic']), EXTRAS, sources),
      { initialProps: { sources: sourcesA } },
    );
    rerender({ sources: sourcesB });

    expect(hoisted.replace).not.toHaveBeenCalled();
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑱ state 已含篩選、URL 還沒(replace 未落地的那一拍)→ 指紋未變就**不得**洗掉 page', () => {
    // 🔴 這格是 2026-08-11 #287 突變驗證補的:原本檔頭寫「`delete('page')` 改回無條件 → ⑥紅」,
    //   重跑發現**零紅** —— ⑥ 走的是等值早退那條路,根本到不了刪 page 那一行,
    //   於是「條件式刪 page」這道守門在最終版上其實沒有任何負測(恆真守門)。
    //   構造:`router.replace` 是非同步的,server 回新 props 時 `window.location` 可能還是舊的
    //   ⇒ 出現「state 有分類、URL 只有 page」這一拍。此時指紋沒變(不是使用者操作)
    //   ⇒ 頁碼必須留著(`useBrowseUrlSync` 才是 page 的權威寫入者,洗掉就是 2026-07-19 的分頁失效)。
    //   拿掉 `if (filtersChanged)` 這個條件 ⇒ **只有本格會紅**。
    window.history.replaceState(null, '', '/products?page=2');
    const picked = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];
    const sourcesA = { ...RESTORE_SOURCES };
    const sourcesB = { ...RESTORE_SOURCES }; // 值同、identity 不同(= server 回新 props)

    const { rerender } = renderHook(
      ({ sources }: { sources: typeof sourcesA }) =>
        useCatalogFilterUrlSync(cascade([], picked), EXTRAS, sources),
      { initialProps: { sources: sourcesA } },
    );
    rerender({ sources: sourcesB });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('page')).toBe('2');
    expect(qs(url).get('category')).toBe('操控部品');
  });

  it('⑦ 使用者真的改了篩選 → 仍須刪 page 回第 1 頁(不得因⑥的修法而失效)', () => {
    window.history.replaceState(null, '', '/products?pbrand=akrapovic&page=3');

    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: ['akrapovic'] } },
    );
    rerender({ brands: ['akrapovic', 'bonamici'] });

    // 篩選變了 → 回第 1 頁(URL 不得殘留 page=3)
    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(url).not.toContain('page=');
    expect(qs(url).get('pbrands')).toBe('akrapovic,bonamici');
  });

  it('⑧ 分類變動 → 也必須刪 page 回第 1 頁(釘住 filterKey 的 category 軸)', () => {
    window.history.replaceState(null, '', '/products?category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81&page=4');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      {
        initialProps: {
          category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'],
        },
      },
    );
    rerender({
      category: {
        mainId: 'ride',
        main: '操控部品',
        subId: 'ride-step',
        sub: '腳踏後移與傳動',
      } as CascadeFilterState['category'],
    });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(url).not.toContain('page=');
  });

  it('⑨ 價格區間變動 → 也必須刪 page 回第 1 頁(釘住 filterKey 的 price 軸)', () => {
    window.history.replaceState(null, '', '/products?page=5');

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([]), extras, RESTORE_SOURCES),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(url).not.toContain('page=');
    expect(url).toContain('price=');
  });

  it('⑩ 深連結還原波(state 剛追上 URL)→ 不得動 URL、不得吃掉 ?page=(#289)', () => {
    // 🔴 `/products?pbrand=akrapovic&page=2` 進站:mount 首輪 state 還空(走 initialized 早退),
    // useDeepLinkRestore dispatch 後 state 變 ['akrapovic'] → 指紋由空變非空。
    // 若把這一波誤判為「使用者改篩選」就會刪掉 page → 實測終態為內容第 1 頁 + UI 停在第 2 頁,
    // 且**不會自癒**(useBrowseUrlSync 的 deps 此時全未變、effect 不重跑)。
    // ⚠️ 本案例用「首輪空 → rerender 非空」模擬還原波,等價前提 = `useDeepLinkRestore` 的所有
    //    dispatch 同步發生在同一 effect → React 批次成**單一 render**,不會出現「category 先到、
    //    brands 後到」的半波(半波會使 params 少掉 pbrand、early return 不觸發、page 仍被吃)。
    window.history.replaceState(null, '', '/products?pbrand=akrapovic&page=2');

    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: [] as string[] } }, // mount 時 state 還空(還原尚未 flush)
    );
    rerender({ brands: ['akrapovic'] }); // restore dispatch 到位 → state 追上 URL

    expect(hoisted.replace).not.toHaveBeenCalled();
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑯ 同一波、**新格式**進站(?pbrands=)→ 一樣不得動 URL、不得吃掉 ?page=', () => {
    // 🔴 ⑩ 與本格是一對,而**只有⑩擋得住 #287 引入的那條回歸**:
    //   寫出端改新格式後,若 `normalizedQuery` 不收斂品牌軸,舊格式進站時重建結果(新格式)
    //   與當前 URL(舊格式)永遠不相等 ⇒ ⑩ 的早退不觸發 ⇒ page 被刪、#289 原封復發。
    //   本格(新格式)在那個突變下**照樣綠** —— 站內連結全是新格式,所以我們自己怎麼點都測不出來,
    //   踩到的只有客人手上的舊連結。留著本格是為了讓這個不對稱看得見,不是湊數。
    window.history.replaceState(null, '', '/products?pbrands=akrapovic&page=2');

    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: [] as string[] } },
    );
    rerender({ brands: ['akrapovic'] });

    expect(hoisted.replace).not.toHaveBeenCalled();
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('④ 分類變動(單值 key、天然不碰撞)→ 不得多餘 refresh', () => {
    // 無條件 refresh 會讓每次切分類都對 12793 筆型錄多查一次、零收益
    transition(
      '',
      cascade([]),
      cascade([], { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category']),
    );

    expect(hoisted.replace).toHaveBeenCalledWith('/products?category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81', {
      scroll: false,
    });
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });
});

// ── #315:認不得的 pbrand/category 留在 URL 上(Sean 2026-08-11 Q1=A)────────────────
//
// 病灶:改名殘連結 / 客人手打的 `?pbrand=dbk` 會被寫回段清掉 ⇒ 網址變成沒有篩選的 `/products`
// ⇒ **靜默顯示全站商品**,客人以為還在看 DBK。留著則是 0 筆 + 空狀態(server 只驗形狀不驗對照表,
// `lib/catalog-query.ts:161`)——看得見、可自我解釋。
//
// 🔴 ⑭ 是**正向對照、不是湊數**:⑪⑫⑬ 全部只證「留得住」,把 delete 整條拿掉也會全綠;
//    要靠 ⑭ 才分得出「認不得才留」與「一律不刪」。
// 突變驗證 —— **四靶全部重跑**(2026-08-11 #287 後再跑一次;數字=該次 vitest 輸出字面):
//   ① 拿掉 unknownBrands 保留                    → 紅 ⑪⑫⑮(3 failed | 15 passed)
//   ② `category` else 改回無條件 `params.delete` → 紅 ⑬  (1 failed | 17 passed)
//   ③ `category` else 整條拿掉(=一律不刪)      → 紅 ⑭  (1 failed | 17 passed)
//   ④ 把「空表就停用保留」那道守衛**加回去**      → 紅 ⑮  (1 failed | 17 passed)
// 🔴 ④ 是刻意留的**回歸鎖**:那道守衛真的被寫進來過,理由聽起來很對(RPC 中斷保護),
//    但前提是假的、方向剛好相反(詳 ⑮ 那格的註解)。這一靶讓它不會被第二個人善意地加回來。
const qs = (url: string) => new URLSearchParams(url.split('?')[1] ?? '');

describe('useCatalogFilterUrlSync — #315 認不得的參數留在網址上', () => {
  it('⑪ 未知 pbrand + 有效品牌並存 → 兩者都留,且**不送導覽**(等值早退命中)', () => {
    // 這格同時釘住修法的支點:保留未知值後,重建結果與當前 URL **值層等值** ⇒ 連 replace 都不必送。
    // ⚠️ 不涵蓋重複鍵(`?pbrand=dbk&pbrand=dbk` 會被收斂成一個 ⇒ 仍送一次收斂導覽,無害)。
    transition('?pbrand=akrapovic&pbrand=dbk', cascade(['akrapovic']), cascade(['akrapovic']));

    expect(hoisted.replace).not.toHaveBeenCalled();
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑫ URL 只帶未知 pbrand,使用者改價格 → 未知值仍在', () => {
    window.history.replaceState(null, '', '/products?pbrand=dbk');

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([]), extras, RESTORE_SOURCES),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('pbrands')).toBe('dbk'); // 未知值改用新格式寫回,值本身原樣
    expect(qs(url).get('price')).toBe('10000-20000');
  });

  it('⑬ 未知 category 不被刪(改名殘連結)', () => {
    window.history.replaceState(null, '', '/products?category=已下架的分類');

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([]), extras, RESTORE_SOURCES),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('category')).toBe('已下架的分類');
  });

  it('⑭ 正向對照:**認得**的 category 被使用者清掉時,照舊要刪(不得因本片變成永不刪)', () => {
    // 🔴 **必須跑滿三個 render**,兩個做不出來 —— 這格第一版就是寫成兩個而假紅的:
    //   ① mount 走 `initialized` 早退,`pendingRestoreRef` 還是 null;
    //   ② 直接跳到「state 已清空」時,V-1a 還原窗口守衛看到「state 空 + URL 有**可還原**的 category」
    //      ⇒ 判定成還原波、`return` 收手,**根本走不到寫回段** ⇒ replace 從未被呼叫。
    //   要觀察「清掉分類」必須先讓 state 非空一次(=還原窗口被消化、pendingRestoreRef 轉 false),
    //   那也才是真實路徑:客人得先選到分類,才有分類可清。
    //   ⚠️ 這同時是「認不得」與「認得」兩條路的**不對稱點**:⑬ 的未知值不 restorable、一步就到寫回段。
    window.history.replaceState(null, '', '/products?category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81');
    const picked = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: picked } },
    );
    rerender({ category: picked }); // ② 還原窗口消化(此輪與 URL 等值 ⇒ 不送導覽)
    expect(hoisted.replace).not.toHaveBeenCalled();
    rerender({ category: null }); // ③ 使用者清掉分類

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('category')).toBeNull();
  });

  it('⑮ 品牌對照表是空的(taxonomy RPC 中斷)→ 值**照樣保留**,不得因此被刪', () => {
    // 🔴 這格的歷史值得留著:我一度在這裡加了一道「空表就停用保留」的守衛(R1 nit-4),
    //   理由是「中斷期每個 pbrand 都會被判未知 ⇒ 全站釘 0 筆」。**那個前提是假的**,
    //   跨模型 adversarial 輪擊破:商品過濾走 `search_catalog_by_vehicle` 的 `p_brand_slugs`
    //   (`lib/products.ts:402`),跟掛掉的 `catalog_brand_counts`(:528)是**兩支不同的 RPC**
    //   ⇒ 側欄清單掛掉時,有效品牌照樣篩得對。
    //   ⇒ 有守衛才會出事:客人一動篩選,**有效**的 pbrand 被刪 ⇒ 靜默顯示全站(=#315 本身),
    //     而且表恢復後不會自癒。守衛已拆,這格改成釘住「拆掉之後」的正確行為。
    //   ⚠️ 教訓:我當時驗了「表會是空的」三段鏈,卻沒驗**結論那一跳**「空表會不會影響查詢」。
    window.history.replaceState(null, '', '/products?pbrand=akrapovic');
    const EMPTY_TABLE = { ...RESTORE_SOURCES, productBrands: [] as { id: string }[] };

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([]), extras, EMPTY_TABLE),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('pbrands')).toBe('akrapovic'); // 空表也不刪
    expect(qs(url).get('price')).toBe('10000-20000'); // 其他軸照常
  });
});
