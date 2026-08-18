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

import { useEffect, useState } from 'react';
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
      <div className="fd-drawer">
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
