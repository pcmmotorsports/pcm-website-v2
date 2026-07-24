// balance-payment.ts — 補差額商品(賣場 1 元商品、變體 PCM-BALANCE-1、supplier_slug=manual)專用規則。
//
// 用途:客人補差額 / 運費差額的付款載體(Sean 2026-07-24)。問題=NT$1 補款走宅配會被加 NT$100 運費、
// 不合「補差額」用途。解法(Sean 拍 A 案、低風險路):結帳走「自取」(store)配送 → 免運
// (重用既有 create_order RPC §7 `store→0` 與前台 calculateShippingFee `store→0`,**零金流 RPC 改動**)。
//
// 🔴 免運僅在「整車都是補差額商品」時生效:混入任何一般商品 → 回宅配(home)照常收運費 →
//   天然防「混車偷吃步免運」(混車永遠拿不到免運、無 gaming 誘因)。
//
// 🔴 前後台同步鏡像:前台傳 shippingMethod='store' 給 create_order、server 端 §7 亦 store→0,
//   兩側運費一致、無顯示漂移(鐵則 3)。

/** 補差額商品的 product handle(= 賣場商品 slug、cart line 的 productId)。 */
export const BALANCE_PAYMENT_HANDLE = 'pcm-balance-payment';

/**
 * 購物車是否「只含補差額商品」(≥1 件、且每一件都是補差額 handle)。
 * true → 結帳走自取免運;false(空車 / 含一般商品)→ 宅配照常。
 */
export function isBalancePaymentOnlyCart(productIds: readonly string[]): boolean {
  return productIds.length > 0 && productIds.every((id) => id === BALANCE_PAYMENT_HANDLE);
}
