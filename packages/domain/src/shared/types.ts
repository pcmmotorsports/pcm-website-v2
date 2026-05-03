/**
 * Currency: PCM 支援幣別。
 *
 * Phase 1 + Phase 2 PRD 範圍只支援 TWD;
 * 拍板 P1=改'TWD'單一(YAGNI、未來加幣別改一字、零成本、不需預留)。
 */
export type Currency = 'TWD';

/**
 * MoneyAmount: brand type 守門金額。
 *
 * 對齊 ADR-0004 Q4=A3 + docs/patterns/money-handling.md §1.1:
 * - number 子類、JSON 序列化直接出 int
 * - 必為整數(浮點誤差防呆)、必為非負
 * - 強制走 toMoneyAmount() helper 集中守門、不允許 `as MoneyAmount` 強轉
 */
export type MoneyAmount = number & { readonly __brand: 'MoneyAmount' };

/**
 * Money: 金額 value-object。
 *
 * 對齊 CLAUDE.md「Server 端鐵則」精神:整數運算、避免浮點誤差。
 * `amount` 為 brand type MoneyAmount(集中守門)、單位為最小貨幣單位:
 *   - TWD: 元位整數(例:NT$ 4,000 → amount: 4000 過 toMoneyAmount() guard)
 *
 * @see docs/patterns/money-handling.md(brand type 守門規範)
 * @see ADR-0004 Q4=A3(brand type 拍板)
 */
export type Money = {
  /** brand type、整數、最小貨幣單位 */
  amount: MoneyAmount;
  currency: Currency;
};

/**
 * 將 number 守門轉成 MoneyAmount。
 *
 * - 必為 integer(浮點誤差防呆)
 * - 必為 ≥ 0(非負)
 * - 不在 use-case 散寫 Number.isInteger guard、統一走 toMoneyAmount()
 *
 * 對齊 docs/patterns/money-handling.md §1.1 + ADR-0004 Q4=A3。
 */
export function toMoneyAmount(n: number): MoneyAmount {
  if (!Number.isInteger(n)) {
    throw new Error(`MoneyAmount must be integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(`MoneyAmount must be non-negative, got ${n}`);
  }
  return n as MoneyAmount;
}

/**
 * MemberTier: 三級會員等級。
 *
 * 對齊 ADR-0003 §4 #8 + PHASE-1-NORTHSTAR §3:
 * - design 字面無 UI 標示
 * - Medusa wire 是 customer_group(string)
 * - domain 用 enum 業務語意
 *
 * 業務含義:
 * - `general` 一般會員(註冊即開通、看零售價)
 * - `store` 經銷商(管理員手動審核、看經銷價)
 * - `premiumStore` 高級店家(累積儲值 ≥ NT$ 100,000、經銷價再 -3~5%)
 *
 * 跨 context 共用:catalog 用於 PriceByTier、identity 用於 Customer.tier;
 * 跨 context 共用 type 住 shared/、避免 catalog ↔ identity 雙向依賴。
 */
export type MemberTier = 'general' | 'store' | 'premiumStore';
