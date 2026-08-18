// FavoritesTab.tsx — 會員中心「收藏清單」分頁(g-3:空狀態,後端待建 backlog #191)
//
// design AccountPages.jsx favorites tab(L561-578)用 data.products.slice(0, 6) mock
// 渲染 6 件「假收藏」、非真實使用者收藏資料。PCM 真用戶 Phase 1 階段:
// - 後端無 favorites entity / port / use-case / adapter(backlog #191 / 2026-05-27 g-1 拍 Q1=A)
// - ~~商品頁亦無「加入收藏」按鈕、無從產生真收藏~~
//   🔴 **這一句 2026-08-18 起不成立,而它會讓下一個人判錯**(留痕不刪):
//   愛心鈕**現在到處都是** —— `ProductCard.tsx:154`(商品卡,四個掛載面都有)
//   與 `ProductInfo.tsx:369`(商品頁本體)。
//   🔴 **兩顆的出沒裝置不一樣(2026-08-18 真瀏覽器量的,不是推的)**:
//     `.pcard-heart`  商品卡那顆 —— ~~390 與 1440 都看得見(390 實測 2/2 可見)~~
//       🔴🔴 **2026-08-18 更正:上面那句是我量錯的。** 它 `opacity: 0`,
//       **只有 `.pcard:hover` 才浮出來**(`product-card.css:126`+`:143`,全樹無 `@media (hover:none)` 覆寫)。
//       兩個世界實測:未 hover ⇒ `opacity` **0**;真 hover(`:hover` 偽類成立)⇒ **1**。
//       ⇒ **手機沒有 hover ⇒ 那顆愛心在手機上是【看不見】的。**
//       ⇒ 我原本的判準是 `rect.width > 0`,而 `opacity:0` 的元素照樣有 rect。**尺說看得見,客人看不到。**
//       🔴 而它**照樣吃點擊**(`pointer-events: auto`、32×32、貼在每張商品圖右上角):
//       實測在它的中心座標點下去 ⇒ `elementFromPoint` 命中它的 `<svg>`、
//       **網址沒有變**(`/products` → `/products`)⇒ **那一下沒有打開商品,被吃掉了。**
//       ⇒ 手機客人在那個角落點商品 = 沒反應,而他看不到任何東西擋在那裡。
//     `.pd-like`      商品頁那顆 —— 390 **量不到**(`display:none`、rect 0×0)、1440 **看得見**(48×48)
//   ⇒ **手機上只有商品卡那顆會被點到。** 要拿掉的話兩顆都要拿,不然桌機還留著一顆。
//   🔴 而 `.pd-like` 那顆還會把假成功**講給讀螢幕軟體聽**:
//     實測點一下 ⇒ `aria-pressed` 由 `"false"` 變 `"true"`、class 加 `is-liked`、
//     `fill` 由 `none` 變 `currentColor`,而 `localStorage` 仍然只有購物車那兩把鑰匙。
//   ⚠️ **但它們不產生真收藏**:`ProductCard.tsx:155` 的 onClick 只有 `setLiked(!liked)`
//   = **純 React 畫面狀態**,沒有任何持久化。
//   `ProductInfo.tsx` 那顆同款,而且**可以窮舉**:全檔 `grep -n liked` **6 個命中**
//   (`:194` 註解 / `:197` `useState(false)` / `:367` className / `:368` onClick / `:370` aria-pressed
//    / `:376` fill),**沒有任何一個在 effect、localStorage 或送 server 的路徑上**
//   (該檔唯一的 `useEffect`(`:202`)重設的是 `qty`,不是 `liked`)。
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
