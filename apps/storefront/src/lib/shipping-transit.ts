// shipping-transit.ts — 宅配「出貨後幾個工作天送達」的唯一來源(2026-09-22)。
// 配送說明頁、結帳頁的文字與商品頁給 Google 的 shippingDetails 都讀這裡 ⇒ 改一處三處一起變。
// 🔴 這是【出貨後】的宅配時間, 不是交期(#291 Sean 07-24 拍 Q2=A:訂貨另需約 2-12 週, 見 /terms 第 7 條)。
export const HOME_TRANSIT_BUSINESS_DAYS = { min: 1, max: 3 } as const;

/** 畫面用的文字:「出貨後 1-3 個工作天」。 */
export const HOME_TRANSIT_TEXT = `出貨後 ${HOME_TRANSIT_BUSINESS_DAYS.min}-${HOME_TRANSIT_BUSINESS_DAYS.max} 個工作天`;

/**
 * 出貨前的備貨交期(週),#291 Sean 07-24 拍 Q2=A:訂貨約 2–12 週(/terms 第 7 條、商品頁 FAQ 同一個區間)。
 * 給 Google 的 handlingTime 用(2026-09-25 Search Console「handlingTime 欄位未填」)。
 * 守門:`shipping-transit.test.ts` 比對 /terms 第 7 條,任一邊改了沒改另一邊就紅。
 */
export const HANDLING_WEEKS = { min: 2, max: 12 } as const;

