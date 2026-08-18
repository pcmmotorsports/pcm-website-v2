// FavoritesTab.tsx — 會員中心「收藏清單」分頁(g-3:空狀態,後端待建 backlog #191)
//
// design AccountPages.jsx favorites tab(L561-578)用 data.products.slice(0, 6) mock
// 渲染 6 件「假收藏」、非真實使用者收藏資料。PCM 真用戶 Phase 1 階段:
// - 後端無 favorites entity / port / use-case / adapter(backlog #191 / 2026-05-27 g-1 拍 Q1=A)
// - ~~商品頁亦無「加入收藏」按鈕、無從產生真收藏~~
//   🔴 **這一句 2026-08-18 起不成立,而它會讓下一個人判錯**(留痕不刪):
//   愛心鈕**現在到處都是** —— `ProductCard.tsx:154`(商品卡,四個掛載面都有)
//   與 `ProductInfo.tsx:369`(商品頁本體)。
//   ⚠️ **但它們不產生真收藏**:`ProductCard.tsx:155` 的 onClick 只有 `setLiked(!liked)`
//   = **純 React 畫面狀態**,沒有任何持久化。
//   本機實測(2026-08-18,真瀏覽器 390×844、真資料):
//     點愛心 ⇒ `fill` 由 `none` 變 `var(--c-red)`（畫面告訴客人「收藏成功」）
//     `localStorage` ⇒ 只有購物車那兩把鑰匙,**零收藏**
//     重新整理同一頁 ⇒ 12 顆愛心,紅的 **0** 顆
//     本分頁 ⇒ 仍然「目前尚無收藏商品」
//   🔴 ⇒ 現況比原註解描述的**更糟**:不是「沒有入口所以不會誤會」,
//      是「**有入口、而且會回報成功**」。要不要先拿掉那顆愛心 = Sean 的題,已端上去
//      (artifact `3ffcec9e-1e32-468c-a47f-074df3f049dc` 第二節)。
// - M-3 接 #191 後端後、本檔換成 useFavorites() 真清單
//   (~~補商品頁按鈕~~ 那半已經有人做了,剩下的是把它接上後端)
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
