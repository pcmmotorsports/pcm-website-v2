import { describe, it, expect } from 'vitest';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  clearVehicle,
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  toggleBrand,
  clearAll,
} from './cascadeFilterReducer';

/**
 * cascadeFilterReducer 單元測試 — 對齊 packages/domain pricing.test.ts 慣例
 * (顯式 import describe/it/expect、describe('X') / it('...') 結構、繁中描述)。
 *
 * 涵蓋:車輛 cascade reset、分類 cascade reset、品牌 toggle、clear-all、
 * 防禦式 no-op、reducer 純度(不 mutate 傳入 state)。
 */

describe('makeInitialCascadeState', () => {
  it('回傳全空初始狀態', () => {
    expect(makeInitialCascadeState()).toEqual({
      vehicle: null,
      category: null,
      brands: [],
    });
  });

  it('每次呼叫回傳全新 brands 陣列參考(非共用可變參考)', () => {
    const a = makeInitialCascadeState();
    const b = makeInitialCascadeState();
    expect(a.brands).not.toBe(b.brands);
  });
});

describe('cascadeFilterReducer — 車輛 cascade', () => {
  it('select-brand 設定 vehicle = { brand }', () => {
    const next = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    expect(next.vehicle).toEqual({ brand: 'Yamaha' });
  });

  it('選品牌後 select-model 保留品牌、加上車型', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, selectVehicleModel('R15'));
    expect(s.vehicle).toEqual({ brand: 'Yamaha', model: 'R15' });
  });

  it('選品牌+車型後 select-year 組成完整 vehicle', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, selectVehicleModel('R15'));
    s = cascadeFilterReducer(s, selectVehicleYear(2023));
    expect(s.vehicle).toEqual({ brand: 'Yamaha', model: 'R15', year: 2023 });
  });

  it('cascade reset:已選完整 vehicle、改選新品牌 → 清空車型+年份', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, selectVehicleModel('R15'));
    s = cascadeFilterReducer(s, selectVehicleYear(2023));
    s = cascadeFilterReducer(s, selectVehicleBrand('Honda'));
    expect(s.vehicle).toEqual({ brand: 'Honda' });
  });

  it('cascade reset:已選完整 vehicle、改選新車型 → 清空年份', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, selectVehicleModel('R15'));
    s = cascadeFilterReducer(s, selectVehicleYear(2023));
    s = cascadeFilterReducer(s, selectVehicleModel('MT-15'));
    expect(s.vehicle).toEqual({ brand: 'Yamaha', model: 'MT-15' });
  });

  it('防禦:未選品牌就 select-model → no-op(回原 state 參考)', () => {
    const init = makeInitialCascadeState();
    const next = cascadeFilterReducer(init, selectVehicleModel('R15'));
    expect(next).toBe(init);
  });

  it('防禦:未選車型就 select-year → no-op(回原 state 參考)', () => {
    const s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    const next = cascadeFilterReducer(s, selectVehicleYear(2023));
    expect(next).toBe(s);
  });

  it('clear-vehicle 將 vehicle 設回 null', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, clearVehicle());
    expect(s.vehicle).toBeNull();
  });
});

describe('cascadeFilterReducer — 零件分類 cascade', () => {
  it('select-main 設定 category = { mainId, main }', () => {
    const next = cascadeFilterReducer(
      makeInitialCascadeState(),
      selectCategoryMain('c-engine', '引擎部品'),
    );
    expect(next.category).toEqual({ mainId: 'c-engine', main: '引擎部品' });
  });

  it('選大分類後 select-sub 保留大分類、加上細項', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    expect(s.category).toEqual({
      mainId: 'c-engine',
      main: '引擎部品',
      subId: 's-exhaust',
      sub: '排氣管',
    });
  });

  it('cascade reset:已選細項、改選新大分類 → 清空細項', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    s = cascadeFilterReducer(s, selectCategoryMain('c-brake', '煞車系統'));
    expect(s.category).toEqual({ mainId: 'c-brake', main: '煞車系統' });
  });

  it('toggle:再點同一 subId → 清除整個分類(category = null)', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    expect(s.category).toBeNull();
  });

  it('點不同 subId → 換成新細項、保留大分類', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    s = cascadeFilterReducer(s, selectCategorySub('s-piston', '活塞'));
    expect(s.category).toEqual({
      mainId: 'c-engine',
      main: '引擎部品',
      subId: 's-piston',
      sub: '活塞',
    });
  });

  it('防禦:未選大分類就 select-sub → no-op(回原 state 參考)', () => {
    const init = makeInitialCascadeState();
    const next = cascadeFilterReducer(init, selectCategorySub('s-exhaust', '排氣管'));
    expect(next).toBe(init);
  });

  it('clear-category 將 category 設回 null', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, clearCategory());
    expect(s.category).toBeNull();
  });
});

describe('cascadeFilterReducer — 品牌多選 toggle', () => {
  it('toggle 未選品牌 → 加入 brands', () => {
    const next = cascadeFilterReducer(makeInitialCascadeState(), toggleBrand('b-akrapovic'));
    expect(next.brands).toEqual(['b-akrapovic']);
  });

  it('toggle 已選品牌 → 從 brands 移除', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), toggleBrand('b-akrapovic'));
    s = cascadeFilterReducer(s, toggleBrand('b-akrapovic'));
    expect(s.brands).toEqual([]);
  });

  it('多個品牌依序 toggle → 累加', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), toggleBrand('b-akrapovic'));
    s = cascadeFilterReducer(s, toggleBrand('b-brembo'));
    expect(s.brands).toEqual(['b-akrapovic', 'b-brembo']);
  });
});

describe('cascadeFilterReducer — clear-all', () => {
  it('清除全部:vehicle + category + brands 一次回初始', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
    s = cascadeFilterReducer(s, selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, toggleBrand('b-akrapovic'));
    s = cascadeFilterReducer(s, clearAll());
    expect(s).toEqual(makeInitialCascadeState());
  });
});

describe('cascadeFilterReducer — 純度 immutability', () => {
  it('reducer 不 mutate 傳入的 state', () => {
    const init = makeInitialCascadeState();
    cascadeFilterReducer(init, selectVehicleBrand('Yamaha'));
    cascadeFilterReducer(init, toggleBrand('b-akrapovic'));
    expect(init).toEqual(makeInitialCascadeState());
  });

  it('toggle-brand 不 mutate 原 brands 陣列', () => {
    const s = cascadeFilterReducer(makeInitialCascadeState(), toggleBrand('b-akrapovic'));
    const before = s.brands;
    const next = cascadeFilterReducer(s, toggleBrand('b-brembo'));
    expect(before).toEqual(['b-akrapovic']);
    expect(next.brands).not.toBe(before);
  });

  it('category/select-sub 換細項回傳新 category 物件、不影響原物件', () => {
    let s = cascadeFilterReducer(makeInitialCascadeState(), selectCategoryMain('c-engine', '引擎部品'));
    s = cascadeFilterReducer(s, selectCategorySub('s-exhaust', '排氣管'));
    const before = s.category;
    const next = cascadeFilterReducer(s, selectCategorySub('s-piston', '活塞'));
    expect(next.category).not.toBe(before);
    expect(before).toEqual({ mainId: 'c-engine', main: '引擎部品', subId: 's-exhaust', sub: '排氣管' });
  });
});
