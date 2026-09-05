// @vitest-environment node
//
// ⟦search-COUNTROLLUP⟧ 的守門 —— **「這個分類空不空」有兩個答案, 而它們都是真的數字。**
//
// 🔴🔴 **本檔存在的理由是一個【已經發生過的】錯, 不是假想**(2026-09-04 線【身分】`-auth`):
//    `SEARCH_CATEGORY_EMPTY_NAMES` 第一版是用一行 SQL 數的 —— `count(products_public) group by 分類`
//    ⇒ 那是**自身**件數。而 `buildCategoryTree` 逐字 `top.productCount + children.reduce(...)`
//    ⇒ **樹上的件數含子類加總**。
//    🔬 實測:那份 29 個的清單裡 **14 個在樹上其實有貨**
//       (`外觀與後視鏡` 3,278 · `騎士用品與配件` 2,506 · `拉桿與把手` 2,347 …)。
//    🛑 **而代價不是「閘太嚴」而已** —— `search-synonyms.test.ts` 拿那份清單扣掉之後建假目錄樹,
//       ⇒ **那棵假樹少了 14 個真實存在的分類** ⇒ **它的世界比正式站窄, 而窄的方向不會叫。**
//
// 🎯 **⇒ 這一族不能靠災情去找**:同一個成因一次讓召回差 12 倍(`傳動`), 一次完全無害(`卡夢`)——
//    差別只在資料剛好長什麼樣。⇒ **要靠【形狀】去找:誰拿件數當「有沒有東西」。**

import { describe, expect, it } from 'vitest';

import { buildCategoryTree } from '@/lib/category-taxonomy';
import { SEARCH_CATEGORY_EMPTY_NAMES } from '@/data/search-category-names';

type Summary = Parameters<typeof buildCategoryTree>[0][number];

/** 最小的世界:一個【自身 0 件】的大類 + 一個有貨的子類。 */
const FIXTURE = [
  {
    id: 'p1',
    name: '大類自身零件',
    path: { raw: '大類自身零件', segments: ['大類自身零件'] },
    parentId: null,
    sortOrder: 1,
    productCount: 0,
  },
  {
    id: 'c1',
    name: '子類有貨',
    path: { raw: '大類自身零件 · 子類有貨', segments: ['大類自身零件', '子類有貨'] },
    parentId: 'p1',
    sortOrder: 1,
    productCount: 7,
  },
] as unknown as Summary[];

describe('⟦search-COUNTROLLUP⟧ 自身件數 vs 樹上加總', () => {
  it('🔴 一個【自身 0 件】的大類, 只要子類有貨, 就【在樹上而且不是 0】', () => {
    const tree = buildCategoryTree(FIXTURE);
    const parent = tree.find((t) => t.name === '大類自身零件');
    expect(parent, '自身 0 件的大類被整個丟掉了 ⇒ 那與「拿自身件數判空」是同一個病').toBeDefined();
    // 🎯 這一行就是整條線的核心:**7 不是 0**, 而 SQL 那把尺會說 0。
    expect(parent!.count, '樹上的件數不含子類 ⇒ buildCategoryTree 的加總被改掉了').toBe(7);
  });

  it('🟢 正對照:真的什麼都沒有的大類【不在樹上】—— 否則上面那格與「什麼都留」印同一個綠', () => {
    const tree = buildCategoryTree([
      FIXTURE[0]!,
      {
        id: 'p2',
        name: '真的空的大類',
        path: { raw: '真的空的大類', segments: ['真的空的大類'] },
        parentId: null,
        sortOrder: 2,
        productCount: 0,
      } as unknown as Summary,
    ]);
    expect(tree.map((t) => t.name)).not.toContain('真的空的大類');
  });

  // 🔴🔴 **這一格是【實際發生過的那 14 個】的回歸釘** ——
  //    它們每一個都曾經在 `SEARCH_CATEGORY_EMPTY_NAMES` 裡, 而它們在樹上都有貨。
  //    ⇒ 有人拿舊的 SQL 一行重產這份清單 ⇒ 這一格紅。
  it('🔴 這 14 個大類【不得】出現在「空分類」清單裡(它們的自身件數是 0, 而樹上有貨)', () => {
    const WRONGLY_EMPTY = [
      '外觀與後視鏡', '騎士用品與配件', '拉桿與把手', '車身防護與防摔', '引擎與冷卻',
      '精品螺絲與螺帽', '止滑貼與保護膜', '腳踏後移與傳動', '排氣系統', '進氣系統',
      '燈具與電子', '煞車系統', '懸吊與車架', '四輪 ATV/UTV',
    ];
    const hit = WRONGLY_EMPTY.filter((n) => SEARCH_CATEGORY_EMPTY_NAMES.includes(n));
    expect(
      hit,
      '這幾個大類的【自身】件數是 0 而【樹上】有貨(2026-09-04 實測:外觀與後視鏡 3,278 件)' +
        ' ⇒ 把它們列為「空分類」會讓 search-synonyms.test.ts 那棵假樹少掉真實存在的分類。' +
        ' ⇒ 重產這份清單要走「餵真的 buildCategoryTree 再走一遍樹」, 不是一行 SQL。',
    ).toEqual([]);
  });

  // 🟢 而上面那格需要一個「清單不是空的」的對照 —— 空清單會讓它恆綠。
  it('🟢 正對照:清單本身不是空的(否則上面那格恆綠)', () => {
    expect(SEARCH_CATEGORY_EMPTY_NAMES.length).toBeGreaterThan(5);
  });
});
