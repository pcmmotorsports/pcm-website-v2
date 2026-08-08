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
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { InlineVehicleForm, type InlineVehicleInitial } from '@/components/account/InlineVehicleForm';
import { useRevealForm } from '@/components/account/use-reveal-form';
import {
  addVehicleAction,
  updateVehicleAction,
  deleteVehicleAction,
} from '@/app/account/vehicle/actions';

export type VehiclesTabProps = {
  vehicles: CustomerVehicle[];
  /** V-1c++:車型字典(結構化 taxonomy;表單品牌/車型雙下拉用、缺省 [] 退回純自由輸入) */
  vehicleBrands?: MockMotoBrand[];
};

export function VehiclesTab({ vehicles, vehicleBrands = [] }: VehiclesTabProps) {
  // 單一 inline 表單狀態(對齊 design vehEdit):null=全關 / 無 id=新增 / 有 id=編輯該筆。
  const [vehEdit, setVehEdit] = useState<InlineVehicleInitial | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  // g-6c 手機捲動修復(Sean 08-06 回報「新增/編輯沒有自動捲到表單」):邏輯與 AddressTab 逐字相同,
  // 抽在 use-reveal-form.ts(病灶、Q1=A 為何不 focus 輸入欄、preventScroll 的理由都寫在那)。
  // 兩處 `.acc-inline-form` 包裹層都掛 `tabIndex={-1}` + `role="group"` + `aria-label`:
  // 焦點落**容器**不落輸入欄 ⇒ 手機不彈鍵盤;讀屏**預期**會念出「新增車輛 / 編輯車輛」
  // (⚠️ 真機讀屏未實測,iOS VoiceOver 不保證跟著程式化 focus 走 —— 詳見 use-reveal-form.ts);
  // 沒有 tabIndex 的話 focus() 是 no-op,沒有 role 的話 aria-label 掛在裸 div 上部分讀屏不念。
  // aria-label 是這裡手寫的第二份字面(真標題在 InlineVehicleForm 的 <h4>)⇒ 有測試釘住兩者同步。
  const formRef = useRevealForm(vehEdit);

  // 刪除:design L399-406 deleteVehicle 內 confirm('確定要刪除這輛車？')確認後刪、直接搬(L602 刪除鈕呼叫 handler);
  // 接 deleteVehicleAction(ownership 由 use-case + RLS 守);ok 才 router.refresh()(清單即時刷新);
  // 失敗時 design 無刪除錯誤 UI、不刷新留卡片(graceful、不偽裝成功)。
  // 🔴 存檔成功的收尾**由本層(父層)做**,不在表單元件內(2026-08-08、P-205-STOP ③)。
  //   關鍵差別是**發出 `router.refresh()` 的是誰**:本層的閉包(元件續存)vs 表單自己
  //   (下一拍就被 `setXxx(null)` unmount)。這與同檔已知正常的「刪除」路徑同形。
  //   ⚠️ **順序不重要,別把它當契約**:`setXxx(null)` 是 setState、**不是同步 unmount**,
  //   兩行對調在 React 語意下等價 —— 突變實測(R3 對調)**零測試會紅,而那是正確的**,
  //   不是守門缺口。我原本在這裡寫過「順序刻意」,那句是我沒想清楚,已刪。
  const handleSaved = () => {
    setVehEdit(null);
    router.refresh();
  };

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
                ref={formRef}
                tabIndex={-1}
                role="group"
                aria-label={vehEdit?.id ? '編輯車輛' : '新增車輛'}
              >
                <InlineVehicleForm
                  vehicleBrands={vehicleBrands}
                  veh={vehEdit}
                  onClose={() => setVehEdit(null)}
                  onSaved={handleSaved}
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
            ref={formRef}
            tabIndex={-1}
            role="group"
            aria-label={vehEdit?.id ? '編輯車輛' : '新增車輛'}
          >
            <InlineVehicleForm
              vehicleBrands={vehicleBrands}
              veh={vehEdit}
              onClose={() => setVehEdit(null)}
                  onSaved={handleSaved}
              onSubmit={addVehicleAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
