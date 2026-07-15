'use client';

// FilterDrawerVehicleTab.tsx — 手機抽屜「依車輛搜尋」tab(V-1b2;自 FilterDrawer 抽出=鐵則 6
// 381 行+加料破 400 必拆)。外殼維持 tap 逐層 drill(手機慣用),加「打字快速找車」過濾列=
// V-1 統一核心(lib/vehicle-match:NFKC/prefix 優先/字典字面直出零猜)、與桌機 VehicleSelect
// 同比對邏輯不同殼(值班台 plan verdict:統一=共用核心、外殼依掛載點變形)。
// drill/選定的 dispatch 語意與抽出前逐行同;⚠️ 抽出副作用:drill 位置 state 隨條件渲染
// 掛/卸=切到別的 tab 或關抽屜再回來會重置回品牌層(抽出前 FilterDrawer 常駐、drawer 開著
// 切 tab 會保留位置)——重開重選=可接受的 fresh 起點、Sean 實測不順再調。換層自動清查詢。

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

export function FilterDrawerVehicleTab({
  motoBrands,
  cascade,
  dispatch,
}: {
  motoBrands: MockMotoBrand[];
  cascade: CascadeFilterState;
  dispatch: Dispatch<CascadeFilterAction>;
}) {
  const [vehBrand, setVehBrand] = useState<MockMotoBrand | null>(null);
  const [vehModel, setVehModel] = useState<MockMotoModel | null>(null);
  const [query, setQuery] = useState('');

  const isYearActive = (y: number) =>
    !!cascade.vehicle &&
    cascade.vehicle.brand === vehBrand?.name &&
    cascade.vehicle.model === vehModel?.name &&
    cascade.vehicle.year === y;

  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
  );

  const brands = filterVehicleOptions(motoBrands, query, (b) => b.name);
  const models = vehBrand ? filterVehicleOptions(vehBrand.models, query, (m) => m.name) : [];
  const years = vehModel ? filterVehicleOptions(vehModel.years, query, (y) => String(y)) : [];

  return (
    <div className="fd-veh">
      <input
        type="search"
        inputMode="search"
        className="fd-veh-search"
        placeholder="打字快速找車(例:ya、r6)"
        aria-label="打字快速找車"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!vehBrand ? (
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
    </div>
  );
}
