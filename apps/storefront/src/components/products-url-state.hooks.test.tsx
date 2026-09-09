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

import { useCatalogFilterUrlSync, useBrowseUrlSync, useBrowseUrlState } from './products-url-state';
import { DEFAULT_PER_PAGE } from './products-url-parsers';
import {
  markClearAllRequested,
  __resetClearAllRequestedForTests,
} from './use-catalog-filter-url-sync';
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
  // 🔴 **旗標是模組層的, 會跨測試活著**(R3 consider):第一格跑完時 state 是空的
  //    ⇒ 那一輪不會把它歸零 ⇒ 它帶著 `true` 離開。#315 那格之所以還成立, 是因為它的 helper
  //    剛好多跑一次非空 render 把它清掉 ⇒ 📌 **那道鎖是靠隔壁測試的 render 次數在成立的。**
  //    有人重排測試或把 helper 縮成兩個 render, 它會【安靜地】停止鎖。這一行讓它不依賴那個巧合。
  __resetClearAllRequestedForTests();
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

  // ── ⟦搜尋-落點換 /products⟧ 2026-09-03 · Q2=A 的**後半** ────────────────────
  //
  // 🔴🔴 主視窗拍板逐字:「提示句;facet 仍可點, **點了就清掉關鍵字**」
  //    ⛔ 我第一版只做了前半(提示句)⇒ code-reviewer 抓到:
  //       關鍵字留在 URL 上, 而 `ActiveChips` 已經畫出一顆「已選」的膠囊
  //       ⇒ 📌 **畫面聲稱清單被那個 facet 縮過, 而商品其實是關鍵字撈的、完全沒縮。**
  it('⑲ 使用者動了 facet(關鍵字還在 URL 上)→ **必須清掉 search**', () => {
    window.history.replaceState(null, '', '/products?search=cark9650&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('search'), '關鍵字沒被清掉 ⇒ 膠囊會說謊').toBeNull();
    // 🎯 而分類要真的寫進去 —— 少了這行, 一個「把整串 query 清空」的實作也會綠。
    expect(qs(url).get('category')).toBe('操控部品');
  });

  // 🔴 code-reviewer 2026-09-04 Important 1:`unmatched` 是孤兒參數 —— 沒有任何路徑清它。
  it('㉑ 使用者動了 facet → **必須**連 `unmatched` 一起清(否則那句話永久卡著)', () => {
    window.history.replaceState(null, '', '/products?unmatched=%E5%A5%BD%E7%9C%8B%E7%9A%84&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('unmatched'), '沒清掉 ⇒ 「這幾個字沒用到」會講一個已經不存在的搜尋').toBeNull();
  });

  it('⑳ 🔵 負對照:URL 還沒追上 state 的那一拍(指紋未變)→ **不得**清掉 search', () => {
    // 🔴🔴 **這一格是【第二版】—— 第一版到不了要測的那個世界, 而突變告訴了我。**
    //    ⛔ 第一版構造「server 回新 props、URL 有 search」然後斷言 `replace` 沒被呼叫。
    //    🛑 而那條路走的是**等值早退**, 根本到不了刪 search 那一行
    //       ⇒ 無條件 `params.delete('search')` 在那個世界裡**行為完全相同**
    //       ⇒ 📌 突變 M8(改成無條件)⇒ **20/20 全綠** = 那一格什麼都沒守。
    //    ⇒ ✅ 改抄 ⑱ 的構造(它是專門為了「到得了寫入那一行」而造的):
    //       `router.replace` 是非同步的 ⇒ 出現「state 有分類、URL 只有 page」這一拍,
    //       此時**指紋沒變**(不是使用者操作)⇒ 會走到寫入, 而 search 必須留著。
    //    📌 **一個到不了目標世界的測試, 在正向那一側會誠實地印綠。**
    window.history.replaceState(null, '', '/products?search=cark9650&page=2');
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
    expect(url, '沒走到寫入 ⇒ 這一格又到不了目標世界了').toBeDefined();
    expect(qs(url).get('search'), '關鍵字被憑空清掉 —— 客人沒有動任何 facet').toBe('cark9650');
    // 🔴 **[2026-09-08 · code-reviewer nit] `q0` 也必須受 `filtersChanged` 管** ——
    //    突變(讓 `q0` 的寫入跳出 `filtersChanged` 而 `search` 的 delete 仍受管)⇒ **62/62 全綠**。
    //    真實危害:深連結 `?search=X` 的還原波會寫出 `?search=X&q0=X`
    //    ⇒ `app/products/page.tsx` 那道 `spGet('q0') === null` 不成立
    //    ⇒ 🛑 **膠囊解析對那個客人【永久關閉】** + 一次多餘導覽。
    expect(qs(url).get('q0'), '還原波寫了 q0 ⇒ 那個客人的膠囊解析從此不會再發生').toBeNull();
  });

  // ═══ ⟦搜尋-關鍵字消失無聲⟧(主視窗 A 2026-09-08 拍乙:只做出路, 文案端 Sean)═══
  //
  // 🔬 **實測到的缺口**(本機顧客站鑽機 2026-09-08 02:1x, 桌機側欄真的點到品牌):
  //   解析得到 facet 的路   ?search=X&q0=X ⇒ 點品牌 ⇒ ?q0=X&pbrands=rizoma
  //                        ⇒ 🟢 畫面有「查看全部 1 筆搜尋結果 →」= 回頭路【已經存在】
  //   解析不到 facet 的路   ?search=可調角度(**無 q0**)⇒ 點品牌 ⇒ ?pbrands=rizoma
  //                        ⇒ 🔴 q0=null ⇒ 膠囊與提示都消失、**無聲**、**沒有回頭路**
  // 🔴 成因:`app/products/page.tsx` 的 `next.set('q0', catalogQuery.search)` **只在轉址那條分支裡**,
  //    而解析不到任何 facet 的詞**不會轉址** ⇒ 那條路上沒有人寫 q0。
  // ✅ 修法 = 本 effect 刪 search 之前, 把那個字**順手存進 q0**(若 q0 尚未存在)
  //    ⇒ 既有的 `SearchAllResultsLink` 就【兩條路都涵蓋】, **不新增元件**。
  // 🛑 **它不改行為**:search 照樣刪、facet 照樣生效、`q0` 不參與過濾
  //    (`app/products/page.tsx` 那一行上方註解逐字「它**不參與過濾**」)。
  // ⚠️ **而本片讓本檔成為 `q0` 的【第二個產生點】** —— `page.tsx` 那道 `spGet('q0') === null` 守衛上方的註解原本逐字寫
  //    「它只從『查看全部搜尋結果 →』那條連結來, 站上沒有別的產生點」⇒ 那句已同步訂正。

  it('㉜ 動 facet 且 URL 有 search 而【無】q0 → 把關鍵字存進 q0(回頭路的來源)', () => {
    window.history.replaceState(null, '', '/products?search=cark9650&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('q0'), 'q0 沒被寫入 ⇒ 關鍵字無聲消失, 客人沒有回頭路').toBe('cark9650');
    // 🎯 而 search 仍必須被刪 —— 少了這行, 一個「兩個都留著」的實作也會綠,
    //    而那正是 7bfefe4af4 修掉的那個病(膠囊聲稱已縮而商品是關鍵字撈的)。
    expect(qs(url).get('search'), 'search 沒被清掉 ⇒ 壞回 7bfefe4af4 修掉的病').toBeNull();
  });

  it('㉝ 🔵 負對照:URL 已經有 q0(落地頁形狀)→ **不得覆寫**它', () => {
    // 🔴 為什麼要這一格:落地頁是 `?search=X&q0=X`, 兩個值今天相同 ⇒ 覆寫與不覆寫**印一樣的東西**。
    //    ⇒ 所以這裡刻意讓兩個值**不同**, 兩個世界才分得開。
    window.history.replaceState(null, '', '/products?search=%E6%96%B0%E7%9A%84&q0=%E5%8E%9F%E6%9C%AC%E7%9A%84&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('q0'), '覆寫了 q0 ⇒ 客人本來打的字被中途的字蓋掉').toBe('原本的');
  });

  it('㉞ 🔵 負對照:URL 沒有 search → **不得**憑空生出 q0', () => {
    window.history.replaceState(null, '', '/products?page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('q0'), '憑空生出 q0 ⇒ 畫面會冒出一行沒有人搜尋過的「查看全部」').toBeNull();
  });

  it('㉟ 🔵 負對照:search 只有空白 → **不得**寫出空的 q0(那會畫出假的「0 筆」)', () => {
    // 🔴 受詞在 `products-message-state.tsx` 的 `originalSearchQueryFor()`:它對 `?q0=%20%20` 回 null,
    //    理由逐字是「否則會畫出『查看全部 **0** 筆』那個假 0」。
    //    ⇒ 那道守門在【下游】。本格守的是【上游不要製造它】—— 兩道都要, 因為
    //      下游那道日後若被改寫, 上游這一格仍會紅。
    window.history.replaceState(null, '', '/products?search=%20%20&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('q0'), '寫出了空白的 q0 ⇒ 下游會畫出一個假的 0 筆').toBeNull();
  });

  it('⑥ server 回新 props(restoreSources 換 identity)但篩選未變 → 不得洗掉 page', () => {
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

  // 🔴🔴 **[2026-09-08 · 釘的是那一段的【位置】, 不是它的內容]**
  //    突變:把 `⟦搜尋-關鍵字消失無聲⟧` 那整塊(仍包在 `filtersChanged` 裡)移到
  //    那道等值早退**之前** ⇒ 早退所看的 `params` 已經多了一個 `q0` ⇒ **等值不再成立**
  //    ⇒ 早退失效 ⇒ 底下的 `delete('page')` 跑掉 ⇒ 📌 **#289 分頁失效復發**(實測不會自癒)。
  //
  //    🔴🔴 **[R2 nit-1 訂正 —— 這一格的【第一版是恆真的】]**
  //    ⛔ 舊版抄 ⑯ 那個 `sourcesA`/`sourcesB` 換 identity 的形狀,
  //       而那兩次 render 的 **`filterKey` 相同** ⇒ `filtersChanged` **恆 false**
  //       ⇒ 🛑 **被移上去的那一塊根本不執行** ⇒ 突變之後 44/44 全綠、
  //          對全部 146 支元件測試檔跑同一發也是 2180 passed / 0 紅。
  //       ⇒ 📌 **它宣稱釘住位置, 而它連那段碼都沒跑到** —— 字面 vs 事實。
  //    ✅ 改抄 ⑯ 的**另一半**(還原波:`brands: [] → ['akrapovic']`)——
  //       那才會讓 `filterKey` 真的由空變非空 ⇒ **`filtersChanged = true`**,
  //       而網址上本來就有 `?pbrands=akrapovic` ⇒ **重建結果與現網址等值** ⇒ 早退成立。
  //       ⇒ 🎯 **兩個條件同時成立, 才是那一維真正的目標世界。**
  it('⑯b 還原波(filtersChanged 為真)+ 網址帶關鍵字 → 仍然**零導覽**(釘住 q0 那段在早退【之後】)', () => {
    window.history.replaceState(null, '', '/products?pbrands=akrapovic&page=2&search=cark9650');

    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: [] as string[] } },
    );
    rerender({ brands: ['akrapovic'] });

    expect(
      hoisted.replace,
      '早退那條路上送出了導覽 ⇒ q0 那段跑在等值比對【之前】⇒ #289 分頁失效會復發',
    ).not.toHaveBeenCalled();
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
// `lib/catalog-query.ts` 的 `parseCatalogQuery` docblock)——看得見、可自我解釋。
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

  // ═══ ⟦search-CHIPDELETEDEADURL⟧(Sean 2026-09-04 拍甲)═══
  // 🔴 這三格守的是同一句不變式:**網址上有 `categories` 時,本 hook 一個字都不寫分類軸。**
  // ⛔ ~~拿掉 `if (!params.has(CATEGORIES_PARAM))` 那一層 ⇒ ㉒㉓ 都紅~~
  // ⇒ 🔴 **2026-09-04 實跑訂正:那句是錯的。㉒㉓ 對【不同的】改壞法有判別力,不是同一發。**
  //   突變①`if (!params.has(...))` ⇒ `if (true)`(拿掉守衛)⇒ **只有 ㉓ 紅**,㉒ 全綠。
  //   突變②`cascade.category === null` ⇒ `params.delete(CATEGORIES_PARAM)`(= 我 09-04 實際犯的
  //   那個修法)⇒ **只有 ㉒ 紅**,㉓ 全綠。
  //   📌 所以**只跑一發突變會把「這格沒判別力」讀成「這格通過」** —— 舊字面留刪除線, 讓下一個人
  //   不要以為 ㉒ 守得住那道守衛。㉔ 釘住本片**新造出來**的行為(見該格)。
  it('㉒ 多顆分類在網址上、客人改價格 → `categories` **原封不動**(我 2026-09-04 弄壞過這一格)', () => {
    // 病史:第一版修法寫成「`cascade.category === null` ⇒ 刪掉 `categories`」,鑽機實測這一格
    //   從「刪一顆剩一顆」變成「兩顆都還在」⇒ 📌 **修法可以把本來好的世界弄壞, 而它不在症狀那一格。**
    window.history.replaceState(null, '', '/products?categories=A%2CB');

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([]), extras, RESTORE_SOURCES),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('categories')).toBe('A,B');
    expect(qs(url).get('price')).toBe('10000-20000'); // 其他軸照常動
  });

  it('㉓ 主症狀:膠囊剛刪完、cascade 仍握著一顆 → **不得**把 `category=` 寫回去', () => {
    // 🔴 這一格就是「按了沒反應」的成因:膠囊送出乾淨網址 `?categories=操控部品` 之後,
    //   cascade 這一拍仍握著那一顆(還原波尚未消化)⇒ 舊碼下一行 `params.set('category', …)`
    //   把舊鍵寫回去 ⇒ 客人看到的是**網址原封不動、膠囊沒少**。
    //   ⚠️ `cascade.category` **是單值的** ⇒ 它永遠只答得出一顆, 從它推 `categories` 結構上不可能對。
    window.history.replaceState(null, '', '/products?categories=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81');
    const stillHeld = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];

    const { rerender } = renderHook(
      ({ extras }: { extras: ProductExtraFilters }) =>
        useCatalogFilterUrlSync(cascade([], stillHeld), extras, RESTORE_SOURCES),
      { initialProps: { extras: EXTRAS } },
    );
    rerender({ extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] } });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('category')).toBeNull(); // 舊鍵不得被寫回
    expect(qs(url).get('categories')).toBe('操控部品'); // 新鍵原樣留著
  });

  it('㉔ 多顆在網址上 + 側欄改分類 → **`unmatched` 必須消失**(守衛只擋分類軸, 不擋這三個 delete)', () => {
    // 🔴 這一格 2026-09-04 **換過形狀**:原本釘的是「一次 replace 都不送」——
    //   那是把**缺陷本身**當成規格釘住了。主視窗-94 當天裁「一起做」⇒ 現在釘的是修好之後的樣子。
    //   ⛔ ~~多顆 + 分類軸變動 ⇒ 零導覽~~(那個世界裡 `page`/`search`/`unmatched` 三個 delete
    //   一起不跑 ⇒ 搜尋留下的「這幾個字沒有用到」會**永久卡在畫面上**)。
    //   ✅ 現在:等值早退帶 `!categoryAxisSuppressed` ⇒ 三個 delete 照跑, 分類軸仍不被寫。
    //   🛑 拿掉 `!categoryAxisSuppressed` ⇒ 本格紅。
    window.history.replaceState(null, '', '/products?categories=A%2CB&unmatched=%E5%B0%BB%E9%8A%98&page=3');

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url).toBeDefined();
    expect(qs(url).get('unmatched')).toBeNull(); // 那句話要跟著這次操作消失
    expect(qs(url).get('page')).toBeNull(); // 回第 1 頁
    // ⛔ ~~expect(qs(url).get('categories')).toBe('A,B'); 🔴 而分類軸仍然不被本 hook 動~~
    // 🔴🔴 **2026-09-05 Sean `21` 推翻了那個規格** —— 逐字「這邊我要把多顆分類修好, 因為我們
    //   客人可能會多選不同分類」⇒ **多顆狀態下側欄選的那一顆要被【加進去】**, 不是被忽略。
    //   舊字面留刪除線, 讓拿它去搜的人同一發撞到訂正。
    expect(qs(url).get('categories')).toBe('A,B,操控部品');
    expect(qs(url).get('category')).toBeNull(); // 舊鍵也不得被寫回
  });

  it('㉕ 🔵 負對照:多顆世界的**還原波** → 照舊早退, **不得**吃掉 `?page=`(#289 不得回歸)', () => {
    // 🔴 這格守的是 ㉔ 那個修法**沒有**打破的東西 —— 它與 ㉔ 是一對:
    //   ㉔ 要「多顆 + 分類軸變動 ⇒ 三個 delete 照跑」,而還原波**看起來一模一樣**
    //   (cascade 由空變非空、filtersChanged 為真、網址有 `categories`)。
    //   🎯 分辨它們的是 `categoryAxisSuppressed` 的**第二個條件**:還原波的 cascade 是從網址
    //   同一個 `category=` 還原來的 ⇒ 兩邊相等 ⇒ **什麼都沒被擋** ⇒ 不是「被壓下」。
    //   🛑 把那個布林簡化成只看 `params.has(CATEGORIES_PARAM)` ⇒ 本格紅(page 被吃掉)。
    window.history.replaceState(
      null,
      '',
      '/products?categories=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81&category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81&page=2',
    );

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    // 還原 dispatch 落地:state 追上網址上那個 `category=`
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  // ═══ ⟦search-REDUNDANTREPLACE⟧(主視窗-94 2026-09-05 拍乙)═══
  // 🔴 **本格【先寫、當時是紅的】** —— 那是它存在的理由:它釘的是一個當時還不成立的行為。
  //   病:`⟦search-SHORTNAMEZEROFLASH⟧` 之後 server 自己把**裸子分類名**解成全路徑, 而回寫段
  //   仍然無條件用 `${main} · ${sub}` 重建 ⇒ 與網址上的裸短名**不等** ⇒ 等值早退不命中
  //   ⇒ 送一次多餘的 `router.replace`, 而同一輪 `filtersChanged` 為真 ⇒ **`page` 被一起刪掉**。
  // 🔬 **鑽機 2026-09-05 實走(四格, 比解碼後的參數值)**:
  //   裸子名 ⇒ 網址被改寫 · 裸子名+`page=2` ⇒ **改寫且 page 掉了**
  //   🟢 而全路徑那兩格(負對照)**兩個都沒變** ⇒ 差別只有分類名是裸的還是全的。
  // ✅ 修法:`normalizedQuery` 把分類軸也收斂 —— **裸子名與它解出來的全路徑視為同一個篩選**。
  //   🛑 那是「把比對改寬」, 而板列曾警告過這條路。**方向的理由**:那道早退 firing **更多**是往
  //   **安全**走 —— #289 那個「不會自癒」的終態是它**沒有** firing 時產生的(見上方 ⑩⑯)。
  it('㉖ 裸子分類名進站 + `?page=2` → **不得**多送一次 replace, `page` 必須活著', () => {
    // 樹要有子分類, 預設的 RESTORE_SOURCES 是 childless ⇒ 那份餵下去本格恆綠 = 零判別力。
    const tree = {
      ...RESTORE_SOURCES,
      categories: [
        { id: 'gear', name: '騎士用品與配件', children: [{ id: 'mount', name: '攝影機支架', count: 4 }] },
      ],
    };
    setUrl('?category=%E6%94%9D%E5%BD%B1%E6%A9%9F%E6%94%AF%E6%9E%B6&page=2');
    const resolved = {
      mainId: 'gear', main: '騎士用品與配件', subId: 'mount', sub: '攝影機支架',
    } as CascadeFilterState['category'];

    // 三個 render:① mount 早退 ② 還原窗口消化 ③ state 已等於網址解出來的那個分類
    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, tree),
      { initialProps: { category: resolved } },
    );
    rerender({ category: resolved });
    rerender({ category: resolved });

    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  it('㉗ 🔵 負對照:**認不得**的裸名不得被收斂 —— 照舊送導覽(#315 的值仍原樣留著)', () => {
    // 🔴 少了本格, ㉖ 的修法可以寫成「分類軸整個不比對」而照樣全綠 —— 那會讓 #315 的
    //   「認不得的值留在網址上」與「使用者剛清掉篩選」變成同一件事。
    const tree = {
      ...RESTORE_SOURCES,
      categories: [
        { id: 'gear', name: '騎士用品與配件', children: [{ id: 'mount', name: '攝影機支架', count: 4 }] },
      ],
    };
    setUrl('?category=%E5%B7%B2%E4%B8%8B%E6%9E%B6%E7%9A%84%E5%88%86%E9%A1%9E');
    const picked = { mainId: 'gear', main: '騎士用品與配件' } as CascadeFilterState['category'];

    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, tree),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: picked });

    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '認不得的裸名被當成已解析 ⇒ 導覽沒送出去').toBeDefined();
    expect(qs(url).get('category')).toBe('騎士用品與配件');
  });

  // ── 2026-09-05 · Sean `21`「把多顆分類修好」新增三格 ────────────────────────
  // 🔴 順序是刻意的:**先寫【對突變該紅】的那一格, 綠了才寫正向**(主視窗指定)。
  // ⚠️ 編號從 ㉘ 起 —— **㉗ 檔裡已經有了**(我第一版撞號, 而 `git checkout` 把那一版清掉時才發現)。

  it('㉘ 深連結還原波【不得】把還原出來的那顆 union 進 categories', () => {
    // 🔴🔴 **本格存在的理由 = R2 對抗審查指出「判別法恆真那個突變沒有任何一格殺得死」**:
    //   既有 ㉓(`categories=X` + cascade 握同一顆)與 ㉕(`categories=X&category=X`)的 union
    //   都是 **no-op** ⇒ 網址逐字不變 ⇒ 兩格照綠。
    //   ✅ 殺得死它的世界 = **還原波, 而還原出來的那顆【不在】`categories=` 裡面**。
    window.history.replaceState(
      null,
      '',
      '/products?categories=A%2CB&category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81&page=2',
    );
    const resolved = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];
    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: resolved });
    rerender({ category: resolved });
    // 還原波不是「使用者自選」⇒ 一次 replace 都不該送。恆真 ⇒ 寫成 A,B,操控部品 且 page 被刪 ⇒ 紅。
    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  it('㉙ 多顆在網址上 + 側欄選【第三顆】→ union 進 categories, 而 legacy 單槽不得被寫', () => {
    window.history.replaceState(null, '', '/products?categories=A%2CB');
    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: null as CascadeFilterState['category'] });
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'] });

    // 🔴 **R3 findings ④:不能只查第 1 次呼叫** —— 「先送對的、再多送一個錯的 `replace`」
    //   在只看 `calls[0]` 的斷言下**仍然全綠**。⇒ 釘次數 + 查**最後一次**。
    expect(hoisted.replace).toHaveBeenCalledTimes(1);
    const url = hoisted.replace.mock.calls.at(-1)?.[0] as string;
    expect(url).toBeDefined();
    // 🔴 斷言走 `qs(url).get(...)` 比**編碼前**的值 —— 逗號會被編成 `%2C`(檔頭 :99-103 已警告)
    expect(qs(url).get('categories')).toBe('A,B,操控部品');
    expect(qs(url).get('category')).toBeNull(); // 🔵 那個槽只有一個, 不拿它當累加器
  });




  it('㉚ 清空分類【同時】改別的軸 → 不得把 null union 進 categories', () => {
    // 🔴🔴 **本格存在的理由 = codex R3(第三個模型)不同意我的宣稱。**
    //   我在 hook 註解裡寫過「`cat === null` 那道擋在單元測試層【構造不出會紅的世界】」——
    //   依據是探針量到那一波 `replace` 次數 **0**(被更前面的等值早退擋住)。
    //   🛑 **而 R3 指出:那是因為我只讓【分類】變。同一波【同時改別的軸】就繞得過等值早退。**
    //   ⇒ 📌 **我把「我造的那個世界到不了」寫成了「那條路測不到」** ——
    //      與同日 plan §0 那句「第三條路技術上是死的」**同一個形狀**。
    //   🔬 而照 R3 的形狀造出來之後實測:那一波**確實走到寫入段**(`n=1`, 網址帶 price),
    //      **而 `categories` 仍是 `A,B`** ⇒ **突變沒有把 null 寫進去**(`join` 對 `null` 的行為),
    //      ⇒ 🔵 **所以這一格【對那個突變仍然是綠的】** —— 它擋的是**未來**有人把 union 改成
    //         會產出尾逗號/空值的寫法。**本格是回歸鎖, 不是突變殺手, 兩者不要混。**
    window.history.replaceState(null, '', '/products?categories=A%2CB');
    const { rerender } = renderHook(
      ({ category, extras }: { category: CascadeFilterState['category']; extras: typeof EXTRAS }) =>
        useCatalogFilterUrlSync(cascade([], category), extras, RESTORE_SOURCES),
      {
        initialProps: {
          category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'],
          extras: EXTRAS,
        },
      },
    );
    rerender({ category: { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'], extras: EXTRAS });
    hoisted.replace.mockClear();
    rerender({
      category: null as CascadeFilterState['category'],
      extras: { ...EXTRAS, price: '10000-20000', priceRange: [10000, 20000] as [number, number] },
    });

    // 🔴 R3 findings ④:不能只查第 1 次呼叫 —— 「先送對的、再多送一個錯的」也會綠。
    expect(hoisted.replace).toHaveBeenCalledTimes(1);
    const url = hoisted.replace.mock.calls.at(-1)?.[0] as string;
    expect(qs(url).get('categories')).toBe('A,B'); // 原樣, 不得多出空值或尾逗號
    expect(qs(url).get('price')).toBe('10000-20000'); // 證明這一波真的走到了寫入段
  });


  it('㉛ 網址落地後【瀏覽器上一頁】退回舊網址 → 再選同一顆仍要 union(R3 ①③)', () => {
    // 🔴🔴 **本格存在的理由 = codex R3 ①③**:`router.replace()` 回來只代表【已呼叫】。
    //   若 ref 在那一刻就前進, 而網址(被 Next 忽略 / 被上一頁退回)沒跟上
    //   ⇒ 📌 **同一個選擇會【永久】被吞掉** —— 判別法看到 ref 已等於它, 判非自選, 不再寫。
    //   ✅ 修法是 pending/committed 兩段:**觀察到網址真的落地才升 committed**,
    //      而網址上沒有 committed 那顆時(上一頁)**把 ref 退回**。本格釘住後半。
    window.history.replaceState(null, '', '/products?categories=A%2CB');
    const pick = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];
    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: null as CascadeFilterState['category'] } },
    );
    rerender({ category: null as CascadeFilterState['category'] });
    rerender({ category: pick });                    // 第一次選 ⇒ 送出 union
    expect(hoisted.replace).toHaveBeenCalledTimes(1);

    // 模擬「那一發落地了」⇒ 網址真的變成 A,B,操控部品
    window.history.replaceState(null, '', '/products?categories=A%2CB%2C%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81');
    rerender({ category: pick });                    // 讓 hook 看到落地(pending ⇒ committed)

    // 🔴 現在【上一頁】:網址退回 A,B, 而 cascade 仍握著那一顆
    window.history.replaceState(null, '', '/products?categories=A%2CB');
    hoisted.replace.mockClear();
    rerender({ category: null as CascadeFilterState['category'] }); // 退回後 cascade 也清掉
    rerender({ category: pick });                    // 客人再選同一顆

    // ⇒ 必須【再送一次】—— ref 沒退回的話這裡是 0 次(那個選擇被永久吞掉)
    expect(hoisted.replace).toHaveBeenCalledTimes(1);
    const url = hoisted.replace.mock.calls.at(-1)?.[0] as string;
    expect(qs(url).get('categories')).toBe('A,B,操控部品');
  });

});

describe('⟦b4-CLEARALLKEEPSJUNK⟧ 清除全部之後, 認不得的品牌不得被寫回去', () => {
  // 🔬 病:`unknownBrands` 是拿【那一輪的 params】重算的 ⇒ `clearAll()` 這一輪把認不得的
  //    `pbrands` 又 set 回去 ⇒ 客人按完「清除全部」, 膠囊沒了、垃圾參數還在 ⇒ 仍然 0 筆。
  //
  // 🔴 **必須跑滿三個 render** —— 兩個做不出來(⑭ 那格檔頭逐字寫過同一件事):
  //    ① mount 走 `initialized` 早退 ② 還原窗口消化 ③ 這一輪才是客人的那一按。
  //    ⚠️ 我第一版寫成兩個而**假紅**:紅在「一次 replace 都沒送」, 那不是本格要證的事。
  //
  // 🛑 **射程**:本格證的是【hook 這一輪不會復活它】。
  //    「按鈕送出的乾淨網址會不會被覆蓋」是兩個 replace 的賽跑, jsdom 造不出來 ⇒ 不宣稱。
  const picked = { mainId: 'ride', main: '操控部品' } as CascadeFilterState['category'];
  const DIRTY = '/products?category=%E6%93%8D%E6%8E%A7%E9%83%A8%E5%93%81&pbrands=zzq-unknown';

  /** 三個 render:選好 → 還原窗口消化 → 清空。`mark` = 有沒有先按「清除全部」那顆鈕。 */
  const clearRun = (mark: boolean) => {
    window.history.replaceState(null, '', DIRTY);
    const { rerender } = renderHook(
      ({ category }: { category: CascadeFilterState['category'] }) =>
        useCatalogFilterUrlSync(cascade([], category), EXTRAS, RESTORE_SOURCES),
      { initialProps: { category: picked } },
    );
    rerender({ category: picked });
    if (mark) markClearAllRequested();
    rerender({ category: null });
    return hoisted.replace.mock.calls.at(-1)?.[0] as string;
  };

  it('🔴 按了「清除全部」:認不得的 pbrands 不得被寫回網址', () => {
    const url = clearRun(true);
    expect(url, '這一輪一次 replace 都沒送 ⇒ 這一格什麼都沒驗到(不是通過)').toBeDefined();
    expect(
      qs(url).get('pbrands'),
      `按完清除全部, 網址仍帶著認不得的品牌 ⇒ 客人看到的還是 0 筆(拿到的網址:${url})`,
    ).toBeNull();
  });

  it('🟢 對照(#315 的鎖):【沒有】按清除全部而只是清掉最後一顆膠囊 ⇒ 認不得的值照舊留著', () => {
    // 🔴 這一格是 code-reviewer R1 Critical 逼出來的:
    //    「按清除全部」與「點掉唯一那顆分類膠囊的 ×」**state 變化完全同構**
    //    ⇒ 只看形狀的修法會把後者也清掉, 而那正是 #315 要留的東西。
    //    ⇒ 📌 所以修法靠的是【明示手勢的旗標】, 而這一格就是那個區別的鎖。
    const url = clearRun(false);
    expect(url, '這一格沒送 replace ⇒ 它證不到「沒按鈕時值還在」').toBeDefined();
    expect(
      qs(url).get('pbrands'),
      `沒有按清除全部, 認不得的品牌卻被清掉了 ⇒ 誤傷 #315(拿到的網址:${url})`,
    ).toBe('zzq-unknown');
  });

  it('🟢 對照:清除全部要把【認得的】那顆也一起帶走 —— 不是只挑認不得的丟', () => {
    // ⚠️ **前一版這一格結構上恆綠**(code-reviewer R2 Critical C):它的 `category` 從頭到尾是
    //    `picked`、`brands` 也沒清空 ⇒ `stateAndExtrasEmpty` **不可能為真** ⇒ 與旗標完全無關。
    //    📌 **「網址帶 unknown」是必要條件, 不是充分條件** —— 還要讓那一輪真的走到讓路那一支。
    window.history.replaceState(null, '', '/products?pbrands=akrapovic%2Czzq-unknown');
    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: ['akrapovic'] as string[] } },
    );
    rerender({ brands: ['akrapovic'] });
    markClearAllRequested();
    rerender({ brands: [] });

    const url = hoisted.replace.mock.calls.at(-1)?.[0] as string;
    expect(url, '這一格沒送 replace ⇒ 它什麼都沒驗到').toBeDefined();
    expect(
      qs(url).get('pbrands'),
      `清除全部之後 pbrands 還有東西 ⇒ 認得的或認不得的沒被清乾淨(拿到的網址:${url})`,
    ).toBeNull();
  });

  it('🟢 對照(旗標不得外溢):舉了手之後客人【又選了東西】⇒ 認不得的值要回到被保留的狀態', () => {
    // 🔴 這一格守的是 AND 條件裡的 `stateAndExtrasEmpty` 與那行歸零:
    //    旗標是模組層的, 若它會留著, 下一次不該讓路的清空就會被誤放。
    window.history.replaceState(null, '', '/products?pbrands=zzq-unknown');
    markClearAllRequested();
    const { rerender } = renderHook(
      ({ brands }: { brands: string[] }) =>
        useCatalogFilterUrlSync(cascade(brands), EXTRAS, RESTORE_SOURCES),
      { initialProps: { brands: [] as string[] } },
    );
    rerender({ brands: ['akrapovic'] });   // 客人又選了一顆 ⇒ 這一輪要把旗標歸零
    hoisted.replace.mockClear();
    rerender({ brands: [] });              // 再清掉, 而這次【沒有】按清除全部

    // 🔵 **這一格的判準是「一次 replace 都不該送」, 而那【有判別力】**:
    //    旗標若外溢 ⇒ `unknownBrands` 變空 ⇒ 重建出來的網址少了 `pbrands`
    //    ⇒ 與當前網址不等值 ⇒ **等值早退不會命中, replace 一定會送出去**。
    //    ⇒ 📌 所以「沒送」只可能是「值被保留了」。(不是「什麼都沒發生」那種空綠。)
    const calls = hoisted.replace.mock.calls;
    expect(
      calls.length,
      `旗標外溢了:沒按清除全部而認不得的值被清掉(送出的網址:${calls.at(-1)?.[0]})`,
    ).toBe(0);
  });
});

// ═══ ⟦搜尋-關鍵字消失無聲⟧ 第二個刪 `search` 的地方 —— **改排序那條路**(`useBrowseUrlSync`)═══
//
// 🔴🔴 **本組是 code-reviewer 2026-09-08 的 must-fix** —— 我第一版只修了 `useCatalogFilterUrlSync`
//    (點 facet 那條路), 而 `products-url-state.tsx` 的 `useBrowseUrlSync` **也會安靜刪掉 `search`**
//    (同一條 Q2=A 拍板:改了排序 ⇒ 清掉關鍵字), 而它**不寫 `q0`**
//    ⇒ 📌 **我那句「兩條路都涵蓋」對【改排序】不成立** —— 字面 vs 事實, 而抓到它的不是我。
// 🛑 **站上共有【四個】刪 `search` 的點**(`grep -rn "delete('search')" apps/storefront/src | grep -v '\.test\.'` ⇒ 4 命中):
//    ① `app/products/page.tsx` 轉址那條(它自己寫 `q0`)
//    ② `use-catalog-filter-url-sync.tsx` 點 facet(本片補了 `q0`)
//    ③ `products-url-state.tsx` 改排序(**本組補的**)
//    ⚠️ 而 `SearchKeywordChip.tsx` 的 ✕ 是第四個, **它刻意不寫 `q0`** —— 客人明示要丟掉那個字。

describe('⟦搜尋-關鍵字消失無聲⟧ 改排序那條路也要留下回頭路', () => {
  const sortTransition = (initialSearch: string) => {
    setUrl(initialSearch);
    const { rerender } = renderHook(
      ({ sort }: { sort: string }) => useBrowseUrlSync(1, sort, DEFAULT_PER_PAGE, true),
      { initialProps: { sort: 'recommend' } },
    );
    rerender({ sort: 'price-asc' });
    // 🔴🔴 **[2026-09-08 · R2 nit-4 訂正 —— 這一段的第一版是【我的 fixture 造出來的】]**
    //    ⛔ 舊寫法傳 `perPage = 24` ⇒ 掛載那一發就送了一次導覽 ⇒ 我以為「掛載一定會送」,
    //       於是改成取最後一發並把次數只寫進錯誤訊息。
    //    🛑 **而 `24` 是一個【UI 與 parser 都到不了的值】**:`PER_PAGE_VALUES = [25, 50, 75, 100]`
    //       且 `DEFAULT_PER_PAGE = 50`(`products-url-parsers.ts`)⇒ 那第二發是**我自己造的**。
    //    ✅ 改成 `DEFAULT_PER_PAGE` ⇒ **掛載零導覽, n 恆為 1** ⇒ 可以**直接斷言次數**,
    //       而那正是本 repo 那條 lesson 自己開的處方(`docs/patterns/guard-and-instrument-traps.md`
    //       逐字「若答案是『應該只有一次』, 那就**斷言次數**, 不要靜靜地取最後一發」)。
    //    📌 **⇒ 寫下處方與執行處方是兩件事** —— 我上一版寫了那句處方, 然後沒照它做。
    const calls = hoisted.replace.mock.calls;
    return { url: calls[calls.length - 1]?.[0] as string | undefined, n: calls.length };
  };

  it('㊱ 關鍵字在 + 客人改排序 → 存進 q0, 且 search 仍被刪', () => {
    const { url, n } = sortTransition('?search=cark9650');
    expect(url, `沒有送出導覽(replace 呼叫 ${n} 次)⇒ 這一格什麼都沒驗到`).toBeDefined();
    // 🔴 **硬斷言次數** —— 多一發就是有人在掛載時也送了導覽, 那是另一件事, 不要被「取最後一發」蓋掉。
    expect(n, '導覽次數不是 1 ⇒ 掛載那一發也送了, 而本格讀的是最後一發 ⇒ 讀數可能不是你以為的那一次').toBe(1);
    expect(qs(url!).get('q0'), `q0 沒寫 ⇒ 改個排序關鍵字就無聲消失, 客人沒有回頭路(replace ${n} 次, 讀最後一發)`).toBe('cark9650');
    expect(qs(url!).get('search'), 'search 沒刪 ⇒ 壞回 7bfefe4af4 修掉的病').toBeNull();
    // 🎯 而排序要真的寫進去 —— 少了這行, 一個「把整串 query 清空」的實作也會綠。
    expect(qs(url!).get('sort')).toBe('price-asc');
  });

  it('㊲ 🔵 負對照:已經有 q0 → **不得覆寫**(兩個值刻意不同, 否則兩個世界印一樣)', () => {
    const { url, n } = sortTransition('?search=%E6%96%B0%E7%9A%84&q0=%E5%8E%9F%E6%9C%AC%E7%9A%84');
    expect(url, `沒有送出導覽(replace ${n} 次)⇒ 這一格什麼都沒驗到`).toBeDefined();
    expect(n, '導覽次數不是 1 ⇒ 讀數可能不是你以為的那一次').toBe(1);
    expect(qs(url!).get('q0'), '覆寫了 q0 ⇒ 客人本來打的字被中途的字蓋掉').toBe('原本的');
  });

  // 🔴🔴 **[2026-09-08 · R2 nit-2 訂正 —— 這一格的第一版【零咬合力】]**
  //    ⛔ 舊版傳 `keywordActive = false`, 而 `q0` 那整塊包在 `if (keywordActive && …)` 裡
  //       ⇒ **它永遠不執行** ⇒ reviewer 把三道守門全拿掉改成無條件寫入, **本格照樣綠**。
  //    🛑 而它讀的 `calls[0]` 是**掛載那一發**(網址 `/products`), 根本不是改排序那一發。
  //    ✅ 修法 = 進得去那個世界:`keywordActive = true` + 排序改成非預設 + **網址沒有 `search`**。
  //    📌 **⇒ 「沒有 search」這個負對照, 必須在【那段碼會跑】的前提下才問得出來。**
  it('㊳ 🔵 負對照:進得去那條路 + 網址沒有 search → **不得**憑空生出 q0', () => {
    // 🔵 網址刻意**全空** —— `?page=1` 會被 `setOrDelete('page', null)` 正規化掉
    //    ⇒ 掛載那一發就送了一次導覽(實測 n=2)。那不是壞掉, 而它會讓本格讀到錯的那一發。
    const { url, n } = sortTransition('');
    expect(url, `沒有送出導覽(replace ${n} 次)⇒ 這一格什麼都沒驗到`).toBeDefined();
    expect(n, '導覽次數不是 1 ⇒ 掛載那一發也送了 ⇒ 讀數可能不是你以為的那一次').toBe(1);
    expect(qs(url!).get('sort'), '沒走到排序寫入 ⇒ 那段 q0 的碼也沒跑到, 這一格又是空的').toBe('price-asc');
    expect(qs(url!).get('q0'), '憑空生出 q0 ⇒ 畫面冒出一行沒有人搜尋過的「查看全部」').toBeNull();
  });

  // 🔴 **[2026-09-08 · R2 nit-3 補 —— 排序這條路的空白守門原本【一格都沒有】]**
  //    ㉟ 只覆蓋 facet 那條路;reviewer 拿掉本條路的三道守門 ⇒ **只紅一格**
  //    ⇒ `.trim() !== ''` 與 `!== null` 在改排序這條路上當時是**裸的**。
  //    危害與 ㉟ 註解同一句:`?search=%20%20` + 改排序 ⇒ 寫出空白 `q0`
  //    ⇒ 下游 `originalSearchQueryFor()` 畫出「查看全部 **0** 筆」那個**本片明令不准的假 0**。
  it('㊵ 🔵 負對照:排序這條路上 search 只有空白 → **不得**寫出空的 q0', () => {
    const { url, n } = sortTransition('?search=%20%20');
    expect(url, `沒有送出導覽(replace ${n} 次)⇒ 這一格什麼都沒驗到`).toBeDefined();
    // 🔴 **這一格的 n 是 2, 而那【不是】壞掉 —— 照實釘住並寫明原因**:
    //    `URLSearchParams.toString()` 把空白正規化成 `+`(`search=++`), 而網址上是 `%20%20`
    //    ⇒ 掛載那一發 `next !== current` ⇒ 送出一次**純編碼正規化**的導覽。
    //    🛑 那是**既有行為, 不是本片造的**(本片一行都沒動編碼)。
    //    ⇒ 📌 釘 `2` 而不是靜靜取最後一發:哪天它變成 1 或 3, 這一格會叫。
    expect(n, '導覽次數變了 ⇒ 掛載那一發的編碼正規化行為改了, 去查是誰改的').toBe(2);
    expect(qs(url!).get('q0'), '寫出了空白的 q0 ⇒ 下游會畫出一個假的「查看全部 0 筆」').toBeNull();
  });

  it('㊴ 🔵 負對照:關鍵字在但排序【還是預設】→ 不刪 search, 也不寫 q0', () => {
    // 🔴 檔內逐字:`page` / `per` 變動**不得**清掉關鍵字 —— 分頁在關鍵字路上是生效的。
    //    ⇒ 這一格守的是那個界線沒有被本片推寬。
    setUrl('?search=cark9650');
    const { rerender } = renderHook(
      ({ page }: { page: number }) => useBrowseUrlSync(page, 'recommend', 24, true),
      { initialProps: { page: 1 } },
    );
    rerender({ page: 2 });
    const url = hoisted.replace.mock.calls[0]?.[0] as string;
    expect(url, '沒有送出導覽 ⇒ 這一格什麼都沒驗到').toBeDefined();
    expect(qs(url).get('search'), '翻頁把關鍵字清掉了 ⇒ 客人翻第二頁被踢回全目錄').toBe('cark9650');
    expect(qs(url).get('q0'), '沒刪 search 卻寫了 q0 ⇒ 兩個鍵同時在, 落地頁那行連結會消失').toBeNull();
  });
});


// ═══ ⟦新品頁排序下拉說謊⟧ client 的預設排序要跟著 `?filter=` 走 ═══════════════════
//
// 🔴 病灶(Sean 2026-09-09 截圖):`/products?filter=new` 的清單**確實**照上架時間排
//    (server 的 `parseCatalogQuery` 算出 `sort='new'`),而排序下拉印**「推薦排序」**
//    —— client 那邊自己有一個**不看 `filter`** 的預設。
//    ⇒ 📌 **同一個網址, 兩端算出不同的字, 而畫面印的是錯的那個。**
// ✅ 修法:兩端共用 `lib/catalog-query.ts` 的 `resolveCatalogSort`。本組釘 client 那一半。
describe('⟦新品頁排序下拉說謊⟧ 預設排序要跟著 ?filter= 走', () => {
  const initialSort = (search: string, keywordActive = false) => {
    setUrl(search);
    const sp = new URLSearchParams(window.location.search);
    const { result } = renderHook(() => useBrowseUrlState(sp, keywordActive));
    return result.current.sort;
  };

  it('?filter=new 且沒帶 sort ⇒ 預設是 new(不是 recommend)', () => {
    expect(initialSort('?filter=new')).toBe('new');
  });

  // 🟢 正對照:沒有 filter 的一般目錄頁**不能**被改掉。
  it('沒有 filter ⇒ 照舊 recommend', () => {
    expect(initialSort('')).toBe('recommend');
  });

  // 🔴 客人自己選的永遠贏 —— 這一格擋「順手把明確指定的 sort 也蓋掉」。
  it('明確帶了 sort ⇒ 用客人帶的那個', () => {
    expect(initialSort('?filter=new&sort=price-asc')).toBe('price-asc');
  });

  // 🔴 關鍵字那條路**不還原 sort**(既有紀律, 見 useBrowseUrlState 檔內註解)——
  //    本片不得把它改掉:關鍵字走 ILIKE, 排序在那條路上不生效。
  it('關鍵字結果頁仍然從 recommend 起跳(即使網址有 filter=new)', () => {
    expect(initialSort('?filter=new&search=abc', true)).toBe('recommend');
  });

  // 🔴 回寫端:`filter=new` 時 `new` **就是預設** ⇒ 不該被寫進網址。
  //    少了這一格,一進站就會多一次導覽把 `?sort=new` 貼上去。
  it('sort 等於解出來的預設 ⇒ 不寫進網址、不送導覽', () => {
    setUrl('?filter=new');
    renderHook(() => useBrowseUrlSync(1, 'new', DEFAULT_PER_PAGE, false));
    expect(hoisted.replace.mock.calls.length, '送了導覽 ⇒ 它把預設值當成客人改的').toBe(0);
  });
});
