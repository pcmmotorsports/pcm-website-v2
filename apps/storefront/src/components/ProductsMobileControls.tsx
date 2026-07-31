'use client';

// ProductsMobileControls.tsx — 手機商品目錄控制列(ADR-0007 手機決定 6-8;2026-07-30 Sean 拍板)。
//
// 取代原本的手機入口組合(單一顆紅色「篩選」FAB → FilterDrawer 六個 tab 混在一起):
//   ① 車輛列  :未選車=「選擇車輛」;已選車=摘要 +「更換」+「清除車輛」
//   ② 工具列  :分類 / 篩選 / 排序 = **三個獨立入口**(排序字面視覺置中)
//   ③ 面板    :選車走 MobileVehicleSheet;分類與商品篩選走既有 FilterDrawer 的兩個 scope;
//               排序走本檔的短面板(選項清單來自 lib/sort-options 單一定義點)
//
// 🔴 桌機零影響:本元件整棵樹由 products-mobile.css 在 ≥1025px 關掉(`.pmc-root`),
//    桌機選車入口仍是 CascadeFilterTop;守門 = styles/products-mobile.test.ts。
// 🔴 同一時間只開一個面板(單一 `panel` state):否則兩個面板各自鎖/解 body overflow,
//    先關的那個會把還開著的那個解鎖 = 背景跟著捲。

import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  clearCategory,
  clearVehicle,
  type CascadeFilterState,
  type CascadeFilterAction,
} from '@pcm/ui';
import { vehicleLabel } from '@/lib/vehicle-match';
import { SORT_OPTIONS, sortLabel } from '@/lib/sort-options';
import type { ProductExtraFilters } from './filter-state';
import type { FilterTopData } from './FilterTop';
import { FilterDrawer } from './FilterDrawer';
import type { VehicleFacetCounts } from '@/lib/vehicle-facet-display';
import { MobileVehicleSheet } from './MobileVehicleSheet';
import type { GarageChipItem } from './GarageChips';

type Panel = 'vehicle' | 'category' | 'filter' | 'sort' | null;

export function ProductsMobileControls({
  data,
  cascade,
  dispatch,
  extras,
  setExtras,
  garage = [],
  resultCount,
  sort,
  setSort,
  facetCounts = null,
}: {
  data: FilterTopData;
  cascade: CascadeFilterState;
  dispatch: Dispatch<CascadeFilterAction>;
  extras: ProductExtraFilters;
  setExtras: Dispatch<SetStateAction<ProductExtraFilters>>;
  /** V-1e:登入會員愛車(未登入/讀取失敗=[]) */
  garage?: GarageChipItem[];
  resultCount: number;
  sort: string;
  setSort: (value: string) => void;
  /** #306:已選車款的各分類 / 各品牌件數;穿透給兩個 scope 的 FilterDrawer。 */
  facetCounts?: VehicleFacetCounts | null;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const closePanel = () => setPanel(null);

  const vehicle = cascade.vehicle;
  const vehicleTitle = vehicle
    ? vehicle.model != null
      ? vehicleLabel(vehicle.brand, vehicle.model)
      : vehicle.brand
    : null;

  // ADR-0007 手機決定 8:這個數字只代表「商品篩選」面板裡的條件。
  // 🔴 車輛與分類**不入帳** —— 它們有自己的入口與自己的清除出口,算進來會讓客人以為
  //    按「篩選」裡的清除就能把車清掉。
  const productFilterCount =
    cascade.brands.length +
    (extras.price ? 1 : 0) +
    (extras.inStock ? 1 : 0) +
    (extras.isNew ? 1 : 0) +
    (extras.isSale ? 1 : 0) +
    extras.colors.length;

  // ADR-0007 手機決定 6:清除車輛 = 回到全部商品 + 清掉車輛相關分類。
  // 🔴 clearVehicle() 只清車輛(reducer 逐字),分類要自己補一發;
  //    這與選車面板的「清除」(只清輸入草稿)是**兩種不同的清除**,不可互相代用。
  const clearVehicleAndCategory = () => {
    dispatch(clearVehicle());
    dispatch(clearCategory());
    closePanel();
  };

  return (
    <div className="pmc-root">
      {/* 🔴 已選車時**不再**渲染大塊車輛資訊(Sean 2026-07-30 真機第二輪回饋:「最上面這一群在
          手機版本上車種資訊過剩」)。原本第一屏會把同一台車講四次:大塊摘要 / 黏頂精簡列 /
          頁面標題 `.pp-head` / `ActiveChips` 膠囊 —— 前兩個都是本元件自己加的,純重複。
          留下的分工:**未選車 = 大塊 CTA**(這是要客人動作的主訴求,不能縮);
          **已選車 = 只留黏頂精簡列**(車名 + 更換 + 清除,捲到哪都在)。
          守門 = ProductsMobileControls.test.tsx「車輛資訊在本元件內只出現一次」。 */}
      {vehicleTitle === null && (
        <div className="pmc-vehicle">
          <div className="pmc-vehicle-empty">
            <div>
              <span className="pmc-eyebrow">適用車輛</span>
              <p>先選車，只看裝得上的零件</p>
            </div>
            <button type="button" className="pmc-vehicle-cta" onClick={() => setPanel('vehicle')}>
              選擇車輛
            </button>
          </div>
        </div>
      )}

      {/* 黏頂區:精簡車輛列(已選車才有)+ 三個獨立入口。
          🔴 為什麼精簡列要存在:大塊資訊捲走後,客人往下看商品時仍需要「換車 / 清車」的出口
          (核准預覽的 compactVehicle 就是這個角色)。
          🔴 為什麼 sticky 掛在這一層、而不是掛在整個 .pmc-root:sticky 只能在**自己父層的
          box 內**移動。第一版把 sticky 掛在一個高度剛好等於它自己的 wrapper 上 ⇒ 移動空間 0
          ⇒ 一捲就跟著滑掉(Sean 真機截圖抓到、實測捲 900px 後它在 top:-835)。
          現在 .pmc-root 在手機是 `display: contents`(box 被移除)⇒ 本層的父層是頁面本體、
          有整頁的移動空間,才真的黏得住。 */}
      <div className="pmc-sticky">
        {vehicleTitle !== null && (
          <div className="pmc-compact">
            <span className="pmc-compact-name">
              {vehicleTitle}
              {vehicle?.year != null && `・${vehicle.year}`}
            </span>
            <div className="pmc-compact-actions">
              <button type="button" onClick={() => setPanel('vehicle')}>更換</button>
              <button type="button" onClick={clearVehicleAndCategory}>清除</button>
            </div>
          </div>
        )}
        <div className="pmc-tools">
          {data.categories.length > 0 && (
            <button type="button" className="pmc-tool" onClick={() => setPanel('category')}>
              類別
              {cascade.category && <b className="pmc-tool-dot">1</b>}
            </button>
          )}
          <button type="button" className="pmc-tool" onClick={() => setPanel('filter')}>
            品牌/價格
            {productFilterCount > 0 && <b className="pmc-tool-dot">{productFilterCount}</b>}
          </button>
          <button
            type="button"
            className="pmc-tool pmc-tool--sort"
            onClick={() => setPanel('sort')}
            aria-label={`排序，目前${sortLabel(sort)}`}
          >
            {/* Sean 2026-07-30 指定:入口字面固定為「排序」(原本顯示當前排序值 =「推薦排序」)。
                目前排序值不消失、改留在 aria-label(報讀器仍讀得到),面板內也有勾選標記。 */}
            排序
          </button>
        </div>
      </div>

      {panel === 'vehicle' && (
        <MobileVehicleSheet
          open
          onClose={closePanel}
          motoBrands={data.motoBrands}
          cascade={cascade}
          dispatch={dispatch}
          garage={garage}
        />
      )}

      {/* 分類與商品篩選重用既有 FilterDrawer(真分類樹 drill / 真品牌清單 / 價格區間),
          只是各自收在自己的 scope 裡 —— 不另建第二套分類樹或品牌清單。 */}
      {panel === 'category' && (
        <FilterDrawer
          facetCounts={facetCounts}
          open
          onClose={closePanel}
          scope="category"
          data={data}
          resultCount={resultCount}
          hideColor
          hidePromoFlags
          cascade={cascade}
          dispatch={dispatch}
          extras={extras}
          setExtras={setExtras}
        />
      )}

      {panel === 'filter' && (
        <FilterDrawer
          facetCounts={facetCounts}
          open
          onClose={closePanel}
          scope="product"
          data={data}
          resultCount={resultCount}
          hideColor
          hidePromoFlags
          cascade={cascade}
          dispatch={dispatch}
          extras={extras}
          setExtras={setExtras}
        />
      )}

      {panel === 'sort' && (
        <>
          <div className="pmc-overlay" onClick={closePanel} />
          <section className="pmc-sort-sheet" role="dialog" aria-modal="true" aria-label="商品排序">
            <header className="pmc-sort-head">
              <h2>商品排序</h2>
              <button type="button" className="pmc-sort-close" onClick={closePanel} aria-label="關閉排序面板">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div className="pmc-sort-list">
              {SORT_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`pmc-sort-row${option.value === sort ? ' is-active' : ''}`}
                  onClick={() => {
                    setSort(option.value);
                    closePanel();
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === sort && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
