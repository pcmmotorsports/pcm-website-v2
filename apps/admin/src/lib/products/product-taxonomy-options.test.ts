import { describe, expect, it } from 'vitest';

import {
  buildBrandOptions,
  buildCategoryOptions,
  resolveCategoryIds,
  type CategoryOptionRow,
} from './product-taxonomy-options';

// 固定測資:兩層(對齊 2026-08-19 正式庫量到的 max depth = 2)。
//   引擎部品 ─┬ 排氣管(有商品)
//             └ 進氣(無商品)
//   外觀部品 ─┬ 車殼(無商品)          ⇒ 整個大類都沒商品 ⇒ 不該出現
//   通用品(無子類、自身有商品)         ⇒ 單層也要撐得住
const ROWS: CategoryOptionRow[] = [
  { id: 'top-engine', name: '引擎部品', raw_path: '引擎部品', parent_category_id: null, sort_order: 1 },
  { id: 'sub-exhaust', name: '排氣管', raw_path: '引擎部品 · 排氣管', parent_category_id: 'top-engine', sort_order: 1 },
  { id: 'sub-intake', name: '進氣', raw_path: '引擎部品 · 進氣', parent_category_id: 'top-engine', sort_order: 2 },
  { id: 'top-body', name: '外觀部品', raw_path: '外觀部品', parent_category_id: null, sort_order: 2 },
  { id: 'sub-shell', name: '車殼', raw_path: '外觀部品 · 車殼', parent_category_id: 'top-body', sort_order: 1 },
  { id: 'top-misc', name: '通用品', raw_path: '通用品', parent_category_id: null, sort_order: 3 },
];
const WITH_PRODUCTS = new Set(['sub-exhaust', 'top-misc']);

describe('buildCategoryOptions', () => {
  it('只留有商品的分類 —— 空子類與整個空大類都不出現', () => {
    const options = buildCategoryOptions(ROWS, WITH_PRODUCTS);

    expect(options.map((o) => o.rawPath)).toEqual(['引擎部品', '通用品']);
    expect(options[0]?.children.map((c) => c.rawPath)).toEqual(['引擎部品 · 排氣管']);
    // 🔴 負向:外觀部品底下只有一個沒商品的子類 ⇒ 大類本身也不該在
    expect(options.map((o) => o.id)).not.toContain('top-body');
  });

  it('大類自身沒商品、但有有商品的子類 ⇒ 大類仍要出現(否則子類點不到)', () => {
    const options = buildCategoryOptions(ROWS, new Set(['sub-exhaust']));

    expect(options.map((o) => o.id)).toEqual(['top-engine']);
    expect(options[0]?.children).toHaveLength(1);
  });

  it('沒有子類的大類(單層)照樣撐得住', () => {
    const options = buildCategoryOptions(ROWS, new Set(['top-misc']));

    expect(options).toHaveLength(1);
    expect(options[0]?.rawPath).toBe('通用品');
    expect(options[0]?.children).toEqual([]);
  });

  it('依 sort_order 排;sort_order 相同時依名稱穩定排', () => {
    // DB 的 sort_order 預設全 0 ⇒ 只靠它會讓下拉順序隨查詢回傳順序漂移。
    // ⚠️ 名稱用 ASCII:CJK 的 localeCompare 依環境 collation 而異
    //    (實測「乙」U+4E59 排在「甲」U+7532 前面 —— 那不是筆劃也不是注音)
    //    ⇒ 這一格要測的是【穩定】,不該綁在某個 collation 的字序上。
    const flat: CategoryOptionRow[] = [
      { id: 'b', name: 'Bravo', raw_path: 'Bravo', parent_category_id: null, sort_order: 0 },
      { id: 'a', name: 'Alpha', raw_path: 'Alpha', parent_category_id: null, sort_order: 0 },
    ];
    const forward = buildCategoryOptions(flat, new Set(['a', 'b']));
    const reversed = buildCategoryOptions(flat.slice().reverse(), new Set(['a', 'b']));

    expect(forward.map((o) => o.id)).toEqual(['a', 'b']);
    // 🔴 同一組資料換一個回傳順序 ⇒ 結果必須一樣(這是「穩定」的意思)
    expect(reversed.map((o) => o.id)).toEqual(forward.map((o) => o.id));

    // 🔴 而 sort_order 不同時,它要壓過名稱(否則上面那條會在「名稱剛好也對」時假綠)
    const ordered = buildCategoryOptions(
      [
        { id: 'a', name: 'Alpha', raw_path: 'Alpha', parent_category_id: null, sort_order: 9 },
        { id: 'b', name: 'Bravo', raw_path: 'Bravo', parent_category_id: null, sort_order: 1 },
      ],
      new Set(['a', 'b']),
    );
    expect(ordered.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('空集合進 ⇒ 空陣列出(不是丟例外)', () => {
    expect(buildCategoryOptions(ROWS, new Set())).toEqual([]);
    expect(buildCategoryOptions([], WITH_PRODUCTS)).toEqual([]);
  });
});

describe('resolveCategoryIds', () => {
  const options = buildCategoryOptions(ROWS, new Set(['sub-exhaust', 'sub-intake', 'top-misc']));

  it('選大類 ⇒ 大類自己 + 它全部的子類(對齊顧客站「點大類涵蓋所有子類」)', () => {
    expect(resolveCategoryIds(options, '引擎部品')).toEqual(['top-engine', 'sub-exhaust', 'sub-intake']);
  });

  it('選子類 ⇒ 只有那一個', () => {
    expect(resolveCategoryIds(options, '引擎部品 · 排氣管')).toEqual(['sub-exhaust']);
  });

  it('沒選 ⇒ null(呼叫端不套用分類條件)', () => {
    expect(resolveCategoryIds(options, undefined)).toBeNull();
  });

  it('🔴 不認得的 raw_path ⇒ null 而不是空陣列 —— 網址被亂改時要看到全部,不是看到 0 件', () => {
    expect(resolveCategoryIds(options, '引擎部品 · 不存在')).toBeNull();
    expect(resolveCategoryIds(options, '')).toBeNull();
    // 負向對照:同一支函式對認得的值回非空 ⇒ 上面那兩個 null 不是因為函式壞了
    expect(resolveCategoryIds(options, '通用品')).toEqual(['top-misc']);
  });

  it('前綴相同但不是同一個分類 ⇒ 不命中(避免「引擎部品」誤中「引擎部品進階」)', () => {
    const tricky: CategoryOptionRow[] = [
      ...ROWS,
      { id: 'top-engine-adv', name: '引擎部品進階', raw_path: '引擎部品進階', parent_category_id: null, sort_order: 4 },
    ];
    const built = buildCategoryOptions(tricky, new Set(['top-engine-adv', 'sub-exhaust']));

    expect(resolveCategoryIds(built, '引擎部品進階')).toEqual(['top-engine-adv']);
    expect(resolveCategoryIds(built, '引擎部品')).toEqual(['top-engine', 'sub-exhaust']);
  });
});

describe('buildBrandOptions', () => {
  it('依名稱排,且不動到傳進來的陣列', () => {
    const rows = [
      { id: '2', name: 'Rizoma' },
      { id: '1', name: 'Akrapovic' },
    ];
    const sorted = buildBrandOptions(rows);

    expect(sorted.map((b) => b.name)).toEqual(['Akrapovic', 'Rizoma']);
    expect(rows[0]?.name).toBe('Rizoma');
  });
});
