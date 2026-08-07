// @vitest-environment jsdom
//
// ProductsMobileControls — 手機商品目錄控制列(ADR-0007 手機決定 6-8)。
// 鎖三件 Sean 拍板、且**責任一旦混回去就再也看不出來**的事:
//   ① 分類 / 篩選 / 排序 = 三個獨立入口(不是同一個抽屜的三個 tab)
//   ② 商品篩選面板只處理商品條件 —— 不放選車、不放「僅顯示現貨」
//   ③ 「清除車輛」= 回到全部商品 + 清掉車輛相關分類(與選車面板的「清除草稿」語意不同)
//
// 資料全走真 taxonomy / 真分類 / cascadeFilterReducer;fixture 是字典形狀小樣本。

import { useReducer, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';
import { ProductsMobileControls } from './ProductsMobileControls';
import { makeFacetCountResolver, type VehicleFacetCounts } from '@/lib/vehicle-facet-display';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import type { FilterTopData } from './FilterTop';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockBrand } from '@/data/mock-brands';

const MOTO_BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'Yamaha', models: [{ id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] }] },
] as MockMotoBrand[];

const CATEGORIES: MockCategory[] = [
  { id: 'carbon', name: '碳纖維部品', count: 20, children: [] },
  { id: 'levers', name: '拉桿與把手', count: 36, children: [] },
];

const BRANDS: MockBrand[] = [
  { id: 'rpm-carbon', name: 'RPM CARBON', count: 12 },
  { id: 'lightech', name: 'LIGHTECH', count: 8 },
] as MockBrand[];

const data: FilterTopData = { motoBrands: MOTO_BRANDS, categories: CATEGORIES, brands: BRANDS };

function Harness({
  sort = 'recommend',
  setSort = vi.fn(),
  facetCounts,
}: {
  sort?: string;
  setSort?: (v: string) => void;
  /** #306:宿主(ProductsPage)算好的件數;不傳 = 沒接 #306 取數。 */
  facetCounts?: VehicleFacetCounts | null;
}) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <ProductsMobileControls
      data={data}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
      resultCount={161}
      sort={sort}
      setSort={setSort}
      countOf={facetCounts !== undefined ? makeFacetCountResolver(true, facetCounts) : undefined}
    />
  );
}

/** 走完整選車流程(工具列 → 選車面板 → 套用),回到「已選車」狀態。 */
function applyVehicle() {
  fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
  const brand = screen.getByLabelText('選擇廠牌') as HTMLInputElement;
  fireEvent.change(brand, { target: { value: 'Yamaha' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
  const model = screen.getByLabelText('選擇車型') as HTMLInputElement;
  fireEvent.change(model, { target: { value: 'MT-09 SP' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: 'MT-09 SP' }));
  const year = screen.getByLabelText('選擇年份') as HTMLInputElement;
  fireEvent.change(year, { target: { value: '2022' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: '2022' }));
  fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));
}

// Part B(債④):CTA「選擇車輛」只在 vehicleTitle===null 時渲染,而套用選車草稿一定會
// dispatch 品牌(見 MobileVehicleSheet applyDraft)⇒ 真的走 reducer 會讓 CTA 立刻換成「更換」。
// 要在 CTA 仍在畫面上時觀察到提示,得凍結 cascade(dispatch 不接真 reducer)——
// 不是造假情境,是隔離「CTA 入口本身有沒有清提示」這件事,不被「vehicleTitle 也剛好變了」污染。
function FrozenCascadeHarness({
  cascade = makeInitialCascadeState(),
  dispatch = vi.fn<(action: CascadeFilterAction) => void>(),
}: {
  cascade?: CascadeFilterState;
  dispatch?: (action: CascadeFilterAction) => void;
}) {
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <ProductsMobileControls
      data={data}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
      resultCount={161}
      sort="recommend"
      setSort={vi.fn()}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProductsMobileControls(ADR-0007 手機三入口)', () => {
  // ① 三個獨立入口。
  it('工具列同時提供類別、品牌/價格、排序三個獨立入口', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '類別' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /品牌\/價格/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /排序/ })).toBeTruthy();
  });

  it('類別入口開的是分類面板(真分類、非車輛)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '類別' }));

    expect(screen.getByText('碳纖維部品')).toBeTruthy();
    expect(screen.getByText('拉桿與把手')).toBeTruthy();
    // 分類面板不該混進選車
    expect(screen.queryByText('選擇車款')).toBeNull();
    expect(screen.queryByLabelText('選擇廠牌')).toBeNull();
  });

  // ② 商品篩選只處理商品條件。
  it('商品篩選面板只有商品條件:不放選車、不放現貨', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /品牌\/價格/ }));

    expect(screen.getByText('RPM CARBON')).toBeTruthy(); // 品牌
    expect(screen.getByText('價格')).toBeTruthy();
    expect(screen.queryByText('選擇車款')).toBeNull();
    expect(screen.queryByLabelText('選擇廠牌')).toBeNull();
    expect(screen.queryByText('僅顯示現貨')).toBeNull();
  });

  it('篩選數字只計商品條件(品牌+價格)、不計車輛與分類', () => {
    render(<Harness />);
    applyVehicle();
    fireEvent.click(screen.getByRole('button', { name: '類別' }));
    fireEvent.click(screen.getByText('碳纖維部品'));

    // 車輛 + 分類都已選,但「篩選」入口不得因此顯示數字
    expect(screen.getByRole('button', { name: /品牌\/價格/ }).textContent).not.toMatch(/\d/);

    fireEvent.click(screen.getByRole('button', { name: /品牌\/價格/ }));
    fireEvent.click(screen.getByText('RPM CARBON'));
    fireEvent.click(screen.getByRole('button', { name: /查看 161 件商品/ }));
    expect(screen.getByRole('button', { name: /品牌\/價格/ }).textContent).toMatch(/1/);
  });

  // Sean 2026-07-30:選了車之後,品牌右邊的數字是全站總數(`catalog_brand_counts()` 不吃
  // #306:件數跟著所選車款走(~~舊契約:選車後一律隱藏~~ 已被 #306-b 取代 —— 隱藏只是
  //   「不給錯的」,Sean 要的是「給對的」)。本元件只負責**把宿主算好的 countOf 穿透下去**,
  //   自己不判斷有沒有車(理由見 FilterSide 的 countOf prop 註解:審查 M1 的兩條時間軸)。
  // 🔴 三個方向都測,只測一半的話「乾脆全部拿掉」也會是綠的。
  it.each([
    ['品牌/價格面板', /品牌\/價格/, 'RPM CARBON'],
    ['類別面板', '類別', '碳纖維部品'],
  ])('%s:未接 #306 取數 → 沿用 server 全站數', (_label, entry, _sampleRow) => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: entry }));
    expect(container.querySelectorAll('.fd-row-count').length).toBeGreaterThan(0);
  });

  it.each([
    ['品牌/價格面板', /品牌\/價格/, 'RPM CARBON'],
    ['類別面板', '類別', '碳纖維部品'],
  ])('%s:選了車但件數還沒回來 → 一律不顯示(項目本身仍在)', (_label, entry, sampleRow) => {
    const { container } = render(<Harness facetCounts={null} />);
    applyVehicle();
    fireEvent.click(screen.getByRole('button', { name: entry }));
    expect(screen.getByText(sampleRow)).toBeTruthy();
    expect(container.querySelectorAll('.fd-row-count')).toHaveLength(0);
  });

  it('件數回來了 → 穿透到抽屜、顯示真實件數(拔掉 countOf 這條就會紅)', () => {
    const { container } = render(
      <Harness facetCounts={{ categories: { 碳纖維部品: 7 }, brands: {} }} />,
    );
    applyVehicle();
    fireEvent.click(screen.getByRole('button', { name: '類別' }));
    const shown = Array.from(container.querySelectorAll('.fd-row-count')).map((el) => el.textContent);
    expect(shown).toContain('7');
  });

  it('排序入口列出排序選項、選定回報值(非字面)', () => {
    const setSort = vi.fn();
    render(<Harness setSort={setSort} />);
    fireEvent.click(screen.getByRole('button', { name: /排序/ }));

    fireEvent.click(screen.getByText('價格低到高'));
    expect(setSort).toHaveBeenCalledWith('price-asc');
  });

  it('排序入口文字視覺置中,且字面固定為「排序」(Sean 2026-07-30 指定)', () => {
    render(<Harness />);
    const sortButton = screen.getByRole('button', { name: /排序/ });
    expect(sortButton.className).toContain('pmc-tool--sort');
    // 顯示字面固定;目前排序值改留 aria-label(資訊不消失、視覺不重複)
    expect(sortButton.textContent?.trim()).toBe('排序');
    expect(sortButton.getAttribute('aria-label')).toContain('推薦排序');
  });

  // 三個入口的字面 = Sean 指定,寫死鎖住(日後有人「順手改回」會當場轉紅)
  it('三個入口字面為 類別 / 品牌價格 / 排序', () => {
    const { container } = render(<Harness />);
    const labels = [...container.querySelectorAll('.pmc-tool')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['類別', '品牌/價格', '排序']);
  });

  // 未選車 → 入口;已選車 → 摘要。
  it('未選車顯示「選擇車輛」入口、點開選車面板', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    expect(screen.getByText('選擇適用車輛')).toBeTruthy();
    expect(screen.getByLabelText('選擇廠牌')).toBeTruthy();
  });

  // 🔴 Sean 2026-07-30 第二輪真機回饋:「最上面這一群在手機版本上車種資訊過剩」。
  //    第一屏原本把同一台車講四次(大塊摘要 / 黏頂精簡列 / 頁面標題 / ActiveChips 膠囊),
  //    其中前兩個都是本元件加的。這條鎖住「本元件內車名只出現一次」——
  //    再有人補一塊摘要回來就當場轉紅。
  it('已選車時車輛資訊在本元件內只出現一次(不得再有大塊摘要重複)', () => {
    const { container } = render(<Harness />);
    applyVehicle();

    const root = container.querySelector('.pmc-root') as HTMLElement;
    const hits = [...root.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && (el.textContent ?? '').includes('MT-09 SP'),
    );
    expect(hits).toHaveLength(1);
    // 唯一那處必須在黏頂列內(捲到哪都看得到、才有留它的意義)
    expect(container.querySelector('.pmc-sticky')?.contains(hits[0] as Node)).toBe(true);
    // 大塊摘要整塊不得存在
    expect(container.querySelector('.pmc-vehicle-summary')).toBeNull();
    expect(container.querySelector('.pmc-vehicle')).toBeNull();
  });

  // Sean 2026-07-30 真機回報:大塊資訊捲走後,往下看商品時仍要有「換車 / 清車」出口。
  // 🔴 這條同時是「黏頂列裡真的有東西」的守門:黏頂的是 .pmc-sticky,精簡列必須長在它裡面,
  //    否則捲下去之後客人就只剩三個入口、換不了車(核准預覽的 compactVehicle 角色)。
  it('已選車時黏頂列內含精簡車輛列 + 換車/清車出口', () => {
    const { container } = render(<Harness />);
    applyVehicle();

    const sticky = container.querySelector('.pmc-sticky');
    const compact = sticky?.querySelector('.pmc-compact');
    expect(compact).not.toBeNull();
    expect(compact?.textContent).toContain('MT-09 SP');
    const actions = [...(compact?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(actions).toEqual(['更換', '清除']);
    // 三個入口也必須在同一個黏頂容器內(否則捲下去只黏到一半)
    expect(sticky?.querySelectorAll('.pmc-tool').length).toBe(3);
  });

  it('未選車時黏頂列不出現精簡車輛列(沒車可換)', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.pmc-sticky')).not.toBeNull();
    expect(container.querySelector('.pmc-compact')).toBeNull();
  });

  it('黏頂列的「更換」重開選車面板', () => {
    const { container } = render(<Harness />);
    applyVehicle();

    const compactChange = [...container.querySelectorAll('.pmc-compact button')]
      .find((b) => b.textContent === '更換') as HTMLElement;
    fireEvent.click(compactChange);
    expect(screen.getByText('選擇適用車輛')).toBeTruthy();
  });

  // ③ 清除車輛 = 回全部商品 + 清車輛相關分類。
  it('「清除車輛」回到全部商品並一併清掉分類', () => {
    const { container } = render(<Harness />);
    applyVehicle();
    fireEvent.click(screen.getByRole('button', { name: '類別' }));
    fireEvent.click(screen.getByText('碳纖維部品'));

    // 🔴 綁黏頂列裡那顆:抽屜 footer 也有一顆叫「清除」(清商品條件),
    //    用全域 getByRole 會撞到它 —— 兩顆的作用範圍完全不同,不能混。
    const clearVehicle = [...container.querySelectorAll('.pmc-compact button')]
      .find((b) => b.textContent === '清除') as HTMLElement;
    fireEvent.click(clearVehicle);

    // 車輛摘要消失 → 回到未選車入口
    expect(screen.getByRole('button', { name: '選擇車輛' })).toBeTruthy();
    expect(container.querySelector('.pmc-compact')).toBeNull();
    expect(screen.queryByRole('button', { name: '更換' })).toBeNull();
    // 分類也被清掉(cascade.category=null ⇒ 分類面板無 active 列)
    fireEvent.click(screen.getByRole('button', { name: '類別' }));
    const active = screen.getByText('碳纖維部品').closest('button');
    expect(active?.className).not.toContain('is-active');
  });

  // ── Part B 債④:套用時被略過的草稿提示 —— 兩個「重開選車面板」入口各測一次 ──
  describe('選車草稿被略過的提示', () => {
    it('CTA 入口(選擇車輛):提示出現後再次打開面板 ⇒ 提示消失', () => {
      render(<FrozenCascadeHarness />);
      fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
      const brand = screen.getByLabelText('選擇廠牌') as HTMLInputElement;
      fireEvent.change(brand, { target: { value: 'Yamaha' } });
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
      const model = screen.getByLabelText('選擇車型') as HTMLInputElement;
      fireEvent.change(model, { target: { value: 'MT-0' } });
      fireEvent.blur(model);
      fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));

      expect(screen.getByText(/沒有對應到車型/)).toBeTruthy();
      // cascade 凍結(dispatch 不接真 reducer)⇒ vehicleTitle 仍是 null ⇒ CTA 入口仍在畫面上
      expect(screen.getByRole('button', { name: '選擇車輛' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
      expect(screen.queryByText(/沒有對應到車型/)).toBeNull();
    });

    it('黏頂列「更換」入口:提示出現後再次打開面板 ⇒ 提示消失', () => {
      const { container } = render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
      const brand = screen.getByLabelText('選擇廠牌') as HTMLInputElement;
      fireEvent.change(brand, { target: { value: 'Yamaha' } });
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
      const model = screen.getByLabelText('選擇車型') as HTMLInputElement;
      fireEvent.change(model, { target: { value: 'MT-0' } });
      fireEvent.blur(model);
      fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));

      expect(screen.getByText(/沒有對應到車型/)).toBeTruthy();
      // 真實 reducer 已 dispatch 品牌 ⇒ vehicleTitle 非 null ⇒ CTA 換成黏頂「更換」
      const compactChange = [...container.querySelectorAll('.pmc-compact button')]
        .find((b) => b.textContent === '更換') as HTMLElement;

      fireEvent.click(compactChange);
      expect(screen.queryByText(/沒有對應到車型/)).toBeNull();
    });

    // 🔴 F2a 回歸(對抗審查 must-fix):提示原本只由本元件自己的三個入口清 ——
    //    ActiveChips 的車輛膠囊 × 直接 dispatch clearVehicle,不經過那三個入口,
    //    車清掉了、提示還掛著。用 FrozenCascadeHarness 的既有手法(dispatch 凍結)
    //    先製造出提示,再用 rerender 把 `cascade.vehicle` 換成 null(模擬外部清除,
    //    不呼叫本元件的「清除」鈕)⇒ 提示要跟著消失。
    it('F2a:提示出現後車輛被外部清空(非本元件清除鈕)⇒ 提示消失', () => {
      // 🔴 只 dispatch brand、不連 model:model 欄若預先有值,`Combo.commit()` 的 Q7=A
      //    規則(已選定 → 打字未命中就還原成已選那個)會讓底下打的 'MT-0' 直接被蓋掉,
      //    永遠留不住草稿、也就永遠等不到提示 —— 必須讓 model 欄從空值起跑(Q4=B 留字路徑)。
      const cascade: CascadeFilterState = cascadeFilterReducer(makeInitialCascadeState(), selectVehicleBrand('Yamaha'));
      const dispatch = vi.fn();
      const { container, rerender } = render(<FrozenCascadeHarness cascade={cascade} dispatch={dispatch} />);

      const compactChange = [...container.querySelectorAll('.pmc-compact button')]
        .find((b) => b.textContent === '更換') as HTMLElement;
      fireEvent.click(compactChange);
      const model = screen.getByLabelText('選擇車型') as HTMLInputElement;
      fireEvent.change(model, { target: { value: 'MT-0' } });
      fireEvent.blur(model);
      fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));
      expect(screen.getByText(/沒有對應到車型/)).toBeTruthy();

      rerender(<FrozenCascadeHarness cascade={{ ...cascade, vehicle: null }} dispatch={dispatch} />);
      expect(screen.queryByText(/沒有對應到車型/)).toBeNull();
    });
  });
});
