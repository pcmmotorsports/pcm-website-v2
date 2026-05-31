'use client';

// VehiclesTab.tsx — 會員中心「我的愛車」分頁(g-1a stub → g-6a 唯讀列表 → g-6b 新增表單 → g-6c 編輯/刪除/設主車)
//
// 字面從 design-reference/components/AccountPages.jsx vehicles tab(L580-620)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「我的愛車」+ .acc-add「＋ 新增車輛」鈕(design L584)
// - .acc-bikes 容器 + vehicles.map → .acc-bike 卡(.acc-bike-primary〔v.isPrimary〕+ ap-mono Primary/Secondary +
//   h3 車型 + .acc-bike-meta 年份·引擎號 + .acc-bike-stats 里程/已改裝/最近保養條件渲染)
// - .acc-addr-actions「編輯 / 刪除」鈕(design L600-603、複用 address actions class + style marginTop:12):
//   編輯 toggle 開該卡 inline 編輯表單、刪除接 deleteVehicleAction
// - 空清單 → design 字面「尚未新增愛車 — 新增後可記錄改裝履歷。」(.acc-empty、design L613)
// - InlineVehicleForm 顯於對應位置:編輯模式接在該卡後(design L606-609)、新增模式於清單底部(design L615-618)
//
// 單一 inline 表單狀態(對齊 design vehEdit、L385/L601/L607/L617):
// - vehEdit = null → 表單全關;無 id → 新增模式(清單底部);有 id → 編輯該筆(該卡後)。
// - 同一時間只開一個表單(新 state 覆蓋舊 state、天然互斥、對齊 design 單一 vehEdit)。
//
// g-6c 接 e-2b session-write(InlineVehicleForm onSubmit prop 可重用):
// - 新增 → addVehicleAction(g-6b);編輯 → (input) => updateVehicleAction(v.id, input)(id 綁 parent closure)
// - 刪除 → confirm('確定要刪除這輛車？')(直接搬 design L400)→ deleteVehicleAction(v.id) → ok 後 router.refresh()
// - **設主車無獨立鈕**(design 卡片只有編輯/刪除、已 grep 確認):改主車靠編輯表單「設為主要車輛」勾選 → updateVehicle 內建 swap;
//   setPrimaryVehicle use-case 本 UI 不接、不硬塞按鈕。
// - **絕不搬 design localStorage mock 愛車**(只渲染真 vehicles prop);design L803 VehicleModal dead code(return null)不搬
//
// 對應 backlog:#200(我的愛車車款 → filter 連動、綁 Phase 2)、#201(name min(1) vs trim 跨 address/vehicle)。
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerVehicle } from '@pcm/domain';
import { InlineVehicleForm, type InlineVehicleInitial } from '@/components/account/InlineVehicleForm';
import {
  addVehicleAction,
  updateVehicleAction,
  deleteVehicleAction,
} from '@/app/account/vehicle/actions';

export type VehiclesTabProps = {
  vehicles: CustomerVehicle[];
};

export function VehiclesTab({ vehicles }: VehiclesTabProps) {
  // 單一 inline 表單狀態(對齊 design vehEdit):null=全關 / 無 id=新增 / 有 id=編輯該筆。
  const [vehEdit, setVehEdit] = useState<InlineVehicleInitial | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // 刪除:design L399-406 deleteVehicle 內 confirm('確定要刪除這輛車？')確認後刪、直接搬(L602 刪除鈕呼叫 handler);
  // 接 deleteVehicleAction(ownership 由 use-case + RLS 守);ok 才 router.refresh()(清單即時刷新);
  // 失敗時 design 無刪除錯誤 UI、不刷新留卡片(graceful、不偽裝成功)。
  const handleDelete = (id: string) => {
    // 同步、user gesture 內彈確認(對齊 design L400 原字面);取消即不刪。
    if (!confirm('確定要刪除這輛車？')) return;
    startTransition(async () => {
      const result = await deleteVehicleAction(id);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <div className="acc-section" data-tab="vehicles">
      <div className="acc-section-head">
        <h2>我的愛車</h2>
        <button
          className="acc-add"
          onClick={() => setVehEdit({ isPrimary: vehicles.length === 0 })}
        >
          ＋ 新增車輛
        </button>
      </div>
      <div className="acc-bikes">
        {vehicles.map((v) => (
          <Fragment key={v.id}>
            <div className={'acc-bike' + (v.isPrimary ? ' acc-bike-primary' : '')}>
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
              <div className="acc-addr-actions" style={{ marginTop: 12 }}>
                {/* 編輯 toggle:點開該卡編輯表單;再點同卡收合(對齊 design L601 setVehEdit toggle) */}
                <button onClick={() => setVehEdit(vehEdit?.id === v.id ? null : v)}>編輯</button>
                <button onClick={() => handleDelete(v.id)}>刪除</button>
              </div>
            </div>
            {vehEdit?.id === v.id && (
              <div
                className="acc-inline-form"
                ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
              >
                <InlineVehicleForm
                  veh={vehEdit}
                  onClose={() => setVehEdit(null)}
                  // id 綁 parent closure(對齊 InlineVehicleForm 註解設計:form 保持 generic、action 由 parent 帶 id)。
                  onSubmit={(input) => updateVehicleAction(v.id, input)}
                />
              </div>
            )}
          </Fragment>
        ))}
        {vehicles.length === 0 && (
          <div className="acc-empty">尚未新增愛車 — 新增後可記錄改裝履歷。</div>
        )}
        {vehEdit && !vehEdit.id && (
          <div
            className="acc-inline-form"
            ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
          >
            <InlineVehicleForm
              veh={vehEdit}
              onClose={() => setVehEdit(null)}
              onSubmit={addVehicleAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
