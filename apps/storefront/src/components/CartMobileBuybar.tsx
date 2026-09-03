'use client';

/**
 * CartMobileBuybar — 手機版購物車底部固定列(總計 + 前往結帳)。
 *
 * 🔴 **為什麼存在**:板列 `⟦f3-MOBCHECKOUTFOLD⟧` 實量 —— 手機上購物車只放 1 件時,
 *    「前往結帳」要捲**兩個半螢幕**才摸得到。⇒ 已經決定要買的客人被擋在最後一步。
 *    Sean 2026-09-03 拍 `Q26 = 乙`(只改結帳鈕;**輪播點那半他沒批,不要碰**)。
 *
 * 🔴 **抄哪裡**:抄本 repo 自己的 `checkout.css` 手機 buybar(`:709` 起),**不是回頭抄稿** ——
 *    我們那份在稿之上多了三樣稿沒答的現實:`body:has()` 讓頁尾讓位、
 *    `env(safe-area-inset-bottom)`、以及一個**量出來的**高度。稿仍是權威,
 *    而落地版 = 稿 + 那三格現實(鐵則 1 不衝突:沒有翻譯稿,只補了稿沒畫的)。
 *
 * 🛑 **為什麼抽成獨立檔**:`CartView.tsx` 當時 **399 行**,直接加這段會過鐵則 6 的 400。
 *    ⇒ 而抽出來的理由不只是行數:這一塊只在手機出現、只讀兩個值,
 *    與 CartView 的購物車狀態機沒有耦合。
 *
 * 🔵 **為什麼「繼續購物」不放進來**(Sean 沒指定,我的判斷、已寫進 commit body):
 *    那顆是**離開動線**的鈕。固定列 = 永遠看得到 ⇒ 把離開的路永遠擺在眼前會提高放棄率。
 *    ⇒ 它留在原位(捲下去看得到),沒有被移除。
 *
 * ⚠️ **這個元件在什麼情況下會變成假的**:`.cart-mobile-buybar` 的高度一改,
 *    `cart.css` 那條 `body:has()` 的讓位數字就要**重量**(它是量出來的、不是算出來的)。
 */
export function CartMobileBuybar({
  total,
  onCheckout,
}: {
  /** 已含運費的應付總額(與 `.cart-grand` 同一個值、同一次計算 —— 不重算)。 */
  total: number;
  /** 與頁面上那顆 `.cart-checkout` 走同一個 handler,不另開一條路。 */
  onCheckout: () => void;
}) {
  return (
    <div className="cart-mobile-buybar">
      <div className="cart-mobile-buybar-info">
        <div className="ap-mono">總計</div>
        <div className="cart-mobile-buybar-price">NT$ {total.toLocaleString()}</div>
      </div>
      <button className="btn-primary cart-mobile-buybar-btn" onClick={onCheckout}>
        前往結帳 <span>→</span>
      </button>
    </div>
  );
}
