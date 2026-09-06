/**
 * computeTax —— 經銷單(未稅列)的營業稅,純函式。
 *
 * 🎯 **它為什麼存在**:M-2-08 讓經銷會員在顧客站看到 **store(未稅)價**。
 *   而**接上未稅價卻沒有算稅 ⇒ 經銷商刷卡少收 5%, 而每一格都會綠**
 *   (沒有任何一格在問「這張單的稅對不對」)⇒ 那正是本檔存在的理由。
 *
 * ── 四條依據(全部是拍板,逐字 + 座標;正本 `~/pcm-mailbox/端Sean-0905早上佇列.md`)──
 *   1. `:1589`(Q24)「甲=未稅 但是不標未稅, **單純 刷卡+5%, 匯款不用**」
 *   2. `:440`      「手動建單單價**一律填未稅**, 系統算稅」
 *   3. `:441`      「甲 = 稅基含運費(**小計 + 運費 × 5%**)」
 *   4. `:442`      「**既有的單不回頭重算**」
 *
 * ── 🔴 捨入:整單一次四捨五入(查證題, 不是拍板題;2026-09-07 查官方來源)──
 *   ① 營業稅法 §14 逐字「尾數不滿通用貨幣一元者, **按四捨五入計算**」
 *   ② 施行細則 §32-1 **射程只到【賣給非營業人】且分母是【當期總額】** ⇒ 三聯式套不上它
 *   ③ 🔴 **最強的一條是【結構】不是【解釋】**:財政部電子發票 MIG V4.1(第 42/44 頁)——
 *      品項 `ProductItem` 層**只有 `Amount`、沒有 `TaxAmount`**;`TaxAmount` 只在發票層出現一次
 *      ⇒ 📌 **資料結構上就排除了逐項算稅。**
 *   ⚠️ **未確認**:沒有專門講「多品項捨入」的解釋令;部落格「國稅局確認可比照」是二手 ⇒ **不採**。
 *
 * ── 🛑 它答不出什麼(先寫, 免得下一個人以為它管全部)──
 *   · 它**只管 `exclusive`(未稅列)的單**。`inclusive` 的單一個字都不改(依據 4)。
 *   · 它**不決定哪張單是 `exclusive`** —— 那是 `orders.price_tax_mode`(`20260905360000:89`)。
 *   · 它**不管折扣**:今天呼叫端的 discount 一律 0(`20260905360000:30` 逐字
 *     「稅基 = subtotal + shipping_fee − discount_total(本函式的 discount_total 寫死 0)」)
 *     ⇒ 本檔**收 discount 參數但預設 0**, 讓「哪天真的有折扣」是**改呼叫端**不是改這裡。
 */

/** 營業稅率(5%)。🔴 寫成常數不是字面 —— 它會出現在測試的期望值裡, 兩邊必須是同一顆。 */
export const VAT_RATE = 0.05;

/** 付款方式決定要不要外加稅(Sean Q24 逐字「刷卡+5%, 匯款不用」)。 */
export type TaxablePaymentMethod = 'card' | 'bank_transfer';

export type ComputeTaxInput = {
  /** 商品小計,**未稅**、元位整數。 */
  readonly subtotalUntaxed: number;
  /**
   * 運費,**未稅**、元位整數。
   * 🔴 **「未稅」這三個字是這一格的全部** —— 依據 `:441` 的算式(小計 + 運費)× 5%
   * 與 `:440`(一律填未稅)⇒ 經銷單的 100 元運費會變成客人付 105。
   * ⚠️ 而**今天系統裡那 100 元沒有任何一處說它含不含稅**
   * (`order/shipping.ts:32` 只寫「宅配未滿門檻運費(NT$、元位整數)」)
   * ⇒ 🛑 **呼叫端有責任送未稅的數進來**;本函式**證不了**它收到的是哪一種。
   */
  readonly shippingUntaxed: number;
  /** 付款方式。`bank_transfer` ⇒ 不加稅(Q24)。 */
  readonly paymentMethod: TaxablePaymentMethod;
  /** 折扣(未稅、元位整數)。今天呼叫端一律 0 —— 見檔頭。 */
  readonly discountUntaxed?: number;
};

export type ComputeTaxResult = {
  /** 稅基 = 小計 + 運費 − 折扣(皆未稅)。**負數會被夾到 0**, 見下。 */
  readonly taxableBase: number;
  /** 營業稅(元位整數)。匯款 ⇒ 0。 */
  readonly tax: number;
  /** 應付總額 = 稅基 + 稅。 */
  readonly total: number;
};

/**
 * 🔴 **捨入只在這一處** —— 查證結果若哪天翻成「逐列」, **改這一個函式就夠了**。
 *   ⚠️ `Math.round` 對**負數**是往 +∞(`Math.round(-0.5) === -0`)⇒ 與「四捨五入」的直覺不同。
 *   而本函式的稅基**夾在 0 以上**(見 `computeTax`)⇒ 走不到負數那一格;
 *   📌 **仍然寫出來** —— 因為「今天走不到」不是「以後走不到」。
 */
function roundHalfUp(n: number): number {
  return Math.round(n);
}

export function computeTax(input: ComputeTaxInput): ComputeTaxResult {
  const discount = input.discountUntaxed ?? 0;
  const raw = input.subtotalUntaxed + input.shippingUntaxed - discount;
  // 🔴 **負稅基夾到 0, 而不是回一個負稅** —— 形狀抄後台那支
  //    (`20260905360000_…:443` 附近的「負稅基閘」)⇒ 不自創第二種處置。
  //    🛑 而它**不出聲** —— 這裡是純函式, 出聲是呼叫端的事;
  //      而「折扣大於小計」今天走不到(discount 恆 0)。
  const taxableBase = raw > 0 ? raw : 0;
  const tax =
    input.paymentMethod === 'bank_transfer' ? 0 : roundHalfUp(taxableBase * VAT_RATE);
  return { taxableBase, tax, total: taxableBase + tax };
}
