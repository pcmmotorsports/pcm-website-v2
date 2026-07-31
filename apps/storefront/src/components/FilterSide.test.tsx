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
import { makeFacetCountResolver, type VehicleFacetCounts } from '@/lib/vehicle-facet-display';

const data: FilterSideData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterSide 的宿主模擬 — 持 cascade reducer + extras state。
function Harness({
  hideVehicle,
  vehicle,
  facetCounts,
  selectedCategory,
  selectedBrands,
}: {
  hideVehicle?: boolean;
  vehicle?: boolean;
  facetCounts?: VehicleFacetCounts | null;
  /** 🔴 直接注入「已選中」的狀態:0 件的列是 disabled 的,用點擊**永遠到不了**這個組合
   *  (2026-07-31 突變測試抓到:原本用「件數 3 的列點一下」測,`&& !isMainActive` 拿掉仍全綠)。 */
  selectedCategory?: { mainId: string; main: string };
  selectedBrands?: string[];
}) {
  const [base, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  // 已選車態:直接組出 cascade(不依賴 UI 流程,測的是「有車 vs 沒車」這一個變數)
  const cascade = {
    ...base,
    ...(vehicle ? { vehicle: { brand: 'Yamaha', model: 'MT-09 SP', year: 2022 } } : {}),
    ...(selectedCategory ? { category: selectedCategory } : {}),
    ...(selectedBrands ? { brands: selectedBrands } : {}),
  };
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterSide
      data={data}
      countOf={makeFacetCountResolver(Boolean(vehicle), facetCounts ?? null)}
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

// #306:件數跟著所選車款走。三態都要測,只測一半的話「乾脆全部拿掉」也會是綠的:
//   ①未選車 = 全站數照常顯示 ②選了車但件數還沒回來 = 不顯示(不給錯的)③件數回來了 = 真實件數。
describe('FilterSide 件數(桌機側欄)', () => {
  const counts = (c: HTMLElement) =>
    c.querySelectorAll('.fs-tree-count, .fs-cbx-count').length;

  it('未選車 → 分類與品牌件數照常顯示', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('品牌')); // 品牌段預設收合,展開才看得到
    expect(counts(container)).toBeGreaterThan(0);
  });

  it('已選車但件數還沒回來 → 一律不顯示(項目本身仍在;不得用全站數頂替)', () => {
    const { container } = render(<Harness vehicle />);
    fireEvent.click(screen.getByText('品牌'));
    expect(counts(container)).toBe(0);
    // 只拿掉數字、不拿掉可選項
    expect(container.querySelectorAll('.fs-tree-row').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.fs-cbx-row').length).toBeGreaterThan(0);
  });

  it('已選車且件數回來了 → 顯示該車真實件數,0 件灰掉且點不下去', () => {
    const first = MOCK_CATEGORIES[0]!;
    const second = MOCK_CATEGORIES[1]!;
    const brand = MOCK_BRANDS[0]!;
    const { container } = render(
      <Harness
        vehicle
        facetCounts={{
          categories: { [first.name]: 7, [second.name]: 0 },
          brands: { [brand.id]: 0 },
        }}
      />,
    );
    fireEvent.click(screen.getByText('品牌'));

    // 🔴 顯示的是車款件數,不是 server 帶下來的全站數
    const shown = Array.from(container.querySelectorAll('.fs-tree-count')).map((el) => el.textContent);
    expect(shown).toContain('7');
    expect(shown).not.toContain(String(first.count));

    const rowOf = (name: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.fs-tree-row')).find(
        (el) => el.textContent?.includes(name),
      );
    expect(rowOf(first.name)?.disabled).toBe(false);
    // 0 件 → 灰掉且停用(Sean Q2=A:點進去只會是空頁)
    expect(rowOf(second.name)?.disabled).toBe(true);
    expect(rowOf(second.name)?.className).toContain('is-empty');

    const brandRow = Array.from(container.querySelectorAll('.fs-cbx-row')).find((el) =>
      el.textContent?.includes(brand.name),
    );
    expect(brandRow?.className).toContain('is-empty');
    expect(brandRow?.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  });

  it('0 件的分類一旦被選中就必須留活口(否則取消不掉、列表空白又沒出路)', () => {
    const target = MOCK_CATEGORIES[1]!;
    const counts = { categories: { [target.name]: 0 }, brands: {} };

    const { container } = render(<Harness vehicle facetCounts={counts} />);
    const rowOf = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.fs-tree-l1')).find((el) =>
        el.textContent?.includes(target.name),
      )!;
    expect(rowOf(container).disabled).toBe(true); // 未選中 ⇒ 灰掉
    expect(rowOf(container).className).toContain('is-empty');

    // 🔴 同樣 0 件、但已經選中它(等同「選好分類之後才換車」)⇒ 必須留活口
    const { container: c2 } = render(
      <Harness
        vehicle
        facetCounts={counts}
        selectedCategory={{ mainId: target.id, main: target.name }}
      />,
    );
    expect(rowOf(c2).disabled).toBe(false);
    expect(rowOf(c2).className).not.toContain('is-empty');
  });

  it('已勾選的品牌即使 0 件也不得停用(否則取消不掉)', () => {
    const brand = MOCK_BRANDS[0]!;
    const counts = { categories: {}, brands: { [brand.id]: 0 } };
    const boxOf = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('.fs-cbx-row'))
        .find((el) => el.textContent?.includes(brand.name))
        ?.querySelector<HTMLInputElement>('input');

    const { container } = render(<Harness vehicle facetCounts={counts} />);
    fireEvent.click(screen.getByText('品牌'));
    expect(boxOf(container)?.disabled).toBe(true); // 未勾 ⇒ 停用

    // 🔴 同樣 0 件、但已經勾著(選好品牌之後才換車)⇒ 必須留活口,否則取消不掉
    const { container: c2 } = render(
      <Harness vehicle facetCounts={counts} selectedBrands={[brand.id]} />,
    );
    fireEvent.click(screen.getAllByText('品牌')[1]!);
    expect(boxOf(c2)?.checked).toBe(true);
    expect(boxOf(c2)?.disabled).toBe(false);
  });

  it('子類的 facet key 用「大類 · 子類」—— 參數對調就會拿到大類的數字', () => {
    const parent = MOCK_CATEGORIES.find((c) => c.children.length > 0);
    if (!parent) return; // 真分類為單層時本條自動略過
    const child = parent.children[0]!;
    const { container } = render(
      <Harness
        vehicle
        facetCounts={{
          categories: { [parent.name]: 9, [`${parent.name} · ${child.name}`]: 4 },
          brands: {},
        }}
      />,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll<HTMLButtonElement>('.fs-tree-l1')).find((el) =>
        el.textContent?.includes(parent.name),
      )!,
    );
    const sub = Array.from(container.querySelectorAll('.fs-tree-l2')).find((el) =>
      el.textContent?.includes(child.name),
    );
    expect(sub?.querySelector('.fs-tree-count')?.textContent).toBe('4');
  });

  it('件數回來了但沒有這個分類的 key → 不顯示,不得當成 0 件灰掉', () => {
    const first = MOCK_CATEGORIES[0]!;
    const { container } = render(<Harness vehicle facetCounts={{ categories: {}, brands: {} }} />);
    const rowOf = Array.from(container.querySelectorAll<HTMLButtonElement>('.fs-tree-row')).find(
      (el) => el.textContent?.includes(first.name),
    );
    expect(counts(container)).toBe(0);
    expect(rowOf?.disabled).toBe(false); // 「算不出來」≠「沒有商品」
  });
});
