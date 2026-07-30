// CascadeFilterTop.tsx — 車款 cascade 選擇列(V-1b 起=可打字 combobox 版)
// 桌機:sticky bar、品牌 / 車型 / 年份 三欄搜尋式 VehicleCombo(typeahead)。
// 手機:本列整條由 CSS 關掉(≤1024px 與 [data-mobile="true"] 兩條路徑),
//       手機選車入口 = ProductsMobileControls + MobileVehicleSheet(ADR-0007)。
//
// 佈局字面源自 design-reference/components/FilterTop.jsx L286-407(M-1-10 搬入);
// V-1b(2026-07-15、Sean 拍板+值班台 plan verdict):三顆原生 <select> 換 VehicleSelect
// 可打字 combobox(design 零 typeahead 先例=行為層 Sean 口述授權偏離;.cft-bar/.cft-cascade
// 佈局與 .cft-select 視覺 token 不動)。
//
// 2026-07-30 ADR-0007 桌機正式落地(Sean 看過可操作預覽後拍板):
//   - 搜尋式三欄 +「可直接選擇，也可輸入搜尋」提示 + 年份新到舊 = **正式預設輸出**。
//     原 `?vehicle-ui=preview` query gate 已整條移除(它只是開發過渡;留著=正式站帶一條
//     沒人維護的分支,且要靠 useEffect 讀 window.location 才知道自己是哪一版)。
//   - 版面、固定內容寬度、左側分類、商品卡、排序、分頁一律不動(只優化這條選車列)。
//   - 「我的愛車」維持選車列右側原位置 + 中性 variant="top" 膠囊。
//
// 狀態管理(M-1-08 拍板 B → M-1-12a controlled):vehicle 走 @pcm/ui cascadeFilterReducer、
// cascade/dispatch 由宿主傳入。本元件零 local state —— VehicleCombo 直接 controlled by
// cascade.vehicle;清除語意=combobox 清空該層(連動由 reducer cascade reset 保證)+ 右側
// 「清除車輛」鈕。

'use client';

import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  clearVehicle,
} from '@pcm/ui';
import type { CascadeControlledProps } from './filter-state';
import type { FilterTopData } from './FilterTop';
import { VehicleCombo } from './VehicleSelect';
import { GarageChips, type GarageChipItem } from './GarageChips';
import { modelFieldOptions, resolveModelPick, yearsNewestFirst } from '@/lib/vehicle-options';

export function CascadeFilterTop({
  data,
  cascade,
  dispatch,
  garage = [],
}: {
  data: FilterTopData;
  /** V-1e:登入會員愛車 chips(未登入/讀取失敗=[]、「我的愛車」鈕不顯示) */
  garage?: GarageChipItem[];
} & CascadeControlledProps) {
  const vehicle = cascade.vehicle;
  const currentBrand = vehicle
    ? data.motoBrands.find((brand) => brand.name === vehicle.brand)
    : undefined;
  const currentModel = vehicle?.model != null
    ? currentBrand?.models.find((model) => model.name === vehicle.model)
    : undefined;
  // ADR-0007 桌機決定 3:年份由新到舊(與手機面板共用同一個排序函式、不各排一次)。
  const years = yearsNewestFirst(currentModel);
  const modelHasNoYears = currentModel !== undefined && years.length === 0;
  // Sean 2026-07-30 逐字:「電腦版也要可以直接輸入車款,目前只有輸入廠牌」。
  // 未選廠牌時車型欄改在「品牌 車型」攤平字面空間跨層搜尋(打 r6 直達車款),選定同時補上廠牌。
  // 🔴 與手機選車面板共用 lib/vehicle-options 的同一顆(不建立第二套車款比對邏輯)。
  const { crossLayer, options: modelOptions } = modelFieldOptions(
    data.motoBrands,
    vehicle?.brand ?? null,
  );
  const pickModel = (picked: string) => {
    const resolved = resolveModelPick(data.motoBrands, vehicle?.brand ?? null, picked);
    if (!resolved) return;
    // 跨層命中 → 先立廠牌再立車型(reducer 的 select-model 在無廠牌時是 no-op)
    if (resolved.brand !== vehicle?.brand) dispatch(selectVehicleBrand(resolved.brand));
    dispatch(selectVehicleModel(resolved.model));
  };

  return (
    /* ── cascade bar(桌機專屬;手機整條由 products-mobile 側的 CSS 關掉)── */
    <div className="cft-bar">
      <div className="cft-inner">
        <div className="cft-cascade">
          <span className="cft-icon" aria-hidden="true">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 13l2-7h14l2 7M5 13h14M5 13v5a1 1 0 001 1h2a1 1 0 001-1v-1h6v1a1 1 0 001 1h2a1 1 0 001-1v-5" />
            </svg>
          </span>
          <span className="cft-picker-title">
            <strong className="cft-label">選擇適用車輛</strong>
            <small className="cft-picker-hint">可直接選擇，也可輸入搜尋</small>
          </span>
          <VehicleCombo
            label="選擇品牌"
            value={vehicle?.brand ?? null}
            options={data.motoBrands.map((brand) => brand.name)}
            placeholder="搜尋或選擇廠牌"
            onPick={(name) => dispatch(selectVehicleBrand(name))}
            onClear={() => dispatch(clearVehicle())}
            variant="catalog"
          />
          <VehicleCombo
            label="選擇車型"
            value={vehicle?.model ?? null}
            options={modelOptions}
            placeholder={crossLayer ? '搜尋或選擇車型，例:R6' : '搜尋或選擇車型'}
            emptyHint={crossLayer ? '查無符合的車款，請調整關鍵字' : '查無符合的車型，請調整關鍵字'}
            onPick={pickModel}
            onClear={() => {
              if (vehicle) dispatch(selectVehicleBrand(vehicle.brand));
            }}
            variant="catalog"
          />
          <VehicleCombo
            label="選擇年份"
            value={vehicle?.year != null ? String(vehicle.year) : null}
            options={years.map(String)}
            disabled={!vehicle || vehicle.model == null || modelHasNoYears}
            placeholder={modelHasNoYears ? '不限年份' : '搜尋或選擇年份'}
            onPick={(year) => dispatch(selectVehicleYear(Number(year)))}
            onClear={() => {
              if (vehicle?.model != null) dispatch(selectVehicleModel(vehicle.model));
            }}
            variant="catalog"
          />
        </div>
        <div className="cft-right">
          {/* V-1e:「我的愛車」鈕(登入會員才顯示、點開展膠囊、套用=dispatch 進同一 cascade)。
              ADR-0007 桌機決定 4:位置與中性配色不動。 */}
          <GarageChips garage={garage} motoBrands={data.motoBrands} dispatch={dispatch} variant="top" />
          {vehicle && (
            <button className="cft-clear" onClick={() => dispatch(clearVehicle())} aria-label="清除車輛篩選">清除車輛</button>
          )}
        </div>
      </div>
    </div>
  );
}
