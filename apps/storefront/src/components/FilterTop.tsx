// FilterTop.tsx — Variant A: Uniqlo 式頂部 chip + dropdown
// 篩選列 sticky 於 header 下方。點 chip → 下方展開 dropdown。
//
// 字面從 design-reference/components/FilterTop.jsx 直接搬(M-1-10):
// - jsx → tsx + props type
// - React.useState → import { useEffect, useReducer, useState }
// - window.FilterTop / window.CategoryPanel UMD 註冊移除(改 ES export)
// - 狀態管理 B 混合模式(M-1-08 拍板):vehicle / category / brands 接 @pcm/ui
//   cascadeFilterReducer;price / inStock 由本元件 useState 自管
// - design 的 filters / setFilters / onSortChange / sort props 來自尚未做的
//   ProductsPage(M-1-12)→ 比照 M-1-09 FilterSide 移除、元件自管:sort 改本元件
//   useState、resultCount 留成 prop(外部資料、元件算不出)
// - dropdown 導覽 state(open / vehBrand / vehModel / CategoryPanel main)維持各
//   元件 local useState(UI 特異、不入 reducer)
// - className 字面完全不動
// - design FilterTop.jsx 的 ActiveChips 不在 M-1-10 scope(非本元件依賴、ProductsPage
//   M-1-12 用)→ 不搬

'use client';

import { useEffect, useReducer, useState, type Dispatch } from 'react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  clearVehicle,
  clearCategory,
  toggleBrand,
  clearAll,
  type CategorySelection,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockBrand } from '@/data/mock-brands';

export type FilterTopData = {
  motoBrands: MockMotoBrand[];
  categories: MockCategory[];
  brands: MockBrand[];
};

type DropdownKey = 'vehicle' | 'category' | 'brand' | 'price';

const PRICE_RANGES = [
  { label: 'NT$ 0 – 3,000', v: '0-3000' },
  { label: 'NT$ 3,000 – 10,000', v: '3000-10000' },
  { label: 'NT$ 10,000 – 30,000', v: '10000-30000' },
  { label: 'NT$ 30,000 – 100,000', v: '30000-100000' },
  { label: 'NT$ 100,000 以上', v: '100000-' },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function FilterTop({ data, resultCount }: { data: FilterTopData; resultCount: number }) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [price, setPrice] = useState<string | null>(null);
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState('recommend');

  const [open, setOpen] = useState<DropdownKey | null>(null);
  const [vehBrand, setVehBrand] = useState<MockMotoBrand | null>(null);
  const [vehModel, setVehModel] = useState<MockMotoModel | null>(null);

  const close = () => setOpen(null);
  const toggle = (k: DropdownKey) => setOpen(open === k ? null : k);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const selectedVeh = () => {
    if (!cascade.vehicle) return '依車輛搜尋';
    const { brand, model, year } = cascade.vehicle;
    return [brand, model, year].filter(Boolean).join(' / ');
  };

  const selectedCat = () => {
    if (!cascade.category) return '零件分類';
    return cascade.category.sub || cascade.category.main;
  };

  const clearEverything = () => {
    dispatch(clearAll());
    setPrice(null);
    setInStock(false);
  };

  const hasAnyFilter =
    cascade.vehicle || cascade.category || cascade.brands.length || price || inStock;

  return (
    <>
      <div className="ft-bar">
        <div className="ft-bar-inner">
          <div className="ft-chips">
            <button className={`ft-chip ${cascade.vehicle ? 'is-selected' : ''} ${open === 'vehicle' ? 'is-open' : ''}`} onClick={() => toggle('vehicle')}>
              <span>{selectedVeh()}</span>
              <Chevron open={open === 'vehicle'} />
            </button>
            <button className={`ft-chip ${cascade.category ? 'is-selected' : ''} ${open === 'category' ? 'is-open' : ''}`} onClick={() => toggle('category')}>
              <span>{selectedCat()}</span>
              <Chevron open={open === 'category'} />
            </button>
            <button className={`ft-chip ${cascade.brands.length ? 'is-selected' : ''} ${open === 'brand' ? 'is-open' : ''}`} onClick={() => toggle('brand')}>
              <span>{cascade.brands.length ? `品牌 · ${cascade.brands.length}` : '品牌'}</span>
              <Chevron open={open === 'brand'} />
            </button>
            <button className={`ft-chip ${price ? 'is-selected' : ''} ${open === 'price' ? 'is-open' : ''}`} onClick={() => toggle('price')}>
              <span>{price || '價格'}</span>
              <Chevron open={open === 'price'} />
            </button>
            <button className={`ft-chip ${inStock ? 'is-selected' : ''}`} onClick={() => setInStock(!inStock)}>
              <span>僅顯示現貨</span>
              {inStock && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
            </button>
          </div>
          <div className="ft-right">
            <span className="ft-count">{resultCount} 件商品</span>
            <div className="ft-divider" />
            <select className="ft-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recommend">推薦排序</option>
              <option value="new">最新上架</option>
              <option value="price-asc">價格低到高</option>
              <option value="price-desc">價格高到低</option>
              <option value="sale">折扣優先</option>
            </select>
          </div>
        </div>

        {/* Dropdown panel */}
        {open && (
          <>
            <div className="ft-overlay" onClick={close} />
            <div className="ft-dropdown">
              {open === 'vehicle' && (
                <div className="ft-veh">
                  <div className="ft-veh-col">
                    <div className="ft-col-head">品牌</div>
                    <div className="ft-col-body">
                      {data.motoBrands.map((b) => (
                        <button key={b.id}
                          className={`ft-col-row ${vehBrand?.id === b.id ? 'is-active' : ''}`}
                          onClick={() => { setVehBrand(b); setVehModel(null); }}>
                          <span>{b.name}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ft-veh-col">
                    <div className="ft-col-head">車型</div>
                    <div className="ft-col-body">
                      {vehBrand ? vehBrand.models.map((m) => (
                        <button key={m.id}
                          className={`ft-col-row ${vehModel?.id === m.id ? 'is-active' : ''}`}
                          onClick={() => setVehModel(m)}>
                          <span>{m.name}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                      )) : <div className="ft-col-empty">請先選擇品牌</div>}
                    </div>
                  </div>
                  <div className="ft-veh-col">
                    <div className="ft-col-head">年份</div>
                    <div className="ft-col-body">
                      {vehModel ? vehModel.years.map((y) => (
                        <button key={y}
                          className="ft-col-row"
                          onClick={() => {
                            if (!vehBrand || !vehModel) return;
                            dispatch(selectVehicleBrand(vehBrand.name));
                            dispatch(selectVehicleModel(vehModel.name));
                            dispatch(selectVehicleYear(y));
                            close();
                          }}>
                          <span>{y}</span>
                        </button>
                      )) : <div className="ft-col-empty">請先選擇車型</div>}
                    </div>
                  </div>
                </div>
              )}

              {open === 'category' && (
                <CategoryPanel data={data} category={cascade.category} dispatch={dispatch} onDone={close} />
              )}

              {open === 'brand' && (
                <div className="ft-brands">
                  {data.brands.map((b) => {
                    const checked = cascade.brands.includes(b.id);
                    return (
                      <label key={b.id} className={`ft-brand-row ${checked ? 'is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => dispatch(toggleBrand(b.id))}
                        />
                        <span className="ft-cbx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg></span>
                        <span className="ft-brand-name">{b.name}</span>
                        <span className="ft-brand-count">{b.count}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {open === 'price' && (
                <div className="ft-price">
                  {PRICE_RANGES.map((r) => (
                    <button key={r.v}
                      className={`ft-price-row ${price === r.label ? 'is-active' : ''}`}
                      onClick={() => { setPrice(r.label); close(); }}>
                      {r.label}
                    </button>
                  ))}
                  <div className="ft-price-custom">
                    <input placeholder="最低" /><span>—</span><input placeholder="最高" />
                    <button className="ft-apply">套用</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Active filter pills */}
      {hasAnyFilter && (
        <div className="ft-pills">
          <div className="ft-bar-inner">
            {cascade.vehicle && (
              <span className="ft-pill">{selectedVeh()}
                <button onClick={() => dispatch(clearVehicle())}>×</button>
              </span>
            )}
            {cascade.category && (
              <span className="ft-pill">{selectedCat()}
                <button onClick={() => dispatch(clearCategory())}>×</button>
              </span>
            )}
            {cascade.brands.map((bid) => {
              const brand = data.brands.find((x) => x.id === bid);
              return (
                <span key={bid} className="ft-pill">{brand?.name}
                  <button onClick={() => dispatch(toggleBrand(bid))}>×</button>
                </span>
              );
            })}
            {price && (
              <span className="ft-pill">{price}
                <button onClick={() => setPrice(null)}>×</button>
              </span>
            )}
            {inStock && (
              <span className="ft-pill">現貨
                <button onClick={() => setInStock(false)}>×</button>
              </span>
            )}
            <button className="ft-clear" onClick={clearEverything}>清除全部</button>
          </div>
        </div>
      )}
    </>
  );
}

// Shared category panel (3-col drill down)
function CategoryPanel({
  data,
  category,
  dispatch,
  onDone,
}: {
  data: FilterTopData;
  category: CategorySelection | null;
  dispatch: Dispatch<CascadeFilterAction>;
  onDone: () => void;
}) {
  const [main, setMain] = useState<MockCategory | null>(
    category?.mainId ? data.categories.find((c) => c.id === category.mainId) ?? null : null,
  );
  return (
    <div className="ft-veh">
      <div className="ft-veh-col">
        <div className="ft-col-head">大分類</div>
        <div className="ft-col-body">
          {data.categories.map((c) => (
            <button key={c.id}
              className={`ft-col-row ${main?.id === c.id ? 'is-active' : ''}`}
              onClick={() => setMain(c)}>
              <span>{c.name}</span>
              <span style={{ color: 'var(--c-text-3)', fontSize: 12, marginRight: 8 }}>{c.count}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          ))}
        </div>
      </div>
      <div className="ft-veh-col ft-veh-col-wide">
        <div className="ft-col-head">細項</div>
        <div className="ft-col-body">
          {main ? (
            <>
              <button className="ft-col-row"
                onClick={() => { dispatch(selectCategoryMain(main.id, main.name)); onDone(); }}>
                <span>全部 {main.name} <span style={{ color: 'var(--c-text-3)' }}>({main.count})</span></span>
              </button>
              {main.children.map((s) => (
                <button key={s.id} className="ft-col-row"
                  onClick={() => {
                    dispatch(selectCategoryMain(main.id, main.name));
                    dispatch(selectCategorySub(s.id, s.name));
                    onDone();
                  }}>
                  <span>{s.name}</span>
                  <span style={{ color: 'var(--c-text-3)', fontSize: 12 }}>{s.count}</span>
                </button>
              ))}
            </>
          ) : <div className="ft-col-empty">請先選擇大分類</div>}
        </div>
      </div>
    </div>
  );
}
