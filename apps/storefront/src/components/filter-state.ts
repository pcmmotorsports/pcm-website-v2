// filter-state.ts — 4 篩選元件「提升狀態」契約(M-1-12a)
//
// M-1-12 起 FilterSide / FilterTop / CascadeFilterTop / FilterDrawer 改 controlled:
// 篩選 state 不再各元件自管、改由宿主(ProductsPage / dev-preview 頁)持有,
// 透過 props 傳入。對齊 design ProductsPage.jsx 的 lifted filters 物件模型
// (見 docs/recon/M-1-12-products-page-recon.md §3、Sean 拍板狀態架構=方案 1)。
//
// - 階層篩選(車輛 / 分類 / 品牌)沿用 @pcm/ui cascadeFilterReducer:宿主持有
//   useReducer、把 cascade + dispatch 傳入(CascadeControlledProps)。
// - 其餘篩選欄位(價格 / 顏色 / 現貨 / 新品 / 特價)收斂為單一 ProductExtraFilters
//   物件 + setExtras 傳入(ExtrasControlledProps),避免逐欄位 props 爆量。

import type { Dispatch, SetStateAction } from 'react';
import type { CascadeFilterState, CascadeFilterAction } from '@pcm/ui';

/**
 * 「現貨」篩選 UI feature flag(M-1-13e-pre-3 落地)。
 *
 * Sean 2026-05-21 業務拍板「不顯示有無庫存、商品永遠可加購」、UI(FilterTop /
 * FilterSide / FilterDrawer 的「現貨」chip / checkbox)隱藏、邏輯保留。
 *
 * 未來業務改回顯示庫存 → 改 `true`、3 處 UI 同步出現、無需動其他邏輯。
 * `extras.inStock` state default 仍 false(見 makeInitialExtraFilters)、用戶
 * 不能勾就永遠 false、過濾邏輯(products-filter-logic.ts)自然不啟動。
 * ActiveChips / ProductsPage 活動 filter 計數 / FilterDrawer tab count 同理
 * 不渲染、刻意保留條件、未來 revisit 0 成本(對齊鐵則 9 業務試水溫精神)。
 *
 * 對齊 backlog #161:storefront 偏離 design 字面(design 仍含「現貨」filter
 * + 沒貨徽章)、待 Claude Design 補對齊或 Sean 業務 revisit。
 */
export const SHOW_IN_STOCK_FILTER = false;

/**
 * 階層篩選(車輛 / 分類 / 品牌、見 @pcm/ui CascadeFilterState)以外的篩選欄位。
 *
 * 對齊 design `filters` 物件剩餘欄位:price / priceRange / colors / inStock /
 * isNew / isSale。sort 屬「排序」非「篩選」、不收進本型別(由宿主獨立持有)。
 *
 * price 與 priceRange 並存且各有用途:FilterTop / FilterDrawer 用字串區間 price、
 * FilterSide 雙滑桿用數值區間 priceRange(對齊 design filterProducts 兩者皆吃)。
 */
export interface ProductExtraFilters {
  /** 價格區間字串標籤(FilterTop / FilterDrawer 用);null = 未選。 */
  price: string | null;
  /** 價格數值區間 [低, 高](FilterSide 雙滑桿用);undefined = 未選。 */
  priceRange?: [number, number];
  /** 已選顏色 id 列表。 */
  colors: string[];
  /** 僅顯示現貨。 */
  inStock: boolean;
  /** 僅顯示新品。 */
  isNew: boolean;
  /** 僅顯示特價。 */
  isSale: boolean;
}

/**
 * 建立 ProductExtraFilters 初始值(全空)。
 *
 * 採 factory function 而非共用 const:每次回傳全新物件 + 全新 colors 陣列,
 * 避免多個宿主實例共用同一個可變參考(對齊 @pcm/ui makeInitialCascadeState 慣例)。
 */
export function makeInitialExtraFilters(): ProductExtraFilters {
  return {
    price: null,
    priceRange: undefined,
    colors: [],
    inStock: false,
    isNew: false,
    isSale: false,
  };
}

/** 階層篩選 controlled props — 持有 cascadeFilterReducer 的宿主傳入。 */
export interface CascadeControlledProps {
  /** 當前階層篩選狀態(車輛 / 分類 / 品牌)。 */
  cascade: CascadeFilterState;
  /** cascadeFilterReducer 的 dispatch。 */
  dispatch: Dispatch<CascadeFilterAction>;
}

/** extras 篩選 controlled props — 宿主持有的 ProductExtraFilters 物件 + 更新器。 */
export interface ExtrasControlledProps {
  /** 當前 extras 篩選欄位。 */
  extras: ProductExtraFilters;
  /** extras 的 React setState 更新器(元件以 setExtras(e => ({ ...e, x })) 更新)。 */
  setExtras: Dispatch<SetStateAction<ProductExtraFilters>>;
}
