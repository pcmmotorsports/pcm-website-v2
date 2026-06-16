/**
 * cascadeFilterReducer — 三 Filter 變體共用「車輛 / 零件分類」階層篩選狀態機。
 *
 * **角色:** packages/ui 純 TS reducer(framework-free、零 React 依賴、對齊
 * @pcm/domain / @pcm/adapters 純 TS 套件慣例)。M-1-09 / M-1-10 / M-1-11 三個
 * Filter 元件(FilterSide / FilterTop / FilterDrawer)各自
 * `useReducer(cascadeFilterReducer, makeInitialCascadeState())` 接、共用同一份
 * cascade 邏輯、不重複實作狀態機。
 *
 * **字面源(真權威):**
 * - `design-reference/components/FilterTop.jsx`
 *   - L286-407 `CascadeFilterTop`:`onBrandChange` 選品牌 drop 車型+年份、
 *     `onModelChange` 選車型 drop 年份(cascade reset 字面)
 *   - L90-134 `FilterTop` 車輛 dropdown:L98 選品牌 `setVehModel(null)`
 *   - L232-276 `CategoryPanel`:大分類 → 細項 drill-down、L260「全部 {main}」
 *   - L149-153 品牌 checkbox toggle、L223 `setFilters({ brands: [] })`
 * - `design-reference/components/FilterSide.jsx`
 *   - L21-58 `VehicleTree`、L61-91 `CategoryTree`(L81 active sub → `null` toggle)
 *   - L141-145 `toggleBrand`、L150 `setFilters({ brands: [] })`
 * - `design-reference/components/FilterDrawer.jsx`
 *   - L72-119 車輛麵包屑、L122-161 分類麵包屑(L152 active sub → `null` toggle)
 *   - L39-42 `toggleBrand`、L247 `setFilters({ brands: [] })`
 *
 * **cascade 規則(階層、上層變動清空下層):**
 * - 車輛:品牌 → 車型 → 年份。選品牌清車型+年份、選車型清年份。
 * - 分類:大分類 → 細項。選大分類清細項。
 *
 * **字面 vs 事實揭示:**
 * 1. design 用 lifted `filters` 物件 + `setFilters` spread;本實作改 reducer +
 *    action,語意等價、API 不同(Q2-redo=B 拍板:framework-free 狀態機、非 hook)。
 * 2. design `filters.vehicle` 的 brand / model 存「名稱字串」(`b.name` / `m.name`);
 *    `VehicleSelection` 同存名稱字串、不改存 id(對齊 design 真權威)。
 * 3. design 三變體的中介導覽 state(`vehBrand` / `vehModel` / `catMain` / `tmpBrand`…)
 *    屬 UI 特異、不入 reducer;reducer 只管 committed cascade slice
 *    (對齊 recon「cascade 邏輯共用、UI 特異」)。
 * 4. reducer scope = `{ vehicle, category, brands }`;design `setFilters({ brands: [] })`
 *    清的是「整個 filters」(含 price / colors / flags),本 reducer 的 `clear-all`
 *    僅回 `makeInitialCascadeState()`,price / colors / flags 由各元件自管
 *    (Q2=A 拍板:priceRange / price 留各元件自管)。
 * 5. 細項 toggle:FilterSide L81 + FilterDrawer L152 點 active sub → `category = null`;
 *    FilterTop `CategoryPanel` 不 toggle(選後關 dropdown)。`category/select-sub`
 *    採多數變體 toggle 語意:再點同一 subId → `category = null`。
 * 6. `vehicle/select-model`、`vehicle/select-year`、`category/select-sub` 在上層未選時
 *    → no-op(回原 state);design 三變體 UI 結構上不可能觸發此路徑(下層欄需上層先選
 *    才 render),reducer 防禦式守門、確保狀態機封閉可測。
 *
 * **consumer 契約(M-1-09 / M-1-10 / M-1-11 接 useReducer 時):**
 * - 初始值固定由 `makeInitialCascadeState()` 提供(全空)。consumer 若需從既有
 *   `filters` 物件 hydrate,須先正規化:design `filters.vehicle.year` 可能為空字串
 *   (ProductsPage `veh.year || ''`)、須轉 `undefined`;品牌 / 車型 / 分類若持有 id
 *   須先解析為名稱字串(本狀態機 `vehicle` / `category` 存名稱、非 id)。
 * - `brands` 存品牌 id(非名稱);名稱解析(`data.brands` 查表)是 Filter 元件責任。
 *
 * @see design-reference/components/FilterTop.jsx
 * @see design-reference/components/FilterSide.jsx
 * @see design-reference/components/FilterDrawer.jsx
 */

/** 車輛選擇 — 品牌 → 車型 → 年份階層;`model` / `year` 未定義代表僅選到上層。 */
export interface VehicleSelection {
  /** 機車品牌名稱(字面、對齊 design `motoBrands[].name`)。 */
  brand: string;
  /** 車型名稱(對齊 design `models[].name`);未選車型時 undefined。 */
  model?: string;
  /** 年份(對齊 design `years[]` 數字);未選年份時 undefined。 */
  year?: number;
}

/** 零件分類選擇 — 大分類 → 細項階層;`subId` / `sub` 未定義代表「全部大分類」。 */
export interface CategorySelection {
  /** 大分類 id(對齊 design `categories[].id`)。 */
  mainId: string;
  /** 大分類名稱(對齊 design `categories[].name`)。 */
  main: string;
  /** 細項 id(對齊 design `categories[].children[].id`);選「全部大分類」時 undefined。 */
  subId?: string;
  /** 細項名稱;選「全部大分類」時 undefined。 */
  sub?: string;
}

/**
 * cascade 篩選狀態 — `filters` 物件中與階層篩選相關的切片。
 *
 * price / priceRange / colors / inStock / isNew / isSale 不在本狀態機 scope、
 * 由各 Filter 元件自管(Q2=A 拍板)。
 */
export interface CascadeFilterState {
  /** 已選車輛;null = 未篩選車輛。 */
  vehicle: VehicleSelection | null;
  /** 已選零件分類;null = 未篩選分類。 */
  category: CategorySelection | null;
  /** 已選品牌 id 列表(多選);空陣列 = 未篩選品牌。 */
  brands: string[];
}

/** cascadeFilterReducer 可接受的 action 聯集(discriminated union)。 */
export type CascadeFilterAction =
  | { type: 'vehicle/select-brand'; brand: string }
  | { type: 'vehicle/select-model'; model: string }
  | { type: 'vehicle/select-year'; year: number }
  | { type: 'vehicle/clear' }
  | { type: 'category/select-main'; mainId: string; main: string }
  | { type: 'category/select-sub'; subId: string; sub: string }
  | { type: 'category/clear' }
  | { type: 'brands/toggle'; brandId: string }
  | { type: 'clear-all' };

/**
 * 建立 cascade 篩選初始狀態(全空)。
 *
 * 採 factory function 而非共用 const:每次回傳全新物件 + 全新 `brands` 陣列,
 * 避免多個 `useReducer` 實例共用同一個可變陣列參考(對齊 reducer 純度)。
 */
export function makeInitialCascadeState(): CascadeFilterState {
  return { vehicle: null, category: null, brands: [] };
}

// ── action creators ──────────────────────────────────────────────
// 三 Filter 元件 import 後 `dispatch(selectVehicleBrand('Yamaha'))` 呼叫,
// payload 型別由 CascadeFilterAction 聯集守門。

/** 選車輛品牌 — 清空車型 + 年份(cascade)。 */
export function selectVehicleBrand(brand: string): CascadeFilterAction {
  return { type: 'vehicle/select-brand', brand };
}

/** 選車輛車型 — 清空年份(cascade);未先選品牌時 reducer no-op。 */
export function selectVehicleModel(model: string): CascadeFilterAction {
  return { type: 'vehicle/select-model', model };
}

/** 選車輛年份;未先選品牌+車型時 reducer no-op。 */
export function selectVehicleYear(year: number): CascadeFilterAction {
  return { type: 'vehicle/select-year', year };
}

/** 清除車輛篩選。 */
export function clearVehicle(): CascadeFilterAction {
  return { type: 'vehicle/clear' };
}

/** 選零件大分類(等同「全部 {大分類}」)— 清空細項(cascade)。 */
export function selectCategoryMain(mainId: string, main: string): CascadeFilterAction {
  return { type: 'category/select-main', mainId, main };
}

/** 選零件細項;再點同一 subId → 清除整個分類(toggle);未先選大分類時 no-op。 */
export function selectCategorySub(subId: string, sub: string): CascadeFilterAction {
  return { type: 'category/select-sub', subId, sub };
}

/** 清除分類篩選。 */
export function clearCategory(): CascadeFilterAction {
  return { type: 'category/clear' };
}

/** 切換品牌多選 — 未選則加入、已選則移除。 */
export function toggleBrand(brandId: string): CascadeFilterAction {
  return { type: 'brands/toggle', brandId };
}

/** 清除全部 cascade 篩選(車輛 + 分類 + 品牌)。 */
export function clearAll(): CascadeFilterAction {
  return { type: 'clear-all' };
}

/**
 * exhaustiveness 守門:`CascadeFilterAction` 新增成員若未在 reducer 處理,
 * `action` 在此處型別不為 `never`、編譯期即報錯(對齊三視角 bug 可追蹤性)。
 */
function assertNever(action: never): never {
  throw new Error(`cascadeFilterReducer 未處理的 action: ${JSON.stringify(action)}`);
}

/**
 * cascadeFilterReducer — pure reducer、套用 cascade 階層規則。
 *
 * 純函式:不 mutate 傳入的 `state`。回傳原 `state` 參考(`useReducer` bail-out 最佳化、#146、
 * React 跳過重渲染)的情況有二:
 * (a) 防禦式守門:上層未選時的 `select-model` / `select-year` / `select-sub`;
 * (b) action 不改變狀態:重選同值且 cascade 下層已空(同品牌/車型/年份/大分類)、
 *     `vehicle/clear`·`category/clear` 對應切片已空、`clear-all` 已全空。
 * 其餘改變狀態的分支一律回傳新物件(不 mutate)。
 * ⚠️ bail-out 僅在「真無變化」觸發:model/year/sub 仍有值時重選上層仍須清下層(cascade reset)、不誤 bail。
 *
 * @param state 當前 cascade 篩選狀態
 * @param action CascadeFilterAction 聯集之一
 * @returns 新狀態;無變化(守門 / 重選同值 / clear 已空)時回傳原 `state` 參考
 */
export function cascadeFilterReducer(
  state: CascadeFilterState,
  action: CascadeFilterAction,
): CascadeFilterState {
  switch (action.type) {
    case 'vehicle/select-brand':
      // 重選同品牌且 model/year 已空 → 無變化、回原 state(#146 bail-out)。
      // ⚠️ model/year 仍有值時重選同品牌須清下層(cascade reset)、不可誤 bail。
      if (
        state.vehicle &&
        state.vehicle.brand === action.brand &&
        state.vehicle.model === undefined &&
        state.vehicle.year === undefined
      ) {
        return state;
      }
      // 選品牌 → 重建 vehicle、清車型+年份(cascade reset)
      return { ...state, vehicle: { brand: action.brand } };

    case 'vehicle/select-model': {
      // 未先選品牌 → no-op(cascade 不允許跳級)
      if (!state.vehicle) return state;
      // 重選同車型且 year 已空 → 無變化、回原 state(#146 bail-out;year 仍有值時須清、不誤 bail)
      if (state.vehicle.model === action.model && state.vehicle.year === undefined) return state;
      // 選車型 → 保留品牌、清年份(cascade reset)
      return {
        ...state,
        vehicle: { brand: state.vehicle.brand, model: action.model },
      };
    }

    case 'vehicle/select-year': {
      // 未先選品牌或車型 → no-op
      if (!state.vehicle || state.vehicle.model === undefined) return state;
      // 重選同年份 → 無變化、回原 state(#146 bail-out;year 為 leaf、無 cascade 下層)
      if (state.vehicle.year === action.year) return state;
      return {
        ...state,
        vehicle: { ...state.vehicle, year: action.year },
      };
    }

    case 'vehicle/clear':
      // 已無車輛 → 無變化、回原 state(#146 bail-out)
      if (!state.vehicle) return state;
      return { ...state, vehicle: null };

    case 'category/select-main':
      // 重選同大分類且 sub 已空 → 無變化、回原 state(#146 bail-out;sub 仍有值時須清、不誤 bail)
      if (
        state.category &&
        state.category.mainId === action.mainId &&
        state.category.subId === undefined
      ) {
        return state;
      }
      // 選大分類(= 全部大分類)→ 清細項(cascade reset)
      return {
        ...state,
        category: { mainId: action.mainId, main: action.main },
      };

    case 'category/select-sub': {
      // 未先選大分類 → no-op
      if (!state.category) return state;
      // 再點已選的同一 subId → 清除整個分類(toggle off、對齊 design)
      if (state.category.subId === action.subId) {
        return { ...state, category: null };
      }
      // 選 / 換細項 → spread 保留上層大分類(對齊 vehicle/select-year 寫法)
      return {
        ...state,
        category: { ...state.category, subId: action.subId, sub: action.sub },
      };
    }

    case 'category/clear':
      // 已無分類 → 無變化、回原 state(#146 bail-out)
      if (!state.category) return state;
      return { ...state, category: null };

    case 'brands/toggle': {
      const selected = state.brands.includes(action.brandId);
      return {
        ...state,
        brands: selected
          ? state.brands.filter((id) => id !== action.brandId)
          : [...state.brands, action.brandId],
      };
    }

    case 'clear-all':
      // 已全空 → 無變化、回原 state(#146 bail-out)
      if (!state.vehicle && !state.category && state.brands.length === 0) return state;
      return makeInitialCascadeState();

    default:
      return assertNever(action);
  }
}
