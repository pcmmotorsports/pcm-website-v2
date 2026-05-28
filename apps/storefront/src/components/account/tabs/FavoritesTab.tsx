// FavoritesTab.tsx — 會員中心「收藏清單」分頁(g-3:空狀態,後端待建 backlog #191)
//
// design AccountPages.jsx favorites tab(L561-578)用 data.products.slice(0, 6) mock
// 渲染 6 件「假收藏」、非真實使用者收藏資料。PCM 真用戶 Phase 1 階段:
// - 後端無 favorites entity / port / use-case / adapter(backlog #191 / 2026-05-27 g-1 拍 Q1=A)
// - 商品頁亦無「加入收藏」按鈕、無從產生真收藏
// - M-3 接 #191 後端 + 補商品頁按鈕後、本檔換成 useFavorites() 真清單
//
// g-3 走 acc-empty 空狀態 business override、不搬 design mock 6 件商品字面
// (LIGHTECH / RIZOMA / AKRAPOVIČ / NT$ 12,800 等)、避免假裝有收藏功能。
//
// 殼對齊 design .acc-section[data-tab="favorites"] + .acc-section-head h2「收藏清單」、
// 避免 M-3 接真清單時殼破。文案沿用 OrdersTab(g-2)pattern:正體 + sub。

export function FavoritesTab() {
  return (
    <div className="acc-section" data-tab="favorites">
      <div className="acc-section-head">
        <h2>收藏清單</h2>
      </div>
      <div className="acc-empty">
        目前尚無收藏商品
        <div className="acc-empty-sub">您的收藏會顯示在此</div>
      </div>
    </div>
  );
}
