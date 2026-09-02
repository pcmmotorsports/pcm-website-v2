// FilterDrawer.tsx — Variant C: 全螢幕 / bottom-sheet 抽屜篩選器
// 手機優先;桌機亦可作 modal 使用。
//
// 字面從 design-reference/components/FilterDrawer.jsx 直接搬(M-1-11):
// - jsx → tsx + props type
// - window.FilterDrawer UMD 註冊移除(改 ES export)
// - open / onClose / resultCount / initialTab 留成 prop(宿主控制抽屜開合 / 起始分頁)
// - 抽屜導覽 state(tab / catMain)維持本元件 local useState;車輛 tab(vehBrand/vehModel drill+
//   V-1b2 打字快速找車)抽出 FilterDrawerVehicleTab(鐵則 6:本檔加料會破 400 行)
//   (UI 特異、不入 reducer)
// - className 字面完全不動
//
// 狀態管理(M-1-08 拍板 B 混合模式 → M-1-12a 改 controlled):
// - vehicle / category / brands 走 @pcm/ui cascadeFilterReducer;price / colors /
//   inStock / isNew / isSale 收斂為 ProductExtraFilters(見 filter-state.ts)。
// - M-1-11 期間本元件自管上述 state;M-1-12a 起改 controlled —— cascade / dispatch /
//   extras / setExtras 一律由宿主(ProductsPage / dev-preview 頁)透過 props 傳入
//   (Sean 拍板狀態架構=方案 1、見 docs/recon/M-1-12-products-page-recon.md)。
//
// 字面 vs 事實揭示:
// 1. design 用 lifted filters 物件 + setFilters spread;本實作 vehicle/category/brands
//    走 reducer + action、price/colors/flags 走 ProductExtraFilters,語意等價、API 不同。
// 2. design fd-foot-clear 的 setFilters({ brands: [] }) 清整個 filters;本實作
//    clearAllFilters() = clearAll() + setExtras(makeInitialExtraFilters()),等價。
// 3. 細項 toggle 比照 FilterSide:點 active sub → clearCategory();否則
//    selectCategoryMain + selectCategorySub。
//
// 2026-07-30 ADR-0007(手機決定 7/8):新增 `scope` —— 手機把「分類」與「商品篩選」拆成
// 兩個獨立入口,而**商品篩選不得再放選車**(選車已是自己的面板 MobileVehicleSheet)。
//   scope='all'(預設)= 現行全 tab 行為,`/dev-preview/filter-drawer` 靠它、不得改動。
//   scope='category'  = 只有零件分類(單一責任 ⇒ 不渲染 tab 列)、清除只清分類。
//   scope='product'   = 只有商品條件(品牌/價格/顏色/其他)、清除不動車輛與分類。
// 🔴 可見 tab 與實際渲染的 panel 綁同一份 `tabs`(activeTab 回退機制):否則 `tab` state
//    停在 scope 外的值時(例:換 scope 前選過 vehicle)會把選車面板漏進商品篩選。

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  toggleBrand,
  clearAll,
} from '@pcm/ui';
import {
  SHOW_IN_STOCK_FILTER,
  makeInitialExtraFilters,
  type CascadeControlledProps,
  type ExtrasControlledProps,
} from './filter-state';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import { makeFacetCountResolver, type FacetCountResolver } from '@/lib/vehicle-facet-display';

/** 未接 #306 取數時的預設:只用 server 帶下來的全站數(= #306 之前的行為)。 */
const SERVER_COUNTS_ONLY = makeFacetCountResolver(false, null);
import { FilterDrawerVehicleTab } from './FilterDrawerVehicleTab';
import { FilterDrawerCategoryTab } from './FilterDrawerCategoryTab';
import type { MockBrand } from '@/data/mock-brands';
import type { GarageChipItem } from './GarageChips';

export type FilterDrawerData = {
  motoBrands: MockMotoBrand[];
  categories: MockCategory[];
  brands: MockBrand[];
};

type DrawerTab = 'vehicle' | 'category' | 'brand' | 'price' | 'color' | 'other';

/** ADR-0007:抽屜責任範圍。null=不限制(現行全 tab)。 */
type DrawerScope = 'all' | 'category' | 'product';

const SCOPE_TABS: Record<DrawerScope, readonly DrawerTab[] | null> = {
  all: null,
  category: ['category'],
  // 🔴 刻意不含 'vehicle' 與 'category':Sean 拍板「商品篩選只處理品牌、價格等商品條件」。
  product: ['brand', 'price', 'color', 'other'],
};

const SCOPE_TITLE: Record<DrawerScope, string> = {
  all: '篩選條件',
  category: '選擇商品分類',
  product: '篩選商品',
};

const PRICE_RANGES = [
  'NT$ 0 – 3,000',
  'NT$ 3,000 – 10,000',
  'NT$ 10,000 – 30,000',
  'NT$ 30,000 – 100,000',
  'NT$ 100,000 以上',
];

const COLORS = [
  { id: 'black', name: '黑', hex: '#1a1a1a' },
  { id: 'silver', name: '銀', hex: '#c4c4c4' },
  { id: 'red', name: '紅', hex: '#dc2626' },
  { id: 'gold', name: '金', hex: '#c9a552' },
  { id: 'titanium', name: '鈦', hex: '#8a8578' },
  { id: 'blue', name: '藍', hex: '#2563eb' },
];

export function FilterDrawer({
  open,
  onClose,
  data,
  resultCount,
  initialTab,
  scope = 'all',
  hideCategory,
  hideBrand,
  hideColor,
  hidePromoFlags,
  cascade,
  dispatch,
  extras,
  setExtras,
  garage = [],
  countOf = SERVER_COUNTS_ONLY,
}: {
  open: boolean;
  onClose: () => void;
  data: FilterDrawerData;
  resultCount: number | null;   // null = 撈不到，不是 0 件
  initialTab?: DrawerTab;
  /** ADR-0007 責任分離:'all'=現行全 tab;'category'=只有分類;'product'=只有商品條件(無選車)。 */
  scope?: DrawerScope;
  /** V-1e:登入會員愛車 chips(手機車輛 tab 內「我的愛車」鈕;未登入/失敗=[]、不顯示) */
  garage?: GarageChipItem[];
  /** #220-B1:真資料單一分類 → 隱藏「零件分類」tab(同 FilterSide hideCategory) */
  hideCategory?: boolean;
  /** #220-B1:真資料單一品牌 RPM CARBON → 隱藏「品牌」tab(#220c) */
  hideBrand?: boolean;
  /** #220-B1:toUIProduct color 全 silver → 隱藏「顏色」tab */
  hideColor?: boolean;
  /** #220-B1:toUIProduct isNew/isSale 全 false → 隱藏新品/特價(與 #161 關著的現貨皆空時整 tab 隱藏) */
  hidePromoFlags?: boolean;
  /** #306:件數解析器,由宿主建立下傳(理由見 FilterSide 同名 prop 的註解 —— 審查 M1)。 */
  countOf?: FacetCountResolver;
} & CascadeControlledProps & ExtrasControlledProps) {
  const [tab, setTab] = useState<DrawerTab>(
    initialTab ?? (scope === 'category' ? 'category' : scope === 'product' ? 'brand' : 'vehicle'),
  );
  const [catMain, setCatMain] = useState<MockCategory | null>(null);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  /**
   * ⟦fc-FOCUSTRAP⟧ **Tab 在抽屜內循環**(2026-09-02)。
   *
   * 🔴 **為什麼這一片存在**:抽屜是 `position:fixed; inset:0` 的全屏層,而它**沒有把背景關起來**
   *    ⇒ 客人用鍵盤時,Tab 會走出抽屜、落到背後的導覽列 / 會員 / 購物車 / 頁尾。
   * 🔬 真瀏覽器實測基線(`-fc` 2026-09-02,同族的 `.pd-lightbox`):
   *    全頁 **52** 個可聚焦元素,而那個全屏層裡只有 **1** 個 ⇒ **背景 51 個全部 Tab 得到**;
   *    且開啟當下 `document.activeElement` 還是 `BODY` ⇒ **它根本沒有把焦點移進來**。
   *
   * 🔵 **做法照抄 `MobileMenu.tsx:127-141`,不發明第二種** —— 而那支自己逐字寫著這一片:
   *    「只做『Tab 在面板內循環』,**不加背景 inert(相容性未逐一驗證、範圍留給獨立片評估)**」。
   *
   * 🛑🛑 **而【為什麼不是 `inert`】要寫清楚,因為那才是這一刀真正的理由**:
   *    `inert` 是更正確的做法(它同時擋掉螢幕閱讀器),而 🔴 **jsdom 對它零判別力** ——
   *    `-fc` 2026-09-02 拋棄式探針實測:設 `inert` 前後 `focus()` **都成功**
   *    (`worldA=true` / `worldB=true` / `discriminates=**false**`)
   *    ⇒ ⇒ **走 `inert` 那條路的產出會是:動了全站共用容器(鐵則 12 ⑥),換到一格【證不到任何事】的綠。**
   *    ✅ 而 Tab 循環 jsdom **量得到**(同日探針:`discriminates=**true**`)⇒ **它的綠是真的。**
   *    ⇒ 📌 所以這不是「選比較小的那條」,是【唯一一條驗得起來的】。
   *
   * ⚠️ **而它不是等價物,不要讀成等價物**:
   *    循環擋得住【Tab 走出去】,**擋不住【螢幕閱讀器讀到背景】**。
   *    ⇒ `inert` 那一半(含 layout 那一層)另開一列,**是被正確地延後,不是被放棄**。
   */
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    /**
     * 🔴🔴 **開啟時把焦點移進來 —— 而它是循環的【前提】,不是第三件事。**
     * 不做它 ⇒ 焦點留在 `BODY`(`-fc` 2026-09-02 在同族的 `.pd-lightbox` 上實測到的正是這個)
     * ⇒ 客人按第一下 Tab 是從**整頁最上面**開始走 ⇒ 要走完背景才進得來
     * ⇒ ⇒ **循環要等 30 下才生效 = 等於沒做。**
     */
    drawerRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      /**
       * 🔴🔴 **Escape —— 而它是「把焦點關起來」這個承諾的另一半。**
       * 焦點被關在裡面 ⇒ **就必須有一條出去的路**;只做循環而不做 Escape
       * = 我們親手把客人關進去了。⇒ 那是這一片唯一一格【新增的傷害】,不是加碼。
       */
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = drawerRef.current;
      if (!panel) return;
      // 選擇器與 MobileMenu 同形;`:not([disabled])` 少了它,一顆 disabled 的鈕會變成循環的端點。
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // 🔴 `onClose` 進了依賴 —— 宿主若每次 render 都給新的函式,這個 effect 會重掛。
    //    重掛本身無害(listener 先移除再加),而**焦點移入那一行也會跟著再跑一次** ⇒
    //    客人打到一半焦點被搶回關閉鈕。⇒ 若日後看到那個症狀,病灶在這裡,不在鍵盤處理。
  }, [open, onClose]);

  if (!open) return null;

  const productFilterCount =
    cascade.brands.length +
    (extras.price ? 1 : 0) +
    (extras.inStock ? 1 : 0) +
    (extras.isNew ? 1 : 0) +
    (extras.isSale ? 1 : 0) +
    extras.colors.length;
  // ADR-0007:scope='product' 的計數不含車輛與分類(它們不在這個面板的責任內)。
  const activeCount =
    scope === 'product'
      ? productFilterCount
      : productFilterCount + (cascade.vehicle ? 1 : 0) + (cascade.category ? 1 : 0);

  // #220-B1:真資料單一分類/單一品牌 RPM CARBON/全 silver/無促銷 → 隱藏對應 tab(同 FilterSide;車種=#220b 留)。
  // 其他 tab = 現貨(#161 SHOW_IN_STOCK_FILTER=false 關著)+ 新品/特價(hidePromoFlags 隱);兩者皆空時整 tab 隱藏避空殼。
  const allTabs: { id: DrawerTab; label: string; count: number }[] = [
    { id: 'vehicle', label: '選擇車款', count: cascade.vehicle ? 1 : 0 },
    ...(hideCategory ? [] : [{ id: 'category' as DrawerTab, label: '零件分類', count: cascade.category ? 1 : 0 }]),
    ...(hideBrand ? [] : [{ id: 'brand' as DrawerTab, label: '品牌', count: cascade.brands.length }]),
    { id: 'price', label: '價格', count: extras.price ? 1 : 0 },
    ...(hideColor ? [] : [{ id: 'color' as DrawerTab, label: '顏色', count: extras.colors.length }]),
    ...(SHOW_IN_STOCK_FILTER || !hidePromoFlags
      ? [{ id: 'other' as DrawerTab, label: '其他', count: (extras.inStock ? 1 : 0) + (extras.isNew ? 1 : 0) + (extras.isSale ? 1 : 0) }]
      : []),
  ];
  // ADR-0007:scope 白名單過濾。scope 內只剩 1 個 tab 時不渲染 tab 列(單一責任面板)。
  const scopeTabs = SCOPE_TABS[scope];
  const tabs = scopeTabs === null ? allTabs : allTabs.filter((t) => scopeTabs.includes(t.id));
  // 🔴 渲染哪個 panel 一律由 `tabs` 決定:`tab` state 若落在 scope 之外(例:預設值 'brand'
  //    卻 hideBrand、或日後有人重用同一個 instance 換 scope)就回退到第一個合法 tab、
  //    絕不渲染 scope 外的 panel(否則選車會漏進商品篩選)。
  const activeTab: DrawerTab | null =
    tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? null);

  const toggleColor = (id: string) => {
    setExtras((e) => ({
      ...e,
      colors: e.colors.includes(id) ? e.colors.filter((x) => x !== id) : [...e.colors, id],
    }));
  };

  // ADR-0007:清除的作用範圍必須等於面板的責任範圍。
  // 🔴 分類面板按「清除」不得連坐清掉客人的車(那是選車面板的「清除車輛」才做的事);
  //    商品篩選面板同理只清品牌+價格等商品條件。
  const clearAllFilters = () => {
    if (scope === 'category') {
      dispatch(clearCategory());
      return;
    }
    if (scope === 'product') {
      // reducer 無 brands/clear action ⇒ 用既有 toggle 逐一移除(全部都在選中態)
      for (const brandId of cascade.brands) dispatch(toggleBrand(brandId));
      setExtras(makeInitialExtraFilters());
      return;
    }
    dispatch(clearAll());
    setExtras(makeInitialExtraFilters());
  };

  return (
    <>
      <div className="fd-overlay" onClick={onClose} />
      {/* ⟦fc-FOCUSTRAP⟧ ref 掛在 `.fd-drawer` 而**不是** `.fd-overlay` ——
          overlay 是那塊點了會關閉的背板、裡面零個可聚焦元素;
          循環要在【有東西可以按的那一塊】裡面繞。 */}
      <div className="fd-drawer" ref={drawerRef}>
        <div className="fd-head">
          <div className="fd-head-title">
            {SCOPE_TITLE[scope]}
            {scope !== 'category' && activeCount > 0 && (
              <span className="fd-head-count">{activeCount}</span>
            )}
          </div>
          <button className="fd-close" onClick={onClose} aria-label="close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="fd-body">
          {tabs.length > 1 && (
          <div className="fd-tabs">
            {tabs.map((t) => (
              <button key={t.id}
                className={`fd-tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}>
                <span>{t.label}</span>
                {t.count > 0 && <span className="fd-tab-dot">{t.count}</span>}
              </button>
            ))}
          </div>
          )}
          <div className="fd-panel">
            {activeTab === 'vehicle' && (
              <FilterDrawerVehicleTab
                motoBrands={data.motoBrands}
                cascade={cascade}
                dispatch={dispatch}
                garage={garage}
              />
            )}

            {activeTab === 'category' && (
              <FilterDrawerCategoryTab
                categories={data.categories}
                cascade={cascade}
                dispatch={dispatch}
                countOf={countOf}
                catMain={catMain}
                setCatMain={setCatMain}
              />
            )}

            {activeTab === 'brand' && (
              <div>
                <div className="fd-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                  <input placeholder="搜尋品牌" />
                </div>
                {data.brands.map((b) => {
                  const checked = cascade.brands.includes(b.id);
                  const brandCount = countOf('brands', b.id, b.count);
                  // 已勾選的維持可操作,否則取消不掉
                  const empty = brandCount === 0 && !checked;

                  return (
                    <label key={b.id} className={`fd-cbx ${checked ? 'is-checked' : ''} ${empty ? 'is-empty' : ''}`}>
                      <input type="checkbox" checked={checked} disabled={empty} onChange={() => dispatch(toggleBrand(b.id))} />
                      <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                      <span className="fd-cbx-name">{b.name}</span>
                      {brandCount !== null && <span className="fd-row-count">{brandCount}</span>}
                    </label>
                  );
                })}
              </div>
            )}

            {activeTab === 'price' && (
              <div style={{ padding: 16 }}>
                {PRICE_RANGES.map((r) => (
                  <button key={r}
                    className={`fd-row ${extras.price === r ? 'is-active' : ''}`}
                    onClick={() => setExtras((e) => ({ ...e, price: e.price === r ? null : r }))}>
                    <span>{r}</span>
                    {extras.price === r && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'color' && (
              <div className="fd-colors">
                {COLORS.map((c) => {
                  const on = extras.colors.includes(c.id);
                  return (
                    <button key={c.id} className={`fd-color ${on ? 'is-on' : ''}`}
                      onClick={() => toggleColor(c.id)}>
                      <span style={{ background: c.hex }} />
                      <span className="fd-color-name">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'other' && (
              <div>
                {SHOW_IN_STOCK_FILTER && (
                  <label className={`fd-cbx ${extras.inStock ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={extras.inStock} onChange={() => setExtras((e) => ({ ...e, inStock: !e.inStock }))} />
                    <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                    <span className="fd-cbx-name">僅顯示現貨</span>
                  </label>
                )}
                {!hidePromoFlags && (
                  <>
                    <label className={`fd-cbx ${extras.isNew ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={extras.isNew} onChange={() => setExtras((e) => ({ ...e, isNew: !e.isNew }))} />
                      <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                      <span className="fd-cbx-name">新品</span>
                    </label>
                    <label className={`fd-cbx ${extras.isSale ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={extras.isSale} onChange={() => setExtras((e) => ({ ...e, isSale: !e.isSale }))} />
                      <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                      <span className="fd-cbx-name">特價中</span>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="fd-foot">
          <button className="fd-foot-clear" onClick={clearAllFilters}>清除</button>
          <button className="fd-foot-apply" onClick={onClose}>
            {/* 🔴 null 態的字面與桌機 `.pp-count` 刻意【不同】(codex 關卡2 nit):
                桌機那句旁邊就有「載入失敗、請稍後再試」當上下文;而這顆鈕在手機是【覆蓋整個畫面】的抽屜裡,
                客人看不到那句 ⇒ 只寫「件數未能載入」會讓他以為只有計數壞了、商品還逛得到。 */}
            {resultCount === null ? '商品載入失敗' : `查看 ${resultCount} 件商品`}
          </button>
        </div>
      </div>
    </>
  );
}
