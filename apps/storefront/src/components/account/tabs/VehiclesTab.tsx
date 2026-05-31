'use client';

// VehiclesTab.tsx — 會員中心「我的愛車」分頁(g-1a stub → g-6a 唯讀列表 → g-6b 新增表單;編輯/刪除/設主車 g-6c)
//
// 字面從 design-reference/components/AccountPages.jsx vehicles tab(L580-620)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「我的愛車」+ .acc-add「＋ 新增車輛」鈕(design L584)
// - .acc-bikes 容器(grid)+ vehicles.map → .acc-bike 卡(v.isPrimary→.acc-bike-primary class):
//   .ap-mono Primary/Secondary + h3 車型 name + .acc-bike-meta「{year}{engine? ' · 引擎號 '+engine:''}」
//   + .acc-bike-stats(條件:km/mods/service 任一有值才渲染)逐項里程/已改裝/最近保養(各自有值才顯)
// - 空清單 → design 字面「尚未新增愛車 — 新增後可記錄改裝履歷。」(.acc-empty、design L613)
// - 新增模式 InlineVehicleForm 顯於 .acc-bikes 底部(design L615-618、.acc-inline-form 包)
//
// g-6b 新增表單(本片接寫入、鏡像 g-5b):
// - 「＋ 新增車輛」鈕 → 開 InlineVehicleForm new 模式(veh.isPrimary = vehicles.length===0、對齊 design L584;
//   design 新增不預填 name〔車型是車不是人、L584 name:''〕→ 不傳 name)
// - 表單接 addVehicleAction(onSubmit prop);成功 router.refresh()〔清單即時刷新〕+ onClose()〔收合〕
// - **編輯/刪除鈕仍不渲染**(design L600-603 .acc-addr-actions 留 g-6c;g-6b 只接新增)
// - **絕不搬 design localStorage mock 愛車**(只渲染真 vehicles prop);design L803 VehicleModal dead code(return null)不搬
//
// 對應 backlog:#200(我的愛車車款 → filter 快速帶入、跨 bounded context 連動、綁 Phase 2 結構化 vehicles)。
import { useState } from 'react';
import type { CustomerVehicle } from '@pcm/domain';
import { InlineVehicleForm } from '@/components/account/InlineVehicleForm';
import { addVehicleAction } from '@/app/account/vehicle/actions';

export type VehiclesTabProps = {
  vehicles: CustomerVehicle[];
};

export function VehiclesTab({ vehicles }: VehiclesTabProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="acc-section" data-tab="vehicles">
      <div className="acc-section-head">
        <h2>我的愛車</h2>
        <button className="acc-add" onClick={() => setShowForm(true)}>
          ＋ 新增車輛
        </button>
      </div>
      <div className="acc-bikes">
        {vehicles.map((v) => (
          <div className={'acc-bike' + (v.isPrimary ? ' acc-bike-primary' : '')} key={v.id}>
            <div className="ap-mono">{v.isPrimary ? 'Primary' : 'Secondary'}</div>
            <h3>{v.name}</h3>
            <div className="acc-bike-meta">
              {v.year}
              {v.engine ? ' · 引擎號 ' + v.engine : ''}
            </div>
            {(v.km || v.mods || v.service) && (
              <div className="acc-bike-stats">
                {v.km && (
                  <div>
                    <span>里程</span>
                    <b>{v.km}</b>
                  </div>
                )}
                {v.mods && (
                  <div>
                    <span>已改裝</span>
                    <b>{v.mods}</b>
                  </div>
                )}
                {v.service && (
                  <div>
                    <span>最近保養</span>
                    <b>{v.service}</b>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {vehicles.length === 0 && (
          <div className="acc-empty">尚未新增愛車 — 新增後可記錄改裝履歷。</div>
        )}
        {showForm && (
          <div className="acc-inline-form">
            <InlineVehicleForm
              veh={{ isPrimary: vehicles.length === 0 }}
              onClose={() => setShowForm(false)}
              onSubmit={addVehicleAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
