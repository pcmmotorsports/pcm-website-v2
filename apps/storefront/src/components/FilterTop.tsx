// FilterTop.tsx — Variant A: Uniqlo 式頂部 chip + dropdown
// 篩選列 sticky 於 header 下方。點 chip → 下方展開 dropdown。
//
// 字面從 design-reference/components/FilterTop.jsx 直接搬(M-1-10):
// - jsx → tsx + props type
// - window.FilterTop / window.CategoryPanel UMD 註冊移除(改 ES export)
// - dropdown 導覽 state(open / vehBrand / vehModel / CategoryPanel main)維持各
//   元件 local useState(UI 特異、不入 reducer)
// - className 字面完全不動
// - design FilterTop.jsx 的 ActiveChips 不在本元件 scope(ProductsPage M-1-12 用)→ 不搬
//
// 狀態管理(M-1-08 拍板 B 混合模式 → M-1-12a 改 controlled):
// - vehicle / category / brands 走 @pcm/ui cascadeFilterReducer;price / inStock
//   收斂進 ProductExtraFilters(見 filter-state.ts);sort 為排序、由宿主獨立持有。
// - M-1-10 期間本元件自管上述 state;M-1-12a 起改 controlled —— cascade / dispatch /
//   extras / setExtras / sort / setSort 一律由宿主透過 props 傳入
//   (Sean 拍板狀態架構=方案 1、見 docs/recon/M-1-12-products-page-recon.md)。

'use client';

import { useEffect, useState, type Dispatch } from 'react';
import {
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
import {
  SHOW_IN_STOCK_FILTER,
  makeInitialExtraFilters,
  type CascadeControlledProps,
  type ExtrasControlledProps,
} from './filter-state';
import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockBrand } from '@/data/mock-brands';

export type FilterTopData = {
  motoBrands: MockMotoBrand[];
  categories: MockCategory[];
  brands: MockBrand[];
};


/**
 * 價格輸入框 → 非負整數,或 `null`(空白 / 非數字 / 負數 / 小數)。
 *
 * 判準刻意與網址回程那支對齊(`lib/catalog-query.ts:130` `parseNonNegativeInteger`):
 * 只認非負整數。兩邊不一致的話,會出現「打得進去、重整就不見」。
 */
function parsePriceInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

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

export function FilterTop({
  data,
  resultCount,
  cascade,
  dispatch,
  extras,
  setExtras,
  sort,
  setSort,
}: {
  data: FilterTopData;
  resultCount: number | null;   // null = 撈不到，不是 0 件
  sort: string;
  setSort: (value: string) => void;
} & CascadeControlledProps & ExtrasControlledProps) {
  const [open, setOpen] = useState<DropdownKey | null>(null);
  const [vehBrand, setVehBrand] = useState<MockMotoBrand | null>(null);
  const [vehModel, setVehModel] = useState<MockMotoModel | null>(null);
  // 自訂價格區間的兩個輸入框:UI 特異、不入 reducer(同本檔檔頭 dropdown 導覽 state 的處置)。
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

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
    setExtras(makeInitialExtraFilters());
    setPriceMin('');
    setPriceMax('');
  };

  /**
   * 自訂價格區間「套用」。
   *
   * 🔴 **寫進 `priceRange` 而不是 `price`**:`price` 是**字串標籤**,只有
   * `PRICE_RANGE_TABLE`(`products-filter-logic.ts:21`)那五個 key 認得
   * (`'NT$ 0 – 3,000'` 那種)。自由輸入生不出合法 key ⇒ 會落進 `?? [0, Infinity]`
   * = **靜靜地不篩**,而畫面上看起來像篩過了。
   *
   * 🔴 **同時把 `price` 清成 null**:`products-filter-logic.ts:102` 與 `:106` 是
   * **兩條獨立的 if**,兩個都設會 AND 疊加;而 UI 上預設列與自訂區間看起來是
   * 同一個「價格」篩選器 ⇒ 疊加的結果是「篩不到東西」,客人只會以為沒貨。
   * ⇒ 自訂區間**取代**預設列,同預設列彼此互相取代的行為。
   *
   * 🔴 **上限用 `Number.MAX_SAFE_INTEGER` 而不是 `Infinity`**:網址同步會寫
   * `pmax=String(...)`(`use-catalog-filter-url-sync.tsx:182`),而回程的
   * `parseNonNegativeInteger`(`lib/catalog-query.ts:130-139`)要求 `Number.isInteger`
   * —— `Infinity` 不是整數 ⇒ **重整之後上限會安靜消失**。`MAX_SAFE_INTEGER` 過得了那道檢查。
   */
  const applyCustomPrice = () => {
    const lo = parsePriceInput(priceMin);
    const hi = parsePriceInput(priceMax);
    if (lo === null && hi === null) {
      // 兩格都空 = 取消自訂區間,不是「篩 0 元以上」。
      setExtras((e) => ({ ...e, priceRange: undefined }));
      close();
      return;
    }
    // 打反了就對調,不要讓他得到一個必然為空的結果。
    const a = lo ?? 0;
    const b = hi ?? Number.MAX_SAFE_INTEGER;
    const range: [number, number] = a <= b ? [a, b] : [b, a];
    setExtras((e) => ({ ...e, price: null, priceRange: range }));
    close();
  };

  const hasAnyFilter =
    cascade.vehicle || cascade.category || cascade.brands.length || extras.price || extras.inStock;

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
            <button className={`ft-chip ${extras.price ? 'is-selected' : ''} ${open === 'price' ? 'is-open' : ''}`} onClick={() => toggle('price')}>
              <span>{extras.price || '價格'}</span>
              <Chevron open={open === 'price'} />
            </button>
            {SHOW_IN_STOCK_FILTER && (
              <button className={`ft-chip ${extras.inStock ? 'is-selected' : ''}`} onClick={() => setExtras((e) => ({ ...e, inStock: !e.inStock }))}>
                <span>僅顯示現貨</span>
                {extras.inStock && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
              </button>
            )}
          </div>
          <div className="ft-right">
            <span className="ft-count">{resultCount === null ? '件數未能載入' : `${resultCount} 件商品`}</span>
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
                      className={`ft-price-row ${extras.price === r.label ? 'is-active' : ''}`}
                      onClick={() => { setExtras((e) => ({ ...e, price: r.label })); close(); }}>
                      {r.label}
                    </button>
                  ))}
                  {/* 🔴🔴 **這一格是死的,而它正在正式站上**(2026-08-19 G1 量到、純標註零行為改動)。
                        兩個 `<input>` 沒有 `value` / `onChange` / `name` / `ref`;`<button>` 沒有 `onClick`;
                        同檔沒有 `<form>` / `onSubmit`(唯一的 `addEventListener` 是 `:95` 的 Esc 關閉)。
                        ⇒ **客人打兩個數字、按「套用」,什麼都不會發生。**
                        負向對照:同一支檔有 **18 個 `onClick`** ⇒ 這不是「掃不到接線」,是真的沒接。

                        **成因不是有人偷懶**:`design-reference/components/FilterTop.jsx:182` **逐字就是這樣**,
                        而本檔檔頭寫著「字面直接搬」「className 完全不動」⇒ **鐵則 1 被正確執行了,
                        而搬進來的是 design 的【靜態原型】。**

                        🔴 **它比一般死鈕毒,因為【它上面那幾列是會動的】**(`ft-price-row` 每一列都有 `onClick`)
                        ⇒ 客人沒有理由覺得這一格不一樣 ⇒ 他會以為**是自己做錯了**,不是「這功能還沒做」。
                        而他在按之前**已經打了兩個數字**。

                        ~~⏳ **處置待 Sean**(三條路:甲 拿掉 / 乙 接起來 / 丙 維持)~~
                        ✅ **2026-08-22 已接起來(乙),而且它【不是】決策題。**
                        判準(memory `feedback_standard-admin-features-are-not-decisions`):
                        **這個功能換一個購物網站也會有嗎?會 ⇒ 自己補,不要拿去問他。**
                        價格區間篩選任何購物網站都有 ⇒ 拿去問等於問「要不要有價格篩選」。
                        🔴 而它**看起來**像決策題,是因為那三條路都動 design 的畫面(鐵則 1)——
                        **「動到 design」與「要 Sean 拍板」是兩件事**,前者只要求逐字對稿,
                        不要求他重新選一次他早就選過的東西(這一格 className 一字未動)。
                        📌 溯源與規格全文:`~/pcm-mailbox/E-011-FilterTop死鈕溯源與規格-20260822.md`
                        原始掃描分母:`docs/probes/2026-08-19-g1-inert-controls-live.md` */}
                  <div className="ft-price-custom">
                    <input
                      placeholder="最低"
                      inputMode="numeric"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyCustomPrice(); }}
                    /><span>—</span><input
                      placeholder="最高"
                      inputMode="numeric"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyCustomPrice(); }}
                    />
                    <button className="ft-apply" type="button" onClick={applyCustomPrice}>套用</button>
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
            {extras.price && (
              <span className="ft-pill">{extras.price}
                <button onClick={() => setExtras((e) => ({ ...e, price: null }))}>×</button>
              </span>
            )}
            {extras.inStock && (
              <span className="ft-pill">現貨
                <button onClick={() => setExtras((e) => ({ ...e, inStock: false }))}>×</button>
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
          {data.categories.map((c) => {
            // Sean 2026-07-13:點大類 = 直接篩「該大類全部」;有子類則右欄展開細項供細分(取消獨立「全部」列),
            //   無子類則直接關閉面板。切不同大類一次點擊即切換。
            const hasChildren = c.children.length > 0;
            return (
              <button key={c.id}
                className={`ft-col-row ${main?.id === c.id ? 'is-active' : ''}`}
                onClick={() => {
                  dispatch(selectCategoryMain(c.id, c.name));
                  if (hasChildren) setMain(c);
                  else onDone();
                }}>
                <span>{c.name}</span>
                <span style={{ color: 'var(--c-text-3)', fontSize: 12, marginRight: 8 }}>{c.count}</span>
                {hasChildren && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ft-veh-col ft-veh-col-wide">
        <div className="ft-col-head">細項</div>
        <div className="ft-col-body">
          {main ? (
            <>
              {/* 「全部 {大類}」列已移除:左欄點大類時即已篩全部(Sean 2026-07-13)。 */}
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
