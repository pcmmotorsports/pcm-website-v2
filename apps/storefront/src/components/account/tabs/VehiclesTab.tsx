// VehiclesTab.tsx — 會員中心「我的愛車」分頁(g-1a stub → g-6a 唯讀列表;寫入留 g-6b/g-6c)
//
// 字面從 design-reference/components/AccountPages.jsx vehicles tab(L580-620)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「我的愛車」(沿用 AddressTab g-5a 唯讀殼 pattern)
// - .acc-bikes 容器(grid)+ vehicles.map → .acc-bike 卡(v.isPrimary→加 .acc-bike-primary class):
//   .ap-mono Primary/Secondary + h3 車型 v.name + .acc-bike-meta「{year}{engine? ' · 引擎號 '+engine:''}」
//   + .acc-bike-stats(條件:km/mods/service 任一有值才渲染)逐項里程/已改裝/最近保養(各自有值才顯)
// - 空清單 → design 字面「尚未新增愛車 — 新增後可記錄改裝履歷。」(.acc-empty、design L613)
//
// g-6a 唯讀地基(只渲染 server 傳入的真 vehicles prop、鏡像 g-5a AddressTab):
// - **不渲染** design L584 .acc-add「＋ 新增車輛」鈕 + L600-603 .acc-addr-actions「編輯/刪除」鈕 + InlineVehicleForm
//   (寫入互動:新增留 g-6b、編輯/刪除/設主車留 g-6c;g-6a 先不渲染 action 鈕、避免 dead button)
// - **絕不搬 design mock 愛車**(design 用 localStorage pcm-vehicles + 2 筆假車 L378-379;本檔只渲染真 vehicles prop)
// - design L678 VehicleModal 是 dead code(`return null`、同 AddressModal)、不搬;真表單用 InlineVehicleForm(留 g-6b)
//
// 對應 backlog:#200(我的愛車車款 → filter 快速帶入、跨 bounded context〔Identity↔Catalog〕連動、綁 Phase 2 結構化 vehicles;
//   g-6a 唯讀列表不接、車款維持 design 自由文字 name)。
import type { CustomerVehicle } from '@pcm/domain';

export type VehiclesTabProps = {
  vehicles: CustomerVehicle[];
};

export function VehiclesTab({ vehicles }: VehiclesTabProps) {
  return (
    <div className="acc-section" data-tab="vehicles">
      <div className="acc-section-head">
        <h2>我的愛車</h2>
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
      </div>
    </div>
  );
}
