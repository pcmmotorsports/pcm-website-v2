// ActiveChips.tsx — 已選篩選條件標籤列(對齊 design FilterTop.jsx L413-470)
//
// M-1-12 Codex review 修正:自 ProductsPage.tsx 拆出(AGENTS.md 鐵則 6:元件檔
// >400 行必拆)。.ac-* CSS 原隨 filter-top.css(M-1-10)落地、[#221] 拆檔後移入
// filter-cascade.css(與 CascadeFilterTop .cft-* 同檔、皆「目前篩選狀態」UI)。

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
  if (cascade.category) {
    chips.push({
      key: 'category',
      label: cascade.category.sub ?? cascade.category.main,
      onRemove: () => dispatch(clearCategory()),
    });
  }
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
        }}>
        清除全部
      </button>
    </div>
  );
}
