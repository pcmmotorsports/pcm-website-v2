// @vitest-environment jsdom
//
// FilterSide smoke test — WO-2 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(車輛 accordion 切換 / 分類展開)不報錯」。
// M-1-12a 起 FilterSide 改 controlled、用 Harness 持 useReducer + useState 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterSide, type FilterSideData } from './FilterSide';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterSideData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterSide 的宿主模擬 — 持 cascade reducer + extras state。
function Harness({ hideVehicle }: { hideVehicle?: boolean }) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterSide
      data={data}
      hideVehicle={hideVehicle}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
    />
  );
}

afterEach(cleanup);

describe('FilterSide', () => {
  it('should render the filter sidebar without crashing', () => {
    render(<Harness />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('清除全部')).toBeDefined();
  });

  it('should show the vehicle accordion when hideVehicle is not set', () => {
    render(<Harness />);
    expect(screen.getByText('依車輛搜尋')).toBeDefined();
  });

  it('should hide the vehicle accordion when hideVehicle is set', () => {
    render(<Harness hideVehicle />);
    expect(screen.queryByText('依車輛搜尋')).toBeNull();
  });

  it('should expand a category and reveal its sub-items on click', () => {
    render(<Harness />);
    // 「零件分類」defaultOpen=true、大分類「代理配件」可見;有子類 → 點它展開細項(原行為不變)
    fireEvent.click(screen.getByText('代理配件'));
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  // Sean 拍 A(桌機大類可選性):childless 大類(無子類,如現況「碳纖維部品」+ 多品牌後 16 大類)
  //   點擊 → 直接選取「全部 {大類}」(對齊手機 FilterDrawer),再點取消(toggle)。原碼只 setExpanded、
  //   childless 點了展開空、選不了 → 本測鎖新行為(is-active 反映選取狀態)。
  it('should directly select a childless top-level category on click (Sean 拍 A)', () => {
    const childlessData: FilterSideData = {
      motoBrands: MOCK_MOTO_BRANDS,
      categories: [{ id: 'carbon', name: '碳纖維部品', count: 1117, children: [] }],
      brands: MOCK_BRANDS,
    };
    function ChildlessHarness() {
      const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
      const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
      return (
        <FilterSide data={childlessData} cascade={cascade} dispatch={dispatch} extras={extras} setExtras={setExtras} />
      );
    }
    render(<ChildlessHarness />);
    const row = screen.getByText('碳纖維部品').closest('button')!;
    expect(row.className).not.toContain('is-active'); // 未選
    fireEvent.click(row);
    expect(row.className).toContain('is-active'); // 點一下 → 選「全部 碳纖維部品」(非只展開)
    fireEvent.click(row);
    expect(row.className).not.toContain('is-active'); // 再點同列 → 取消(toggle)
  });

  // Sean 2026-07-12 UX 調整:has-children 大類點一次=選「該大類全部」+ 展開子類(取消獨立「全部」列);
  //   切換不同大類只需一次點擊;再點已選同一大類 → 取消 + 收合。
  it('should select whole parent AND expand subs on a single click, with no separate 全部 row (has-children)', () => {
    render(<Harness />);
    const parentRow = screen.getByText('代理配件').closest('button')!;
    expect(parentRow.className).not.toContain('is-active');
    fireEvent.click(parentRow); // 一次點:選「全部代理配件」+ 展開子類
    expect(parentRow.className).toContain('is-active'); // 大類自身反映「已選全部」
    expect(screen.getByText('BONAMICI RACING')).toBeDefined(); // 子類已展開
    expect(screen.queryByText('全部 代理配件')).toBeNull(); // 不再有獨立「全部」列
    fireEvent.click(parentRow); // 再點同一大類 → 取消 + 收合
    expect(parentRow.className).not.toContain('is-active');
    expect(screen.queryByText('BONAMICI RACING')).toBeNull();
  });

  // 切換不同大類只需一次點擊(舊行為需先展開再點「全部」=兩次)。
  it('should switch between top-level categories in a single click', () => {
    const twoParentData: FilterSideData = {
      motoBrands: MOCK_MOTO_BRANDS,
      categories: [
        { id: 'a', name: '大類A', count: 10, children: [{ id: 'a1', name: '子A1', count: 4 }] },
        { id: 'b', name: '大類B', count: 20, children: [{ id: 'b1', name: '子B1', count: 6 }] },
      ],
      brands: MOCK_BRANDS,
    };
    function TwoParentHarness() {
      const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
      const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
      return (
        <FilterSide data={twoParentData} cascade={cascade} dispatch={dispatch} extras={extras} setExtras={setExtras} />
      );
    }
    render(<TwoParentHarness />);
    fireEvent.click(screen.getByText('大類A').closest('button')!);
    expect(screen.getByText('大類A').closest('button')!.className).toContain('is-active');
    expect(screen.getByText('子A1')).toBeDefined();
    // 一次點大類B → B 選中 + 展開,A 收合
    fireEvent.click(screen.getByText('大類B').closest('button')!);
    expect(screen.getByText('大類B').closest('button')!.className).toContain('is-active');
    expect(screen.getByText('子B1')).toBeDefined();
    expect(screen.getByText('大類A').closest('button')!.className).not.toContain('is-active');
    expect(screen.queryByText('子A1')).toBeNull(); // A 已收合
  });

  // M-1-13e-pre-3:Sean 2026-05-21 業務拍板「不顯示有無庫存」、SHOW_IN_STOCK_FILTER=false
  // 隱藏「僅顯示現貨」checkbox;原「勾選後 row 帶 is-checked class」測點失效、翻轉為
  // 「verify hidden」。未來業務 revisit 把 flag 改 true 時、本 test 會 alert(需改回測
  // click 互動)、是 regression 錨點。
  it('should not render 僅顯示現貨 checkbox when SHOW_IN_STOCK_FILTER=false', () => {
    render(<Harness />);
    // 「其他」accordion 預設收合、展開後仍應無「僅顯示現貨」label(flag 隱藏)
    fireEvent.click(screen.getByText('其他'));
    expect(screen.queryByText('僅顯示現貨')).toBeNull();
  });
});
