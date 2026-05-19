// FilterDrawer.tsx — Variant C: 全螢幕 / bottom-sheet 抽屜篩選器
// 手機優先;桌機亦可作 modal 使用。
//
// 字面從 design-reference/components/FilterDrawer.jsx 直接搬(M-1-11):
// - jsx → tsx + props type
// - React.useState / React.useEffect → import { useEffect, useReducer, useState }
// - window.FilterDrawer UMD 註冊移除(改 ES export)
// - 狀態管理 B 混合模式(M-1-08 拍板):vehicle / category / brands 接 @pcm/ui
//   cascadeFilterReducer;price / colors / inStock / isNew / isSale 由本元件 useState 自管
// - design 的 filters / setFilters props 來自尚未做的 ProductsPage(M-1-12)→ 比照
//   M-1-09 FilterSide / M-1-10 FilterTop 移除、改 reducer + 自管 useState
// - open / onClose / resultCount / initialTab 留成 prop(宿主控制抽屜開合 / 起始分頁;
//   resultCount 為外部資料、元件算不出。比照 CascadeFilterTop 留 onOpenDrawer)
// - 抽屜導覽 state(tab / vehBrand / vehModel / catMain)維持本元件 local useState
//   (UI 特異、不入 reducer)
// - className 字面完全不動
//
// 字面 vs 事實揭示:
// 1. design 用 lifted filters 物件 + setFilters spread;本實作 vehicle/category/brands
//    改 reducer + action、price/colors/flags 改 useState,語意等價、API 不同。
// 2. design fd-foot-clear 的 setFilters({ brands: [] }) 清整個 filters;本實作
//    clearAllFilters() = clearAll() + 重置自管 useState,等價(比照 FilterSide)。
// 3. 細項 toggle 比照 FilterSide:點 active sub → dispatch(clearCategory());
//    否則 dispatch(selectCategoryMain) + dispatch(selectCategorySub)。

'use client';

import { useEffect, useReducer, useState } from 'react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  toggleBrand,
  clearAll,
} from '@pcm/ui';
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
}: {
  open: boolean;
  onClose: () => void;
  data: FilterDrawerData;
  resultCount: number;
  initialTab?: DrawerTab;
}) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [price, setPrice] = useState<string | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [inStock, setInStock] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [isSale, setIsSale] = useState(false);

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
    (price ? 1 : 0) +
    (inStock ? 1 : 0) +
    (isNew ? 1 : 0) +
    (isSale ? 1 : 0) +
    colors.length;

  const tabs: { id: DrawerTab; label: string; count: number }[] = [
    { id: 'vehicle', label: '依車輛搜尋', count: cascade.vehicle ? 1 : 0 },
    { id: 'category', label: '零件分類', count: cascade.category ? 1 : 0 },
    { id: 'brand', label: '品牌', count: cascade.brands.length },
    { id: 'price', label: '價格', count: price ? 1 : 0 },
    { id: 'color', label: '顏色', count: colors.length },
    { id: 'other', label: '其他', count: (inStock ? 1 : 0) + (isNew ? 1 : 0) + (isSale ? 1 : 0) },
  ];

  const toggleColor = (id: string) => {
    setColors(colors.includes(id) ? colors.filter((x) => x !== id) : [...colors, id]);
  };

  const clearAllFilters = () => {
    dispatch(clearAll());
    setPrice(null);
    setColors([]);
    setInStock(false);
    setIsNew(false);
    setIsSale(false);
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
                    {data.categories.map((c) => (
                      <button key={c.id} className="fd-row" onClick={() => setCatMain(c)}>
                        <span>{c.name}</span>
                        <span className="fd-row-count">{c.count}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button className="fd-back" onClick={() => setCatMain(null)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                      {catMain.name}
                    </button>
                    <div className="fd-step-label">選擇細項</div>
                    <button className="fd-row"
                      onClick={() => dispatch(selectCategoryMain(catMain.id, catMain.name))}>
                      <span>全部 {catMain.name}</span>
                      <span className="fd-row-count">{catMain.count}</span>
                    </button>
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
                    className={`fd-row ${price === r ? 'is-active' : ''}`}
                    onClick={() => setPrice(price === r ? null : r)}>
                    <span>{r}</span>
                    {price === r && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>}
                  </button>
                ))}
              </div>
            )}

            {tab === 'color' && (
              <div className="fd-colors">
                {COLORS.map((c) => {
                  const on = colors.includes(c.id);
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
                <label className="fd-cbx">
                  <input type="checkbox" checked={inStock} onChange={() => setInStock(!inStock)} />
                  <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                  <span className="fd-cbx-name">僅顯示現貨</span>
                </label>
                <label className="fd-cbx">
                  <input type="checkbox" checked={isNew} onChange={() => setIsNew(!isNew)} />
                  <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                  <span className="fd-cbx-name">新品</span>
                </label>
                <label className="fd-cbx">
                  <input type="checkbox" checked={isSale} onChange={() => setIsSale(!isSale)} />
                  <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                  <span className="fd-cbx-name">特價中</span>
                </label>
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
