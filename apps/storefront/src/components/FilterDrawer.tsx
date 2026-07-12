// FilterDrawer.tsx — Variant C: 全螢幕 / bottom-sheet 抽屜篩選器
// 手機優先;桌機亦可作 modal 使用。
//
// 字面從 design-reference/components/FilterDrawer.jsx 直接搬(M-1-11):
// - jsx → tsx + props type
// - window.FilterDrawer UMD 註冊移除(改 ES export)
// - open / onClose / resultCount / initialTab 留成 prop(宿主控制抽屜開合 / 起始分頁)
// - 抽屜導覽 state(tab / vehBrand / vehModel / catMain)維持本元件 local useState
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

'use client';

import { useEffect, useState } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
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
import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockBrand } from '@/data/mock-brands';

export type FilterDrawerData = {
  motoBrands: MockMotoBrand[];
  categories: MockCategory[];
  brands: MockBrand[];
};

type DrawerTab = 'vehicle' | 'category' | 'brand' | 'price' | 'color' | 'other';

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
  hideCategory,
  hideBrand,
  hideColor,
  hidePromoFlags,
  cascade,
  dispatch,
  extras,
  setExtras,
}: {
  open: boolean;
  onClose: () => void;
  data: FilterDrawerData;
  resultCount: number;
  initialTab?: DrawerTab;
  /** #220-B1:真資料單一分類 → 隱藏「零件分類」tab(同 FilterSide hideCategory) */
  hideCategory?: boolean;
  /** #220-B1:真資料單一品牌 RPM CARBON → 隱藏「品牌」tab(#220c) */
  hideBrand?: boolean;
  /** #220-B1:toUIProduct color 全 silver → 隱藏「顏色」tab */
  hideColor?: boolean;
  /** #220-B1:toUIProduct isNew/isSale 全 false → 隱藏新品/特價(與 #161 關著的現貨皆空時整 tab 隱藏) */
  hidePromoFlags?: boolean;
} & CascadeControlledProps & ExtrasControlledProps) {
  const [tab, setTab] = useState<DrawerTab>(initialTab ?? 'vehicle');
  const [vehBrand, setVehBrand] = useState<MockMotoBrand | null>(null);
  const [vehModel, setVehModel] = useState<MockMotoModel | null>(null);
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

  const activeCount =
    (cascade.vehicle ? 1 : 0) +
    (cascade.category ? 1 : 0) +
    cascade.brands.length +
    (extras.price ? 1 : 0) +
    (extras.inStock ? 1 : 0) +
    (extras.isNew ? 1 : 0) +
    (extras.isSale ? 1 : 0) +
    extras.colors.length;

  // #220-B1:真資料單一分類/單一品牌 RPM CARBON/全 silver/無促銷 → 隱藏對應 tab(同 FilterSide;車種=#220b 留)。
  // 其他 tab = 現貨(#161 SHOW_IN_STOCK_FILTER=false 關著)+ 新品/特價(hidePromoFlags 隱);兩者皆空時整 tab 隱藏避空殼。
  const tabs: { id: DrawerTab; label: string; count: number }[] = [
    { id: 'vehicle', label: '依車輛搜尋', count: cascade.vehicle ? 1 : 0 },
    ...(hideCategory ? [] : [{ id: 'category' as DrawerTab, label: '零件分類', count: cascade.category ? 1 : 0 }]),
    ...(hideBrand ? [] : [{ id: 'brand' as DrawerTab, label: '品牌', count: cascade.brands.length }]),
    { id: 'price', label: '價格', count: extras.price ? 1 : 0 },
    ...(hideColor ? [] : [{ id: 'color' as DrawerTab, label: '顏色', count: extras.colors.length }]),
    ...(SHOW_IN_STOCK_FILTER || !hidePromoFlags
      ? [{ id: 'other' as DrawerTab, label: '其他', count: (extras.inStock ? 1 : 0) + (extras.isNew ? 1 : 0) + (extras.isSale ? 1 : 0) }]
      : []),
  ];

  const toggleColor = (id: string) => {
    setExtras((e) => ({
      ...e,
      colors: e.colors.includes(id) ? e.colors.filter((x) => x !== id) : [...e.colors, id],
    }));
  };

  const clearAllFilters = () => {
    dispatch(clearAll());
    setExtras(makeInitialExtraFilters());
  };

  const isYearActive = (y: number) =>
    !!cascade.vehicle &&
    cascade.vehicle.brand === vehBrand?.name &&
    cascade.vehicle.model === vehModel?.name &&
    cascade.vehicle.year === y;

  return (
    <>
      <div className="fd-overlay" onClick={onClose} />
      <div className="fd-drawer">
        <div className="fd-head">
          <div className="fd-head-title">篩選條件 {activeCount > 0 && <span className="fd-head-count">{activeCount}</span>}</div>
          <button className="fd-close" onClick={onClose} aria-label="close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="fd-body">
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
          <div className="fd-panel">
            {tab === 'vehicle' && (
              <div className="fd-veh">
                {!vehBrand ? (
                  <>
                    <div className="fd-step-label">選擇品牌</div>
                    {data.motoBrands.map((b) => (
                      <button key={b.id} className="fd-row"
                        onClick={() => setVehBrand(b)}>
                        <span>{b.name}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                      </button>
                    ))}
                  </>
                ) : !vehModel ? (
                  <>
                    <button className="fd-back" onClick={() => setVehBrand(null)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                      {vehBrand.name}
                    </button>
                    <div className="fd-step-label">選擇車型</div>
                    {vehBrand.models.map((m) => (
                      <button key={m.id} className="fd-row"
                        onClick={() => setVehModel(m)}>
                        <span>{m.name}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button className="fd-back" onClick={() => setVehModel(null)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                      {vehBrand.name} / {vehModel.name}
                    </button>
                    <div className="fd-step-label">選擇年份</div>
                    {vehModel.years.map((y) => (
                      <button key={y}
                        className={`fd-row ${isYearActive(y) ? 'is-active' : ''}`}
                        onClick={() => {
                          dispatch(selectVehicleBrand(vehBrand.name));
                          dispatch(selectVehicleModel(vehModel.name));
                          dispatch(selectVehicleYear(y));
                        }}>
                        <span>{y}</span>
                        {isYearActive(y) && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === 'category' && (
              <div className="fd-veh">
                {!catMain ? (
                  <>
                    <div className="fd-step-label">選擇大分類</div>
                    {data.categories.map((c) => {
                      // Sean 2026-07-13:點大類 = 直接篩「該大類全部」(即時套用);有子類則進入細項視圖細分,
                      //   取消原「進入後才有的『全部 {大類}』列」。切不同大類一次點擊即切換。
                      const isMainActive = cascade.category?.mainId === c.id;
                      const hasChildren = c.children.length > 0;
                      return (
                        <button key={c.id} className={`fd-row ${isMainActive ? 'is-active' : ''}`}
                          onClick={() => {
                            dispatch(selectCategoryMain(c.id, c.name));
                            if (hasChildren) setCatMain(c);
                          }}>
                          <span>{c.name}</span>
                          <span className="fd-row-count">{c.count}</span>
                          {hasChildren && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <button className="fd-back" onClick={() => setCatMain(null)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                      {catMain.name}
                    </button>
                    <div className="fd-step-label">選擇細項</div>
                    {/* 「全部 {大類}」列已移除:進入本視圖前點大類時即已篩全部(Sean 2026-07-13)。 */}
                    {catMain.children.map((s) => {
                      const active = cascade.category?.subId === s.id;
                      return (
                        <button key={s.id}
                          className={`fd-row ${active ? 'is-active' : ''}`}
                          onClick={() => {
                            if (active) {
                              dispatch(clearCategory());
                            } else {
                              dispatch(selectCategoryMain(catMain.id, catMain.name));
                              dispatch(selectCategorySub(s.id, s.name));
                            }
                          }}>
                          <span>{s.name}</span>
                          <span className="fd-row-count">{s.count}</span>
                          {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {tab === 'brand' && (
              <div>
                <div className="fd-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                  <input placeholder="搜尋品牌" />
                </div>
                {data.brands.map((b) => {
                  const checked = cascade.brands.includes(b.id);
                  return (
                    <label key={b.id} className={`fd-cbx ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => dispatch(toggleBrand(b.id))} />
                      <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                      <span className="fd-cbx-name">{b.name}</span>
                      <span className="fd-row-count">{b.count}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {tab === 'price' && (
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

            {tab === 'color' && (
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

            {tab === 'other' && (
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
            查看 {resultCount} 件商品
          </button>
        </div>
      </div>
    </>
  );
}
