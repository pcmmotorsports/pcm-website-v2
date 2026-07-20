'use client';

// FilterDrawerVehicleTab.tsx — 手機抽屜「選擇車款」tab(V-1b2 抽出;V-1f 三修;
// 2026-07-20 tab 標籤由「依車輛搜尋」改為「選擇車款」= Sean 授權覆蓋 design)。
// V-1f(Sean 07-15 開站實測回饋):
//  ① 跨層直搜:打字非空 → 在「品牌 車型」攤平字面空間跨層搜尋(共用 garage-chip.flattenVehicleModels
//     + vehicle-match.filterVehicleOptions,與愛車建議清單同一顆核心、零新比對邏輯、車種鐵律零猜),
//     打 r6 直達車款;點結果=有年份跳年份層、無年份直接 dispatch 套用。空查詢=保留 tap 逐層 drill。
//  ② 滿版視覺:搜尋欄+愛車鈕收進置頂 .fd-veh-top 群組(留白/inset、非整排跨頁)。
//  ③ 鍵盤跳動:.fd-veh-top sticky top:0(聚焦時搜尋欄不被推走、鍵盤不遮輸入),結果在下方捲動。
// tap 逐層 drill 語意與 V-1b2 逐行同(換層自動清查詢);抽出副作用(切 tab/關抽屜重置回品牌層)不變。

import { useState } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  type CascadeFilterState,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { Dispatch } from 'react';
import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
import { filterVehicleOptions } from '@/lib/vehicle-match';
import { flattenVehicleModels, type FlatVehicleEntry } from '@/lib/garage-chip';
import { GarageChips, type GarageChipItem } from './GarageChips';

export function FilterDrawerVehicleTab({
  motoBrands,
  cascade,
  dispatch,
  garage = [],
}: {
  motoBrands: MockMotoBrand[];
  cascade: CascadeFilterState;
  dispatch: Dispatch<CascadeFilterAction>;
  /** V-1e:登入會員愛車 chips(手機掛載點;未登入/讀取失敗=[]、不顯示) */
  garage?: GarageChipItem[];
}) {
  const [vehBrand, setVehBrand] = useState<MockMotoBrand | null>(null);
  const [vehModel, setVehModel] = useState<MockMotoModel | null>(null);
  const [query, setQuery] = useState('');

  const searching = query.trim() !== '';

  const isYearActive = (y: number) =>
    !!cascade.vehicle &&
    cascade.vehicle.brand === vehBrand?.name &&
    cascade.vehicle.model === vehModel?.name &&
    cascade.vehicle.year === y;
  // 無年份車型「不限年份」套用態(cascade 有此 brand+model 且無 year)
  const noYearApplied =
    !!cascade.vehicle &&
    cascade.vehicle.brand === vehBrand?.name &&
    cascade.vehicle.model === vehModel?.name &&
    cascade.vehicle.year == null;

  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
  );

  // V-1f ①:跨層直搜結果(攤平「品牌 車型」字面空間;字典字面直出零猜)
  const crossResults: FlatVehicleEntry[] = searching
    ? filterVehicleOptions(flattenVehicleModels(motoBrands), query, (e) => e.label)
    : [];

  // 點跨層結果:有年份→跳年份層讓客人選;無年份→直接 dispatch 套用(對齊桌機「不限年份」)
  const pickCrossEntry = (entry: FlatVehicleEntry) => {
    setVehBrand(entry.brand);
    setVehModel(entry.model);
    setQuery('');
    if (entry.model.years.length === 0) {
      dispatch(selectVehicleBrand(entry.brand.name));
      dispatch(selectVehicleModel(entry.model.name));
    }
  };

  // 無年份車型「不限年份」套用(tap drill 到無年份車型時的出口=修 V-1b2 年份層卡死)
  const applyNoYear = () => {
    if (!vehBrand || !vehModel) return;
    dispatch(selectVehicleBrand(vehBrand.name));
    dispatch(selectVehicleModel(vehModel.name));
  };

  const brands = filterVehicleOptions(motoBrands, query, (b) => b.name);
  const models = vehBrand ? filterVehicleOptions(vehBrand.models, query, (m) => m.name) : [];
  const years = vehModel ? filterVehicleOptions(vehModel.years, query, (y) => String(y)) : [];

  return (
    <div className="fd-veh">
      {/* V-1f ②③:置頂控制群組(sticky、留白;愛車鈕+搜尋欄) */}
      <div className="fd-veh-top">
        {/* V-1e:「我的愛車」鈕(登入會員才顯示、共用 GarageChips、外殼 variant=drawer) */}
        <GarageChips garage={garage} motoBrands={motoBrands} dispatch={dispatch} variant="drawer" />
        <input
          type="search"
          inputMode="search"
          className="fd-veh-search"
          placeholder="打字找車,例:R6、MT-09、Panigale"
          aria-label="打字快速找車"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="fd-veh-results">
        {searching ? (
          /* ── V-1f ① 跨層直搜結果(品牌 車型 字面)── */
          <>
            <div className="fd-step-label">符合「{query.trim()}」的車款</div>
            {crossResults.map((e) => (
              <button key={`${e.brand.id}:${e.model.id}`} className="fd-row" onClick={() => pickCrossEntry(e)}>
                <span>{e.label}</span>
                {chevron}
              </button>
            ))}
            {crossResults.length === 0 && (
              <div className="fd-veh-empty">查無符合的車款,請調整關鍵字</div>
            )}
          </>
        ) : !vehBrand ? (
          <>
            <div className="fd-step-label">選擇品牌</div>
            {brands.map((b) => (
              <button key={b.id} className="fd-row"
                onClick={() => { setVehBrand(b); setQuery(''); }}>
                <span>{b.name}</span>
                {chevron}
              </button>
            ))}
            {brands.length === 0 && <div className="fd-veh-empty">查無符合的品牌,請調整關鍵字</div>}
          </>
        ) : !vehModel ? (
          <>
            <button className="fd-back" onClick={() => { setVehBrand(null); setQuery(''); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              {vehBrand.name}
            </button>
            <div className="fd-step-label">選擇車型</div>
            {models.map((m) => (
              <button key={m.id} className="fd-row"
                onClick={() => { setVehModel(m); setQuery(''); }}>
                <span>{m.name}</span>
                {chevron}
              </button>
            ))}
            {models.length === 0 && <div className="fd-veh-empty">查無符合的車型,請調整關鍵字</div>}
          </>
        ) : (
          <>
            <button className="fd-back" onClick={() => { setVehModel(null); setQuery(''); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              {vehBrand.name} / {vehModel.name}
            </button>
            <div className="fd-step-label">選擇年份</div>
            {vehModel.years.length === 0 ? (
              /* V-1f:無年份車型 → 「不限年份」套用出口(修 V-1b2 年份層卡死;對齊桌機 modelNoYears) */
              <button className={`fd-row ${noYearApplied ? 'is-active' : ''}`} onClick={applyNoYear}>
                <span>不限年份(此車型套用全部)</span>
                {noYearApplied && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
                )}
              </button>
            ) : (
              <>
                {years.map((y) => (
                  <button key={y}
                    className={`fd-row ${isYearActive(y) ? 'is-active' : ''}`}
                    onClick={() => {
                      dispatch(selectVehicleBrand(vehBrand.name));
                      dispatch(selectVehicleModel(vehModel.name));
                      dispatch(selectVehicleYear(y));
                    }}>
                    <span>{y}</span>
                    {isYearActive(y) && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                  </button>
                ))}
                {years.length === 0 && <div className="fd-veh-empty">查無符合的年份,請調整關鍵字</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
