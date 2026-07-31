// FilterSide.tsx — Variant B: Farfetch-style left sidebar
// Accordion sections, multi-level category tree, persistent
//
// 字面從 design-reference/components/FilterSide.jsx 直接搬(M-1-09):
// - jsx → tsx + props type
// - window.FilterSide UMD 註冊移除(改 ES export)
// - 樹展開 / 收合(expandedBrand / expandedModel / expanded / Accordion open)維持
//   各子元件 local useState(UI 導覽 state、不入 reducer)
// - className 字面完全不動
//
// 狀態管理(M-1-08 拍板 B 混合模式 → M-1-12a 改 controlled):
// - vehicle / category / brands 走 @pcm/ui cascadeFilterReducer;price / priceRange /
//   colors / inStock / isNew / isSale 收斂為 ProductExtraFilters(見 filter-state.ts)。
// - M-1-09~11 期間本元件自管上述 state;M-1-12a 起改 controlled —— cascade / dispatch /
//   extras / setExtras 一律由宿主(ProductsPage / dev-preview 頁)透過 props 傳入
//   (Sean 拍板狀態架構=方案 1、見 docs/recon/M-1-12-products-page-recon.md)。

'use client';

import { useRef, useState, type Dispatch, type ReactNode } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  toggleBrand,
  clearAll,
  type VehicleSelection,
  type CategorySelection,
  type CascadeFilterAction,
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
import { CategoryTree } from './FilterSideCategoryTree';
import type { MockBrand } from '@/data/mock-brands';

/** 未接 #306 取數時的預設:只用 server 帶下來的全站數(= #306 之前的行為)。 */
const SERVER_COUNTS_ONLY = makeFacetCountResolver(false, null);

export type FilterSideData = {
  motoBrands: MockMotoBrand[];
  categories: MockCategory[];
  brands: MockBrand[];
};

function Accordion({
  title,
  children,
  defaultOpen = false,
  count,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fs-section">
      <button className="fs-section-head" onClick={() => setOpen(!open)}>
        <span className="fs-section-title">{title}</span>
        {count != null && <span className="fs-section-count">({count})</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="fs-section-body">{children}</div>}
    </div>
  );
}

function VehicleTree({
  motoBrands,
  vehicle,
  dispatch,
}: {
  motoBrands: MockMotoBrand[];
  vehicle: VehicleSelection | null;
  dispatch: Dispatch<CascadeFilterAction>;
}) {
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  return (
    <div className="fs-tree">
      {motoBrands.map((b) => (
        <div key={b.id}>
          <button className="fs-tree-row fs-tree-l1"
            onClick={() => setExpandedBrand(expandedBrand === b.id ? null : b.id)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: expandedBrand === b.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span>{b.name}</span>
          </button>
          {expandedBrand === b.id && b.models.map((m) => (
            <div key={m.id}>
              <button className="fs-tree-row fs-tree-l2"
                onClick={() => setExpandedModel(expandedModel === m.id ? null : m.id)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ transform: expandedModel === m.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span>{m.name}</span>
              </button>
              {expandedModel === m.id && m.years.map((y) => (
                <button key={y}
                  className={`fs-tree-row fs-tree-l3 ${vehicle?.brand === b.name && vehicle?.model === m.name && vehicle?.year === y ? 'is-active' : ''}`}
                  onClick={() => {
                    dispatch(selectVehicleBrand(b.name));
                    dispatch(selectVehicleModel(m.name));
                    dispatch(selectVehicleYear(y));
                  }}>
                  <span>{y}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CheckboxList({
  items,
  selected,
  onToggle,
  countOf,
}: {
  items: { id: string; name: string; count?: number }[];
  selected: string[];
  onToggle: (id: string) => void;
  /** #306:未給 = 沿用各 item 自帶的 count(非品牌用途的呼叫端行為不變)。 */
  countOf?: FacetCountResolver;
}) {
  return (
    <div className="fs-cbx-list">
      {items.map((it) => {
        const checked = selected.includes(it.id);
        const count = countOf ? countOf('brands', it.id, it.count) : it.count ?? null;
        // 0 件的品牌一樣灰掉且點不下去(勾了只會得到空頁);已勾選的維持可操作、否則取消不掉。
        // 🔴 未傳 countOf 時完全不套用(泛用元件的預設行為不因 #306 而變)。
        const empty = countOf != null && count === 0 && !checked;
        return (
          <label key={it.id} className={`fs-cbx-row ${checked ? 'is-checked' : ''} ${empty ? 'is-empty' : ''}`}>
            <input type="checkbox" checked={checked} disabled={empty} onChange={() => onToggle(it.id)} />
            <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
            <span className="fs-cbx-name">{it.name}</span>
            {count !== null && <span className="fs-cbx-count">{count}</span>}
          </label>
        );
      })}
    </div>
  );
}

function PriceRangeSlider({
  value,
  onChange,
}: {
  value: [number, number] | undefined;
  onChange: (v: [number, number]) => void;
}) {
  const min = 0, max = 150000;
  const [lo, hi] = value || [min, max];
  return (
    <div className="fs-price">
      <div className="fs-price-readout">
        <span>NT$ {lo.toLocaleString()}</span>
        <span>NT$ {hi.toLocaleString()}</span>
      </div>
      <div className="fs-price-track">
        <div className="fs-price-fill" style={{
          left: `${(lo - min) / (max - min) * 100}%`,
          right: `${100 - (hi - min) / (max - min) * 100}%`,
        }} />
        <input type="range" min={min} max={max} step={500} value={lo}
          onChange={(e) => onChange([Math.min(+e.target.value, hi - 500), hi])} />
        <input type="range" min={min} max={max} step={500} value={hi}
          onChange={(e) => onChange([lo, Math.max(+e.target.value, lo + 500)])} />
      </div>
      <div className="fs-price-presets">
        <button onClick={() => onChange([0, 5000])}>&lt; 5K</button>
        <button onClick={() => onChange([5000, 20000])}>5K–20K</button>
        <button onClick={() => onChange([20000, 50000])}>20K–50K</button>
        <button onClick={() => onChange([50000, 150000])}>50K+</button>
      </div>
    </div>
  );
}

export function FilterSide({
  data,
  hideVehicle,
  hideCategory,
  hideBrand,
  hideColor,
  hidePromoFlags,
  cascade,
  dispatch,
  extras,
  setExtras,
  countOf = SERVER_COUNTS_ONLY,
}: {
  data: FilterSideData;
  hideVehicle?: boolean;
  /** #220-B1:真資料單一分類「碳纖維部品」、零件分類篩選無意義 → 結構性隱藏(視覺 Sean 後續 design skill 調) */
  hideCategory?: boolean;
  /** #220-B1:真資料單一品牌 RPM CARBON、選其他 chip 0 結果 → 隱藏品牌篩選(多品牌 #212 後再開、#220c) */
  hideBrand?: boolean;
  /** #220-B1:toUIProduct color 全 'silver'、顏色篩選 no-op → 隱藏 */
  hideColor?: boolean;
  /** #220-B1:toUIProduct isNew/isSale 全 false、新品/特價 toggle no-op → 隱藏。僅現貨另由 #161 /
   *  SHOW_IN_STOCK_FILTER=false 關著(非本旗標控);新品/特價 + 僅現貨皆空時「其他」段整段隱藏避空殼。 */
  hidePromoFlags?: boolean;
  /**
   * #306:每一格件數的解析器。**由宿主(ProductsPage)建立並下傳** —— 不在這裡自己用
   * `cascade.vehicle` 判斷有沒有車。
   * 🔴 理由(審查 M1):件數的輸入是 URL 的 `?vehicle=`,而 `cascade.vehicle` 是
   * post-hydration 才由 `useDeepLinkRestore` 還原的 ⇒ 兩者分屬不同時間軸。
   * 深連結/首頁選車進站時,SSR 與整段 hydration 期間 `cascade.vehicle` 還是 null,
   * 若在這裡自己判斷就會**先閃一次全站數**(2130 配 198 件列表)= #306 的病灶本身。
   * 未傳 = 只用 server 帶下來的全站數(dev-preview 等掛載點行為不變)。
   */
  countOf?: FacetCountResolver;
} & CascadeControlledProps & ExtrasControlledProps) {
  const clearAllFilters = () => {
    dispatch(clearAll());
    setExtras(makeInitialExtraFilters());
  };

  return (
    <aside className="fs-side">
      <div className="fs-side-head">
        <span>篩選條件</span>
        <button className="fs-clear" onClick={clearAllFilters}>清除全部</button>
      </div>

      {!hideVehicle && (
        <Accordion title="依車輛搜尋" defaultOpen={true}>
          <VehicleTree motoBrands={data.motoBrands} vehicle={cascade.vehicle} dispatch={dispatch} />
        </Accordion>
      )}

      {!hideCategory && (
        <Accordion title="零件分類" defaultOpen={true}>
          <CategoryTree
            categories={data.categories}
            category={cascade.category}
            dispatch={dispatch}
            countOf={countOf}
          />
        </Accordion>
      )}

      {!hideBrand && (
        <Accordion title="品牌" defaultOpen={false} count={data.brands.length}>
          <div className="fs-brand-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input placeholder="搜尋品牌" />
          </div>
          <CheckboxList
            countOf={countOf}
            items={data.brands}
            selected={cascade.brands}
            onToggle={(id) => dispatch(toggleBrand(id))}
          />
        </Accordion>
      )}

      <Accordion title="價格範圍">
        <PriceRangeSlider
          value={extras.priceRange}
          onChange={(v) => setExtras((e) => ({ ...e, priceRange: v }))}
        />
      </Accordion>

      {!hideColor && (
        <Accordion title="顏色">
          <div className="fs-colors">
            {[
              { id: 'black', name: '黑', hex: '#1a1a1a' },
              { id: 'silver', name: '銀', hex: '#c4c4c4' },
              { id: 'red', name: '紅', hex: '#dc2626' },
              { id: 'gold', name: '金', hex: '#c9a552' },
              { id: 'titanium', name: '鈦', hex: '#8a8578' },
              { id: 'blue', name: '藍', hex: '#2563eb' },
              { id: 'white', name: '白', hex: '#f4f4f5' },
            ].map((c) => {
              const on = extras.colors.includes(c.id);
              return (
                <button key={c.id} className={`fs-color ${on ? 'is-on' : ''}`}
                  onClick={() => setExtras((e) => ({
                    ...e,
                    colors: on ? e.colors.filter((x) => x !== c.id) : [...e.colors, c.id],
                  }))}
                  title={c.name}>
                  <span style={{ background: c.hex, border: c.id === 'white' ? '1px solid var(--c-border-strong)' : 'none' }} />
                  <span className="fs-color-name">{c.name}</span>
                </button>
              );
            })}
          </div>
        </Accordion>
      )}

      {/* #220-B1:其他 = 僅現貨(#161 Phase1 不顯庫存、SHOW_IN_STOCK_FILTER=false 關著)+ 新品/特價
          (toUIProduct 全 false、no-op);hidePromoFlags 隱藏新品/特價,兩者皆無內容時整段隱藏(避空殼)。 */}
      {(SHOW_IN_STOCK_FILTER || !hidePromoFlags) && (
        <Accordion title="其他">
          {SHOW_IN_STOCK_FILTER && (
            <label className={`fs-cbx-row ${extras.inStock ? 'is-checked' : ''}`}>
              <input type="checkbox" checked={extras.inStock} onChange={() => setExtras((e) => ({ ...e, inStock: !e.inStock }))} />
              <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
              <span className="fs-cbx-name">僅顯示現貨</span>
            </label>
          )}
          {!hidePromoFlags && (
            <>
              <label className={`fs-cbx-row ${extras.isNew ? 'is-checked' : ''}`}>
                <input type="checkbox" checked={extras.isNew} onChange={() => setExtras((e) => ({ ...e, isNew: !e.isNew }))} />
                <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                <span className="fs-cbx-name">新品</span>
              </label>
              <label className={`fs-cbx-row ${extras.isSale ? 'is-checked' : ''}`}>
                <input type="checkbox" checked={extras.isSale} onChange={() => setExtras((e) => ({ ...e, isSale: !e.isSale }))} />
                <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                <span className="fs-cbx-name">特價中</span>
              </label>
            </>
          )}
        </Accordion>
      )}
    </aside>
  );
}
