import { describe, expect, it } from 'vitest';

import { filterFacets, SEARCH_FACET_LIMIT } from './search-facets';
import type { MockBrand } from '@/data/mock-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

// search-facets.test.ts — ⟦搜尋-第2刀⟧ 2a
//
// 🔴 **本檔最承重的不是「有沒有過濾到」, 是【三個 failed 各自一格】。**
//    合成一個(`failed: a || b || c`)在型別上完全合法、在多數測試下全綠
//    ——(因為多數測試只造【一區失敗】的世界)⇒ 所以那一格要用一個
//    **三區狀態互不相同**的世界去問, 而不是三個各自的世界。

function brand(id: string, name: string): MockBrand {
  return {
    id,
    name,
    count: 3,
    country: 'IT',
    tagline: '',
    since: 2000,
    hero: '',
    logo: '',
    logoBg: '',
  };
}
function category(id: string, name: string): MockCategory {
  return { id, name, count: 5, children: [] };
}
function moto(id: string, name: string, models: Array<[string, string]>): MockMotoBrand {
  return { id, name, models: models.map(([mid, mname]) => ({ id: mid, name: mname, years: [] })) };
}

function data(over: {
  brands?: MockBrand[];
  categories?: MockCategory[];
  motoBrands?: MockMotoBrand[];
  failed?: { brands?: boolean; categories?: boolean; vehicles?: boolean };
} = {}) {
  return {
    brands: { brands: over.brands ?? [], failed: over.failed?.brands ?? false },
    categories: { categories: over.categories ?? [], failed: over.failed?.categories ?? false },
    vehicles: { motoBrands: over.motoBrands ?? [], failed: over.failed?.vehicles ?? false },
  };
}

describe('filterFacets', () => {
  it('should match a brand by its name or its id', async () => {
    const res = filterFacets('akra', data({ brands: [brand('akrapovic', 'Akrapovič'), brand('x', 'Other')] }));
    expect(res.brands.map((b) => b.id)).toEqual(['akrapovic']);

    const byId = filterFacets('akrapov', data({ brands: [brand('akrapovic', '別的名字')] }));
    expect(byId.brands).toHaveLength(1);
  });

  it('should match a vehicle when either the model name or the brand name hits', async () => {
    // 稿 :47-54 逐字:model 名或 brand 名【任一】命中就算
    // ⇒ 打「YAMAHA」要撈得出它旗下的車款, 不是只有名字裡有 YAMAHA 的型號。
    const bikes = [moto('yamaha', 'YAMAHA', [['r1', 'YZF-R1'], ['mt09', 'MT-09']])];

    expect(filterFacets('yamaha', data({ motoBrands: bikes })).vehicles).toHaveLength(2);
    expect(filterFacets('mt-09', data({ motoBrands: bikes })).vehicles).toHaveLength(1);
  });

  it('should cap every section at the number the design uses', async () => {
    // 🔴 那個 6 是【視覺決定】(疊層裡塞得下幾列)—— 稿 SearchOverlay.jsx :40/46/57 `.slice(0, 6)`。
    //    有人日後改大它 ⇒ 疊層會長到看不完, 而那是 Sean 的板不是我們的。
    const many = Array.from({ length: 20 }, (_, i) => brand(`b${i}`, `Brembo ${i}`));
    const cats = Array.from({ length: 20 }, (_, i) => category(`c${i}`, `Brembo ${i}`));
    const bikes = [moto('m', 'Brembo', Array.from({ length: 20 }, (_, i) => [`x${i}`, `M${i}`] as [string, string]))];

    const res = filterFacets('brembo', data({ brands: many, categories: cats, motoBrands: bikes }));

    expect(res.brands).toHaveLength(SEARCH_FACET_LIMIT);
    expect(res.categories).toHaveLength(SEARCH_FACET_LIMIT);
    expect(res.vehicles).toHaveLength(SEARCH_FACET_LIMIT);
  });

  it('should keep the three failed flags apart', async () => {
    // 🔴🔴 **本檔的核心一格。** 三區狀態【互不相同】—— 合成一個的實作在這裡一定紅:
    //    `a || b || c` ⇒ 三格都變 true;`a && b && c` ⇒ 三格都變 false。
    const res = filterFacets(
      'x',
      data({ failed: { brands: true, categories: false, vehicles: true } }),
    );

    expect(res.failed).toEqual({ brands: true, categories: false, vehicles: true });
  });

  it('should still report the flags when the query is empty (unit-only path)', async () => {
    // 🛑 **本格守的是【純函式自己的契約】, 不是正式路徑** ——
    //    `route.ts:61` 在空 `q` 時就 return 了(R1:搜尋框剛打開不該把 DB 叫醒)
    //    ⇒ 這個分支**只有單元測試到得了**(`-c7` 2026-09-02 R1 抓到)。
    //    📌 而寫清楚它, 是因為一發綠的測試守著一段到不了的碼,
    //       在覆蓋率上與真的守住長得一模一樣。
    // 🔴 而它仍然要帶旗標:短路掉結果, 不可以順手短路掉「沒查」這件事。
    const res = filterFacets('   ', data({ failed: { brands: true } }));

    expect(res.brands).toEqual([]);
    expect(res.failed.brands).toBe(true);
  });

  it('should look identical in results but not in flags when a section could not be read', async () => {
    // 🔴 「這次查不到」與「沒有符合的」⇒ **結果都是空陣列**,
    //    而唯一分得開它們的東西就是那個旗標 ⇒ 這一格釘的是【那個旗標是唯一的判別依據】。
    const couldNotRead = filterFacets('brembo', data({ failed: { categories: true } }));
    const nothingMatched = filterFacets('brembo', data({ categories: [category('a', '別的')] }));

    expect(couldNotRead.categories).toEqual(nothingMatched.categories); // 兩個世界的【結果】相同
    expect(couldNotRead.failed.categories).not.toBe(nothingMatched.failed.categories); // 而旗標不同
  });
});
