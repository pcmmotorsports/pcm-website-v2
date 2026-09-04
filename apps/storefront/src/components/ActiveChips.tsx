// ActiveChips.tsx — 已選篩選條件標籤列(對齊 design FilterTop.jsx L413-470)
//
// M-1-12 Codex review 修正:自 ProductsPage.tsx 拆出(AGENTS.md 鐵則 6:元件檔
// >400 行必拆)。.ac-* CSS 原隨 filter-top.css(M-1-10)落地、[#221] 拆檔後移入
// filter-cascade.css(與 CascadeFilterTop .cft-* 同檔、皆「目前篩選狀態」UI)。

import { useRouter, useSearchParams } from 'next/navigation';
import { categoriesFromParams, CATEGORIES_PARAM } from '@/lib/catalog-query';
import { CATEGORY_URL_SEPARATOR } from './products-url-parsers';
import {
  clearVehicle,
  selectVehicleBrand,
  selectVehicleModel,
  clearCategory,
  toggleBrand,
  clearAll,
} from '@pcm/ui';
import {
  makeInitialExtraFilters,
  type CascadeControlledProps,
  type ExtrasControlledProps,
} from './filter-state';
import type { FilterTopData } from './FilterTop';

export function ActiveChips({
  data,
  cascade,
  dispatch,
  extras,
  setExtras,
}: {
  data: FilterTopData;
} & CascadeControlledProps & ExtrasControlledProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (cascade.vehicle) {
    // V-1a(Sean 07-15 追加 2):整台車一顆 → brand/model/year 各一顆、可單刪。
    // 連動語意走既有 reducer cascade reset:刪 brand=clearVehicle(全清);
    // 刪 model=重選同 brand(select-brand 清 model+year);刪 year=重選同 model(select-model 清 year)。
    const { brand, model, year } = cascade.vehicle;
    chips.push({
      key: 'vehicle-brand',
      label: brand,
      onRemove: () => dispatch(clearVehicle()),
    });
    if (model !== undefined) {
      chips.push({
        key: 'vehicle-model',
        label: model,
        onRemove: () => dispatch(selectVehicleBrand(brand)),
      });
    }
    if (year !== undefined && model !== undefined) {
      chips.push({
        key: 'vehicle-year',
        label: String(year),
        onRemove: () => dispatch(selectVehicleModel(model)),
      });
    }
  }
  // 🔴🔴 **分類這幾顆【讀網址, 不讀 state】—— 而其他幾顆仍然讀 state。**
  //    ⚠️ 兩種來源同時存在是刻意的, 而它**不是**兩個真相來源:
  //    網址本來就是 server 過濾的唯一依據(`lib/catalog-query.ts` 的 `parseCatalogQuery`),
  //    而 `use-catalog-filter-url-sync` 已經把 `cascade` 寫進網址
  //    ⇒ 分類改讀網址 = **從兩個來源收斂成一個**, 不是多開一個。
  // 🎯 **為什麼非這樣不可**:`cascade.category` 是**單數**(`packages/ui` 的
  //    `cascadeFilterReducer` 逐字 `category: CategorySelection | null`)⇒ 它**裝不下兩顆**。
  //    而 Sean 2026-09-04 拍甲逐字要「魚雷管要**同時**列全段+尾段」。
  //    改共用狀態機是另一條路(鐵則 12⑥ + 9 支消費端 + 跨 app)⇒ 主視窗-94 裁走這條。
  // 🛑 **`packages/ui` 本片零 diff** —— commit 前用 `git diff --stat -- packages/ui` 核。
  const urlCategories = categoriesFromParams(searchParams);
  urlCategories.forEach((path) => {
    chips.push({
      key: `category-${path}`,
      // 🔵 顯示只取最後一段(`父 · 子` ⇒ 子)—— 與改之前那顆的 `sub ?? main` 同一個字面。
      label: path.split(CATEGORY_URL_SEPARATOR).pop() ?? path,
      onRemove: () => {
        // 🔴 刪一顆 = 送出【少那一顆】的網址。不是只 dispatch ——
        //    dispatch 只清得掉 state, 而**網址上那幾顆會留著**(那正是 ⟦b4-CLEARALLKEEPSJUNK⟧)。
        const rest = urlCategories.filter((c) => c !== path);
        const next = new URLSearchParams(searchParams.toString());
        next.delete('category');
        if (rest.length > 0) next.set(CATEGORIES_PARAM, rest.join(','));
        else next.delete(CATEGORIES_PARAM);
        // 🔵 清掉頁碼:少一個條件之後停在第 3 頁很可能是空的。
        next.delete('page');
        // 🔵 state 那半也要跟著清 —— 否則回寫 effect 會把它寫回網址。
        dispatch(clearCategory());
        const qs = next.toString();
        router.replace(qs ? `/products?${qs}` : '/products');
      },
    });
  });
  cascade.brands.forEach((bid) => {
    const b = data.brands.find((x) => x.id === bid);
    chips.push({
      key: `brand-${bid}`,
      label: b?.name ?? bid,
      onRemove: () => dispatch(toggleBrand(bid)),
    });
  });
  if (extras.price) {
    chips.push({
      key: 'price',
      label: extras.price,
      onRemove: () => setExtras((e) => ({ ...e, price: null })),
    });
  }
  if (extras.inStock) {
    chips.push({ key: 'inStock', label: '僅顯示現貨', onRemove: () => setExtras((e) => ({ ...e, inStock: false })) });
  }
  if (extras.isNew) {
    chips.push({ key: 'isNew', label: '新品', onRemove: () => setExtras((e) => ({ ...e, isNew: false })) });
  }
  if (extras.isSale) {
    chips.push({ key: 'isSale', label: '特價中', onRemove: () => setExtras((e) => ({ ...e, isSale: false })) });
  }
  extras.colors.forEach((c) => {
    chips.push({
      key: `color-${c}`,
      label: c,
      onRemove: () => setExtras((e) => ({ ...e, colors: e.colors.filter((x) => x !== c) })),
    });
  });

  if (chips.length === 0) return null;

  return (
    <div className="ac-bar">
      {chips.map((chip) => (
        <button key={chip.key} className="ac-chip" onClick={chip.onRemove}>
          {chip.label}
          <span className="ac-x">×</span>
        </button>
      ))}
      <button
        className="ac-clear-all"
        onClick={() => {
          dispatch(clearAll());
          setExtras(makeInitialExtraFilters());
          // 🔴🔴 **分類改讀網址之後, 這一顆【非改不可】** ——
          //    `clearAll()` 清的是 state, 而分類那幾顆現在住在網址上
          //    ⇒ 只 dispatch 的話:**state 空了、膠囊還在、篩選還生效**。
          //    📌 那正是 `⟦b4-CLEARALLKEEPSJUNK⟧` 那一列講的病, 而本片會把它【放大】
          //       (以前只有認不得的參數會留, 現在【每一顆分類】都留)⇒ 一起處理。
          // 🔵 保 `sort`/`per`(客人刻意選的)、丟 `page` —— 與空狀態那顆同一支。
          const next = new URLSearchParams();
          const keepSort = searchParams.get('sort');
          const keepPer = searchParams.get('per');
          if (keepSort) next.set('sort', keepSort);
          if (keepPer) next.set('per', keepPer);
          const qs = next.toString();
          router.replace(qs ? `/products?${qs}` : '/products');
        }}>
        清除全部
      </button>
    </div>
  );
}
