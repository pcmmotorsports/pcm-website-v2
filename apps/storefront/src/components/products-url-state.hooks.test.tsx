// @vitest-environment jsdom
//
// useCatalogFilterUrlSync 回歸守門 — Sean 2026-07-19 回報「取消其中一個品牌後,該品牌商品不消失」。
//
// 根因(實測 + 讀 node_modules 內 Next 16.2.6 原始碼坐實):`getCacheKeyForDynamicParam` 產生
// page segment cache key 走 `Object.fromEntries(new URLSearchParams(...))`、**重複 key 只留最後值**。
// 品牌是重複 key(`pbrand`)+ 字母序 → `?pbrand=a&pbrand=b` 與 `?pbrand=b` 的 key 相同 →
// router.replace 判定同一 segment、重用舊 CacheNode、零 RSC 請求 → 畫面停在舊清單。
//
// 修法 = 只在 segment key 真碰撞時補一次 refresh。本檔同時釘住兩個方向:
//   ① 碰撞時**必須** refresh(缺 → 本 bug 復發)
//   ② 不碰撞時**不得** refresh(多餘 → 每次切分類/拉價格都對 12793 筆型錄多查一次)
// 突變驗證(2026-07-19 實跑):拿掉 refresh → 案例①紅;改成無條件 refresh → 案例②③④紅。

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
