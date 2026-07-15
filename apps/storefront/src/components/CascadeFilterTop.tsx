// CascadeFilterTop.tsx — 車款 cascade 選擇列(V-1b 起=可打字 combobox 版)
// 桌機:sticky bar、品牌 / 車型 / 年份 三欄 VehicleSelect(typeahead)。
// 手機:精簡 chip、點擊由 ProductsPage / FilterDrawer 接手開抽屜。
//
// 佈局字面源自 design-reference/components/FilterTop.jsx L286-407(M-1-10 搬入);
// V-1b(2026-07-15、Sean 拍板+值班台 plan verdict):三顆原生 <select> 換 VehicleSelect
// 可打字 combobox(design 零 typeahead 先例=行為層 Sean 口述授權偏離;.cft-bar/.cft-cascade
// 佈局與 .cft-select 視覺 token 不動)。
//
// 狀態管理(M-1-08 拍板 B → M-1-12a controlled):vehicle 走 @pcm/ui cascadeFilterReducer、
// cascade/dispatch 由宿主傳入。V-1b 起本元件**零 local select state**——VehicleSelect 直接
// controlled by cascade.vehicle(V-1a 鏡像 effect 的雙向同步需求由 controlled 天然滿足、
// tmpBrand/tmpModel/tmpYear 與鏡像 effect 一併退場);清除語意=combobox 清空該層(連動
// 由 reducer cascade reset 保證)+ 右側「清除車輛」鈕保留。

'use client';

import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  clearVehicle,
} from '@pcm/ui';
import type { CascadeControlledProps } from './filter-state';
import type { FilterTopData } from './FilterTop';
import { VehicleSelect } from './VehicleSelect';

export function CascadeFilterTop({
  data,
  onOpenDrawer,
  cascade,
  dispatch,
}: {
  data: FilterTopData;
  onOpenDrawer?: (target: string) => void;
} & CascadeControlledProps) {
  const vehicle = cascade.vehicle;

  // 手機版 chip 顯示文字(S1:停在品牌/車型層〔未選年〕成為常態 → year 缺時不顯 '{yy};
  //   修原 `String(undefined).slice(-2)` 顯示 "'ed" 的 latent bug;model 缺退品牌名)
  const vehShort = vehicle
    ? [
        vehicle.model ?? vehicle.brand,
        vehicle.year != null ? `'${String(vehicle.year).slice(-2)}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;

  return (
    <>
      {/* ── 桌機 cascade bar ── */}
      <div className="cft-bar">
        <div className="cft-inner">
          <div className="cft-cascade">
            <span className="cft-icon" aria-hidden="true">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 13l2-7h14l2 7M5 13h14M5 13v5a1 1 0 001 1h2a1 1 0 001-1v-1h6v1a1 1 0 001 1h2a1 1 0 001-1v-5" />
              </svg>
            </span>
            <span className="cft-label">確認適用車款</span>
            <VehicleSelect
              motoBrands={data.motoBrands}
              vehicle={vehicle}
              onPickBrand={(name) => dispatch(selectVehicleBrand(name))}
              onPickModel={(name) => dispatch(selectVehicleModel(name))}
              onPickYear={(year) => dispatch(selectVehicleYear(year))}
              onClearBrand={() => dispatch(clearVehicle())}
              onClearModel={() => {
                if (vehicle) dispatch(selectVehicleBrand(vehicle.brand));
              }}
              onClearYear={() => {
                if (vehicle?.model != null) dispatch(selectVehicleModel(vehicle.model));
              }}
            />
            <span className="cft-helper">先選車，只顯示裝得上的零件</span>
          </div>
          <div className="cft-right">
            {vehicle && (
              <button className="cft-clear" onClick={() => dispatch(clearVehicle())} aria-label="清除車輛篩選">清除車輛</button>
            )}
          </div>
        </div>
      </div>

      {/* ── 手機精簡 chip(無 label,避免擠到第二行)── */}
      <div className="cft-mobile-bar">
        <button className="cft-mobile-chip" onClick={() => onOpenDrawer?.('vehicle')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 13l2-7h14l2 7M5 13h14M5 13v5a1 1 0 001 1h2a1 1 0 001-1v-1h6v1a1 1 0 001 1h2a1 1 0 001-1v-5" />
          </svg>
          <span className="cft-mobile-name">{vehShort || '選擇車款'}</span>
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </>
  );
}
