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
import { makeFacetCountResolver, type VehicleFacetCounts } from '@/lib/vehicle-facet-display';

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
  vehicle,
  facetCounts,
  selectedCategory,
  applying,
}: {
  open: boolean;
  onClose?: () => void;
  resultCount?: number;
  scope?: 'all' | 'category' | 'product';
  initialTab?: 'vehicle' | 'category' | 'brand' | 'price' | 'color' | 'other';
  vehicle?: boolean;
  facetCounts?: VehicleFacetCounts | null;
  /** 直接注入「已選中的分類」——用點擊模擬會進到子類視圖、量不到同一顆按鈕。 */
  selectedCategory?: { mainId: string; main: string };
  applying?: boolean;
}) {
  const [base, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const cascade = {
    ...base,
    ...(vehicle ? { vehicle: { brand: 'Yamaha', model: 'MT-09 SP', year: 2022 } } : {}),
    ...(selectedCategory ? { category: selectedCategory } : {}),
  };
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterDrawer
      open={open}
      onClose={onClose}
      data={data}
      resultCount={resultCount}
      applying={applying}
      scope={scope}
      initialTab={initialTab}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
      countOf={makeFacetCountResolver(Boolean(vehicle), facetCounts ?? null)}
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

// #306:件數跟著所選車款走(手機抽屜側;桌機側欄的對應測試在 FilterSide.test.tsx)。
describe('FilterDrawer 件數(手機抽屜)', () => {
  const counts = (c: HTMLElement) => c.querySelectorAll('.fd-row-count').length;

  it('未選車 → 分類件數照常顯示', () => {
    const { container } = render(<Harness open scope="category" />);
    expect(counts(container)).toBeGreaterThan(0);
  });

  it('已選車但件數還沒回來 → 不顯示(不得用全站數頂替)', () => {
    const { container } = render(<Harness open scope="category" vehicle />);
    expect(counts(container)).toBe(0);
    expect(container.querySelectorAll('.fd-row').length).toBeGreaterThan(0);
  });

  it('已選車且件數回來了 → 顯示真實件數,0 件灰掉且點不下去', () => {
    const first = data.categories[0]!;
    const second = data.categories[1]!;
    const { container } = render(
      <Harness
        open
        scope="category"
        vehicle
        facetCounts={{ categories: { [first.name]: 9, [second.name]: 0 }, brands: {} }}
      />,
    );
    const shown = Array.from(container.querySelectorAll('.fd-row-count')).map((el) => el.textContent);
    expect(shown).toContain('9');
    expect(shown).not.toContain(String(first.count));

    const rowOf = (name: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.fd-row')).find((el) =>
        el.textContent?.includes(name),
      );
    expect(rowOf(first.name)?.disabled).toBe(false);
    expect(rowOf(second.name)?.disabled).toBe(true);
    expect(rowOf(second.name)?.className).toContain('is-empty');
  });
});

describe('FilterDrawer 0 件但已選中 → 留活口', () => {
  const rowOf = (root: HTMLElement, name: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.fd-row')).find((el) =>
      el.textContent?.includes(name),
    )!;

  it('0 件且未選中 → 灰掉且停用', () => {
    const first = data.categories[0]!;
    const { container } = render(
      <Harness open scope="category" vehicle facetCounts={{ categories: { [first.name]: 0 }, brands: {} }} />,
    );
    expect(rowOf(container, first.name).disabled).toBe(true);
    expect(rowOf(container, first.name).className).toContain('is-empty');
  });

  it('🔴 0 件但**已選中** → 必須留活口(手機抽屜是全屏遮罩,取消不掉就卡死)', () => {
    const first = data.categories[0]!;
    const { container } = render(
      <Harness
        open
        scope="category"
        vehicle
        selectedCategory={{ mainId: first.id, main: first.name }}
        facetCounts={{ categories: { [first.name]: 0 }, brands: {} }}
      />,
    );
    const row = rowOf(container, first.name);
    expect(row.disabled).toBe(false);
    expect(row.className).not.toContain('is-empty');
    expect(row.className).toContain('is-active');
  });
});

/**
 * ⟦fc-FOCUSTRAP⟧ Tab 在抽屜內循環。
 *
 * 🔬 **這一族的綠是真的,而我先證過** —— 開工前跑了一支拋棄式探針問 jsdom:
 *    trap 關 ⇒ 從最後一個按 Tab **不會**回到第一個
 *    trap 開 ⇒ **會**回到第一個
 *    ⇒ `discriminates = **true**` ⇒ **jsdom 分得出這兩個世界。**
 * 🛑 **而同一發探針問 `inert` ⇒ `discriminates = false`**(設了之後 `focus()` 照樣成功)
 *    ⇒ 所以本檔**故意不驗 `inert`** —— 那種格子在 CI 裡是空的綠。
 *
 * ⚠️ **本族守得住什麼、守不住什麼(不要讀成等價物)**:
 *    ✅ 守得住:Tab / Shift+Tab **走不出抽屜**
 *    🔴 **守不住:螢幕閱讀器仍然讀得到背景** —— 那要 `inert`,而它在 CI 裡驗不到
 *    ⇒ 📌 **本族是那件事的替身,不是等價物。** 下一個動這段的人:CI 不會替你看那一半。
 */
describe('⟦fc-FOCUSTRAP⟧ Tab 在抽屜內循環', () => {
  const focusablesIn = (container: HTMLElement) =>
    [
      ...(container
        .querySelector('.fd-drawer')!
        .querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
        ) ?? []),
    ];

  it('🔴 焦點在最後一個 → 按 Tab → 回到第一個(不得走出抽屜)', () => {
    const { container } = render(<Harness open />);
    const f = focusablesIn(container);
    // 🟢 正對照:先證這一格有東西可以繞 —— 少於 2 個時下面的斷言會恆真。
    expect(f.length, '抽屜裡可聚焦元素少於 2 個 ⇒ 這一格證不到循環').toBeGreaterThan(1);
    const last = f[f.length - 1]!;
    last.focus();
    expect(document.activeElement, '前提:焦點要先真的落在最後一個').toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement, 'Tab 走出了抽屜 ⇒ 客人會掉到背後的導覽列/購物車').toBe(f[0]);
  });

  it('🔴 Shift+Tab 從第一個 → 回到最後一個(反向那一半)', () => {
    const { container } = render(<Harness open />);
    const f = focusablesIn(container);
    expect(f.length).toBeGreaterThan(1);
    const first = f[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(f[f.length - 1]!);
  });

  it('🔵 中間那些不動 —— 這一片沒有把正常的 Tab 弄壞', () => {
    const { container } = render(<Harness open />);
    const f = focusablesIn(container);
    expect(f.length).toBeGreaterThan(2);
    const middle = f[1]!;
    middle.focus();
    fireEvent.keyDown(middle, { key: 'Tab' });
    // 🔴 只有兩端要被攔;中間那些交給瀏覽器原生行為
    //    (jsdom 不會自己移動焦點 ⇒ 這裡要看到的是「焦點沒有被我們搬走」)。
    expect(document.activeElement, '中間的 Tab 被我們攔走了 ⇒ 那不是循環, 是綁架').toBe(middle);
  });

  it('🔴 開啟時焦點要移進抽屜 —— 而它是循環的【前提】不是額外的禮貌', () => {
    const { container } = render(<Harness open />);
    const a = document.activeElement;
    expect(a && (a as HTMLElement).closest('.fd-drawer'), '開了而焦點留在 body ⇒ 客人要按 30 下 Tab 才進得來 ⇒ 循環等於沒做').not.toBeNull();
    // 🟢 正對照:證明抽屜裡真的有東西可以被聚焦 —— 沒有的話上面那格會因為別的理由過。
    expect(container.querySelector('.fd-drawer button:not([disabled])')).not.toBeNull();
  });

  /**
   * 🔴🔴 **移入的落點必須【就是】循環算出來的 `first` —— 兩處要用同一把尺。**
   *
   * 第一版我把選擇器打了兩份:移入只找 `button`, 循環找四種。
   * ⇒ 抽屜第一個可聚焦的若是 `<a>` / `<input>`, **移入會跳過它**
   * ⇒ ⇒ Shift+Tab 從那個落點走會跳到 `last`, 而中間那幾個永遠走不到。
   * 🔵 而 FilterDrawer 今天第一個剛好是 `button` ⇒ **它今天不發作**
   *    ⇒ 📌 **所以那三發突變一格都沒紅 —— 這一格就是補那個洞。**
   */
  it('🔴 移入的落點 === 循環的 first(兩處必須同一把尺)', () => {
    const { container } = render(<Harness open />);
    const f = focusablesIn(container);
    expect(f.length, '少於 1 個 ⇒ 下面那格恆真').toBeGreaterThan(0);
    expect(
      document.activeElement,
      '移入落在 first 以外 ⇒ Shift+Tab 會跳到 last, 中間那些永遠走不到',
    ).toBe(f[0]);
  });

  it('🔴 Escape 要關得掉 —— 焦點被關起來, 就必須有一條出去的路', () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose, '只做循環而不做 Escape = 我們親手把客人關進去了').toHaveBeenCalled();
  });

  it('🔴 Escape 關掉之後, 全域 Tab 不再被攔(effect 有沒有收掉)', () => {
    const { rerender } = render(<Harness open />);
    // 關掉:宿主收回 open ⇒ effect 的 cleanup 應該把 listener 移除
    rerender(<Harness open={false} />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(document.activeElement, '抽屜關了還在吃全站的 Tab ⇒ 那是【只在別的頁面顯形】的 bug').toBe(outside);
    outside.remove();
  });

  it('🔵 關著時不掛 listener —— 而它的反面是「關著也在攔全域 Tab」', () => {
    render(<Harness open={false} />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(document.activeElement, '抽屜關著卻攔了全站的 Tab').toBe(outside);
    outside.remove();
  });

  // ⟦search-CATSWITCHSLOW⟧ ① 切分類的載入回饋(2026-09-06)。
  // 🔬 為什麼有這三格:正式站量到切一個分類要等 3.4-6.3 秒
  //   (正本 `~/pcm-mailbox/量-抽屜正式站-20260906.md`), 而那幾秒畫面完全不動。
  // 🛑 這三格證的是「客人看得到它在跑」, **不是「它變快了」** —— 它一秒都沒變快。
  it('🔴 applying:底部那顆鈕原地換成「套用中…」並鎖住', () => {
    // 🔵 它在【拿掉 applying 分支】的世界會紅(印回「查看 128 件商品」),
    //    也在【忘了 disabled】的世界會紅。
    render(<Harness open applying />);
    const btn = screen.getByRole('button', { name: '套用中…' });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled, '沒鎖住 ⇒ 客人會在那幾秒裡再按一次').toBe(true);
    expect(btn.className).toContain('is-loading');
    expect(screen.queryByText('查看 128 件商品'), '舊件數還印著 ⇒ 看起來像「算完了而數字沒變」').toBeNull();
  });

  it('🟢 正對照:沒在飛的時候照印件數、鈕沒鎖(證明上面那格不是恆真)', () => {
    // 🛑 少了這一格,「永遠顯示套用中…」也會讓上面那格綠。
    render(<Harness open />);
    const btn = screen.getByRole('button', { name: '查看 128 件商品' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.className).not.toContain('is-loading');
    expect(screen.queryByText('套用中…')).toBeNull();
  });

  it('🔴 applying 要贏過 resultCount 為 null(撈不到 + 正在飛 ⇒ 印套用中, 不印失敗)', () => {
    // 📌 對稱格:`ProductsSortBar.test.tsx` 有同一格, 這裡缺 ⇒ code-reviewer 2026-09-06 nit 補。
    //    印「商品載入失敗」會讓客人以為壞了, 而其實只是還沒回來。
    render(<Harness open applying resultCount={null as unknown as number} />);
    expect(screen.getByText('套用中…')).toBeDefined();
    expect(screen.queryByText('商品載入失敗')).toBeNull();
  });

  it('🔵 applying 沒傳 = 舊行為逐字相同(預設 false, 呼叫端不必改)', () => {
    // 📌 這一格守的是「加一個 optional prop 不得改變任何既有呼叫端的行為」。
    render(<Harness open resultCount={7} />);
    expect(screen.getByText('查看 7 件商品')).toBeDefined();
  });
});
