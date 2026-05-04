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

/**
 * 分頁參數(對齊 backlog #20)
 *
 * 用於 list / search 類 method 限制單次返回 row 數、避免 5w SKU 規模 over-fetch。
 *
 * @property limit  單次返回上限(必填、典型 20-100)
 * @property offset offset-based 分頁(可選、跟 cursor 二擇一)
 * @property cursor cursor-based 分頁(可選、適用 timestamp / id 連續流)
 *
 * @see packages/ports/src/IProductRepository.ts:searchByKeyword
 * @see docs/phase-1-backlog.md #20
 */
export type PaginationParams = {
  limit: number;
  offset?: number;
  cursor?: string;
};

/**
 * 分頁結果包(對齊 backlog #20)
 *
 * 通用 generic、適用任何 entity list 結果。T 為 entity 型(例:Paginated<Product>)。
 *
 * @property items      本頁 entity 陣列
 * @property total      總筆數(可選、cursor 模式可省、提供時方便 UI 顯示「共 N 筆」)
 * @property nextCursor 下一頁 cursor(可選、cursor 模式 only;若無下一頁回 undefined)
 *
 * @see packages/ports/src/IProductRepository.ts:searchByKeyword
 * @see docs/phase-1-backlog.md #20
 */
export type Paginated<T> = {
  items: T[];
  total?: number;
  nextCursor?: string;
};
