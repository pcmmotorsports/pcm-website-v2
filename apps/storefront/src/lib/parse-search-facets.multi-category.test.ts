// parse-search-facets.multi-category.test.ts
//
// 🔴🔴 **為什麼要獨立一支檔, 而不是加進 `parse-search-facets.test.ts`**:
//    這一格必須 `vi.mock` 掉整份俗稱字典, 而那支檔的 253 格全部靠**真字典**在驗。
//    在那裡下 mock ⇒ 那 253 格從此驗的是我編的表 ⇒ **把一整批真的驗收換成假的**。
//
// 🛑 **而這份 mock 是【編的】, 我明說**:今天真字典裡「同一個 `from` 多筆」是**零筆**
//    (實查 42 列, 每個 `from` 各 1 次)⇒ 🔴 **`.filter` 那條多筆分支, 真資料到不了**
//    ⇒ 不 mock 的話它**永遠不會被跑到**, 而我會端出一個「253 格全綠」的假保證。
// 🔵 而編這份輸入是正當的:**被測的單元是【讀字典的那一行】, 字典是它的輸入** ——
//    給輸入不等於編結論。
// ⚠️ **它證不到的**:多顆膠囊會不會**顯示**出來。那條路今天斷在別的地方
//    (畫膠囊只讀 `?category=` 單顆)⇒ 別拿這一格去宣稱那件事。
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/data/search-synonyms', () => ({
  SEARCH_SYNONYMS: [
    { from: '魚雷管', to: '尾段排氣管', kind: 'category', source: 'test', added: '2026-09-04' },
    { from: '魚雷管', to: '全段排氣管', kind: 'category', source: 'test', added: '2026-09-04' },
    { from: '孤兒詞', to: '目錄裡沒有這個分類', kind: 'category', source: 'test', added: '2026-09-04' },
  ],
}));

const { parseSearchFacets, hasAnyFacet } = await import('./parse-search-facets');

const CATS = [
  { id: 'exhaust', name: '排氣系統', count: 9, children: [
    { id: 'slip', name: '尾段排氣管', count: 5 },
    { id: 'full', name: '全段排氣管', count: 4 },
  ] },
];
const SRC = { motoBrands: [], brands: [], categories: CATS } as never;

describe('⟦M-4b 多顆分類膠囊⟧ 一個俗稱對到多個正式名(Sean 2026-09-04 拍甲:聯集)', () => {
  it('🔴 同一個 from 兩筆 ⇒ 兩個都收下, 而不是只回第一筆', () => {
    const p = parseSearchFacets('魚雷管', SRC);
    expect(p.categories).toEqual(['排氣系統 · 尾段排氣管', '排氣系統 · 全段排氣管']);
  });

  it('🔵 category 仍是第一顆(舊呼叫端不動)', () => {
    expect(parseSearchFacets('魚雷管', SRC).category).toBe('排氣系統 · 尾段排氣管');
  });

  it('🔵 目錄裡對不到的那一筆【只丟那一筆】—— 死的字典列不會有東西叫, 但不該拖累別的', () => {
    const p = parseSearchFacets('孤兒詞', SRC);
    expect(p.categories).toEqual([]);
    expect(p.category).toBeNull();
    // 🔴 負對照:它沒解析出東西 ⇒ hasAnyFacet 要是 false, 否則 route 會白跳一次
    expect(hasAnyFacet(p)).toBe(false);
  });

  it('🔵 usedSynonyms 同一個詞會 push 多筆 —— 拿 .length 當「幾個詞」會多算', () => {
    expect(parseSearchFacets('魚雷管', SRC).usedSynonyms.length).toBe(2);
  });
});
