/**
 * Currency: PCM 支援幣別。
 *
 * Phase 1 + Phase 2 PRD 範圍只支援 TWD;
 * 拍板 P1=改'TWD'單一(YAGNI、未來加幣別改一字、零成本、不需預留)。
 */
export type Currency = 'TWD';

/**
 * Money: 金額 value-object。
 *
 * 對齊 CLAUDE.md「Server 端鐵則」精神:整數運算、避免浮點誤差。
 * `amount` 必為整數、單位為最小貨幣單位:
 *   - TWD: 元位整數(例:NT$ 4,000 → amount: 4000)
 *
 * 守門責任在 use-case 層(`Number.isInteger(amount)` guard);
 * 本 type 為 type-only stub、不執行 runtime 守門(實作 M-1-02 起)。
 *
 * @see backlog #13 — Money.amount 守門策略待 M-1-02 重檢
 */
export type Money = {
  /** 整數、最小貨幣單位 */
  amount: number;
  currency: Currency;
};

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
