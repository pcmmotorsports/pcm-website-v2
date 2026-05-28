// OrdersTab.tsx — 會員中心「訂單記錄」分頁(g-2:空狀態,真資料待 M-3)
//
// design AccountPages.jsx orders tab(L538-557)用 mock orders.map 列訂單;PCM 真用戶
// Phase 1 階段 0 筆訂單(M-3 才接真訂單流程)、g-2 走 acc-empty 空狀態 business override、
// 絕不搬 design mock 訂單字面(PCM-2026-0042 / NT$ 18,600 / 已出貨 等)。
//
// 對齊 design 殼 .acc-section + .acc-section-head h2「訂單記錄」、避免 M-3 接真資料時殼破。
// 文案:「目前尚無訂單紀錄」+ sub「您的購買紀錄會顯示在此」(codex k1 C4:避免「上線後」誤導)。

export function OrdersTab() {
  return (
    <div className="acc-section" data-tab="orders">
      <div className="acc-section-head">
        <h2>訂單記錄</h2>
      </div>
      <div className="acc-empty">
        目前尚無訂單紀錄
        <div className="acc-empty-sub">您的購買紀錄會顯示在此</div>
      </div>
    </div>
  );
}
