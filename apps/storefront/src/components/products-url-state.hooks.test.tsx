// @vitest-environment jsdom
//
// useCatalogFilterUrlSync 回歸守門 — Sean 2026-07-19 回報「取消其中一個品牌後,該品牌商品不消失」。
//
// 根因(實測 + 讀 node_modules 內 Next 16.2.6 原始碼坐實):`getCacheKeyForDynamicParam` 產生
// page segment cache key 走 `Object.fromEntries(new URLSearchParams(...))`、**重複 key 只留最後值**。
// 品牌是重複 key(`pbrand`)+ 字母序 → `?pbrand=a&pbrand=b` 與 `?pbrand=b` 的 key 相同 →
// router.replace 判定同一 segment、重用舊 CacheNode、零 RSC 請求 → 畫面停在舊清單。
//
// 修法 = 只在 segment key 真碰撞時補一次 refresh。案例①-⑤釘住兩個方向:
//   ① 碰撞時**必須** refresh(缺 → 本 bug 復發)
//   ② 不碰撞時**不得** refresh(多餘 → 每次切分類/拉價格都對 12793 筆型錄多查一次)
//
// 案例⑥-⑨ = **分頁失效**修復的守門(同日第二片;既有 bug,已對照 61f45b6 確認非品牌片引入):
// `useCatalogFilterUrlSync` 的 deps 含 restoreSources,server 每回新 props 就換 identity → effect
// 重跑 → 舊版**無條件** `delete('page')` 洗掉使用者剛翻到的 `?page=2`。改為只在篩選指紋變動時刪。
//
// 突變驗證(2026-07-19 全數實跑):
//   拿掉 refresh → ①紅;改無條件 refresh → ②③④紅;改「只有品牌變少才 refresh」→ ②⑤紅;
//   `delete('page')` 改回無條件 → ⑥紅;filterKey 拿掉 category 軸 → ⑧紅;拿掉 price 軸 → ⑨紅。
// ⚠️ 已知未擋住(R2 評估為不值得補):`[...brands].sort()` 拿掉(reducer 不會產生不同順序、
//    UI 不可達)、`prevFilterKey !== null` 守衛拿掉(該守衛是不可達死碼,拿掉零行為差異)。
// ⚠️ 本檔**不涵蓋深連結還原波**(`?page=N` 進站被吃掉頁碼)= 既有 bug、backlog #289。

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

describe('useCatalogFilterUrlSync — segment key 碰撞才 refresh', () => {
  it('① 取消非最後值的品牌(key 碰撞)→ replace 後必須 refresh,且順序為 replace→refresh', () => {
    // ?pbrand=akrapovic&pbrand=bonamici → ?pbrand=bonamici;兩者 segment key 同為 pbrand:bonamici
    transition(
      '?pbrand=akrapovic&pbrand=bonamici',
      cascade(['akrapovic', 'bonamici']),
      cascade(['bonamici']),
    );

    expect(hoisted.replace).toHaveBeenCalledWith('/products?pbrand=bonamici', { scroll: false });
    // 缺這行 = bug 復發(URL 對、但 server 不重跑、商品清單停在兩品牌合計)
    expect(hoisted.refresh).toHaveBeenCalledTimes(1);
    // 🔴 順序不變量:refresh 必須在 replace **之後**。若寫成 refresh(); replace();,
    // refresh 抓的是舊 URL、bug 原樣復發,但上面兩條斷言仍會綠(code-reviewer R1 nit-3)。
    const replaceOrder = hoisted.replace.mock.invocationCallOrder[0];
    const refreshOrder = hoisted.refresh.mock.invocationCallOrder[0];
    expect(replaceOrder).toBeDefined();
    expect(refreshOrder).toBeDefined();
    expect(replaceOrder as number).toBeLessThan(refreshOrder as number);
  });

  it('② 取消最後值的品牌(key 改變)→ replace 足矣,不得多餘 refresh', () => {
    // ?pbrand=akrapovic&pbrand=bonamici → ?pbrand=akrapovic;key 由 bonamici 變 akrapovic
    transition(
      '?pbrand=akrapovic&pbrand=bonamici',
      cascade(['akrapovic', 'bonamici']),
      cascade(['akrapovic']),
    );

    expect(hoisted.replace).toHaveBeenCalledWith('/products?pbrand=akrapovic', { scroll: false });
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('③ 新增「字母序在後」的品牌(key 改變)→ replace 足矣,不得多餘 refresh', () => {
    // 新增 bonamici → 最後值由 akrapovic 變 bonamici → key 改變
    transition('?pbrand=akrapovic', cascade(['akrapovic']), cascade(['akrapovic', 'bonamici']));

    expect(hoisted.replace).toHaveBeenCalledWith('/products?pbrand=akrapovic&pbrand=bonamici', {
      scroll: false,
    });
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it('⑤ 新增「字母序在前」的品牌(key 仍碰撞)→ 必須 refresh', () => {
    // 🔴 碰撞不是「移除」專屬:先選 bonamici 再加 akrapovic,排序後為 akrapovic,bonamici,
    // 最後值仍是 bonamici → 新舊 segment key 同為 {pbrand:bonamici} → 一樣不重抓。
    // 若把條件誤寫成「只有品牌變少才 refresh」(collides && to.length < from.length),
    // 案例①②③④ 會**全綠**卻真壞;本案例是殺死該突變的唯一守門(code-reviewer R2 nit-B)。
    transition('?pbrand=bonamici', cascade(['bonamici']), cascade(['akrapovic', 'bonamici']));

    expect(hoisted.replace).toHaveBeenCalledWith('/products?pbrand=akrapovic&pbrand=bonamici', {
      scroll: false,
    });
    expect(hoisted.refresh).toHaveBeenCalledTimes(1);
  });

  it('⑥ server 回新 props(restoreSources 換 identity)但篩選未變 → 不得動 URL、不得洗掉 page', () => {
    // 🔴 分頁失效回歸守門(2026-07-19):本 effect 的 deps 含 restoreSources,而它在 ProductsPage
    // 是 useMemo(..., [categories, brands]) —— server 每回一次新 props 就換 identity。
    // 舊版無條件 `params.delete('page')` 於是把使用者剛翻到的 ?page=2 洗掉 → 內容退回第 1 頁。
    // 另::219-220 重建 pbrand 會把它排到尾端(?pbrand=x&page=2 → ?page=2&pbrand=x),
    // 故比較必須正規化;否則純順序差異也會多送一次導覽 + 多查一次全型錄。
    window.history.replaceState(null, '', '/products?pbrand=akrapovic&page=2');
    const sourcesA = { categories: [], productBrands: [{ id: 'akrapovic' }] };
    const sourcesB = { categories: [], productBrands: [{ id: 'akrapovic' }] }; // 值同、identity 不同

    const { rerender } = renderHook(
      ({ sources }: { sources: typeof sourcesA }) =>
        useCatalogFilterUrlSync(cascade(['akrapovic']), EXTRAS, sources),
      { initialProps: { sources: sourcesA } },
    );
    rerender({ sources: sourcesB });

    expect(hoisted.replace).not.toHaveBeenCalled();
    expect(hoisted.refresh).not.toHaveBeenCalled();
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
    expect(url).toContain('pbrand=akrapovic');
    expect(url).toContain('pbrand=bonamici');
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
