// @vitest-environment jsdom
//
// FilterDrawer smoke test — 前台 regression 安全網。
// 驗「open=false 不 render + open=true render 不報錯 + 關鍵互動(分頁切換 /
// 套用按鈕)不報錯」。M-1-12a 起 FilterDrawer 改 controlled、用 Harness 持
// useReducer + useState 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterDrawer, type FilterDrawerData } from './FilterDrawer';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterDrawerData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterDrawer 的宿主模擬 — 持 cascade reducer + extras state。
function Harness({
  open,
  onClose = () => {},
  resultCount = 128,
  scope,
  initialTab,
}: {
  open: boolean;
  onClose?: () => void;
  resultCount?: number;
  scope?: 'all' | 'category' | 'product';
  initialTab?: 'vehicle' | 'category' | 'brand' | 'price' | 'color' | 'other';
}) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterDrawer
      open={open}
      onClose={onClose}
      data={data}
      resultCount={resultCount}
      scope={scope}
      initialTab={initialTab}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
    />
  );
}

afterEach(cleanup);

describe('FilterDrawer', () => {
  it('should render nothing when open is false', () => {
    const { container } = render(<Harness open={false} resultCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render the drawer without crashing when open', () => {
    render(<Harness open />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('查看 128 件商品')).toBeDefined();
  });

  // Sean 2026-07-20:車輛 tab 標籤由「依車輛搜尋」改為「選擇車款」= 授權覆蓋 design
  // (design-reference/components/FilterDrawer.jsx:31 仍為舊字面、刻意不同步)。
  // 釘住新字面,避免日後對齊 design 時被無聲改回。
  it('should label the vehicle tab 選擇車款 (not the design-reference 依車輛搜尋)', () => {
    const { container } = render(<Harness open />);
    // 綁到 tab 按鈕本身、不只驗字串存在:否則日後 tab 被移除、而「選擇車款」四字
    // 從別處(如 CartVehicleField 的「+ 選擇車款」)滲進抽屜時,斷言仍會假綠。
    const tabLabels = [...container.querySelectorAll('.fd-tab')].map((el) => el.textContent);
    expect(tabLabels[0]).toContain('選擇車款');
    expect(tabLabels.some((t) => t?.includes('依車輛搜尋'))).toBe(false);
  });

  it('should switch to the brand tab when the brand tab is clicked', () => {
    render(<Harness open />);
    fireEvent.click(screen.getByText('品牌'));
    // 品牌分頁顯示品牌列(MOCK_BRANDS 第一筆)
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  // Sean 2026-07-13:點大類 = 直接篩「該大類全部」+ 進入細項視圖(取消進入後的「全部 {大類}」列)。
  it('should drill into a category and drop the 全部 row on a single tap', () => {
    render(<Harness open />);
    fireEvent.click(screen.getByText('零件分類')); // 切到分類分頁
    fireEvent.click(screen.getByText('代理配件')); // 點大類 → 篩全部 + 進入細項
    expect(screen.getByText('選擇細項')).toBeDefined(); // 已進入細項視圖
    expect(screen.queryByText('全部 代理配件')).toBeNull(); // 不再有獨立「全部」列
    expect(screen.getByText('CNC RACING')).toBeDefined(); // 子類已顯示
  });

  it('should call onClose when the apply button is clicked', () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.click(screen.getByText('查看 128 件商品'));
    expect(onClose).toHaveBeenCalled();
  });
});

// ADR-0007 手機決定 7/8:分類與商品篩選拆成兩個獨立入口,商品篩選不得再含選車。
// scope 預設 'all' = 現行全 tab 行為(dev-preview/filter-drawer 那頁靠它,不得被改掉)。
describe('FilterDrawer scope(ADR-0007 責任分離)', () => {
  const tabLabels = (container: HTMLElement) =>
    [...container.querySelectorAll('.fd-tab')].map((el) => el.textContent ?? '');

  it('scope 未指定 → 維持現行全 tab(含選擇車款)', () => {
    const { container } = render(<Harness open />);
    expect(tabLabels(container).some((t) => t.includes('選擇車款'))).toBe(true);
  });

  it('scope="product" → 無選擇車款、無零件分類、無現貨', () => {
    const { container } = render(<Harness open scope="product" />);
    const labels = tabLabels(container);

    expect(labels.some((t) => t.includes('選擇車款'))).toBe(false);
    expect(labels.some((t) => t.includes('零件分類'))).toBe(false);
    expect(labels.some((t) => t.includes('品牌'))).toBe(true);
    expect(labels.some((t) => t.includes('價格'))).toBe(true);
    // 綁不到車輛 UI:抽屜內不得出現任何車款輸入或車款層級字面
    expect(screen.queryByLabelText('打字快速找車')).toBeNull();
    expect(screen.queryByText('僅顯示現貨')).toBeNull();
  });

  // 🔴 activeTab 回退機制的專屬測試(否則那段守門沒有任何測試會因它被拿掉而轉紅):
  //    呼叫端把 initialTab 設成 scope 外的值(真實可能:複製貼上舊的 initialTab="vehicle"),
  //    面板仍不得渲染選車 —— 責任邊界不能依賴呼叫端傳對參數。
  it('scope="product" 即使被要求 initialTab="vehicle" 也不渲染選車', () => {
    const { container } = render(<Harness open scope="product" initialTab="vehicle" />);

    expect(screen.queryByLabelText('打字快速找車')).toBeNull();
    expect(tabLabels(container).some((t) => t.includes('選擇車款'))).toBe(false);
    // 回退到 scope 內第一個 tab(品牌)、不是空面板
    expect(screen.getByText('BONAMICI RACING')).toBeTruthy();
  });

  it('scope="category" → 只有分類、且不出現 tab 列(單一責任面板)', () => {
    const { container } = render(<Harness open scope="category" />);

    expect(tabLabels(container)).toEqual([]);
    expect(screen.getByText('選擇大分類')).toBeTruthy();
    expect(screen.queryByLabelText('打字快速找車')).toBeNull();
  });

  it('scope="category" 的清除只清分類、不連坐清掉車輛', () => {
    const onClose = vi.fn();
    render(<Harness open scope="category" onClose={onClose} />);
    // 面板標題字面須是分類、不是「篩選條件」(否則客人以為按了會清掉全部)
    expect(screen.getByText('選擇商品分類')).toBeTruthy();
    expect(screen.queryByText('篩選條件')).toBeNull();
  });
});
